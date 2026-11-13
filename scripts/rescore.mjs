#!/usr/bin/env node
/**
 * Rescore all accounts in data/processed/account_features.json with the
 * v1.1 formula (dist/score.js, built from src/score.ts) and write
 * data/processed/scores.json. Also computes ROC AUC for paper experiment 1
 * from data/processed/labels.json:
 *   positive = exploit/scam label (should score LOW = risky)
 *   negative = benign label (should score HIGH = trustworthy)
 *   AUC = P(score_negative > score_positive), ties count 0.5.
 * With 1 positive and a handful of negatives the AUC is indicative only;
 * the paper states the sample size. Unlabeled accounts are not used.
 * Accounts in labels.json that have no score (not in features) are listed
 * as unscored, never silently dropped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { scoreAccount } from "../dist/score.js";

const ROOT = new URL("..", import.meta.url).pathname;
const feats = JSON.parse(
  readFileSync(`${ROOT}data/processed/account_features.json`, "utf8")
);
const labels = JSON.parse(
  readFileSync(`${ROOT}data/processed/labels.json`, "utf8")
);

const scored = feats.accounts.map((f) => {
  const s = scoreAccount(f);
  return {
    accountId: f.accountId,
    score: s.score,
    components: s.components,
    concentrationPenalty: s.concentrationPenalty,
    thinHistory: s.thinHistory,
    thinReason: s.thinReason,
    transferCount: f.transferCount,
    sampledDays: f.sampledDays,
    functionCallCount: f.functionCallCount ?? null,
    distinctCallMethods: f.distinctCallMethods ?? null,
    topCallMethod: f.topCallMethod ?? null,
    dominantCallReceiver: f.dominantCallReceiver ?? null,
    dominantCallReceiverShare: f.dominantCallReceiverShare ?? null,
  };
});
scored.sort((a, b) => b.score - a.score);

const byId = new Map(scored.map((s) => [s.accountId, s]));
const positives = [];
const negatives = [];
const unscored = [];
for (const lab of labels.labels) {
  const s = byId.get(lab.accountId);
  if (!s) {
    unscored.push(lab.accountId);
    continue;
  }
  if (lab.label === "exploit_actor" || lab.label === "scam") positives.push(s);
  else if (lab.label === "benign") negatives.push(s);
}

let auc = null;
let pairs = 0;
if (positives.length && negatives.length) {
  let wins = 0;
  for (const p of positives)
    for (const n of negatives) {
      pairs++;
      if (n.score > p.score) wins += 1;
      else if (n.score === p.score) wins += 0.5;
    }
  auc = Math.round((wins / pairs) * 1000) / 1000;
}

const bands = {
  allow: scored.filter((s) => s.score >= 60).length,
  review: scored.filter((s) => s.score >= 40 && s.score < 60).length,
  block: scored.filter((s) => s.score < 40).length,
};
const out = {
  window: feats.window,
  scope: feats.scope,
  nAccounts: scored.length,
  scoreRange: scored.length
    ? [scored[scored.length - 1].score, scored[0].score]
    : [null, null],
  bands,
  rocAuc: {
    auc,
    nPositive: positives.length,
    nNegative: negatives.length,
    pairs,
    unscoredLabeledAccounts: unscored,
    note:
      "AUC is P(benign score > exploit score). Indicative only at this sample size; see paper section 6.",
  },
  scores: scored,
};
writeFileSync(
  `${ROOT}data/processed/scores.json`,
  JSON.stringify(out, null, 2)
);
console.log(
  `accounts=${scored.length} range=${out.scoreRange} ` +
    `allow=${bands.allow} review=${bands.review} block=${bands.block} ` +
    `rocAuc=${auc} (pos=${positives.length} neg=${negatives.length} pairs=${pairs})` +
    (unscored.length ? ` unscored=${unscored.length}` : "")
);
for (const s of scored.slice(0, 8))
  console.log(
    `  ${s.accountId.slice(0, 16)}: ${s.score} thin=${s.thinHistory} ` +
      `transfers=${s.transferCount} days=${s.sampledDays}`
  );
