/**
 * Scoregraft risk score v1.1 — open formula.
 *
 * v1.1 (2026-11-11, day 5) adds the contract-call concentration penalty
 * (see concentrationPenalty below). Everything else is unchanged from v1.
 *
 * The score is computed from REAL NEAR mainnet account behavior in a fixed
 * 90-day window (see data/README.md for the window and sources). It is a
 * behavior-derived risk score, not a vendor guess: every input is a counted
 * on-chain fact, every weight is published here, and every decision cites
 * the rows it was computed from (see ledger.ts).
 *
 * Score range: 0-100. Higher = lower risk = more trustworthy payer.
 *
 * HONEST LIMITS (also in the paper, section 7):
 * - The score is only meaningful with history. New wallets have no history,
 *   so they get the thin-history default (see THIN_HISTORY below) instead of
 *   a made-up score.
 * - The score is correlational, not causal: past on-chain behavior predicts
 *   future payment reliability imperfectly, and a good score is not proof
 *   of good intent.
 * - Account age here is FIRST-SEEN-IN-WINDOW, a lower bound on true age
 *   (an account created before the window still counts from its first
 *   transfer inside the window). The paper states this plainly.
 */

export interface AccountFeatures {
  accountId: string;
  /** First transfer seen inside the window (ISO date). Lower bound on age. */
  firstSeen: string;
  /** Last transfer seen inside the window (ISO date). */
  lastSeen: string;
  /** TRANSFER actions sent in the window. */
  transferCount: number;
  /** Distinct receiver accounts. */
  uniqueCounterparties: number;
  /** Total NEAR moved out (sum of TRANSFER deposits, yoctoNEAR -> NEAR). */
  totalNear: number;
  /** Median single-transfer size in NEAR. */
  medianNear: number;
  /** Largest single transfer in NEAR. */
  maxNear: number;
  /** Share of the account's txns that failed (0-1). */
  failureRate: number;
  /** Share of the account's txns that are FUNCTION_CALL (0-1). */
  contractShare: number;
  /** ADD_KEY / DELETE_KEY actions in the window (key rotation hygiene). */
  keyRotationEvents: number;
  /** Window end date, for age computation. */
  windowEnd: string;
  /** Transaction hashes the features were computed from (evidence). */
  evidenceTxHashes?: string[];
  /** FUNCTION_CALLs signed in the window (v1.1; 0/absent = no call data). */
  functionCallCount?: number;
  /** Distinct FUNCTION_CALL method names (v1.1, diagnostic). */
  distinctCallMethods?: number;
  /** Share of the account's FUNCTION_CALLs to its top receiver (v1.1). */
  dominantCallReceiverShare?: number;
}

export interface ScoreBreakdown {
  score: number; // 0-100, rounded to 1 decimal
  components: {
    historyDepth: number; // 0-100
    counterpartyDiversity: number; // 0-100
    volumeStability: number; // 0-100
    reliability: number; // 0-100
    contractHygiene: number; // 0-100
  };
  thinHistory: boolean;
  thinReason: string | null;
  /** v1.1 concentration penalty applied (0-10 points; 0 = not applied). */
  concentrationPenalty: number;
  inputs: { accountAgeDays: number; transferCount: number };
}

/** Weights sum to 1. Published so any judge can recompute the score. */
export const WEIGHTS = {
  historyDepth: 0.25,
  counterpartyDiversity: 0.2,
  volumeStability: 0.2,
  reliability: 0.2,
  contractHygiene: 0.15,
} as const;

/**
 * Thin-history policy. An account is THIN when it has too little history
 * for the score to mean anything. Thin accounts are NEVER auto-allowed
 * above the thin cap, no matter what the raw components say.
 */
export const THIN_HISTORY = {
  minTransfers: 5,
  minAgeDays: 7,
  /** Thin accounts score at most this (below the ALLOW threshold). */
  scoreCap: 40,
  /** Thin accounts may pay at most this much NEAR per payment. */
  maxPaymentNear: 0.5,
} as const;

export const THRESHOLDS = {
  allow: 60, // score >= 60: ALLOW up to the policy cap
  review: 40, // 40-59: REVIEW, capped at 1 NEAR, flagged for a human
  // score < 40: BLOCK
  reviewCapNear: 1,
} as const;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function daysBetween(a: string, b: string): number {
  const ms =
    new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, ms / 86_400_000);
}

/**
 * History depth: rewards accounts with many transfers over a long span.
 * log-scaled so the 100th transfer matters less than the 5th; an account
 * with 5 transfers over 7 days scores low, one with 200 over 80 days high.
 */
export function historyDepth(f: AccountFeatures): number {
  const ageDays = daysBetween(f.firstSeen, f.windowEnd);
  const agePart = clamp01(ageDays / 90); // full marks at a full window
  const countPart = clamp01(Math.log10(f.transferCount + 1) / Math.log10(201));
  return 100 * (0.5 * agePart + 0.5 * countPart);
}

/** Counterparty diversity: many distinct payees beats paying one address. */
export function counterpartyDiversity(f: AccountFeatures): number {
  if (f.transferCount === 0) return 0;
  return 100 * clamp01(f.uniqueCounterparties / f.transferCount);
}

/**
 * Volume stability: a payer whose transfers are steady-sized is lower risk
 * than one whose history is one giant transfer. Penalizes max >> median.
 */
export function volumeStability(f: AccountFeatures): number {
  if (f.transferCount === 0 || f.medianNear <= 0) return 0;
  const ratio = f.maxNear / f.medianNear;
  // ratio 1 -> 100; ratio 10 -> ~55; ratio 100 -> ~20; ratio 1000 -> 0
  return 100 * clamp01(1 - Math.log10(ratio) / 3);
}

/** Reliability: failed transactions are a risk signal. */
export function reliability(f: AccountFeatures): number {
  return 100 * (1 - clamp01(f.failureRate));
}

/**
 * Contract hygiene: heavy contract interaction is not bad by itself, but
 * a pure-transfer payer is simpler to reason about; key rotation is a
 * small positive hygiene signal (capped, never decisive).
 */
export function contractHygiene(f: AccountFeatures): number {
  const base = 100 * (1 - 0.6 * clamp01(f.contractShare));
  const rotationBonus = Math.min(10, f.keyRotationEvents * 2);
  return Math.min(100, base + rotationBonus);
}

/**
 * v1.1 contract-call concentration penalty (0-10 points, subtracted from
 * the weighted score before the thin cap).
 *
 * DECIDED FROM THE MEASURED DATA (2026-11-11, final 90/90 build, n=163):
 * - 23 accounts have any FUNCTION_CALLs; only 4 have >= 10 calls. Of the
 *   10 accounts with dominant-receiver share 1.0000, 9 have just 1-2 calls,
 *   where share 1.0 is meaningless — so the penalty fires ONLY at
 *   functionCallCount >= 10 (MIN_CALLS). Below that, no penalty.
 * - Among the 4 accounts with >= 10 calls, the shares are: labeled exploit
 *   actor 1.0000 (42 calls), bridge-mng.near 0.837 (276 calls, labeled
 *   benign), tx-bench.near 0.6111 (18 calls, labeled benign),
 *   sweat-relayer.near 0.2856 (2,931 calls, labeled benign). The penalty
 *   therefore ramps from 0 at share 0.90 to the full 10 points at share
 *   1.00 — the 0.90 floor sits in the measured gap between the highest
 *   benign share (0.837) and the exploit's 1.0000, so no labeled benign
 *   account is penalized.
 * - Method count is NOT part of the penalty: the exploit actor uses 6
 *   distinct methods vs bridge-mng's 5, so method count does not separate
 *   them in this sample; penalizing "few methods" would be unjustified.
 * - The threshold is PROVISIONAL (n=1 positive). With more labeled
 *   positives it must be re-estimated; the paper says so.
 *
 * MEASURED EFFECT on this build: only the exploit actor qualifies
 * (42 calls, share 1.0000 -> penalty 10.0), and it is thin-capped at
 * 40.0, so NO scored account changes score in this run. The penalty is
 * live in the formula for future data: a non-thin account with an
 * exploit-like footprint would lose up to 10 points.
 */
export const CONCENTRATION = {
  /** Minimum FUNCTION_CALLs before concentration is judged. */
  minCalls: 10,
  /** Share below which no penalty applies (in the measured benign gap). */
  shareFloor: 0.9,
  /** Maximum penalty in score points, at share 1.00. */
  maxPenalty: 10,
} as const;

export function concentrationPenalty(f: AccountFeatures): number {
  const calls = f.functionCallCount ?? 0;
  if (calls < CONCENTRATION.minCalls) return 0;
  const share = f.dominantCallReceiverShare ?? 0;
  if (share <= CONCENTRATION.shareFloor) return 0;
  return (
    CONCENTRATION.maxPenalty *
    clamp01((share - CONCENTRATION.shareFloor) / (1 - CONCENTRATION.shareFloor))
  );
}

export function scoreAccount(f: AccountFeatures): ScoreBreakdown {
  const ageDays = daysBetween(f.firstSeen, f.windowEnd);
  const thin =
    f.transferCount < THIN_HISTORY.minTransfers ||
    ageDays < THIN_HISTORY.minAgeDays;
  const thinReason = thin
    ? f.transferCount < THIN_HISTORY.minTransfers
      ? `only ${f.transferCount} transfer(s) in window (min ${THIN_HISTORY.minTransfers})`
      : `first seen ${ageDays.toFixed(1)} days before window end (min ${THIN_HISTORY.minAgeDays})`
    : null;

  const components = {
    historyDepth: historyDepth(f),
    counterpartyDiversity: counterpartyDiversity(f),
    volumeStability: volumeStability(f),
    reliability: reliability(f),
    contractHygiene: contractHygiene(f),
  };
  let score =
    WEIGHTS.historyDepth * components.historyDepth +
    WEIGHTS.counterpartyDiversity * components.counterpartyDiversity +
    WEIGHTS.volumeStability * components.volumeStability +
    WEIGHTS.reliability * components.reliability +
    WEIGHTS.contractHygiene * components.contractHygiene;
  const penalty = concentrationPenalty(f);
  score -= penalty;
  if (thin) score = Math.min(score, THIN_HISTORY.scoreCap);
  return {
    score: Math.round(score * 10) / 10,
    components: {
      historyDepth: Math.round(components.historyDepth * 10) / 10,
      counterpartyDiversity:
        Math.round(components.counterpartyDiversity * 10) / 10,
      volumeStability: Math.round(components.volumeStability * 10) / 10,
      reliability: Math.round(components.reliability * 10) / 10,
      contractHygiene: Math.round(components.contractHygiene * 10) / 10,
    },
    thinHistory: thin,
    thinReason,
    concentrationPenalty: Math.round(penalty * 10) / 10,
    inputs: { accountAgeDays: Math.round(ageDays * 10) / 10, transferCount: f.transferCount },
  };
}
