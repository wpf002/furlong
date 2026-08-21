"""Coverage + integrity gate for the race-form archive.

Answers the only questions that decide whether this archive is worth its
backfill, against REAL Furlong catalogues:

  * what share of an upcoming sale's hips resolve to a race record OR family
    data (sire progeny / dam produce / siblings)?
  * are there malformed rows? (single-character names, field sizes > 30)
  * are there unexplained gaps in the date range? (Christmas is a real gap)

  cd services/ml
  DATABASE_URL=... .venv/bin/python scripts/form_coverage.py [--sale <saleId>]
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg  # noqa: E402

from app.training.features import _database_url  # noqa: E402

ARCHIVE_FROM = date(2024, 1, 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sale", default=None, help="sale id; default = the next upcoming sale with a catalogue")
    args = ap.parse_args()

    with psycopg.connect(_database_url()) as c:
        cur = c.cursor()
        cur.execute("SET max_parallel_workers_per_gather=0")

        cur.execute('SELECT count(*), count(DISTINCT "horseKey"), min("date"), max("date") FROM "HorseFormLine"')
        rows, horses, dmin, dmax = cur.fetchone()
        print("=== ARCHIVE ===")
        print(f"form lines: {rows:,}   distinct horses: {horses:,}")
        print(f"date range: {dmin} -> {dmax}")
        if rows == 0:
            print("\nArchive is EMPTY — run scripts/probe_feed.py, then backfill_form.py.")

        print("\n=== INTEGRITY ===")
        cur.execute('SELECT count(*) FROM "HorseFormLine" WHERE length(trim("horseName")) < 2')
        bad_names = cur.fetchone()[0]
        cur.execute('SELECT count(*) FROM "HorseFormLine" WHERE "fieldSize" > 30')
        bad_fields = cur.fetchone()[0]
        print(f"single-character names : {bad_names}  (must be 0)")
        print(f"field size > 30        : {bad_fields}  (must be 0)")
        cur.execute('''SELECT "sireKey", count(DISTINCT "horseKey") n FROM "HorseFormLine"
                       WHERE "sireKey" IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 3''')
        top = cur.fetchall()
        if top:
            print(f"largest sire progeny   : {top[0][1]} ({top[0][0]}) — implausibly large suggests a bad join")

        print("\n=== DATE GAPS (holidays are real gaps) ===")
        cur.execute('SELECT "date" FROM "FormIngestDay" WHERE status=%s', ("ok",))
        covered = {r[0].date() if hasattr(r[0], "date") else r[0] for r in cur.fetchall()}
        cur.execute('SELECT "date", error FROM "FormIngestDay" WHERE status=%s ORDER BY "date"', ("failed",))
        failed = cur.fetchall()
        if covered:
            d, missing = ARCHIVE_FROM, []
            today = date.today()
            while d <= today:
                if d not in covered:
                    missing.append(d)
                d += timedelta(days=1)
            print(f"covered days: {len(covered)}   missing: {len(missing)}   failed: {len(failed)}")
            for f in failed[:10]:
                print(f"   FAILED {f[0]}: {(f[1] or '')[:80]}")
            if missing:
                print("   first missing:", ", ".join(str(m) for m in missing[:10]))
                print("   repair: --repair " + ",".join(str(m) for m in missing[:50]))
        else:
            print("no ingest ledger yet")

        # ---- the decisive question: does a real catalogue resolve? ----
        if args.sale:
            sale_id = args.sale
        else:
            cur.execute('''SELECT s.id FROM "Sale" s JOIN "Hip" h ON h."saleId"=s.id
                           WHERE s."startDate" > NOW() GROUP BY s.id
                           ORDER BY min(s."startDate") LIMIT 1''')
            r = cur.fetchone()
            sale_id = r[0] if r else None
        if not sale_id:
            print("\nNo upcoming catalogued sale to measure against.")
            return

        cur.execute('SELECT "auctionHouse", name, year FROM "Sale" WHERE id=%s', (sale_id,))
        house, name, year = cur.fetchone()
        print(f"\n=== CATALOGUE RESOLUTION — {house} {name} {year} ===")
        cur.execute('''
            SELECT count(*) AS hips,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "HorseFormLine" f WHERE f."horseKey"=yh."normalizedName")) AS own_record,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "HorseFormLine" f WHERE f."sireKey"=si."normalizedName")) AS sire_data,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "HorseFormLine" f WHERE f."damKey"=dm."normalizedName")) AS dam_data
            FROM "Hip" h
            JOIN "Horse" yh ON yh.id=h."horseId"
            LEFT JOIN "Horse" si ON si.id=yh."sireId"
            LEFT JOIN "Horse" dm ON dm.id=yh."damId"
            WHERE h."saleId"=%s
        ''', (sale_id,))
        hips, own, sire, dam = cur.fetchone()
        pct = lambda n: f"{(n/hips*100 if hips else 0):5.1f}%"
        print(f"hips                       : {hips}")
        print(f"with own race record       : {own} ({pct(own)})   [expected ~0 for yearlings]")
        print(f"with sire progeny data     : {sire} ({pct(sire)})")
        print(f"with dam produce data      : {dam} ({pct(dam)})")
        cur.execute('''
            SELECT count(*) FROM "Hip" h
            JOIN "Horse" yh ON yh.id=h."horseId"
            LEFT JOIN "Horse" si ON si.id=yh."sireId"
            LEFT JOIN "Horse" dm ON dm.id=yh."damId"
            WHERE h."saleId"=%s AND (
              EXISTS (SELECT 1 FROM "HorseFormLine" f WHERE f."horseKey"=yh."normalizedName") OR
              EXISTS (SELECT 1 FROM "HorseFormLine" f WHERE f."sireKey"=si."normalizedName") OR
              EXISTS (SELECT 1 FROM "HorseFormLine" f WHERE f."damKey"=dm."normalizedName"))
        ''', (sale_id,))
        any_data = cur.fetchone()[0]
        print(f"RESOLVING TO ANY DATA      : {any_data} ({pct(any_data)})  <- the headline number")

        # Denominator: how many distinct sires/dams this catalogue needs matched.
        cur.execute('''SELECT count(DISTINCT si."normalizedName"), count(DISTINCT dm."normalizedName")
                       FROM "Hip" h JOIN "Horse" yh ON yh.id=h."horseId"
                       LEFT JOIN "Horse" si ON si.id=yh."sireId"
                       LEFT JOIN "Horse" dm ON dm.id=yh."damId" WHERE h."saleId"=%s''', (sale_id,))
        ns, nd = cur.fetchone()
        print(f"(catalogue needs {ns} distinct sires and {nd} distinct dams matched)")


if __name__ == "__main__":
    main()
