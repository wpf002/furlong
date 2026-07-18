"""Backfill Hip.coveringSire for the Keeneland November Breeding Stock sales
already in the DB, from the Keeneland feed (which carries CoveringSire).

Going forward the ingest adapters capture it automatically; this fills in the
sales that were ingested before the field existed.

  cd services/ml
  DATABASE_URL=<prod> .venv/bin/python scripts/backfill_covering_sire.py [--dry-run]
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

import psycopg

URL = os.environ["DATABASE_URL"].split("?", 1)[0]
FLEX = "https://flex.keeneland.com/misc/GenerateJson.do"
# Keeneland Nov Breeding Stock feed sale id = <year+1>03 (2025 sale -> 202603).
KEE_NOV = {y: f"{y + 1}03" for y in range(1999, 2027)}


def feed_covering(sale_id: str) -> dict[int, str]:
    """{hipNumber: coveringSire} across all sessions of a Keeneland sale."""
    out: dict[int, str] = {}
    for session in range(1, 8):
        url = f"{FLEX}?actionName=SalesSummary&paramNames=sale_id%5E%21%5Esession&paramValues={sale_id}%5E%21%5E{session}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest"})
        try:
            rows = json.load(urllib.request.urlopen(req, timeout=60))
        except Exception:
            continue
        rows = rows if isinstance(rows, list) else rows.get("results", [])
        for r in rows:
            try:
                hip = int(str(r.get("Hip")))
            except (TypeError, ValueError):
                continue
            cov = (r.get("CoveringSire") or "").strip()
            if cov:
                out[hip] = cov
    return out


def main() -> None:
    dry = "--dry-run" in sys.argv
    with psycopg.connect(URL) as c, c.cursor() as cur:
        cur.execute("""
            SELECT id, year FROM "Sale"
            WHERE "auctionHouse"='KEENELAND' AND category='BREEDING_STOCK' AND "name" ILIKE '%November%'
            ORDER BY year
        """)
        sales = cur.fetchall()
        print(f"{len(sales)} Keeneland November breeding-stock sales in the DB")
        total = 0
        for sale_id, year in sales:
            feed_id = KEE_NOV.get(year)
            if not feed_id:
                continue
            cov = feed_covering(feed_id)
            if not cov:
                print(f"  {year}: feed {feed_id} returned no covering sires — skip")
                continue
            n = 0
            for hip, sire in cov.items():
                if dry:
                    n += 1
                    continue
                cur.execute(
                    'UPDATE "Hip" SET "coveringSire"=%s WHERE "saleId"=%s AND "hipNumber"=%s',
                    (sire, sale_id, hip),
                )
                n += cur.rowcount
            total += n
            print(f"  {year} (feed {feed_id}): {'would set' if dry else 'set'} coveringSire on {n} hips")
        if not dry:
            c.commit()
        print(f"\n{'[dry run] ' if dry else ''}covering sire on {total} hips total")


if __name__ == "__main__":
    main()
