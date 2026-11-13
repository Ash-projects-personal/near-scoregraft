# Name check — "Scoregraft" (2026-11-07, day 1)

**Verdict: PASS (screening). Name locked for the README/repo.**
This is a screening check (web + GitHub + trademark-index + domain),
NOT a legal trademark clearance.

## Checks run

| Check | Method | Result |
|---|---|---|
| Web exact-match `"Scoregraft"` | Web search | Zero exact matches. Only "scorecard" / "score graph" noise. |
| GitHub repo search | `api.github.com/search/repositories?q=scoregraft` | `total_count: 0`, no repos/gists. |
| USPTO trademark index | Justia trademark search for `scoregraft` | Zero results ("page number higher than results count"). Nearest marks are unrelated: SCORE (business education), 3SCORE (gyms), SCAM SCORE (Scamnetic, scam-detection software — different mark, different field). No "Scoregraft" filing. |
| USPTO TESS direct | TESS has been replaced by tmsearch.uspto.gov; direct API probe returned no usable result from this VM | Covered by the Justia index search above; no exact-match filing found. |
| Domain `.com` | RDAP via rdap.org | HTTP 404 = **not registered**. (VM DNS wildcards unregistered domains to 198.18.183.x — A records prove nothing; RDAP is the evidence.) |
| Domain `.io` | RDAP via rdap.org | HTTP 404 = **not registered**. |
| Domain `.dev` | RDAP via rdap.org | HTTP 404 = **not registered**. |
| Domain `.org` | RDAP via rdap.org | HTTP 404 = **not registered**. |

## Why it fits

Two syllables, easy to spell and say. "Score" = the behavior-derived
credit/risk score; "graft" = the on-chain write / audit ledger. Reads
naturally ("gated by your Scoregraft"). No crypto token, project, or
company uses the name; no confusing-similarity risk found in the same
field (unlike the rejected alternatives Merid/Meritledger — see the
Nov 4 prep file §2).

## Caveat

Screening only. A formal trademark clearance (attorney opinion, full
USPTO + common-law search) was not done and is not needed for a
hackathon project name; if the project continues commercially, run one.
