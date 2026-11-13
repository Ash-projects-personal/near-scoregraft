/**
 * Score + gate unit tests (run: npm test).
 *
 * These fixtures are SYNTHETIC feature vectors written only to test the
 * formula and the gate logic. They are not measurements and never appear
 * in the paper or the replay data. Real measured scores come from
 * data/processed/account_features.json, built from the NearBlocks pull.
 *
 * Ledger writes during tests go to a temp file via SCOREGRAFT_LEDGER_PATH.
 */
import assert from "node:assert/strict";
import { decide } from "../dist/gate.js";
import { scoreAccount } from "../dist/score.js";
// NOTE: SCOREGRAFT_LEDGER_PATH is set by the npm test script BEFORE this
// file loads, so ledger writes land in /tmp, not in data/ledger.jsonl.

const WINDOW_END = "2026-11-06";

function feats(over = {}) {
  return {
    accountId: "test-account.near",
    firstSeen: "2026-08-20",
    lastSeen: "2026-11-05",
    transferCount: 200,
    uniqueCounterparties: 120,
    totalNear: 500,
    medianNear: 2,
    maxNear: 5,
    failureRate: 0,
    contractShare: 0.1,
    keyRotationEvents: 2,
    windowEnd: WINDOW_END,
    ...over,
  };
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// 1. Established, well-behaved account scores high and is ALLOWed.
check("established account scores >= 60 and ALLOWs 0.4 NEAR", () => {
  const s = scoreAccount(feats());
  assert.ok(s.score >= 60, `score ${s.score}`);
  assert.equal(s.thinHistory, false);
  const d = decide(feats(), {
    payer: "test-account.near",
    payee: "service.near",
    amountNear: 0.4,
    purpose: "test",
  });
  assert.equal(d.decision, "ALLOW");
});

// 2. Thin account (1 transfer) is capped at 40 and cannot pay 5 NEAR.
check("thin account capped at 40; 5 NEAR BLOCKed", () => {
  const f = feats({
    firstSeen: "2026-11-05",
    transferCount: 1,
    uniqueCounterparties: 1,
    totalNear: 0.5,
    medianNear: 0.5,
    maxNear: 0.5,
  });
  const s = scoreAccount(f);
  assert.equal(s.thinHistory, true);
  assert.ok(s.score <= 40, `score ${s.score}`);
  const d = decide(f, {
    payer: "test-account.near",
    payee: "service.near",
    amountNear: 5,
    purpose: "test",
  });
  assert.equal(d.decision, "BLOCK");
});

// 3. Thin account may only pay a small amount, under REVIEW.
check("thin account 0.4 NEAR is REVIEW, not ALLOW", () => {
  const f = feats({
    firstSeen: "2026-11-05",
    transferCount: 3,
    uniqueCounterparties: 2,
    totalNear: 1.2,
    medianNear: 0.4,
    maxNear: 0.4,
  });
  const d = decide(f, {
    payer: "test-account.near",
    payee: "service.near",
    amountNear: 0.4,
    purpose: "test",
  });
  assert.equal(d.decision, "REVIEW");
  assert.equal(d.capAppliedNear, 0.5);
});

// 4. High failure rate drags the score down.
check("50% failure rate lowers score vs 0% failures", () => {
  const good = scoreAccount(feats()).score;
  const bad = scoreAccount(feats({ failureRate: 0.5 })).score;
  assert.ok(bad < good - 5, `good ${good} bad ${bad}`);
});

// 5. Policy cap blocks even a high score above the cap.
check("amount above policy cap BLOCKs a high-score account", () => {
  const d = decide(feats(), {
    payer: "test-account.near",
    payee: "service.near",
    amountNear: 50,
    purpose: "test",
    policyCapNear: 10,
  });
  assert.equal(d.decision, "BLOCK");
  assert.match(d.reason, /policy cap/);
});

// 6. One giant transfer vs steady median hurts volume stability.
check("max >> median lowers volume stability", () => {
  const steady = scoreAccount(feats({ maxNear: 2.5 })).components
    .volumeStability;
  const spiky = scoreAccount(feats({ maxNear: 2000 })).components
    .volumeStability;
  assert.ok(spiky < steady, `steady ${steady} spiky ${spiky}`);
});

// 7. v1.1: extreme single-receiver concentration (>= 10 calls, share 1.0)
// costs exactly 10 points; moderate concentration costs nothing.
check("concentration penalty 10 at share 1.0, 0 at share 0.3", () => {
  const concentrated = scoreAccount(
    feats({ functionCallCount: 42, dominantCallReceiverShare: 1.0 })
  );
  const spread = scoreAccount(
    feats({ functionCallCount: 42, dominantCallReceiverShare: 0.3 })
  );
  assert.equal(concentrated.concentrationPenalty, 10);
  assert.equal(spread.concentrationPenalty, 0);
  assert.equal(
    spread.score - concentrated.score,
    10,
    `spread ${spread.score} concentrated ${concentrated.score}`
  );
});

// 8. v1.1: volume gate — share 1.0 with only 1-2 calls is meaningless
// and costs nothing (9 of the 10 share-1.0 accounts in the real build
// have <= 2 calls).
check("concentration penalty 0 below 10 calls even at share 1.0", () => {
  const s = scoreAccount(
    feats({ functionCallCount: 1, dominantCallReceiverShare: 1.0 })
  );
  assert.equal(s.concentrationPenalty, 0);
  const s2 = scoreAccount(
    feats({ functionCallCount: 9, dominantCallReceiverShare: 1.0 })
  );
  assert.equal(s2.concentrationPenalty, 0);
});

// 9. v1.1: bridge-mng-like footprint (276 calls, share 0.837, labeled
// benign) is below the 0.90 floor and costs nothing.
check("concentration penalty 0 at share 0.837 (highest benign)", () => {
  const s = scoreAccount(
    feats({ functionCallCount: 276, dominantCallReceiverShare: 0.837 })
  );
  assert.equal(s.concentrationPenalty, 0);
});

console.log(`\n${passed} score/gate tests passed.`);
