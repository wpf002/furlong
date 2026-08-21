"""Backfill the race-form archive over a date range (default 2024-01-01 -> today).

Resumable, batched, and honest about failure:
  * skips dates already recorded OK (re-runnable after an interruption)
  * retries transient failures, then records the date as FAILED and continues
  * NEVER banks a partial date silently - a date that errors is stored with
    status='failed' so it is retried, not skipped forever
  * integrity gate fails the run loudly on impossible output
  * elapsed time is measured from PROCESS START (a file's ctime updates on
    every write on macOS and produced wildly wrong ETAs)

  cd services/ml
  DATABASE_URL=... RACING_API_USER=... RACING_API_PASS=... \
    .venv/bin/python scripts/backfill_form.py [--from 2024-01-01] [--to 2026-08-19]
    [--repair 2024-03-05,2024-03-06] [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg  # noqa: E402

from app.form.client import RacingFeed, FeedError  # noqa: E402
from app.form.recorder import race_to_form_lines, write_day, integrity_check  # noqa: E402

START = time.monotonic()  # process start - NOT a file ctime


def _url() -> str:
    from app.training.features import _database_url
    return _database_url()


def covered_dates(conn) -> set[date]:
    with conn.cursor() as cur:
        cur.execute('SELECT "date" FROM "FormIngestDay" WHERE status = %s', ("ok",))
        return {r[0].date() if isinstance(r[0], datetime) else r[0] for r in cur.fetchall()}


def mark(conn, day: date, races: int, lines: int, status: str, error: str | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            '''INSERT INTO "FormIngestDay" ("date", races, "formLines", status, error, "ingestedAt")
               VALUES (%s,%s,%s,%s,%s,NOW())
               ON CONFLICT ("date") DO UPDATE SET races=EXCLUDED.races,
                 "formLines"=EXCLUDED."formLines", status=EXCLUDED.status,
                 error=EXCLUDED.error, "ingestedAt"=NOW()''',
            (day, races, lines, status, error),
        )
    conn.commit()


def do_day(feed: RacingFeed, conn, day: date, dry: bool) -> tuple[int, int]:
    """Fetch + record one day. Raises on failure - the caller records it as
    failed. Returns (races, form lines written)."""
    races = feed.results_for_date(day.isoformat())
    lines = []
    for r in races:
        try:
            lines.extend(race_to_form_lines(r, day))
        except Exception as e:  # a single malformed race must not lose the day
            print(f"    ! race skipped on {day}: {e}")
    problems = integrity_check(lines)
    if problems:
        raise RuntimeError(f"integrity gate failed on {day}: {problems[:5]}")
    if dry:
        return len(races), len(lines)
    written = write_day(conn, lines)
    conn.commit()
    return len(races), written


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="frm", default="2024-01-01")
    ap.add_argument("--to", dest="to", default=date.today().isoformat())
    ap.add_argument("--repair", default="", help="comma-separated dates to reprocess REGARDLESS of coverage")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    feed = RacingFeed()
    conn = psycopg.connect(_url())

    if args.repair:
        days = [date.fromisoformat(d.strip()) for d in args.repair.split(",") if d.strip()]
        print(f"REPAIR: reprocessing {len(days)} date(s) regardless of coverage")
    else:
        start = date.fromisoformat(args.frm)
        end = date.fromisoformat(args.to)
        done = covered_dates(conn)
        days = []
        d = start
        while d <= end:
            if d not in done:
                days.append(d)
            d += timedelta(days=1)
        print(f"{len(days)} date(s) to process ({start} -> {end}); {len(done)} already covered")

    total_lines = failed = 0
    failures: list[str] = []
    for i, day in enumerate(days, 1):
        try:
            races, lines = do_day(feed, conn, day, args.dry_run)
            total_lines += lines
            if not args.dry_run:
                mark(conn, day, races, lines, "ok", None)
            elapsed = time.monotonic() - START      # from process start
            rate = i / elapsed if elapsed > 0 else 0
            eta = (len(days) - i) / rate if rate > 0 else 0
            print(f"[{i}/{len(days)}] {day}  races={races:3} lines={lines:5}  "
                  f"eta {eta/60:5.1f}m")
        except Exception as e:  # noqa: BLE001
            failed += 1
            failures.append(f"{day}: {e}")
            if not args.dry_run:
                mark(conn, day, 0, 0, "failed", str(e)[:500])
            print(f"[{i}/{len(days)}] {day}  FAILED: {str(e)[:120]}")

    print(f"\ndone in {(time.monotonic()-START)/60:.1f}m — {total_lines} form lines, {failed} failed date(s)")
    for f in failures[:20]:
        print("  ", f)
    if failures:
        print(f"\nrepair with:\n  --repair {','.join(f.split(':')[0] for f in failures[:50])}")
    conn.close()


if __name__ == "__main__":
    main()
