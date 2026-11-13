#!/usr/bin/env python3
"""
Per-account deepening for Scoregraft (NearBlocks v3, no-auth public API).

Why: the 1-page/day replay sample leaves 31/32 accounts thin (1 sampled
transfer each, score capped at 40.0). Deepening walks each account's FULL
history via /v3/accounts/{account}/txns (newest-first, cursor-walked with
meta.next_page) so scores have multi-transfer histories. This is the route
to a first real ALLOW: the two 2-transfer accounts already have raw
components (diversity 50-100, stability ~95-99, reliability 100) that
would score ~75+ uncapped; they need >=5 transfers spanning >=7 days to
escape the thin cap.

Endpoint verified 2026-11-09 (day 3): GET
  /v3/accounts/sweat-relayer.near/txns?limit=5 -> HTTP 200 in 1.1 s,
  rows carry the same shape as /v3/txns (actions, actions_agg.deposit,
  block_timestamp ns, outcomes.status).

PAGINATION (day 3, measured): meta.next_page cursor DOES advance for
  sweat-relayer.near (limit=5 probe) but does NOT advance for
  2f319e9f... (limit=5 and limit=100 both return page 1 again, exact
  same 5/100 hashes). Likely cause: that account's page-1 last row sits
  at index_in_chunk 0, and the cursor {"index":0,...} is treated as
  "start" server-side. So this script walks with ?before_ts= instead:
  each page's last block_timestamp (+1 ns, so same-block rows are not
  skipped; the API treats before_ts as strictly-before, verified by
  probe) seeds the next page. Rows are deduped by transaction_hash.
  Known limit: rows sharing the boundary block timestamp are re-fetched
  and deduped, never double-counted; the walk stops on no-progress
  (a page with 0 new hashes) as well as on window start / page cap.

Usage:
  python3 scripts/deepen_accounts.py --top 6 --pages 5
  python3 scripts/deepen_accounts.py --accounts 2f31...,ccb9... --pages 5
  python3 scripts/deepen_accounts.py --top 6 --pages 5 --wait-for-pull

--wait-for-pull: poll data/raw/pull_state.json until all 90 replay dates
  are done (or the pull process is gone and the state has not grown for
  30 min), so the deepener does not compete with the replay pull for the
  anonymous rate budget. Pacing 120 s between calls, same resilience as
  pull_replay.py (60 s timeout, 10 retries, 429/Retry-After aware).

Window: only rows with block_timestamp in [2026-08-09, 2026-11-07) UTC
  are kept (the replay window). Rows newer than the window are skipped.
State: data/raw/deepen_state.json (per-account pages, cursor, done flag).
Output: data/raw/deepened_txns.jsonl (TRANSFER rows only, deduped by
  transaction_hash), data/raw/deepened_list_all.jsonl (every row walked).
Log: data/raw/deepen.log.
"""
import argparse
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
STATE_PATH = os.path.join(RAW, "deepen_state.json")
PULL_STATE = os.path.join(RAW, "pull_state.json")
FEATURES = os.path.join(ROOT, "data", "processed", "account_features.json")
OUT_TRANSFERS = os.path.join(RAW, "deepened_txns.jsonl")
OUT_ALL = os.path.join(RAW, "deepened_list_all.jsonl")
LOG = os.path.join(RAW, "deepen.log")

BASE = "https://api.nearblocks.io/v3/accounts"
WINDOW_START_NS = int(datetime.datetime(2026, 8, 9, tzinfo=datetime.timezone.utc).timestamp() * 1e9)
WINDOW_END_NS = int(datetime.datetime(2026, 11, 7, tzinfo=datetime.timezone.utc).timestamp() * 1e9)
BASE_DELAY = 120
MAX_BACKOFF = 600
UA = {"User-Agent": "scoregraft-deepening/0.1 (NEAR hackathon research)"}


def log(msg):
    # stdout is redirected to deepen.log by the launcher; append here would
    # duplicate every line (bug found day 3: each line appeared twice).
    # Print only; the redirect captures it.
    line = f"{datetime.datetime.now(datetime.timezone.utc).isoformat()} {msg}"
    print(line, flush=True)


def get_json(url):
    """One GET with 429/5xx backoff. Returns parsed JSON or raises.
    Honors Retry-After when present.

    CURL FALLBACK 2026-11-10 (day 4): same diagnosed fault as
    pull_replay.py — urllib's urlopen truncates ~60KB+ responses with
    IncompleteRead on this VM (2 failed attempts on the first deepening
    page of ccb91e1d… within minutes of the pull's 6 failures on
    2026-10-22), while curl completes the identical request. fetch_once()
    falls back to curl whenever urllib fails on a fetch. 429/5xx backoff
    semantics unchanged.
    """
    delay = BASE_DELAY
    attempts = 0
    while True:
        try:
            _, data, _ = fetch_once(url)
            return data
        except _HttpStatus as e:
            if e.code in (429, 500, 502, 503):
                wait = delay
                if e.retry_after:
                    try:
                        wait = max(wait, int(e.retry_after))
                    except ValueError:
                        pass
                log(f"  HTTP {e.code} retry-after={e.retry_after} "
                    f"body={e.body[:120]!r}; sleeping {wait}s")
                time.sleep(wait)
                delay = min(delay * 2, MAX_BACKOFF)
                continue
            raise
        except Exception as e:
            attempts += 1
            log(f"  error {e!r} (attempt {attempts}/10); sleeping {delay}s")
            time.sleep(delay)
            delay = min(delay * 2, MAX_BACKOFF)
            if attempts >= 10:
                raise


class _HttpStatus(Exception):
    """Non-200 HTTP response, with Retry-After and a body snippet."""

    def __init__(self, code, retry_after=None, body=""):
        super().__init__(f"HTTP {code}")
        self.code = code
        self.retry_after = retry_after
        self.body = body


def _curl_json(url):
    """Fetch + parse JSON via curl. Returns (status, data, retry_after).
    Raises ConnectionError on curl failure, _HttpStatus on non-200."""
    import subprocess
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        body_p = os.path.join(td, "body")
        hdr_p = os.path.join(td, "headers")
        p = subprocess.run(
            ["curl", "-sS", "-m", "60", "-D", hdr_p, "-o", body_p,
             "-H", "User-Agent: " + UA["User-Agent"], url],
            capture_output=True, text=True, timeout=90)
        if p.returncode != 0:
            raise ConnectionError(
                f"curl rc={p.returncode}: {p.stderr.strip()[:200]}")
        status, ra = 0, None
        try:
            with open(hdr_p) as f:
                for line in f:
                    if line.startswith("HTTP/"):
                        try:
                            status = int(line.split()[1])
                        except (IndexError, ValueError):
                            pass
                    elif line.lower().startswith("retry-after:"):
                        ra = line.split(":", 1)[1].strip()
        except OSError:
            pass
        with open(body_p, "rb") as f:
            raw = f.read()
        if status != 200:
            raise _HttpStatus(status, ra,
                              raw[:300].decode("utf-8", "replace"))
        return status, json.loads(raw), ra


def fetch_once(url):
    """One GET attempt. Returns (status, parsed_json, retry_after).
    urllib first; on any urllib failure (IncompleteRead / timeout /
    URLError) falls back to curl for the same URL."""
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r), r.headers.get("Retry-After")
    except urllib.error.HTTPError as e:
        body = e.read()[:300].decode("utf-8", "replace") if e.fp else ""
        ra = e.headers.get("Retry-After") if e.headers else None
        raise _HttpStatus(e.code, ra, body)
    except Exception:
        return _curl_json(url)


def load_state():
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH) as f:
            return json.load(f)
    return {"accounts": {}}


def save_state(s):
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f, indent=2)
    os.replace(tmp, STATE_PATH)


def seen_hashes():
    # Hashes from BOTH outputs: the walk dedupes every row (TRANSFER and
    # not), so a repeated page adds 0 new rows to either file and the
    # no-progress guard can stop the account.
    h = set()
    for path in (OUT_TRANSFERS, OUT_ALL):
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    try:
                        h.add(json.loads(line)["transaction_hash"])
                    except Exception:
                        pass
    return h


def is_transfer(row):
    return any(a.get("action") == "TRANSFER" for a in row.get("actions") or [])


def pull_is_done():
    try:
        with open(PULL_STATE) as f:
            s = json.load(f)
        return len(s.get("done_dates", {})) >= 90
    except Exception:
        return False


def pull_alive():
    # any pull_replay.py process running?
    import subprocess
    try:
        out = subprocess.run(["pgrep", "-f", "pull_replay.py"],
                             capture_output=True, text=True).stdout.strip()
        return bool(out)
    except Exception:
        return False


def wait_for_pull():
    log("waiting for replay pull to finish (90 dates) before deepening...")
    last_n = -1
    last_grew = time.time()
    while True:
        try:
            with open(PULL_STATE) as f:
                n = len(json.load(f).get("done_dates", {}))
        except Exception:
            n = last_n
        if n >= 90:
            log(f"pull complete ({n}/90 dates); starting deepening")
            return
        if n != last_n:
            last_n, last_grew = n, time.time()
        alive = pull_alive()
        if not alive and time.time() - last_grew > 1800:
            log(f"pull process gone and state stuck at {n}/90 for 30 min; "
                "proceeding anyway (day 4 relaunches the pull; 429 backoff "
                "handles contention)")
            return
        log(f"  pull at {n}/90 dates, alive={alive}; sleeping 300s")
        time.sleep(300)


def deepen_account(account, max_pages, state, known_hashes):
    st = state["accounts"].setdefault(account, {
        "pages": 0, "n_transfer": 0, "n_received_transfer": 0,
        "n_listed": 0, "n_in_window": 0,
        "before_ts": None, "done": False, "reason": "",
    })
    if st["done"]:
        log(f"{account}: already done ({st['reason']})")
        return
    # Legacy cursor field from the day-3 cursor attempt: ignore it; the
    # walk now uses before_ts (see module docstring).
    before_ts = st.get("before_ts")
    prev_first = None
    while st["pages"] < max_pages:
        url = f"{BASE}/{urllib.parse.quote(account, safe='')}/txns?limit=100"
        if before_ts:
            url += "&before_ts=" + str(before_ts)
        d = get_json(url)
        rows = d.get("data") or []
        if not rows:
            st["done"], st["reason"] = True, "empty page"
            break
        first_hash = rows[0].get("transaction_hash")
        if first_hash == prev_first:
            # same page again (cursor-style stall): stop to avoid a loop
            st["done"], st["reason"] = True, "page repeated (no progress)"
            break
        prev_first = first_hash
        st["pages"] += 1
        n_tr = 0
        n_recv = 0
        n_new = 0
        last_ts = None
        with open(OUT_ALL, "a") as fa, open(OUT_TRANSFERS, "a") as ft:
            for r in rows:
                ts = int(r["block"]["block_timestamp"])
                last_ts = ts
                if ts < WINDOW_START_NS:
                    # walked past the window; account done
                    st["done"], st["reason"] = True, "reached before window start"
                    break
                h = r["transaction_hash"]
                if h in known_hashes:
                    continue  # re-fetched boundary row; never double-count
                known_hashes.add(h)
                n_new += 1
                st["n_listed"] += 1
                fa.write(json.dumps(r) + "\n")
                if ts < WINDOW_END_NS:
                    st["n_in_window"] += 1
                    if is_transfer(r):
                        ft.write(json.dumps(r) + "\n")
                        # The accounts endpoint returns txns where the
                        # account is signer OR receiver. Only signer rows
                        # are the account's own sends (day 3: 2f31's walk
                        # returned 476 rows involving it but only 238
                        # sent by it; counting all 476 as its transfers
                        # overstated its history).
                        if r.get("signer_account_id") == account:
                            n_tr += 1
                        elif r.get("receiver_account_id") == account:
                            n_recv += 1
        st["n_transfer"] += n_tr
        st["n_received_transfer"] += n_recv
        if st["done"]:
            break
        if n_new == 0:
            st["done"], st["reason"] = True, "page added 0 new rows (no progress)"
            break
        # before_ts is strictly-before (verified day 3): +1 ns re-includes
        # same-block rows at the boundary so none are skipped; dedupe
        # above drops the repeats.
        before_ts = last_ts + 1
        st["before_ts"] = before_ts
        save_state(state)
        log(f"  {account}: page {st['pages']} listed={len(rows)} "
            f"new={n_new} new TRANSFER sent={n_tr} received={n_recv} "
            f"(total sent {st['n_transfer']})")
        if st["pages"] < max_pages:
            log(f"  pacing sleep {BASE_DELAY}s")
            time.sleep(BASE_DELAY)
    else:
        st["done"], st["reason"] = True, f"page cap {max_pages} reached"
    save_state(state)
    log(f"{account}: DONE pages={st['pages']} in-window listed={st['n_in_window']} "
        f"TRANSFER sent={st['n_transfer']} received={st.get('n_received_transfer', 0)} "
        f"({st['reason']})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accounts", default="",
                    help="comma-separated account ids")
    ap.add_argument("--top", type=int, default=0,
                    help="deepen top N accounts by transferCount from "
                         "account_features.json")
    ap.add_argument("--pages", type=int, default=5,
                    help="max pages (100 txns each) per account")
    ap.add_argument("--wait-for-pull", action="store_true")
    args = ap.parse_args()
    os.makedirs(RAW, exist_ok=True)
    if args.wait_for_pull:
        wait_for_pull()
    accounts = []
    if args.accounts:
        accounts = [a.strip() for a in args.accounts.split(",") if a.strip()]
    elif args.top:
        with open(FEATURES) as f:
            feats = json.load(f)["accounts"]
        accounts = [f["accountId"] for f in
                    sorted(feats, key=lambda x: -x["transferCount"])[:args.top]]
    if not accounts:
        print("no accounts given (--accounts or --top)", flush=True)
        sys.exit(1)
    log(f"deepen: {len(accounts)} account(s), up to {args.pages} pages each, "
        f"{BASE_DELAY}s pacing")
    state = load_state()
    known = seen_hashes()
    for i, acct in enumerate(accounts):
        if i > 0:
            log(f"pacing sleep {BASE_DELAY}s")
            time.sleep(BASE_DELAY)
        try:
            deepen_account(acct, args.pages, state, known)
        except Exception as e:
            log(f"FAILED {acct}: {e!r} -- state saved, resume later")
            sys.exit(2)
    log("DONE this run")


if __name__ == "__main__":
    main()
