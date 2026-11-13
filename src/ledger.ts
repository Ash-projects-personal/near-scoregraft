/**
 * Scoregraft public audit ledger — one JSONL record per payment decision.
 *
 * Every gate decision (ALLOW / REVIEW / BLOCK) appends exactly one entry
 * with the score, its components, the decision, the reason, and the
 * evidence (transaction hashes the score was computed from). The ledger is
 * the verifiability claim: a judge can take any entry, recompute the score
 * from the cited on-chain rows, and check the decision follows the
 * published policy. No entry is ever edited or deleted; corrections are
 * new entries.
 *
 * Format: data/ledger.jsonl, one JSON object per line.
 * Schema version 1.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type Decision = "ALLOW" | "REVIEW" | "BLOCK";

export interface LedgerEntry {
  schemaVersion: 1;
  decisionId: string; // ledger-<unix-ms>-<seq>
  timestamp: string; // ISO 8601 UTC
  payer: string;
  payee: string;
  amountNear: number;
  purpose: string;
  score: number;
  components: {
    historyDepth: number;
    counterpartyDiversity: number;
    volumeStability: number;
    reliability: number;
    contractHygiene: number;
  };
  /** v1.1 contract-call concentration penalty applied (0-10 points). */
  concentrationPenalty: number;
  thinHistory: boolean;
  decision: Decision;
  reason: string;
  evidenceTxHashes: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Override with SCOREGRAFT_LEDGER_PATH (tests use a temp file). */
export const LEDGER_PATH =
  process.env.SCOREGRAFT_LEDGER_PATH ||
  path.join(__dirname, "..", "data", "ledger.jsonl");

let seq = 0;

export function appendLedgerEntry(
  e: Omit<LedgerEntry, "schemaVersion" | "decisionId" | "timestamp">,
): LedgerEntry {
  const entry: LedgerEntry = {
    schemaVersion: 1,
    decisionId: `ledger-${Date.now()}-${seq++}`,
    timestamp: new Date().toISOString(),
    ...e,
  };
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(entry) + "\n");
  return entry;
}

export function readLedger(): LedgerEntry[] {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs
    .readFileSync(LEDGER_PATH, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LedgerEntry);
}
