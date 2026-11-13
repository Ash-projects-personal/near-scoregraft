/**
 * Scoregraft demo — do X, see Y.
 *
 * Usage (from the repo root, after `npm run build`):
 *   node dist/demo.js                 # score top sampled accounts, run the gate
 *   node dist/demo.js --quote         # also request a dry-run 1Click quote
 *                                     # (no funds move, no signature)
 *
 * Reads data/processed/account_features.json (built by
 * scripts/build_features.py from the replay pull). If the features file
 * is missing it exits with instructions — it never invents accounts.
 *
 * What you see:
 *   1. Each sampled account's score with its five components.
 *   2. A gate decision for a 0.4 NEAR payment from the top account
 *      (thin-history accounts get BLOCK/REVIEW, never a free ALLOW).
 *   3. A gate decision for a 5 NEAR payment from a thin account (BLOCK).
 *   4. The ledger entries appended to data/ledger.jsonl.
 *   5. With --quote: a dry-run 1Click quote pricing the allowed payment.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./gate.js";
import { readLedger } from "./ledger.js";
import { scoreAccount } from "./score.js";
import type { AccountFeatures } from "./score.js";
import { requestDryRunQuote } from "./intents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEATURES = path.join(
  __dirname,
  "..",
  "data",
  "processed",
  "account_features.json",
);

async function main(): Promise<void> {
  const wantQuote = process.argv.includes("--quote");
  if (!fs.existsSync(FEATURES)) {
    console.log(
      "No scored accounts yet. Run the replay pull first:\n" +
        "  python3 scripts/pull_replay.py   # resumable, polite pacing\n" +
        "  python3 scripts/build_features.py",
    );
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(FEATURES, "utf-8")) as {
    window: [string, string];
    scope: string;
    accounts: AccountFeatures[];
  };
  console.log(
    `Scoregraft demo — window ${doc.window[0]}..${doc.window[1]}, ` +
      `${doc.accounts.length} sampled accounts (${doc.scope})`,
  );
  const top = [...doc.accounts]
    .sort((a, b) => b.transferCount - a.transferCount)
    .slice(0, 5);
  for (const f of top) {
    const s = scoreAccount(f);
    console.log(
      `\n${f.accountId}: score ${s.score} ` +
        `(history ${s.components.historyDepth}, diversity ` +
        `${s.components.counterpartyDiversity}, stability ` +
        `${s.components.volumeStability}, reliability ` +
        `${s.components.reliability}, hygiene ${s.components.contractHygiene})` +
        (s.thinHistory ? ` THIN: ${s.thinReason}` : ""),
    );
  }
  if (top.length === 0) {
    console.log("No accounts in the replay set yet.");
    return;
  }
  // Decision 1: small payment from the most active sampled account.
  const payer = top[0];
  const d1 = decide(payer, {
    payer: payer.accountId,
    payee: "demo-service.testnet",
    amountNear: 0.4,
    purpose: "demo: pay 0.4 NEAR for a data API call",
    evidenceTxHashes: payer.evidenceTxHashes ?? [],
  });
  console.log(
    `\nGate 1: ${payer.accountId} pays 0.4 NEAR -> ${d1.decision}: ${d1.reason}`,
  );
  // Decision 2: large payment from the least active (thin) account.
  const thin = [...doc.accounts].sort(
    (a, b) => a.transferCount - b.transferCount,
  )[0];
  const d2 = decide(thin, {
    payer: thin.accountId,
    payee: "demo-service.testnet",
    amountNear: 5,
    purpose: "demo: pay 5 NEAR for a data API call",
    evidenceTxHashes: thin.evidenceTxHashes ?? [],
  });
  console.log(
    `Gate 2: ${thin.accountId} pays 5 NEAR -> ${d2.decision}: ${d2.reason}`,
  );
  const ledger = readLedger();
  console.log(
    `\nLedger: ${ledger.length} entr(ies) in data/ledger.jsonl ` +
      `(latest: ${ledger[ledger.length - 1]?.decisionId})`,
  );
  if (wantQuote && d1.decision === "ALLOW") {
    // 1 wNEAR = 10^24 yocto; quote only, dry run, no funds move.
    const q = await requestDryRunQuote(
      "nep141:wrap.near",
      "nep141:wrap.near",
      "400000000000000000000000",
    );
    console.log(
      `\nDry-run 1Click quote for the allowed 0.4 NEAR payment: ` +
        `out=${q.quotedAmountOut} (~$${q.quotedAmountOutUsd}), ` +
        `eta=${q.timeEstimateSeconds}s (quote only, nothing executed)`,
    );
  } else if (wantQuote) {
    console.log(
      "\n--quote skipped: Gate 1 did not ALLOW, so there is no payment to price.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
