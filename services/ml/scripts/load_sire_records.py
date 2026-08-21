"""Populate each stallion's OWN race record from the catalogue pages we already
hold, via the app's existing /ingest/racing-records endpoint.

Why this and not a 149k-page backfill: measured on 504 sold hips holding both a
page and a price, the catalogue page explains 16.6% of price variance overall
but only 1.2% once you know the sire — it was proxying for the sire. Backfilling
every historical page buys ~1%.

The sire's OWN record is different. Measured across 31,585 sold yearlings,
corr(log sire career earnings, price) is +0.287 where the sire has <10 prior
sold yearlings, versus +0.119 once he has 50+. When there is no price history,
the stallion's race record carries the signal — and 24% of Keeneland September
2026 is by such sires. A sire's record is a property of the SIRE, so ~190 pages
per catalogue is enough; we never need the other 148,000.

  cd services/ml
  DATABASE_URL=... .venv/bin/python scripts/load_sire_records.py [--api URL] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg  # noqa: E402

from app.form.parse import horse_key  # noqa: E402
from app.sire_record import parse_sire_block  # noqa: E402
from app.training.features import _database_url  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="https://api-production-3f46.up.railway.app")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with psycopg.connect(_database_url()) as c:
        cur = c.cursor()
        cur.execute("SET max_parallel_workers_per_gather=0")
        cur.execute('SELECT "catalogPageText" FROM "Hip" WHERE "catalogPageText" IS NOT NULL')
        sires: dict[str, dict] = {}
        for (page,) in cur.fetchall():
            d = parse_sire_block(page)
            if not d:
                continue
            k = horse_key(d["sireName"])
            if k and k not in sires:
                sires[k] = d

    records = []
    for d in sires.values():
        if not d.get("earningsUsd"):
            continue
        records.append({
            "name": d["sireName"],
            "wins": d.get("winsCount"),
            # Career earnings from the catalogue's own "By SIRE" summary, in cents.
            "earningsCents": int(d["earningsUsd"]) * 100,
            "foalingYear": d.get("sireYob"),
        })

    print(f"{len(sires)} sires parsed; {len(records)} carry career earnings")
    fc = sum(1 for d in sires.values() if d.get("firstCrop"))
    print(f"  {fc} flagged first-crop (no sales history — where this matters most)")
    for r in records[:5]:
        print(f"   {r['name']:24} {r['foalingYear']}  ${r['earningsCents']//100:,}  wins={r['wins']}")
    if args.dry_run:
        print("\n[dry run — nothing posted]")
        return

    req = urllib.request.Request(
        f"{args.api}/ingest/racing-records",
        data=json.dumps(records).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        print("\ningest:", json.load(resp))


if __name__ == "__main__":
    main()
