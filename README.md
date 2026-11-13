# Scoregraft — a verifiable credit gate for AI-agent payments on NEAR Intents

**Built for NEAR HACKATHON 2026 (Build Beyond Boundaries), track: Agent Economy**
(also fits AI Security & Defense: reputation systems and scam detection).

## The problem

AI agents are about to pay for services — APIs, compute, data, other agents.
Today an agent pays with no credit model and no audit trail: either it can
spend freely, or a vendor's closed score decides. There is no verifiable,
behavior-derived check before the money moves.

## What Scoregraft is

An agent that pays for services with **NEAR Intents**, but only when a
verifiable risk/credit score passes. The score is computed from **real NEAR
mainnet on-chain account behavior** — transfer history, counterparties,
failure rate — not a vendor's proprietary guess. Every payment decision is
written to a **public audit ledger** with its score, its components, and the
on-chain rows it was computed from, so anyone can replay it.

**Honest claim:** the first verifiable, on-chain-behavior-derived payment
gate for NEAR Intents agent payments with a public decision ledger. We do
not claim to be the first agent credit score in general — others exist
(Agntor, AgentPass, agent FICO, POINTS); none combines a behavior-derived
score with an enforced Intents payment gate and a public ledger. See
`paper/scoregraft-paper.md` §2 for the related work.

## Try it (do X, see Y)

Prerequisites: Node.js 20+, Python 3.10+. No accounts, no keys, no payments.

```sh
git clone <this repo> && cd near-scoregraft
npm install
npm test          # -> 9 score/gate unit tests pass (synthetic fixtures only)
```

**1. Score real sampled accounts from NEAR mainnet:**

```sh
python3 scripts/pull_replay.py   # resumable NearBlocks pull, 90-day window
python3 scripts/build_features.py
node dist/demo.js                # (after: npm run build)
```

Do: `npm run demo`. See: each sampled account's 0–100 score with its five
components, a gate decision for a 0.4 NEAR payment, a BLOCK for a 5 NEAR
payment from a thin-history account, and the ledger entries appended to
`data/ledger.jsonl`.

**2. Price the allowed payment (dry run, no funds move):**

```sh
node dist/demo.js --quote
```

Do: run with `--quote`. See: a dry-run 1Click quote for the allowed
payment (quoted output, USD value, time estimate). Nothing is signed,
nothing is spent. Live Intents execution needs a funded mainnet account
(there is no Intents testnet — see HACKATHON.md Q-007) and is a later step.

**3. Replay any ledger decision:**

Each line of `data/ledger.jsonl` carries the payer's score components and
the transaction hashes the score was computed from. Take any entry, fetch
those transactions from NearBlocks, recompute with `src/score.ts`, and
check the decision against the policy in `src/gate.ts`.

## How the score works (open formula, v1)

Five components, weights published in `src/score.ts`:

| Component | Weight | What it measures |
|---|---|---|
| History depth | 0.25 | log-scaled transfer count + account age in window |
| Counterparty diversity | 0.20 | distinct payees / transfers |
| Volume stability | 0.20 | penalizes max transfer >> median transfer |
| Reliability | 0.20 | 1 − failure rate |
| Contract hygiene | 0.15 | low contract-interaction share; small key-rotation bonus |

**Thresholds:** score ≥ 60 ALLOW (up to the agent policy cap, default
10 NEAR); 40–59 REVIEW (capped at 1 NEAR, flagged for a human); < 40
BLOCK. Amounts above the cap are BLOCKed even for high scores.

**Thin-history policy (the honest part):** an account with fewer than 5
transfers in the window, or first seen less than 7 days before the window
end, is THIN: its score is capped at 40 and it may pay at most 0.5 NEAR.
New wallets have no history, so we say so and limit them — we do not
invent a score for them.

## Data (real, never synthetic as evidence)

- **Replay set:** TRANSFER actions stratified by day over
  2026-08-09 → 2026-11-06, from NEAR mainnet via the NearBlocks v3 API
  (no key; see `scripts/pull_replay.py` and `data/README.md`). Status
  2026-11-10 (day 4): **COMPLETE — 90 of 90 pages pulled, 9,000 txns
  listed, 303 TRANSFER rows (3.37% share)**. Day 4 fixed the fetch
  path: urllib truncated ~72KB responses (`IncompleteRead` on
  2026-10-22); both fetchers now fall back to curl. Honest revision:
  the original 10,000-row target is unreachable on the anonymous rate
  limit before Nov 14 (~303 rows from the full 90-page pass).
  **Per-account deepening** (`scripts/deepen_accounts.py`,
  before_ts walk of `/v3/accounts/{account}/txns`) densifies
  histories instead: 7 accounts walked, all done (1,559 in-window
  rows: `2f319e9f…` 476, `6518a6ac…` 494, `0f15c0cd…` 464,
  `37912915…` 81, exploit actor 44; `ccb91e1d…` and
  `sweat-relayer.near` returned 0 in-window rows — their newest 500
  rows are all post-window). Merged build: **163 accounts scored,
  range 40.0–80.3, median 40.0, 24 ALLOW / 139 REVIEW / 0 BLOCK** —
  top scorer `tradenear.near` 80.3. See the paper §4/§6.
- **Prices:** NEAR/USD hourly series from the CoinGecko public API
  (`data/raw/coingecko-near-90d.json`, 2,161 points, $1.542–$5.908).
- **Labels:** no clean NEAR-scam bulk dataset exists. Labeled positives
  are hand-curated from documented NEAR incident threads with citations;
  the paper states the label-noise limitation plainly. **Day 3: first
  labeled positive** — the NEAR Intents $3.8M exploit actor
  (`20e6bfe4…`), named in a published analysis and verified on-chain
  this run (Oct 1 `mt_batch_transfer_call` history on
  `v2_1.omni.hot.tg`). **Day 4: first labeled negatives (3)** —
  `sweat-relayer.near` (SWEAT relayer), `bridge-mng.near` (Omni Bridge
  manager), `tx-bench.near` (Chain Signatures test account, weaker).
  **ROC AUC = 1.000** (1 positive × 3 negatives; indicative only —
  see paper §6.4). EVM-side labels are never used as NEAR labels.
  The contract-call dimension is now measured per account
  (`functionCallCount`, `distinctCallMethods`, `topCallMethod`,
  `dominantCallReceiver` + share): the exploit actor's 42 calls all
  go to one receiver (`v2_1.omni.hot.tg`, share 1.0); diagnostic in
  v1 scoring, not yet wired in.
- BigQuery (`crypto_near_mainnet_us`) is the faster path to the same data
  but needs a Google account in the console — blocked from this VM, so the
  NearBlocks pull is the working path. The paper records both.

## NEAR tools used

- **NEAR Intents / 1Click API** (`docs.near-intents.org`): dry-run quotes
  for the payment leg; execution later, mainnet, tiny amounts.
- **NearBlocks API v3**: mainnet transaction data for the replay set.
- **near-api-js 5**: testnet account tooling (`docs/testnet-account.md`).
- **CoinGecko public API**: NEAR/USD prices for the cost table.

## Repo layout

```
src/
  score.ts    open risk-score formula v1 (+ thin-history policy)
  gate.ts     ALLOW / REVIEW / BLOCK policy
  ledger.ts   public audit ledger (JSONL, append-only)
  intents.ts  1Click dry-run quotes (no signing, no spending)
  demo.ts     the do-X-see-Y demo
scripts/
  pull_replay.py     NearBlocks v3 replay-set pull (resumable, curl fallback)
  deepen_accounts.py per-account full-history walk (before_ts, curl fallback)
  build_features.py  per-account features from replay + deepened rows
                     (+ contract-call dimension, day 4)
  rescore.mjs        score every account, write scores.json, compute ROC AUC
  gate_check.mjs     one gate decision against the built features (ledgered)
data/
  raw/        pulled rows, price series, pull/deepen state
  processed/  account_features.json, labels.json, scores.json
  ledger.jsonl  every gate decision, with evidence
paper/
  scoregraft-paper.md  research paper draft (grows with the data)
tests/
  score.test.mjs  formula + gate unit tests (synthetic fixtures)
```

## Status (2026-11-11, day 5)

- **Day 5 — contract-call dimension WIRED INTO SCORING (v1.1).**
  Concentration penalty live in `src/score.ts`: 0–10 points when an
  account signs ≥ 10 FUNCTION_CALLs with dominant-receiver share
  above 0.90 (full 10 at share 1.00). Threshold set from the measured
  data: among ≥ 10-call accounts the highest benign share is
  `bridge-mng.near` 0.837 vs the exploit actor's 1.0000; method count
  is NOT penalized (exploit 6 methods vs bridge-mng 5 — it does not
  separate them). **Measured effect: zero accounts change score** —
  only the exploit actor qualifies (penalty 10.0) and it is
  thin-capped at 40.0, so all 163 scores, the 24/139/0 bands, and
  ROC AUC 1.000 (1 positive × 3 negatives, indicative only) are
  unchanged from v1. `npm test` 9/9 (3 new tests); day-5 gate checks
  repeat day-4 decisions exactly; ledger 27 entries (penalty
  recorded on the exploit actor's entries). See
  `paper/scoregraft-paper.md` §6.4.
- **Day 5 — no second positive could be labeled.** Best candidate was
  the Harvest Moon exploit (Oct 27, 2026; 1.04M GEAR + 25k USDC) but
  every published source truncates the attacker address to
  `aa7ac…786e4a`, and a 6,500-transaction walk of the mainnet feed
  around the reported 08:03 UTC attack time found no transaction
  touching `aa-harvest-moon.near` or any `aa7ac…` signer. No label
  added — the set stays 1 positive × 3 negatives. Chainabuse results
  checked were BTC/ETH/SOL only; no NEAR scam addresses found there.
- **Submission checklist (verified against near.org, 2026-11-11):**
  form asks for project name + description (20–2,000 chars), team
  lead, email, team size, preferred track (Agent Economy), a NEAR
  account for payout, and links to the public repo + demo post on X.
  One submission, cannot be edited after sending; repo must be public
  by Nov 14, 23:59 UTC; judging Nov 16–18, results by Nov 18.
  Status: repo publish approved by Ash 2026-11-12 and in progress
  (public before Nov 14, 23:59 UTC); demo runs clean (`npm run demo`, quote-free);
  paper §6/§8 current with day-5 figures; payout address still
  missing (Ash-only); demo video + X post still Ash-only (Nov 13–14);
  1Click API key still missing (optional — not a blocker).

- Name check on "Scoregraft": PASS (screening — see `docs/name-check.md`).
  Not a legal trademark clearance.
- Scaffold, score v1, gate, ledger, Intents dry-run quote, tests: done.
- **Replay pull COMPLETE: 90/90 pages, 9,000 listed, 303 TRANSFER
  (3.37%). All 7 deepenings done (1,559 in-window rows). Final build:
  163 accounts scored — range 40.0–80.3, median 40.0, 24 ALLOW /
  139 REVIEW / 0 BLOCK; 26 accounts are non-thin. Top:
  `tradenear.near` 80.3, `6518a6ac…` 74.8, `0f15c0cd…` 74.7,
  `37912915…` 74.0, `2f319e9f…` 73.6. Gate ledger (19 entries at day
  4; 27 after the day-5 v1.1 re-checks):
  `tradenear.near`, `6518a6ac…`, `ccb91e1d…` (69.6) and labeled
  benign `bridge-mng.near` (62.3) 5 NEAR → ALLOW; the labeled exploit
  actor 5 NEAR → BLOCK, 0.4 NEAR → REVIEW. First ROC AUC: 1.000
  (1 positive × 3 negatives — indicative only). See
  `paper/scoregraft-paper.md` §6 and
  `data/processed/scores.json`.**
- The VM restarted 4 times in 2 days (Nov 9 ~18:53; Nov 10 ~17:04,
  ~19:08, ~20:57 UTC), killing the pull/deepener each time; both were
  relaunched from on-disk state every time. A watchdog cron is now
  urgent (parent's call). Day 4 also fixed the fetch path: urllib
  truncated ~72KB NearBlocks responses (`IncompleteRead`); both
  fetchers now fall back to curl, which completes the same requests.
  **First labeled negatives: 3** (`sweat-relayer.near`,
  `bridge-mng.near`, `tx-bench.near` — the last a weaker test-account
  negative); contract-call dimension measured for every account.
- 1Click dry-run quote: **endpoint reachable via detached curl**
  (`GET /v0/tokens` works, 216 assets), but `POST /v0/quote`
  returns HTTP 400 "Internal server error" on 4 variants — likely
  needs an API key (current docs show an `X-API-Key` header) or is
  a server-side fault. No quote numbers claimed; demo stays
  quote-free until a key or another network path is available.
- Testnet account: keypair generated, but **faucet funding FAILED**
  (2026-11-08): near-faucet.io rejects implicit accounts ("Invalid
  account"), named `.testnet` only; on-chain balance 0, 0 NEAR granted.
  Named-account route is Ash-only (see `docs/testnet-account.md`).
  **Not a submission blocker:** HACKATHON.md Q-010/Q-012 allow
  testnet-only projects and local-only demos; submission needs only a
  public repo + X demo post + form. Demo proceeds on dry-run quotes +
  local scoring of real mainnet data.
- NOT submitted. Submission is Nov 14, 23:59 UTC; see the submission
  checklist above — repo publish, demo video + X post, and payout
  address are the remaining steps (repo publish and payout address
  are Ash's calls).

## License

MIT. See `LICENSE`.
