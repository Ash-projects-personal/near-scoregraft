# Data — sources, window, and status

## Fixed window

**2026-08-09 00:00 UTC → 2026-11-06 23:59:59 UTC (90 days).**
Fixed on day 1 (2026-11-07) before sampling. The CoinGecko price series
covers exactly this span.

## Sources (all no-auth, public)

| Source | What | Status 2026-11-07 |
|---|---|---|
| NearBlocks v3 API (`https://api.nearblocks.io/v3/txns`) | Mainnet txns; `before_ts` jumps to any date; list items include `actions[{action, method}]` so TRANSFER rows classify without detail calls | LIVE, verified; anonymous rate limit is TIGHT (~5 calls then HTTP 429 with a multi-minute cooldown). Pull script paces at 120 s + backoff and resumes from state. |
| NearBlocks v1 API | Same data, deprecated; mainnet retires end Nov 2026 | LIVE but deprecated; cursor-jump verified (raw numeric id cursor). Do not build on it. |
| CoinGecko public API (`/api/v3/coins/near/market_chart?vs_currency=usd&days=90`) | NEAR/USD hourly prices | LIVE. `data/raw/coingecko-near-90d.json`: 2,161 points, 2026-08-09 → 2026-11-07, $1.542–$5.908. |
| FastNEAR API (`api.fastnear.com`) | Per-block txns (would have made stratified sampling trivial) | DEAD for this use: `/v0/last_block` returns HTTP 404. Not used. |
| BigQuery `bigquery-public-data.crypto_near_mainnet_us` | Full NEAR lakehouse (blocks, transactions, receipt_actions) | BLOCKED from this VM: no bq/gcloud, no GCP creds, REST returns 401. Needs Ash's Google account in the BigQuery console (free tier 1 TB/mo; planned pulls are MBs). Fastest path to the full 10k rows if unblocked. |
| NEAR Lake S3 | Historical blocks | DEAD (403 AllAccessDisabled; deprecated 2026-03-24). Not used. |

## Replay-set design

- One page (`limit=100`) of txns per day at 12:00 UTC, 90 days → up to
  9,000 listed txns; TRANSFER rows extracted to `replay_txns.jsonl`.
- Target: 10,000 TRANSFER rows. If the measured TRANSFER share makes one
  page/day insufficient, the day-2 runner adds extra pages per day using
  the previous page's last row as the next `before_ts`.
- Per-account features (`scripts/build_features.py`): account age is
  FIRST-SEEN-IN-WINDOW (a lower bound on true age); failure rate and
  contract share come from all listed txns, not just transfers.
- Key-rotation counts (`ADD_KEY`/`DELETE_KEY`) are NOT yet measured
  (v3 list actions don't include them per txn; needs the receipts
  endpoint) — recorded as 0 with a TODO in the features builder and the
  paper. Do not treat 0 as "no rotation".

## Files

- `raw/coingecko-near-90d.json` — CoinGecko 90d NEAR/USD (pulled 2026-11-07).
- `raw/pull_state.json` — pull progress (completed dates, counts).
- `raw/replay_list_all.jsonl` — every listed txn (all actions).
- `raw/replay_txns.jsonl` — TRANSFER rows only.
- `raw/probe_2026-11-06.jsonl` — (if present) first v3 probe page.
- `processed/account_features.json` — per-account features.
- `ledger.jsonl` — gate decisions (in `data/`, not `raw/`).

## Measured so far (day 1, real observations)

- Chain rate near head: ~5–8 txns/sec (page of 100 spans ~20 s;
  cursor jump of 18,000 ids ≈ 37–60 min). Implies ~430–690k txns/day.
- v1 `page` param is capped: `page=1000` → HTTP 422. Use cursors.
- v1 cursor jump works: `cursor=<numeric id>` returns txns below that id.
- v3 `before_ts` (19-digit ns timestamp) is the documented way to jump to
  a date; verified in the migration guide, live test still pending because
  the anonymous budget was exhausted by the v1 probes (HTTP 429).
- No TRANSFER row has been verified yet (no detail call has returned a
  TRANSFER action). The first verified TRANSFER rows land with the pull.
