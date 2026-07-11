"""Evaluate a vendor's sire-stats sample file BEFORE licensing the full feed.

Answers the questions that decide whether a feed is worth paying for:
  - how many of OUR sires does it match?
  - does it reach the FIRST-CROP sires in the live catalog (the ones we price
    worst, where stud fee is the only signal)?
  - which stat fields are actually populated?

Reads a CSV with flexible headers (see COLUMN_ALIASES). Dry-run by default;
pass --commit to POST matched rows to the running API's /ingest/sire-stats.

  cd services/ml
  .venv/bin/python scripts/evaluate_sire_stats_feed.py <file.csv> [--commit] [--api http://127.0.0.1:4100]
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from urllib import request as urlreq

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.training.features import _database_url  # noqa: E402
from app.valuation.model import normalize_entity_name  # noqa: E402

# Map many plausible vendor headers onto our fields (lowercased, stripped).
COLUMN_ALIASES = {
    "sireName": ["sire", "sirename", "stallion", "stallion name", "sire name", "name"],
    "year": ["year", "crop year", "stat year", "reporting year", "season"],
    "studFeeCents": ["stud fee", "studfee", "fee", "advertised fee"],
    "earningsPerStarterCents": ["earnings per starter", "eps", "earn/starter", "avg earnings per starter"],
    "stakesWinnerPct": ["stakes winner %", "sw%", "swpct", "stakes winners pct", "sw pct"],
    "avgYearlingCents": ["avg yearling", "average yearling", "avg yearling price", "median yearling"],
}
CENTS_FIELDS = {"studFeeCents", "earningsPerStarterCents", "avgYearlingCents"}


def _resolve_headers(headers: list[str]) -> dict:
    low = {h.lower().strip(): h for h in headers}
    out = {}
    for field, aliases in COLUMN_ALIASES.items():
        for a in aliases:
            if a in low:
                out[field] = low[a]
                break
    return out


def _num(s):
    if s is None:
        return None
    s = str(s).strip().replace(",", "").replace("$", "").replace("%", "")
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def load_db_sires():
    """DB sires by normalizedName → prior-sold-foal count, plus the set of
    first-crop sires (0 prior sold foals) in upcoming (>= this year) catalogs."""
    import datetime
    import psycopg

    this_year = datetime.date.today().year
    with psycopg.connect(_database_url()) as conn, conn.cursor() as cur:
        cur.execute('SELECT DISTINCT "normalizedName" FROM "Horse" WHERE "normalizedName" IS NOT NULL')
        all_norms = {r[0] for r in cur.fetchall()}
        cur.execute(
            """
            WITH prior AS (
              SELECT sire."normalizedName" AS n, COUNT(*) AS c
              FROM "SaleResult" r JOIN "Hip" h ON h.id=r."hipId"
              JOIN "Sale" s ON s.id=h."saleId"
              JOIN "Horse" yh ON yh.id=h."horseId"
              JOIN "Horse" sire ON sire.id=yh."sireId"
              WHERE r.rna=false AND r."priceCents">0 AND s.year < %s
              GROUP BY sire."normalizedName"
            ), catalog AS (
              SELECT DISTINCT sire."normalizedName" AS n
              FROM "Hip" h JOIN "Sale" s ON s.id=h."saleId"
              JOIN "Horse" yh ON yh.id=h."horseId"
              JOIN "Horse" sire ON sire.id=yh."sireId"
              WHERE s.year >= %s AND sire."normalizedName" IS NOT NULL
            )
            SELECT c.n FROM catalog c LEFT JOIN prior p ON p.n=c.n
            WHERE COALESCE(p.c,0)=0
            """,
            (this_year, this_year),
        )
        first_crop_catalog = {r[0] for r in cur.fetchall()}
    return all_norms, first_crop_catalog


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--commit", action="store_true", help="POST matched rows to /ingest/sire-stats")
    ap.add_argument("--api", default="http://127.0.0.1:4100")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.file, newline="", encoding="utf-8-sig")))
    if not rows:
        print("empty file")
        return
    hdr = _resolve_headers(list(rows[0].keys()))
    print(f"file: {args.file}   rows: {len(rows):,}")
    print(f"resolved columns: {json.dumps(hdr)}")
    if "sireName" not in hdr or "year" not in hdr:
        print("\nERROR: could not find a sire-name and/or year column. Rename headers or extend COLUMN_ALIASES.")
        return

    all_norms, first_crop_catalog = load_db_sires()
    matched, unmatched = set(), set()
    field_pop = {f: 0 for f in COLUMN_ALIASES if f not in ("sireName", "year")}
    payload = []
    for r in rows:
        raw_name = r.get(hdr["sireName"])
        norm = normalize_entity_name(raw_name)
        (matched if norm in all_norms else unmatched).add(norm)
        rec = {"sireName": raw_name, "year": _num(r.get(hdr["year"]))}
        for f in field_pop:
            if f in hdr:
                v = _num(r.get(hdr[f]))
                if v is not None:
                    field_pop[f] += 1
                    if f in CENTS_FIELDS:
                        rec[f] = round(v * 100)
                    elif f == "stakesWinnerPct":
                        # model wants a 0–1 fraction; vendors often give a percent
                        # (e.g. 14.2). Anything > 1 is treated as a percentage.
                        rec[f] = v / 100 if v > 1 else v
                    else:
                        rec[f] = v
        payload.append(rec)

    covered_first_crop = {n for n in matched if n in first_crop_catalog}
    print(f"\nSIRE MATCH")
    print(f"  matched to our horses : {len(matched):,}")
    print(f"  unmatched (in feed, not us): {len(unmatched):,}")
    print(f"\nFIELD POPULATION (non-empty values across {len(rows):,} rows)")
    for f, c in field_pop.items():
        print(f"  {f:<26} {c:>7,}  ({c/len(rows)*100:4.0f}%)")
    print(f"\nFIRST-CROP CATALOG COVERAGE  ← the number that matters")
    print(f"  first-crop sires in live catalog : {len(first_crop_catalog):,}")
    print(f"  of those, covered by this feed   : {len(covered_first_crop):,}"
          f"  ({(len(covered_first_crop)/len(first_crop_catalog)*100 if first_crop_catalog else 0):.0f}%)")

    if args.commit:
        body = json.dumps(payload).encode()
        req = urlreq.Request(f"{args.api}/ingest/sire-stats", data=body,
                             headers={"content-type": "application/json"}, method="POST")
        with urlreq.urlopen(req) as resp:
            print(f"\nCOMMIT → {resp.read().decode()}")
    else:
        print(f"\n(dry run — re-run with --commit to POST {len(payload):,} rows to {args.api}/ingest/sire-stats)")


if __name__ == "__main__":
    main()
