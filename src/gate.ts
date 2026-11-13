/**
 * Scoregraft payment gate — score -> ALLOW / REVIEW / BLOCK.
 *
 * The gate is the product: an agent asks "may I pay X NEAR to Y for Z?"
 * and the gate answers from the payer's scored on-chain behavior. Every
 * decision is written to the public audit ledger (ledger.ts) with its
 * inputs, so any judge can replay it.
 *
 * Policy (v1, published):
 *   score >= 60            ALLOW  (up to the per-payment policy cap)
 *   40 <= score < 60       REVIEW (capped at 1 NEAR, flagged for a human)
 *   score < 40             BLOCK
 *   thin-history accounts  capped at score 40 and 0.5 NEAR (see score.ts)
 * Amounts above the cap are BLOCKed even for high scores: the gate limits
 * blast radius, it does not bless unlimited spend.
 */
import { scoreAccount, THIN_HISTORY, THRESHOLDS } from "./score.js";
import type { AccountFeatures, ScoreBreakdown } from "./score.js";
import { appendLedgerEntry } from "./ledger.js";
import type { LedgerEntry } from "./ledger.js";

export type Decision = "ALLOW" | "REVIEW" | "BLOCK";

export interface PaymentRequest {
  payer: string;
  payee: string;
  amountNear: number;
  purpose: string;
  /** Policy cap for this agent's payments (NEAR). Default: 10. */
  policyCapNear?: number;
  /** Transaction hashes the payer's features were computed from. */
  evidenceTxHashes?: string[];
}

export interface GateResult {
  decision: Decision;
  score: ScoreBreakdown;
  amountNear: number;
  capAppliedNear: number | null;
  reason: string;
  ledgerEntry: LedgerEntry;
}

export function decide(
  features: AccountFeatures,
  req: PaymentRequest,
): GateResult {
  const score = scoreAccount(features);
  const policyCap = req.policyCapNear ?? 10;
  let decision: Decision;
  let reason: string;
  let capApplied: number | null = null;

  if (score.thinHistory) {
    if (req.amountNear > THIN_HISTORY.maxPaymentNear) {
      decision = "BLOCK";
      reason =
        `thin history (${score.thinReason}); payments above ` +
        `${THIN_HISTORY.maxPaymentNear} NEAR are blocked until the account ` +
        `builds history`;
    } else if (score.score < THRESHOLDS.review) {
      decision = "BLOCK";
      reason = `thin history (${score.thinReason}) and score ${score.score} < ${THRESHOLDS.review}`;
    } else {
      decision = "REVIEW";
      capApplied = THIN_HISTORY.maxPaymentNear;
      reason =
        `thin history (${score.thinReason}); small payment allowed only ` +
        `under review cap of ${THIN_HISTORY.maxPaymentNear} NEAR`;
    }
  } else if (score.score >= THRESHOLDS.allow) {
    if (req.amountNear > policyCap) {
      decision = "BLOCK";
      reason =
        `score ${score.score} passes, but amount ${req.amountNear} NEAR ` +
        `exceeds the agent policy cap of ${policyCap} NEAR`;
    } else {
      decision = "ALLOW";
      reason = `score ${score.score} >= allow threshold ${THRESHOLDS.allow}`;
    }
  } else if (score.score >= THRESHOLDS.review) {
    if (req.amountNear > THRESHOLDS.reviewCapNear) {
      decision = "BLOCK";
      reason =
        `score ${score.score} is in review band; amounts above ` +
        `${THRESHOLDS.reviewCapNear} NEAR are blocked`;
    } else {
      decision = "REVIEW";
      capApplied = THRESHOLDS.reviewCapNear;
      reason =
        `score ${score.score} is in review band ` +
        `(${THRESHOLDS.review}-${THRESHOLDS.allow - 1}); payment capped at ` +
        `${THRESHOLDS.reviewCapNear} NEAR and flagged for a human`;
    }
  } else {
    decision = "BLOCK";
    reason = `score ${score.score} < block threshold ${THRESHOLDS.review}`;
  }

  const ledgerEntry = appendLedgerEntry({
    payer: req.payer,
    payee: req.payee,
    amountNear: req.amountNear,
    purpose: req.purpose,
    score: score.score,
    components: score.components,
    concentrationPenalty: score.concentrationPenalty,
    thinHistory: score.thinHistory,
    decision,
    reason,
    evidenceTxHashes: req.evidenceTxHashes ?? [],
  });
  return { decision, score, amountNear: req.amountNear, capAppliedNear: capApplied, reason, ledgerEntry };
}
