# Testnet account (day 1, 2026-11-07)

## Account (implicit, testnet)

- **Implicit account id:** `eb79b3dd08e3f3c11bc6addeb0489e3b09de22c85cecdfb142e97e074dfddf36`
- **Public key:** `ed25519:GrCSiUPmPt3ndoZnrMbUT5VLcro3Ncky9N9ccwG2hpT7`
- **Private key:** stored ONLY at `~/.config/scoregraft/testnet-key.json`
  (mode 600, outside the repo). Never committed, never shared.

## Status: UNFUNDED — faucet REJECTED implicit accounts (day 2, 2026-11-08)

**Faucet attempt FAILED (parent browser task, 2026-11-08 ~13:40 CST).**
near-faucet.io's form shows "Invalid account" for the 64-hex implicit id
and only accepts named `.testnet` accounts. On-chain verification
confirms the account has never existed: balance none / 0, no
transactions. **0 NEAR granted.** No other faucet route was attempted
from here; the parent is separately checking whether any alternative
faucet accepts implicit accounts.

### Named-account option (Ash-only)

A funded named testnet account (e.g. `scoregraft.testnet`) would be
needed instead. Ash would have to supply or create it — creating one
requires an already-funded account, so it is his browser step, not an
agent step. Once a named `.testnet` account exists, near-faucet.io
accepts it for funding. Until then, plan the demo assuming NO funded
testnet account.

### Submission does NOT require a live testnet deployment

Verified against the live HACKATHON.md (2026-11-08): Q-010
("Testnet-only projects eligible? Yes, all tracks") and Q-012
("Local-only demo OK? Yes: public repo, reproducible README, X post
with a video"). The submission is a public repo + X demo post + form
fields only — no wallet connection, no live deployment, no funded
account. AI judges screen for reproducibility ("check that it runs and
does what the README says"). The funded testnet account would only
have enabled an optional live on-chain demo leg (a real testnet
transfer through the gate); losing it costs a demo flourish, not
eligibility. The demo proceeds on dry-run 1Click quotes + local
scoring of real mainnet data, as already scoped. Q-007 also confirms
there is NO Intents testnet — live Intents execution is mainnet-only
with tiny amounts, which stays out of scope (no spending).

## What it is for

- The demo's gate decisions run off-chain (no chain interaction needed).
- Live testnet transfers (a real ALLOWed payment executing on testnet)
  are a day-2/3 step, after funding. Intents itself has no testnet, so
  the live Intents leg is mainnet-only with tiny amounts and dry-run
  quotes first — that step needs Ash's call and a funded mainnet account,
  and is NOT part of day 1.

## Payout address (mainnet) — ASH-ONLY, still missing

The submission form needs a NEAR mainnet account for the prize payout.
Do NOT invent one. Ash must supply his mainnet address (or create one)
before submission. Flagged to the parent agent.
