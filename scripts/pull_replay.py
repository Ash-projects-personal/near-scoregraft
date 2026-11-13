#!/usr/bin/env python3
"""
Scoregraft replay-set puller (NearBlocks v3, no-auth public API).

Design (verified 2026-11-07, day 1):
- v1/v2 are deprecated; mainnet retires them end of Nov 2026. v3 is current.
- v3 supports `before_ts` (19-digit nanosecond timestamp) to jump to any date:
  GET /v3/txns?limit=100&before_ts=<ns>  -> 100 newest txns before that instant.
- v3 list items include actions[{action, method}] so TRANSFER rows can be
  classified WITHOUT a detail call (v1 list items had actions=null).
- Anonymous rate limit is TIGHT (observed: ~5 calls per few minutes, then
  HTTP 429 with a multi-minute cooldown). Pacing: 120 s between calls,
  exponential backoff on 429 (120s -> 600s max), resume from state file.
- Window (fixed day 1): 2026-08-09 00:00 UTC .. 2026-11-06 23:59:59 UTC
  (90 days; matches the CoinGecko 90d price series pulled the same day).
- Stratification: one page (limit=100) per day at 12:00 UTC -> up to 9,000
  txns; TRANSFER rows extracted. Target 10,000 TRANSFER rows is NOT
  reachable from 1 page/day if the TRANSFER share is low; the script logs
  the measured share and the day-2 runner tops up with extra pages per day
  (before_ts of the last row of the previous page) until the target is met.

Usage:
  python3 scripts/pull_replay.py            # resume / run to completion
  python3 scripts/pull_replay.py --dates 2026-11-06,2026-11-05   # subset
State: data/raw/pull_state.json (completed dates, last before_ts per date)
Output: data/raw/replay_txns.jsonl (one txn per line, TRANSFER only),
        data/raw/replay_list_all.jsonl (every listed txn, for share stats)
"""
import argparse
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://api.nearblocks.io/v3/txns"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
STATE_PATH = os.path.join(RAW, "pull_state.json")
OUT_TRANSFERS = os.path.join(RAW, "replay_txns.jsonl")
OUT_ALL = os.path.join(RAW, "replay_list_all.jsonl")

WINDOW_START = datetime.date(2026, 8, 9)
WINDOW_END = datetime.date(2026, 11, 6)
PER_PAGE = 100
BASE_DELAY = 120          # seconds between calls (anonymous limit is tight)
MAX_BACKOFF = 600         # seconds

UA = {"User-Agent": "scoregraft-replay-pull/0.1 (NEAR hackathon research)"}


def ns_for(day, hour=12):
    dt = datetime.datetime(day.year, day.month, day.day, hour, 0, 0,
                           tzinfo=datetime.timezone.utc)
    return str(int(dt.timestamp() * 1e9))


def get_json(url):
    """One GET with 429/5xx backoff. Returns parsed JSON or raises.
    Honors Retry-After when present.

    RESILIENCE FIX 2026-11-08 (day 2): the run died twice (day 1 on
    2026-08-09, day 2 on 2026-08-24) after 3 consecutive 30 s timeouts.
    The NearBlocks path intermittently stalls for this VM (timeouts
    cluster; a probe minutes later succeeds in ~1.5 s), so a 30 s
    timeout + give-up-after-3 is too brittle for a background pull.
    Timeout raised to 60 s; generic network errors now retry up to 10
    times with capped backoff before giving up on the date.

    CURL FALLBACK 2026-11-10 (day 4): urllib's urlopen started
    truncating ~72KB responses with IncompleteRead on 2026-10-22
    (6 consecutive attempts across two processes, 42-68KB read of
    ~72.5KB) while curl completed the IDENTICAL request in 1.4 s
    (100 rows, 72,761 bytes, verified 19:36 UTC). fetch_once() below
    therefore falls back to curl whenever urllib fails on a fetch.
    The 429/5xx backoff semantics are unchanged.
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
                print(f"  HTTP {e.code} retry-after={e.retry_after} "
                      f"body={e.body[:120]!r}; sleeping {wait}s", flush=True)
                time.sleep(wait)
                delay = min(delay * 2, MAX_BACKOFF)
                continue
            raise
        except Exception as e:  # network blip: same backoff, then re-raise
            attempts += 1
            print(f"  error {e!r} (attempt {attempts}/10); sleeping {delay}s",
                  flush=True)
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
    return {"window": [str(WINDOW_START), str(WINDOW_END)],
            "per_page": PER_PAGE, "done_dates": {}, "stats": {}}


def save_state(s):
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f, indent=2)
    os.replace(tmp, STATE_PATH)


def is_transfer(row):
    acts = row.get("actions") or []
    return any(a.get("action") == "TRANSFER" for a in acts)


def pull_date(day, state):
    """One page (PER_PAGE txns) at 12:00 UTC on `day`. Returns counts."""
    before = ns_for(day)
    d = get_json(f"{BASE}?limit={PER_PAGE}&before_ts={before}")
    rows = d.get("data") or []
    n_transfer = 0
    with open(OUT_ALL, "a") as fa, open(OUT_TRANSFERS, "a") as ft:
        for r in rows:
            fa.write(json.dumps(r) + "\n")
            if is_transfer(r):
                ft.write(json.dumps(r) + "\n")
                n_transfer += 1
    first_ts = rows[0]["block"]["block_timestamp"] if rows else None
    last_ts = rows[-1]["block"]["block_timestamp"] if rows else None
    state["done_dates"][str(day)] = {
        "n_listed": len(rows), "n_transfer": n_transfer,
        "first_block_ts": first_ts, "last_block_ts": last_ts,
        "before_ts_used": before,
    }
    save_state(state)
    return len(rows), n_transfer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dates", default="",
                    help="comma-separated YYYY-MM-DD list; default: all "
                         "unfinished days in the window")
    args = ap.parse_args()
    os.makedirs(RAW, exist_ok=True)
    state = load_state()
    if args.dates:
        days = [datetime.date.fromisoformat(x.strip())
                for x in args.dates.split(",") if x.strip()]
    else:
        days = []
        d = WINDOW_START
        while d <= WINDOW_END:
            if str(d) not in state["done_dates"]:
                days.append(d)
            d += datetime.timedelta(days=1)
    print(f"pull: {len(days)} date(s) remaining, {PER_PAGE} txns each, "
          f"{BASE_DELAY}s pacing", flush=True)
    tot_listed = tot_transfer = 0
    for i, day in enumerate(days):
        if i > 0:
            print(f"  pacing sleep {BASE_DELAY}s", flush=True)
            time.sleep(BASE_DELAY)
        try:
            n, nt = pull_date(day, state)
        except Exception as e:
            print(f"FAILED {day}: {e!r} -- state saved, resume later",
                  flush=True)
            sys.exit(2)
        tot_listed += n
        tot_transfer += nt
        print(f"{day}: listed={n} transfer={nt} "
              f"(running transfer share "
              f"{tot_transfer/max(tot_listed,1):.3f})", flush=True)
    print(f"DONE this run: listed={tot_listed} transfer={tot_transfer}",
          flush=True)


if __name__ == "__main__":
    main()
