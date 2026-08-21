"""Backfill catalogPageText across Furlong's OWN sale archive.

The archive already holds ~149,000 sold hips, but almost none carry the
black-type catalogue page — so `pedigree_score` is NaN for nearly every
training row and the sire-record extractor can only see today's catalogues.
Auction houses publish their past catalogues; this walks the archive, fetches
each sale's catalogue PDF, and loads the pages.

No licence required: these are the same catalogues we already ingest for
current sales. Fasig-Tipton exposes each sale's date through its own sales API,
and publishes the catalogue at /catalogs/<YYYY>/<MMDD>/web.pdf.

Resumable: a sale whose hips already have page text is skipped.

  cd services/ml
  DATABASE_URL=... .venv/bin/python scripts/backfill_archive_catalogs.py [--since 2024] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg  # noqa: E402

from app.parsing.catalog_pages import load_for_sale  # noqa: E402
from app.training.features import _database_url  # noqa: E402

START = time.monotonic()
UA = {"User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest"}

# Fasig-Tipton sale code {location}{yy}{suffix} -> the sale name we store.
FT_CODES = {
    "The July Sale": ("K", "B"),
    "The Saratoga Sale": ("N", "A"),
    "New York Bred Yearlings": ("N", "B"),
    "Kentucky October Yearlings": ("K", "C"),
    "California Fall Yearlings": ("C", "B"),
    "Midlantic Fall Yearlings": ("M", "B"),
}


def ft_catalog_url(name: str, year: int) -> str | None:
    """Resolve a Fasig-Tipton sale's catalogue PDF from its own sales API."""
    loc_suf = FT_CODES.get(name)
    if not loc_suf:
        return None
    code = f"{loc_suf[0]}{year % 100:02d}{loc_suf[1]}"
    try:
        req = urllib.request.Request(
            f"https://www.fasigtipton.com/django/api/sales/?sale_identifier={code}", headers=UA
        )
        d = json.load(urllib.request.urlopen(req, timeout=30))
    except Exception:
        return None
    if not d:
        return None
    sd = (d[0].get("sale_start_day") or d[0].get("sale_date") or "")[:10]
    if len(sd) != 10:
        return None
    y, m, dd = sd.split("-")
    return f"https://www.fasigtipton.com/catalogs/{y}/{m}{dd}/web.pdf"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", type=int, default=2024)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = psycopg.connect(_database_url())
    cur = conn.cursor()
    cur.execute("SET max_parallel_workers_per_gather=0")
    cur.execute(
        '''SELECT s.id, s."auctionHouse", s.name, s.year, count(*) hips,
                  count(*) FILTER (WHERE h."catalogPageText" IS NOT NULL) withtext
           FROM "Sale" s JOIN "Hip" h ON h."saleId"=s.id
           WHERE s.year >= %s GROUP BY 1,2,3,4 ORDER BY s.year DESC''',
        (args.since,),
    )
    sales = cur.fetchall()

    done = skipped = failed = total_written = 0
    for sid, house, name, year, hips, withtext in sales:
        if withtext >= hips * 0.9:  # already covered
            skipped += 1
            continue
        url = ft_catalog_url(name, year) if house == "FASIG_TIPTON" else None
        if not url:
            print(f"  -- {house} {year} {name[:34]:36} no catalogue URL resolver ({hips:,} hips)")
            skipped += 1
            continue
        print(f"  >> {house} {year} {name[:34]:36} {hips:,} hips  {url}")
        if args.dry_run:
            continue
        try:
            res = load_for_sale(sid, url)
            total_written += res["written"]
            done += 1
            print(f"     extracted {res['extracted']:,}  matched {res['matched']:,}  wrote {res['written']:,}"
                  f"   [{(time.monotonic()-START)/60:.1f}m elapsed]")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"     FAILED: {str(e)[:140]}")

    print(f"\n{done} sale(s) loaded, {skipped} skipped, {failed} failed — "
          f"{total_written:,} catalogue pages written in {(time.monotonic()-START)/60:.1f}m")
    conn.close()


if __name__ == "__main__":
    main()
