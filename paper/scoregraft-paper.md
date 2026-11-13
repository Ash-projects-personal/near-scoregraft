# Scoregraft: A Verifiable, Behavior-Derived Payment Gate for AI Agents on NEAR Intents

**Draft v0.2 — 2026-11-08 (day 2). First measured results on a 16-page
replay sample (§6). The 10,000-row target is revised in §4: the measured
TRANSFER share makes it unreachable on the anonymous NearBlocks budget
before the Nov 14 deadline; the honest target is now the full 90-page
stratified pass plus per-account deepening (§8).**

Track: Agent Economy (NEAR Hackathon 2026). Secondary fit: AI Security &
Defense.

## 1. Introduction

AI agents will pay for services: APIs, compute, data, other agents. Today
they pay with no credit model and no audit trail. Either an agent can spend
freely, or a vendor's closed score decides — and neither the agent's owner
nor a counterparty can check the decision. Thesis: agent payments need a
credit score derived from verifiable on-chain behavior, enforced as a gate
before the payment, with every decision recorded in a public ledger that
anyone can replay. Scope: NEAR Intents as the payment rail; testnet demo
for the gate, mainnet data for the score. (There is no Intents testnet.)

## 2. Related work

- **Agent payment rails:** x402 (HTTP-native payments), NEAR Intents /
  1Click (cross-chain intent settlement), NEAR AI Agent Market (escrow
  marketplace, paid via Intents — no risk gate).
- **On-chain reputation:** Gitcoin Passport, EigenTrust, ERC-8004
  (on-chain agent identity/reputation registries; a mid-2026 study found
  crowdsourced feedback "cannot function as a trust signal" due to Sybil
  reviewers).
- **Agent credit concepts:** Agntor (in-system track-record reputation
  gating spend over x402/ERC-8004); AgentPass ("credit check for AI
  agents," off-chain behavioral monitoring, demo only); agent FICO
  (mnemopay, 0–850 score gating payment API access, concept stage);
  POINTS (five-factor agent credit model + chained audit ledger, US
  regulated-bank rails, "coming soon").
- **Wallet-behavior scoring for humans:** Trusta.AI (MEDIA score, 570M+
  wallets; AI-agent credit scoring on roadmap — proprietary closed
  model); Spectral Finance MACRO Score; zScore (arXiv 2503.05718).
  These score humans for DeFi lending, not agents for payment gating.
- **Gap:** no verified work combines (a) a payment-authorization credit
  score computed from real on-chain account behavior, (b) enforced as a
  gate over NEAR Intents, and (c) a public audit ledger of every payment
  decision. That combination is this paper's claim — and the claim only.
  We do NOT claim to be the first agent credit score in general.

## 3. Method

**Behavior features.** Per sender account over the fixed 90-day window
(2026-08-09 → 2026-11-06): account age (first-seen-in-window, a lower
bound), transfer count and frequency, unique counterparties, total /
median / max NEAR moved, failure rate, contract-interaction share
(FUNCTION_CALL vs TRANSFER), key-rotation events (ADD_KEY/DELETE_KEY —
TBD, see §7).

**Risk score (open formula, v1.1).** Five components, weights published in
`src/score.ts` and reproducible by any reader: history depth 0.25,
counterparty diversity 0.20, volume stability 0.20, reliability 0.20,
contract hygiene 0.15. Score 0–100, higher = lower risk. **v1.1 (day 5)**
adds a contract-call concentration penalty: 0–10 points subtracted when
an account signs ≥ 10 FUNCTION_CALLs with a dominant-receiver share
above 0.90 (full 10 points at share 1.00); the threshold sits in the
measured gap between the highest benign share (0.837) and the exploit
actor's 1.0000, and method count is not penalized (see §6.4).

**Threshold policy (v1).** ≥ 60 ALLOW (up to the agent policy cap,
default 10 NEAR); 40–59 REVIEW (capped at 1 NEAR, flagged for a human);
< 40 BLOCK. Amounts above the cap BLOCK even for high scores.

**Thin-history default.** Accounts with < 5 transfers in the window or
first seen < 7 days before the window end are THIN: score capped at 40,
max payment 0.5 NEAR. The score is only meaningful with history; the
paper and the demo say so instead of inventing a score for new wallets.

**Authorization gate.** Score → ALLOW/REVIEW/BLOCK (see `src/gate.ts`).

**Audit ledger.** One JSONL record per decision: inputs, score,
components, decision, reason, evidence transaction hashes. Append-only;
corrections are new entries. Format in `src/ledger.ts`.

## 4. Data

- **Replay set:** TRANSFER actions stratified by `block_date` over the
  90-day window, from NEAR mainnet via the NearBlocks v3 API (no key).
  **COMPLETE day 4 (2026-11-10, 90 of 90 pages pulled, 2026-08-09 →
  2026-11-06): 9,000 txns listed, 303 TRANSFER rows (share 3.37%).**
  The pull is slow and resumable (`scripts/pull_replay.py`,
  `data/raw/pull_state.json`); it died twice on clustered 30 s
  timeouts (day 1 on 2026-08-09, day 2 on 2026-08-24) and died again
  overnight day 2→3 (RemoteDisconnected retry on 2026-09-06) and was
  relaunched each time — the script now uses a 60 s timeout and up to
  10 retries per date. **The VM restarted four times in two days**
  (Nov 9 ~18:53 UTC; Nov 10 ~17:04, ~19:08, ~20:57 UTC — systemd/PID 1
  recreated), killing the pull and the queued deepener mid-run each
  time; both were relaunched, state intact on disk. Day-4 runners must
  check for VM restarts and relaunch any dead background process;
  nothing auto-restarts them (a watchdog cron would fix this).
  **Day-4 fetch fix:** urllib's urlopen began truncating ~72KB
  responses with `IncompleteRead` on 2026-10-22 (6 consecutive
  attempts across two processes) while curl completed the identical
  request in 1.4 s; both fetchers now fall back to curl whenever
  urllib fails (`fetch_once` / `_curl_json` in `pull_replay.py` and
  `deepen_accounts.py`). **Revised target (honest):** at the measured
  ~3.4% TRANSFER share, the full 90-page pass yields 303 TRANSFER
  rows, not 10,000. Reaching 10,000 would need ~4,300 pages (~430
  hours at the observed ~10 calls/hour anonymous budget) and is NOT
  achievable before the Nov 14 deadline on this path; the 10,000
  figure is kept here as the original design target, not a result.
  The binding constraint is the anonymous rate limit, not the code.
- **Per-account deepening (day 3–4, complete):**
  `scripts/deepen_accounts.py` walks selected accounts' full
  in-window history via `/v3/accounts/{account}/txns` and merges the
  rows into the feature build (`data/raw/deepened_txns.jsonl`,
  `deepened_list_all.jsonl`; `data/processed/account_features.json`
  flags deepened accounts). Measured: the endpoint returns txns where
  the account is signer OR receiver, so sent/received are counted
  separately; `meta.next_page` cursor pagination does NOT advance for
  some accounts (verified: account `2f319e9f…` returns page 1 again at
  limit 5 and limit 100, while `sweat-relayer.near` advances fine —
  likely an index-0 cursor stall server-side), so the walk uses
  `?before_ts=` instead (verified: strictly-before semantics, zero
  overlap; +1 ns on the boundary timestamp so same-block rows are not
  skipped, with hash dedupe). **Seven accounts walked, all done day
  4:** `2f319e9f…` (476 in-window rows: 238 sent, 238 received),
  `6518a6ac…` (494: 225 sent, 269 received), `0f15c0cd…` (464: 226
  sent, 238 received), `37912915…` (81: 42 sent, 39 received — its
  entire history), the labeled exploit account (44 rows = its entire
  history, 1 TRANSFER sent, 1 received), `ccb91e1d…` and
  `sweat-relayer.near` (**0 in-window rows from their own walks** —
  their newest 500 rows are all post-window, Nov 7–10, so the 5-page
  cap never reached the window; their features still come from the
  replay sample plus counterparty rows). Deepening also enriches the
  account's counterparties as a side effect (**24 accounts carry
  deepened rows in the final build** although only 7 accounts were
  walked — e.g. `ccb91e1d…` gained 61 deepened TRANSFERs, 59 of them
  to `6518a6ac…`, as received rows of that account's walk); their
  features are real rows, but their coverage is incidental, not a
  designed sample.
- **Prices:** CoinGecko public API, NEAR/USD hourly, 2,161 points over
  the window ($1.542–$5.908) — `data/raw/coingecko-near-90d.json`.
  [MEASURED day 1.]
- **BigQuery path:** `bigquery-public-data.crypto_near_mainnet_us`
  (tables `transactions`, `receipt_actions`, `execution_outcomes`) is the
  faster route to the same data but is BLOCKED from the build VM (no
  credentials; REST returns 401). Needs a Google account in the console.
  The NearBlocks pull is the working path; a BigQuery run would replace
  the sample with full history and is listed as future work.
- **Labeled positives (evaluation only):** no clean published NEAR-scam
  bulk dataset exists. Chainabuse (TRM Labs) has no public API — its
  `/api` page 404s and lookups are web-only; NEAR-specific report counts
  are not published. The gov.near.org "3X NEAR Airdrop SCAM" thread
  (https://gov.near.org/t/scam-alert-complex-of-sites-for-3x-near-airdrop-scam/19675)
  names scam *websites* (get-near.org, buy-near.org, 3x-near.org) but NO
  NEAR account addresses — it yields zero labeled accounts. Hand-curation
  from documented incident threads with citations is the primary label
  source. **Labeled accounts: 1 positive, 3 negatives**
  (`data/processed/labels.json`, full provenance). Day-2 curation
  (2026-11-08) tried and failed to yield a NEAR account: ScamSniffer's
  open `scam-database` is EVM addresses only; CryptoScamDB's public API
  returned HTTP 502; REKTgistry is search-only (no browsable NEAR
  list); the Rhea Finance $7.6M exploit write-up (QuillAudits,
  Apr 16 2026) names no NEAR account in text — its screenshots show a
  truncated implicit address (`31ac7a…a540`, unusable) and EVM refund
  addresses (`0x237e67d9…`, `0xBb5Fa936…`), and the incident is
  outside the window. **Day 3 (2026-11-09) — first labeled positive:**
  the NEAR Intents $3.8M exploit (Sep 30–Oct 1, inside the window).
  The Medium analysis "NEAR Intents Exploit Analysis" (andrea8787,
  Oct 8 2026) names NEAR account
  `20e6bfe4685d99004fc2095d3a0fc6158cd810ce8f801196141e183ed6e19d65`
  and EVM address `0x09Fd1f5d9F185067A92493E43AA259ea4AB3ad37` (the EVM
  address is independently corroborated: CryptoTimes reports ZachXBT
  flagged the same address). **Verified on-chain this run**
  (NearBlocks v3, `…/accounts/<account>/txns?limit=10&before_ts=<Oct 2>`):
  10/10 most recent txns before Oct 2 are signed by this account, all
  to `v2_1.omni.hot.tg`, all successful, dated Oct 1 00:35–06:13 UTC —
  4× `mt_batch_transfer_call`, 3× `clear_completed_withdrawal`, 3×
  `mt_transfer`, exactly the method set and contract the analysis
  describes for the exploit flow. Caveats, stated in `labels.json`:
  the attribution rests on a single-author analysis, not the official
  postmortem (which names no NEAR account); the attacker returned all
  funds Oct 2, so the label is "exploit actor", not "unrecovered
  thief". The account has 1 TRANSFER sent in-window (3 NEAR), so it
  scores thin (40.0) and the gate caps it (§6.3) — the label's value
  for experiment 1 is as a known-positive reference. **Day 4
  (2026-11-10) — first labeled negatives (3):** `sweat-relayer.near`
  (SWEAT relayer; 2,055 replay rows, 1,933 DELEGATE_ACTIONs, receivers
  all `.sweat` contracts; SWEAT as a live NEAR project per NEAR.org
  2022-04-12 and PR Newswire 2024-09-18), `bridge-mng.near` (154×
  `ft_deposit` to `omft.near`, the Omni Bridge token contract; NEAR
  Docs Omni Bridge pages), `tx-bench.near` (Chain Signatures
  benchmark/test account — weaker negative, medium confidence).
  Caveat, stated in `labels.json`: no public document names the
  `sweat-relayer.near` or `bridge-mng.near` accounts themselves; the
  account-to-project link rests on the account name plus the exclusive
  on-chain receiver pattern. **Day-4 correction:** this run's pull
  finds only **1 failed row of 43** for the exploit account (failure
  rate 0.0233), which does NOT reproduce the Medium analysis's claim
  of 23 failed deposit txns Sep 29–Oct 1; that count is unverified
  against the rows pulled here and is not used as a feature. EVM-side
  labels are NEVER used as NEAR replay labels. ROC AUC is now
  computable (§6.4) but indicative only at 1 × 3.

## 5. Experiments

1. **Risk-model evaluation:** ROC AUC and precision-at-fixed-recall for
   the score against labeled positives vs sampled legitimate accounts.
   [TBD — needs labeled positives.]
2. **Replay evaluation:** run the replay set (revised target: the full
   90-page stratified pass, ~200–250 TRANSFER rows; §4) through the
   gate; count authorized-correctly / blocked-correctly / false blocks /
   budget overruns. Target: zero budget overruns (no payment above its
   cap ever executes). [TBD — partial data in §6.2–6.3.]
3. **Ablation: gate on vs off.** Same replay, gate disabled: total NEAR
   that *would* have flowed to thin/low-score payers vs gate-on.
   [TBD.]
4. **Cost analysis:** gas + NEAR price at execution time, in USD from
   the real CoinGecko series. [TBD.]
5. **Score distributions:** legitimate vs labeled-exploit accounts.
   [TBD.]

## 6. Results

**Measured 2026-11-10 (day 4) on the FINAL merged build: replay sample
COMPLETE at 90 pages (9,000 txns listed, 303 TRANSFER rows) + deepened
full-history TRANSFER rows for 7 walked accounts (1,559 in-window rows):
163 accounts scored with `src/score.ts` v1.1 (day 5 re-score, 2026-11-11;
`data/processed/account_features.json`, `data/processed/scores.json`).**
All numbers below are measured. Experiment 1 (ROC AUC) is now computable
for the first time — 1 labeled positive × 3 labeled negatives — but is
indicative only at that sample size. Experiments 2–4 stay TBD. Day-3
snapshot for comparison: 43 pages, 4,300 listed, 132 TRANSFER, 60
accounts, range 40.0–77.5, 5 ALLOW.

### 6.1 What the replay sample actually contains

- **TRANSFER share is 3.37%:** 303/9,000 rows over the full 90-page
  pass. Native TRANSFER is a small slice of mainnet traffic at midday
  sampling; the pages are dominated by FUNCTION_CALL (12,009 actions:
  HOT `l2_claim`, `ft_transfer`, Intents `execute_intents`) and
  DELEGATE_ACTION meta-transactions (3,194), plus ADD_KEY 159,
  DELETE_KEY 14, CREATE_ACCOUNT 5, DEPLOY_CONTRACT 1, DELETE_ACCOUNT 89.
- **Two kinds of TRANSFER rows (full 303).** 204 are plain
  `TRANSFER`-only rows with real value: deposits 0–73,027.48 NEAR,
  **median 0.62 NEAR, sum 393,386.07 NEAR**, extremely skewed (one
  73,027.48 NEAR transfer from implicit account `37912915…388916` is
  19% of the total). 99 are multi-action rows, all **0 NEAR**: 98
  `DELEGATE_ACTION + TRANSFER` (relayer traffic — the value moves
  inside the delegated action, not the TRANSFER) and 1
  `ADD_KEY + CREATE_ACCOUNT + TRANSFER`. **Zero of 303 TRANSFER rows
  failed.**
- **Deepening changes the picture.** The replay sample is a relayer
  plus singletons; the accounts endpoint returns both sides of every
  transaction, so walking one heavy account also surfaces its
  counterparties. Seven accounts walked (2 day-3, 5 day-4), 1,559
  in-window rows: `2f319e9f…` 476 (238 sent, 238 received),
  `6518a6ac…` 494 (225 sent, 269 received), `0f15c0cd…` 464 (226 sent,
  238 received), `37912915…` 81 (42 sent, 39 received — its entire
  history), the labeled exploit account 44 (its entire history).
  `ccb91e1d…` and `sweat-relayer.near` returned **0 in-window rows
  from their own walks** — their newest 500 rows are all post-window
  (Nov 7–10), so the 5-page cap never reached the window; their
  features still come from the replay sample plus counterparty rows
  (see below). 24 accounts carry deepened rows in the final build.
- **Forwarding chains, measured.** The deepened walks expose the
  chain structure: `ccb91e1d…` sent 59 of its 61 deepened TRANSFERs
  to `6518a6ac…`; `6518a6ac…` sent 120 of 226 to `03793fb37ffb…`;
  `0f15c0cd…` sent 200 of 227 to `e1810ec76170…`; `2f319e9f…`
  received 193 from `52435fe9…` and sent 214 to `e58945735436…`
  (day 3). These are single-counterparty-dominant flows — the
  diversity component scores them low (0.8–7.9), which is the
  formula working as designed.

### 6.2 Score distribution (n = 163 accounts)

| Band | Count | Accounts |
|---|---|---|
| ALLOW (≥ 60) | 24 | incl. `tradenear.near` 80.3, `6518a6ac…` 74.8, `0f15c0cd…` 74.7, `37912915…` 74.0, `2f319e9f…` 73.6, `bf442596…` 72.6, `e2c58668…` 71.6, `1e6ef846…` 70.6, `ccb91e1d…` 69.6, `52435fe9…` 69.1, `bridge-mng.near` 62.3 (labeled benign) |
| REVIEW (40–59) | 139 | incl. `sweat-relayer.near` 50.1, `tx-bench.near` 48.7 (both labeled benign), labeled exploit actor 40.0 (thin cap) |
| BLOCK (< 40) | 0 | — |

Score range **40.0–80.3, median 40.0**. **137 of 163 accounts are
thin-history** and sit at the thin cap of exactly 40.0. The 26
non-thin accounts differentiate. The top scorer, `tradenear.near`
(**80.3**: 5 transfers on a single sampled day, Oct 12, 2.88 NEAR
total, 5 counterparties; history depth 30.8, diversity 100.0,
stability 88.1, reliability 100.0, hygiene 100.0), escapes the thin
cap on age alone (first seen 25 days before window end) — a
reminder that 5 transfers on one day can still score high when the
span is long, and that the formula rewards breadth (5 distinct
payees) over volume. The most active, `2f319e9f…` (**73.6**: 240
transfers over 16 sampled days, 1,328,166.79 NEAR total, median
5,134.49 NEAR, 2 counterparties; history depth 88.9, diversity 0.8,
stability 81.2, reliability 100.0, hygiene 100.0), and the two
newly deepened heavy accounts, `6518a6ac…` (**74.8**: 226 transfers,
49 days) and `0f15c0cd…` (**74.7**: 227 transfers, 36 days), score
on depth, not breadth. Thinness is decided by transfer count (< 5)
or age (< 7 days from first sight to window end). The score now
differentiates where the data is dense — and still refuses to
differentiate where it is not.

### 6.3 Gate decisions on real data

`data/ledger.jsonl` (27 entries, 2026-11-08 → 2026-11-11). Day-2
entries: `sweat-relayer.near` 1 NEAR → **REVIEW** (score 48.6,
capped at 1 NEAR, flagged for a human); `tx-bench.near` 1 NEAR →
**BLOCK** (thin history, above the 0.5 NEAR thin cap) and 0.5 NEAR
→ **REVIEW**; the 73,027-NEAR implicit account 0.5 NEAR → **REVIEW**
(thin, score 40.0). Day-3 entries — first ALLOWs on real data:
`ccb91e1d…` 0.4 NEAR → **ALLOW** (score 77.5 ≥ 60) and 5 NEAR →
**ALLOW**; `2f319e9f…` 5 NEAR → **ALLOW** (score 73.6). **Day-4
entries (final build, `scripts/gate_check.mjs`):** `tradenear.near`
5 NEAR → **ALLOW** (80.3); `6518a6ac…` 5 NEAR → **ALLOW** (74.8);
`ccb91e1d…` 5 NEAR → **ALLOW** (69.6); `bridge-mng.near` (labeled
benign) 5 NEAR → **ALLOW** (62.3). **Labeled exploit actor**
(`20e6bfe4…`, §4): 5 NEAR → **BLOCK** (thin history — only 1
transfer in window — payments above the 0.5 NEAR thin cap are
blocked) and 0.4 NEAR → **REVIEW**. **Day-5 entries (v1.1 re-score,
same six checks):** identical decisions at identical scores —
`tradenear.near` 5 NEAR → **ALLOW** (80.3), `6518a6ac…` 5 →
**ALLOW** (74.8), `ccb91e1d…` 5 → **ALLOW** (69.6),
`bridge-mng.near` 5 → **ALLOW** (62.3), exploit actor 5 → **BLOCK**
and 0.4 → **REVIEW** (score 40.0, concentration penalty 10.0
recorded on both entries). The demo's two decisions (day 5) also
match: `2f319e9f…` 0.4 NEAR → **ALLOW** (73.6), thinnest account
5 NEAR → **BLOCK**. The gate therefore allows large
payments from the highest-scored real payers — including a labeled
benign bridge account — and refuses a large payment from the known
exploit actor, on the same rules. No payment has been executed
anywhere (nothing signed, nothing spent); all entries are
evaluations only.

### 6.4 Experiment 1 — ROC AUC (first measurement, indicative only)

Labeled set (`data/processed/labels.json`): **1 positive** (NEAR
Intents $3.8M exploit actor, §4) and **3 negatives**, all curated
day 4 with web + on-chain provenance: `sweat-relayer.near` (SWEAT
relayer — 2,055 replay rows, 1,933 DELEGATE_ACTIONs, receivers all
`.sweat` contracts), `bridge-mng.near` (Omni Bridge manager — 154×
`ft_deposit` to `omft.near`), `tx-bench.near` (Chain Signatures
benchmark/test account — weaker negative, medium confidence, kept
with its caveat). Scores: exploit actor **40.0** (thin cap),
sweat-relayer **50.1**, tx-bench **48.7**, bridge-mng **62.3**.
**ROC AUC = 1.000** — all 3 benign scores rank above the exploit
actor's 40.0 (3 pairs; also 1.000 on the 2 pairs that exclude the
weaker tx-bench negative). This is the first AUC the project can
report, and it is **indicative only**: with 1 positive the statistic
has no power, and the positive sits at the thin cap (40.0) rather
than at a scored low — the separation is currently driven by the
thin-history policy, not by the formula distinguishing a scored
exploit pattern. **Day 5: no second positive could be labeled with
solid provenance.** The best candidate was the Harvest Moon exploit
(Oct 27, 2026 — Near Tinker Union flagged the attacker account
holding 1.04M GEAR + 25k USDC), but every published source truncates
the address to `aa7ac…786e4a`, and a 6,500-transaction walk of the
mainnet feed around the reported 08:03 UTC attack time (07:58–
08:10 UTC, NearBlocks v3) found zero transactions touching
`aa-harvest-moon.near` or any `aa7ac…` signer — the exploit
transaction evidently did not go to the game contract as a direct
transaction receiver, and the full address could not be recovered
on-chain from the published record. No label was added; the set
stays 1 positive × 3 negatives and experiment 1 stays open. More
labeled positives (and negatives that score high for the wrong
reasons, if any exist) are the precondition for a meaningful AUC.

**Contract-call dimension (wired into scoring as v1.1, day 5).**
`build_features.py` records per-signer FUNCTION_CALL footprints
(`functionCallCount`, `distinctCallMethods`, `topCallMethod`,
`dominantCallReceiver` + share), measured from the same replay +
deepened rows; final-build figures (90/90 dates): the labeled
exploit actor **42 calls, 6 methods, top `mt_batch_transfer_call`
(23), dominant receiver `v2_1.omni.hot.tg` share 1.0000**; benign
comparators: sweat-relayer 2,931 calls / 12 methods / top
`ft_transfer` / dominant `spin.sweat` 0.2856; bridge-mng 276 / 5 /
`ft_deposit` / `omft.near` 0.837; tx-bench 18 / 4 / `sign` /
`v1.signer` 0.6111. The three heavy pure-transfer accounts
(`6518a6ac…`, `0f15c0cd…`, `37912915…`) have **0 FUNCTION_CALLs as
signer** — their history is transfers only, which is why their
contract hygiene scores 100. **The penalty, decided from this data:**
only 4 of 163 accounts have ≥ 10 calls, and of the 10 accounts with
dominant share 1.0000, 9 have just 1–2 calls, where share 1.0 is
meaningless — so the penalty fires only at ≥ 10 calls, ramping
0 → 10 points as the share rises 0.90 → 1.00 (the 0.90 floor sits in
the measured gap between the highest benign share, 0.837, and the
exploit's 1.0000, so no labeled benign account is penalized).
Method count is NOT penalized: the exploit actor uses 6 methods vs
bridge-mng's 5, so method count does not separate them in this
sample. **Measured effect of wiring it in: zero accounts change
score.** Only the exploit actor qualifies (42 calls, share 1.0000 →
penalty 10.0), and it is thin-capped at 40.0, so all 163 scores,
the 24/139/0 bands, and the ROC AUC (1.000, 3 pairs) are identical
to the v1 re-score. The penalty is live in the formula for future
data — a non-thin account with an exploit-like footprint would lose
up to 10 points — but with n = 1 positive its threshold is
provisional and must be re-estimated as more labels arrive.
`npm test` is 9/9 (3 new tests cover the penalty, the ≥ 10-call
volume gate, and the 0.837 benign floor).

**Still TBD:** the full replay outcome table and ablation
(experiments 2–3) and the USD cost table (experiment 4). The 1Click
dry-run quote smoke test advanced but is still unverified: from the
build VM the endpoint is now reachable via detached curl (day-2
session kills were the synchronous call path, not the host),
`GET /v0/tokens` works (216 assets; wNEAR $3.57 at 2026-11-09
18:27 UTC), but `POST /v0/quote` returns **HTTP 400 "Internal
server error"** on four request variants (same-asset wNEAR→wNEAR,
valid recipient, cross-asset wNEAR→USDC, and with
`quoteWaitingTimeMs`). The current docs example sends an
`X-API-Key` header, so the likely causes are a now-required API key
or a server-side fault; no quote numbers are claimed anywhere, and
the demo stays quote-free until a key or a different network path
is available. No 1Click attempt was made day 4 (no key available;
per the run brief).

## 7. Limitations (stated plainly)

- **Label noise; sparse positives.** Labeled exploit accounts are few
  and hand-curated; evaluation power is limited and the paper says so.
- **Thin-history cold start.** New agent wallets have no history; the
  score is meaningless for them and the policy handles them by capping,
  not by scoring. **Measured consequence (day 2):** 21 of 22 sampled
  accounts appeared exactly once, so the score could not
  differentiate them — all sat at the thin cap of 40. **Day 4 (final
  build):** per-account deepening moved 26 accounts out of thin (24
  now score ≥ 60), but **137 of 163 accounts are still thin
  singletons**; the distribution in §6.2 is still mostly a statement
  about the sample's sparsity, not about NEAR payers in general.
- **Deepening counts both sides.** The accounts endpoint returns
  transactions where the account is signer OR receiver; sent and
  received TRANSFERs are counted separately (`deepen_state.json`),
  and the feature builder groups by signer. A walked account's
  counterparties are enriched as a side effect (**24 accounts carry
  deepened rows in the final build although only 7 accounts were
  walked**); their features are real rows, but their coverage is
  incidental, not a designed sample. Two walked accounts returned
  zero in-window rows from their own walks (`ccb91e1d…`,
  `sweat-relayer.near`) because their newest 500 rows are all
  post-window; a longer walk (more pages, or a before_ts start inside
  the window) would be needed to densify them.
- **1Click quote path: reachable, but quotes return 400.** Detached
  curl from the build VM reaches `1click.chaindefuser.com`
  (`GET /v0/tokens` works, 216 assets), so day 2's session kills
  were the synchronous call path, not the host. But `POST /v0/quote`
  returns HTTP 400 "Internal server error" on four request variants
  (day 3); the current docs example sends an `X-API-Key` header, so
  the likely causes are a now-required API key or a server-side
  fault. No dry-run quote has been executed yet; the demo's `--quote`
  step is code-complete but unverified against the live API, and the
  paper claims no quote numbers.
- **Sample-based features.** Until/unless the BigQuery run happens,
  features come from a sampled replay set (one page/day), not full chain
  history. Coverage per account is recorded (`sampledDays`). Deepened
  accounts use full in-window history for transfer counts
  and are flagged (`"deepened": true` in `account_features.json`); all
  other accounts stay sample-only. **Day-4 fetch note:** urllib
  truncates large NearBlocks responses on this VM (`IncompleteRead`);
  both fetchers fall back to curl, which completes the same requests —
  see §4. No fetch in the final build was hand-filled; every row in
  `data/raw/` came through the scripts.
- **Zero-value meta-transfers.** 99 of 303 sampled TRANSFER rows carry
  0 NEAR (98 DELEGATE_ACTION relayer rows + 1 ADD_KEY/CREATE_ACCOUNT
  row). The score's volume features read the TRANSFER deposit, so
  relayer rows contribute history and counterparties but no volume
  signal; a future version should price the delegated inner actions.
- **Value is extremely skewed.** Plain-transfer deposits in the full
  sample run 0–73,027 NEAR with median 0.62 NEAR; one transfer is 19%
  of sampled value. Medians, not means, are the honest summary here.
- **First-seen age is a lower bound.** Accounts created before the window
  still count from their first in-window transfer.
- **Key rotation not yet measured.** ADD_KEY/DELETE_KEY counts are 0 in
  v1 features (not yet pulled); treat as unmeasured, not as "no rotation".
- **Correlational, not causal.** Past behavior predicts future payment
  reliability imperfectly; a good score is not proof of good intent.
- **Testnet demo only; no live mainnet deployment in the window.**
  Intents has no testnet, so live execution is mainnet-only with tiny
  amounts and dry-run quotes first. The implicit testnet account
  created for the demo could not be faucet-funded (near-faucet.io
  accepts named `.testnet` accounts only; 0 NEAR granted, account never
  existed on chain) — the demo therefore runs on dry-run quotes and
  local scoring, which the hackathon rules expressly allow (HACKATHON.md
  Q-010/Q-012: testnet-only projects eligible; local-only demo OK).

## 8. Future work

Cross-chain reputation portability (same score shape on other chains'
  behavior data); the score as a priced bond/stake (pay more for a higher
  cap); agent-to-agent credit markets; a BigQuery full-history rerun of
  the replay evaluation. **Done day 3:** per-account deepening works
  (before_ts walk, not cursor — §4) and produced the first ALLOWs;
  the labeled exploit account is deepened (44 rows = its whole
  history). **Done day 4:** the replay pull is COMPLETE (90/90 pages,
  9,000 listed, 303 TRANSFER); all 5 queued deepenings are done
  (`ccb91e1d…`, `sweat-relayer.near`, `37912915…`, `6518a6ac…`,
  `0f15c0cd…`); first labeled negatives curated (3) so experiment 1
  (ROC AUC) runs — 1.000, indicative only; the contract-call
  dimension is measured in the feature builder (diagnostic in v1).
  **Next before submission (as of day 4; wiring done day 5 — see
  below):** more labeled positives so the
  AUC has power; a working 1Click dry-run quote (likely needs an API
  key — §6.4); a watchdog cron so VM restarts stop killing the
  background pull/deepener (4 restarts in 2 days); the demo video +
  X post (Ash-only, Nov 13–14).
  **Done day 5 (2026-11-11):** the contract-call dimension is WIRED
  into scoring as v1.1 (concentration penalty: ≥ 10 calls, share
  0.90 → 1.00 ramps 0 → 10 points; threshold set from the measured
  benign gap, method count not penalized — §6.4). Re-ran experiment
  1: **zero accounts change score** (only the exploit actor
  qualifies, penalty 10.0, thin-capped at 40.0); bands 24/139/0 and
  ROC AUC 1.000 (3 pairs, indicative only) unchanged; `npm test`
  9/9; day-5 gate checks repeat day-4 decisions exactly; ledger
  27 entries. **No second positive could be labeled:** the Harvest
  Moon exploit attacker address is published only truncated
  (`aa7ac…786e4a`) and a 6,500-txn on-chain walk around the attack
  time found no recoverable full address — no label added, no
  padding. **Still before submission:** public repo publish (Ash's
  decision — no repo yet); demo video + X post (Ash-only, Nov 13–14);
  NEAR mainnet payout address (Ash-only); 1Click API key (optional,
  demo stays quote-free without it).

## 9. Reproducibility

Repo link [TBD at publish]; exact pull script
(`scripts/pull_replay.py`), window (2026-08-09 → 2026-11-06), seeds
(none — deterministic API reads), testnet addresses
(`docs/testnet-account.md`). Every number in §6 traces to a file in
`data/` and a decision in `data/ledger.jsonl`.

## References

[TBD — Agntor, AgentPass, Trusta.AI, agent FICO, POINTS, ERC-8004,
Spectral MACRO, zScore arXiv 2503.05718, NEAR Intents docs,
NearBlocks API docs, CoinGecko API. Full citations when the draft
advances past v0.1.]
