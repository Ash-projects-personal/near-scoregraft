#!/usr/bin/env python3
"""
Build per-account behavior features from the replay pull.

Inputs (produced by scripts/pull_replay.py):
  data/raw/replay_txns.jsonl       TRANSFER rows only
  data/raw/replay_list_all.jsonl   every listed txn (for failure rate +
                                   contract share, which need all actions)
Output:
  data/processed/account_features.json  (one object per sender account)

HONEST SCOPE NOTE: features are computed from the SAMPLED replay set (one
page of 100 txns per day), not from the account's full chain history. The
paper states this: scores from this build are sample-based estimates, and
the thin-history policy treats lightly-sampled accounts conservatively.
`sampled_days` records how many of the 90 window days the account appears
in, so a judge can see coverage. A BigQuery run (needs Ash's Google
account in the console) would replace the sample with full history.

DEEPENED ACCOUNTS (day 3): scripts/deepen_accounts.py walks selected
accounts' full in-window history (before_ts walk) into
data/raw/deepened_txns.jsonl / deepened_list_all.jsonl. When those files
exist, this builder merges them with the replay set (deduped by
transaction_hash) and marks each affected account with "deepened": true
plus "deepenedTransferCount". For a deepened account, transferCount /
firstSeen / lastSeen / sampledDays reflect its full in-window history,
while failureRate / contractShare still mix the replay sample with the
deepened rows walked (both are real on-chain rows; the mix is stated
here and in the paper). Non-deepened accounts stay sample-only.

CONTRACT-CALL DIMENSION (day 4): alongside contractShare, the builder
now records the FUNCTION_CALL footprint per signer — functionCallCount,
distinctCallMethods, topCallMethod (+count), distinctCallReceivers,
dominantCallReceiver (+share). This is the dimension that distinguishes
a contract-driven account (e.g. the labeled exploit actor, whose
footprint is repeated same-method calls to a single receiver) from a
plain-transfer payer. All counts are measured from the same replay +
deepened rows; nothing is inferred. WIRED INTO SCORING day 5 (v1.1 in
src/score.ts): a concentration penalty (0-10 points, >= 10 calls,
dominant share 0.90 -> 1.00); see the paper section 6.4 for the
data-driven threshold choice and the measured (zero) effect on this
build's scores.
"""
import datetime
import json
import os
import statistics
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "processed", "account_features.json")
WINDOW_END = "2026-11-06"


def ns_to_date(ns_ts):
    """19-digit nanosecond block timestamp -> ISO date (UTC).

    BUGFIX 2026-11-08 (day 2): the original code sliced ts[:10], which
    yields epoch SECONDS ('1786276786'), not a date. That broke
    firstSeen/lastSeen (score.ts daysBetween -> NaN) and inflated
    sampledDays (one 'day' per distinct second). Convert properly.
    """
    try:
        sec = int(ns_ts) / 1e9
        return datetime.datetime.fromtimestamp(
            sec, tz=datetime.timezone.utc).date().isoformat()
    except (TypeError, ValueError):
        return ""


def yocto_to_near(x):
    """Deposit may arrive as int, float, or scientific-notation string."""
    try:
        return float(x) / 1e24
    except (TypeError, ValueError):
        return 0.0


def main():
    transfers = defaultdict(list)   # signer -> [(date, receiver, near, hash)]
    all_txns = defaultdict(list)    # signer -> [(actions, status)]
    call_methods = defaultdict(lambda: defaultdict(int))    # signer -> method -> n
    call_receivers = defaultdict(lambda: defaultdict(int))  # signer -> receiver -> n
    days_seen = defaultdict(set)
    deepened_counts = defaultdict(int)  # signer -> TRANSFER rows from deepened files
    seen_hashes = set()
    seen_all_hashes = set()

    def load_txns(path, is_deepened):
        if not os.path.exists(path):
            return
        with open(path) as f:
            for line in f:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                h = r.get("transaction_hash")
                if h in seen_hashes:
                    continue
                seen_hashes.add(h)
                signer = r.get("signer_account_id")
                if not signer:
                    continue
                ts = r["block"]["block_timestamp"]
                date = ns_to_date(ts)
                deposit = (r.get("actions_agg") or {}).get("deposit", 0)
                transfers[signer].append(
                    (date, r.get("receiver_account_id"), yocto_to_near(deposit),
                     r.get("transaction_hash")))
                days_seen[signer].add(date)
                if is_deepened:
                    deepened_counts[signer] += 1

    def load_all(path):
        if not os.path.exists(path):
            return
        with open(path) as f:
            for line in f:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                h = r.get("transaction_hash")
                if h in seen_all_hashes:
                    continue  # same row already counted from the other file
                seen_all_hashes.add(h)
                signer = r.get("signer_account_id")
                if not signer:
                    continue
                acts = r.get("actions") or []
                status = (r.get("outcomes") or {}).get("status")
                all_txns[signer].append((acts, status))
                # Contract-call dimension: method + receiver concentration
                # of the signer's FUNCTION_CALL actions (real rows only).
                recv = r.get("receiver_account_id")
                for a in acts:
                    if a.get("action") == "FUNCTION_CALL":
                        call_methods[signer][a.get("method") or ""] += 1
                        if recv:
                            call_receivers[signer][recv] += 1

    tx_path = os.path.join(RAW, "replay_txns.jsonl")
    load_txns(tx_path, is_deepened=False)
    # Deepened full-history TRANSFER rows merge in (deduped by hash).
    load_txns(os.path.join(RAW, "deepened_txns.jsonl"), is_deepened=True)

    all_path = os.path.join(RAW, "replay_list_all.jsonl")
    load_all(all_path)
    load_all(os.path.join(RAW, "deepened_list_all.jsonl"))

    features = []
    for signer, rows in transfers.items():
        rows.sort()
        amounts = [x[2] for x in rows]
        receivers = {x[1] for x in rows}
        dates = [x[0] for x in rows]
        atx = all_txns.get(signer, [])
        n_all = len(atx)
        failed = sum(1 for _, s in atx if s is False)
        contract = sum(1 for acts, _ in atx
                       if any(a.get("action") == "FUNCTION_CALL" for a in acts))
        # Contract-call dimension (measured here; scored by v1.1 in src/score.ts).
        meths = call_methods.get(signer, {})
        rcvs = call_receivers.get(signer, {})
        n_calls = sum(meths.values())
        top_method, top_method_n = (max(meths.items(), key=lambda kv: kv[1])
                                    if meths else (None, 0))
        dom_recv, dom_recv_n = (max(rcvs.items(), key=lambda kv: kv[1])
                                if rcvs else (None, 0))
        features.append({
            "accountId": signer,
            "firstSeen": min(dates),
            "lastSeen": max(dates),
            "transferCount": len(rows),
            "uniqueCounterparties": len(receivers),
            "totalNear": round(sum(amounts), 6),
            "medianNear": round(statistics.median(amounts), 6) if amounts else 0,
            "maxNear": round(max(amounts), 6) if amounts else 0,
            "failureRate": round(failed / n_all, 4) if n_all else 0,
            "contractShare": round(contract / n_all, 4) if n_all else 0,
            "functionCallCount": n_calls,
            "distinctCallMethods": len(meths),
            "topCallMethod": top_method,
            "topCallMethodCount": top_method_n,
            "distinctCallReceivers": len(rcvs),
            "dominantCallReceiver": dom_recv,
            "dominantCallReceiverShare": round(dom_recv_n / n_calls, 4) if n_calls else 0,
            "keyRotationEvents": 0,  # TBD: needs ADD_KEY/DELETE_KEY counts; 0 = not yet measured, stated in paper
            "windowEnd": WINDOW_END,
            "sampledDays": len(days_seen[signer]),
            "evidenceTxHashes": [x[3] for x in rows],
            "deepened": signer in deepened_counts,
            "deepenedTransferCount": deepened_counts.get(signer, 0),
        })
    features.sort(key=lambda f: -f["transferCount"])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    n_deepened = sum(1 for f in features if f["deepened"])
    scope = ("sampled replay set + deepened full-history transfers "
             f"for {n_deepened} account(s)" if n_deepened else
             "sampled replay set (see module docstring)")
    with open(OUT, "w") as f:
        json.dump({"window": ["2026-08-09", "2026-11-06"],
                   "scope": scope,
                   "accounts": features}, f, indent=2)
    print(f"accounts={len(features)} -> {OUT}")
    for f in features[:5]:
        print(f"  {f['accountId']}: transfers={f['transferCount']} "
              f"counterparties={f['uniqueCounterparties']} "
              f"total={f['totalNear']} NEAR median={f['medianNear']}")


if __name__ == "__main__":
    main()
