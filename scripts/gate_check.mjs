#!/usr/bin/env node
/**
 * Gate check — run one gate decision against the built features and append
 * it to the audit ledger (data/ledger.jsonl), exactly as the demo does.
 *
 * Usage:
 *   node scripts/gate_check.mjs <accountId> <amountNear> [purpose]
 *
 * The account must exist in data/processed/account_features.json; the
 * script never invents an account or a score. Nothing is signed, nothing
 * is spent — evaluations only.
 */
import { readFileSync } from "node:fs";
import { decide } from "../dist/gate.js";

const ROOT = new URL("..", import.meta.url).pathname;
const [accountId, amountRaw, ...purposeParts] = process.argv.slice(2);
if (!accountId || !amountRaw) {
  console.error("usage: node scripts/gate_check.mjs <accountId> <amountNear> [purpose]");
  process.exit(1);
}
const amountNear = Number(amountRaw);
if (!Number.isFinite(amountNear) || amountNear <= 0) {
  console.error("amountNear must be a positive number");
  process.exit(1);
}
const doc = JSON.parse(
  readFileSync(`${ROOT}data/processed/account_features.json`, "utf8")
);
const f = doc.accounts.find((a) => a.accountId === accountId);
if (!f) {
  console.error(`account not in account_features.json: ${accountId}`);
  process.exit(1);
}
const purpose =
  purposeParts.join(" ") || `gate check: pay ${amountNear} NEAR`;
const d = decide(f, {
  payer: accountId,
  payee: "demo-service.testnet",
  amountNear,
  purpose,
  evidenceTxHashes: f.evidenceTxHashes ?? [],
});
console.log(
  `${accountId} pays ${amountNear} NEAR -> ${d.decision} ` +
    `(score ${d.score.score}, thin=${d.score.thinHistory}): ${d.reason}`
);
console.log(`ledger entry: ${d.ledgerEntry.decisionId}`);
