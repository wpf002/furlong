"""Parse the Equibase Free Dataset (2023 result charts) into per-horse racing
records and load them into Furlong via POST /ingest/racing-records.

Source: Equibase "Free Dataset" — the complete 2023 calendar year of Result
Charts (TrackMaster `tch` schema). Each chart is one track-day; each RACE holds
per-runner ENTRY rows (NAME, OFFICIAL_FIN, SPEED_RATING, SEX) plus race-level
EARNING_SPLITS (purse paid by finish position). We aggregate, per horse across
the whole year:
  starts, wins (fin=1), places (fin=2), shows (fin=3),
  earningsCents (sum of the split for each finish), bestSpeedFigure (max).

The API matches each record to an existing horse by normalized name (a
broodmare's own form, a juvenile's starts, a sire's race record), powering the
horses-in-training valuation + the race-record card line.

NOTE (per ROADMAP): this is Equibase's free EVAL dataset (2023 only) and stays
out of git (data/ is gitignored). Production uses the licensed Equibase feed.

Usage:
  PYTHONPATH=. ./.venv/bin/python scripts/parse_equibase.py "/path/to/2023 Result Charts.zip"
  # optional: --out data/equibase/racing_2023.json  --no-post  --limit 500
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import zipfile
from collections import defaultdict

import httpx
import xml.etree.ElementTree as ET

API = "http://localhost:4100"


def _int(s, default=0):
    if s is None:
        return default
    m = re.search(r"-?\d+", str(s))
    return int(m.group(0)) if m else default


def parse_charts(zip_path: str, limit: int | None) -> dict:
    """Aggregate per-horse 2023 records from the result-charts zip."""
    rec: dict[str, dict] = defaultdict(
        lambda: {"name": None, "sex": None, "starts": 0, "wins": 0,
                 "places": 0, "shows": 0, "earnings": 0, "bestSpeedFigure": None}
    )
    files = 0
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist()
                 if n.endswith(".xml") and "__MACOSX" not in n]
        if limit:
            names = names[:limit]
        for n in names:
            try:
                root = ET.fromstring(z.read(n))
            except ET.ParseError:
                continue
            files += 1
            for race in root.iter("RACE"):
                splits = [_int(race.findtext(f"EARNING_SPLITS/SPLIT_{i}"), 0)
                          for i in range(1, 9)]
                for entry in race.findall("ENTRY"):
                    name = (entry.findtext("NAME") or "").strip()
                    if not name:
                        continue
                    fin_raw = entry.findtext("OFFICIAL_FIN")
                    fin = _int(fin_raw, 0)
                    if fin <= 0:
                        continue  # scratched / no official finish
                    key = name.upper()
                    r = rec[key]
                    r["name"] = name
                    sex = (entry.findtext("SEX") or "").strip()
                    if sex and not r["sex"]:
                        r["sex"] = sex
                    r["starts"] += 1
                    if fin == 1:
                        r["wins"] += 1
                    elif fin == 2:
                        r["places"] += 1
                    elif fin == 3:
                        r["shows"] += 1
                    if 1 <= fin <= len(splits):
                        r["earnings"] += splits[fin - 1]
                    sr = _int(entry.findtext("SPEED_RATING"), 0)
                    if sr > 0 and (r["bestSpeedFigure"] is None or sr > r["bestSpeedFigure"]):
                        r["bestSpeedFigure"] = sr
    return {"files": files, "records": rec}


# Equibase sex codes -> Furlong Sex enum.
SEX_MAP = {
    "C": "COLT", "F": "FILLY", "G": "GELDING", "H": "STALLION", "M": "MARE",
    "R": "COLT", "S": "STALLION",
}


def to_payload(records: dict) -> list[dict]:
    out = []
    for r in records.values():
        out.append({
            "name": r["name"],
            "sex": SEX_MAP.get((r["sex"] or "").upper()),
            "starts": r["starts"],
            "wins": r["wins"],
            "places": r["places"],
            "shows": r["shows"],
            "earningsCents": int(r["earnings"]) * 100,  # whole USD -> cents
            "bestSpeedFigure": r["bestSpeedFigure"],
        })
    return out


def post_records(payload: list[dict]) -> dict:
    totals = {"received": 0, "matched": 0, "updated": 0, "unmatched": 0}
    with httpx.Client(timeout=600) as c:
        for i in range(0, len(payload), 1000):
            batch = payload[i:i + 1000]
            r = c.post(f"{API}/ingest/racing-records", json=batch)
            r.raise_for_status()
            j = r.json()
            for k in totals:
                totals[k] += j.get(k, 0)
            print(f"  batch {i // 1000 + 1}: matched {j.get('matched')} "
                  f"updated {j.get('updated')} / {len(batch)}")
    return totals


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("charts_zip", help="path to '2023 Result Charts.zip'")
    ap.add_argument("--out", default=None, help="also write aggregated JSON here")
    ap.add_argument("--no-post", action="store_true", help="parse only, don't POST")
    ap.add_argument("--limit", type=int, default=None, help="cap chart files (debug)")
    args = ap.parse_args()

    t0 = time.time()
    parsed = parse_charts(args.charts_zip, args.limit)
    payload = to_payload(parsed["records"])
    starts = sum(p["starts"] for p in payload)
    print(f"parsed {parsed['files']} charts -> {len(payload)} horses, "
          f"{starts} starts  [{time.time() - t0:.1f}s]")
    top = sorted(payload, key=lambda p: p["earningsCents"], reverse=True)[:5]
    for p in top:
        print(f"  top earner: {p['name']} — {p['starts']}st {p['wins']}w "
              f"${p['earningsCents'] // 100:,} fig {p['bestSpeedFigure']}")

    if args.out:
        import os
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        with open(args.out, "w") as f:
            json.dump(payload, f)
        print(f"wrote {args.out}")

    if not args.no_post:
        print("posting to API...")
        totals = post_records(payload)
        print(f"== loaded: matched {totals['matched']} horses, "
              f"updated {totals['updated']}, unmatched {totals['unmatched']} ==")


if __name__ == "__main__":
    sys.exit(main())
