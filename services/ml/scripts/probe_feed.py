"""Probe the results feed BEFORE trusting the parser or launching a backfill.

The archive's parser must be verified against MANY real payloads across
different tracks and dates - not one sample. That is exactly how the
517,000-single-letter-horses corruption happened. This script answers, from
real data:

  1. Which regions/courses does our licence actually cover?  (Furlong's sales
     are mostly US - if the feed is GB/IRE only, this archive helps Tattersalls
     lots and almost nothing else. Know that BEFORE backfilling years.)
  2. What shapes does `also_ran` actually arrive in, and how often?
  3. Does the parser handle every shape seen, with zero malformed names?
  4. Do charted + also-ran counts reconcile with the stated field size?

  cd services/ml
  RACING_API_USER=... RACING_API_PASS=... .venv/bin/python scripts/probe_feed.py
"""
from __future__ import annotations

import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.form.client import RacingFeed  # noqa: E402
from app.form.parse import parse_also_ran, suspicious_name  # noqa: E402
from app.form.recorder import race_to_form_lines, integrity_check  # noqa: E402

# Spread the sample across seasons and days of week, not one date.
SAMPLE_DATES = [
    date(2024, 1, 13), date(2024, 4, 6), date(2024, 5, 4), date(2024, 8, 3),
    date(2024, 11, 2), date(2025, 3, 8), date(2025, 6, 7), date(2025, 9, 6),
    date(2026, 1, 10), date(2026, 5, 2),
]


def main() -> None:
    feed = RacingFeed()
    shapes: Counter = Counter()
    regions: Counter = Counter()
    courses: Counter = Counter()
    field_mismatch = 0
    malformed: list[str] = []
    total_races = total_lines = 0
    pedigree_present = reg_present = 0

    for d in SAMPLE_DATES:
        try:
            races = feed.results_for_date(d.isoformat())
        except Exception as e:  # noqa: BLE001
            print(f"{d}: fetch failed: {str(e)[:120]}")
            continue
        print(f"{d}: {len(races)} races")
        total_races += len(races)
        for r in races:
            regions[r.get("region") or r.get("country") or "?"] += 1
            courses[r.get("course") or r.get("track") or "?"] += 1
            ar = r.get("also_ran", r.get("alsoRan"))
            shapes[type(ar).__name__] += 1
            try:
                lines = race_to_form_lines(r, d)
            except Exception as e:  # noqa: BLE001
                malformed.append(f"{d} {r.get('race_id')}: {e}")
                continue
            total_lines += len(lines)
            for ln in lines:
                if suspicious_name(ln.horseName):
                    malformed.append(f"{d} {r.get('race_id')}: bad name {ln.horseName!r}")
                if ln.sireName:
                    pedigree_present += 1
                if ln.regNumber:
                    reg_present += 1
            stated = lines[0].fieldSize if lines else None
            if stated and len(lines) != stated:
                field_mismatch += 1

    print("\n=== COVERAGE (does this licence cover Furlong's sales?) ===")
    print("regions:", dict(regions))
    print("top courses:", [c for c, _ in courses.most_common(15)])
    print("\n=== also_ran SHAPES SEEN ===")
    print(dict(shapes), " <- if 'str' appears, the multi-space-and rule is load-bearing")
    print("\n=== PARSER HEALTH ===")
    print(f"races sampled : {total_races}")
    print(f"form lines    : {total_lines}")
    print(f"malformed     : {len(malformed)}")
    for m in malformed[:10]:
        print("   ", m)
    print(f"field-size mismatches: {field_mismatch}/{total_races} "
          "(some feeds state field size before scratchings - investigate if high)")
    print(f"lines carrying sire  : {pedigree_present}/{total_lines}")
    print(f"lines carrying reg # : {reg_present}/{total_lines}")
    if not total_races:
        print("\nNo races returned at all - check the licence's date range and region access.")


if __name__ == "__main__":
    main()
