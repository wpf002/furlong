"""Parse the Equibase Past-Performance (SIMD) files for EXACT-match racing records.

Tighter accuracy than parse_equibase.py: the result charts carry no foaling year,
so matching was name-only (same-era homonyms could collide). The SIMD
past-performance files identify each runner precisely — `Starters/Horse` carries
HorseName + YearOfBirth + RegistrationNumber + Sire — and `Starters/RaceSummary`
gives the multi-year record. So we:

  • key each horse by RegistrationNumber (Jockey Club id), dedup across the
    ~11,860 daily files, keeping the most complete (max career starts) copy;
  • build a CAREER record by summing each year's total block (the max-starts
    RaceSummary per Year+Country — smaller same-year blocks are surface/track
    subsets, never the total);
  • emit name + foalingYear (+ sireName) so the API matches name+YearOfBirth
    EXACTLY, eliminating cross-generation and same-era name collisions;
  • fold in the best 2023 speed figure from the charts pass (racing_2023.json),
    joined by name only when the name is unambiguous here.

NOTE (per ROADMAP): Equibase free EVAL dataset (2023), gitignored. Production
uses the licensed feed (DRF/Timeform pending).

Usage:
  PYTHONPATH=. ./.venv/bin/python scripts/parse_equibase_pp.py "/path/to/2023 PPs.zip" \
      [--figures data/equibase/racing_2023.json] [--out data/equibase/racing_pp_2023.json] \
      [--no-post] [--limit N]
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
import zipfile
from collections import defaultdict

import httpx
import xml.etree.ElementTree as ET

API = "http://localhost:4100"
SEX_MAP = {"C": "COLT", "F": "FILLY", "G": "GELDING", "H": "STALLION",
           "M": "MARE", "R": "COLT", "S": "STALLION"}


def _money_cents(s: str | None) -> int:
    try:
        return int(round(float(s) * 100))
    except (TypeError, ValueError):
        return 0


def _int(s: str | None) -> int:
    try:
        return int(str(s).strip())
    except (TypeError, ValueError):
        return 0


def career_from_summaries(runner: ET.Element) -> dict:
    """Sum each (Year, Country) total block. The total for a year/country is the
    block with the most starts; smaller same-key blocks are surface/track subsets."""
    best: dict[tuple, dict] = {}
    for rs in runner.findall("RaceSummary"):
        year = (rs.findtext("Year") or "").strip()
        country = (rs.findtext("Country") or "").strip()
        if not year:
            continue
        starts = _int(rs.findtext("NumberOfStarts"))
        key = (year, country)
        cur = best.get(key)
        if cur is None or starts > cur["starts"]:
            best[key] = {
                "starts": starts,
                "wins": _int(rs.findtext("NumberOfWins")),
                "places": _int(rs.findtext("NumberOfSeconds")),
                "shows": _int(rs.findtext("NumberOfThirds")),
                "earnings": _money_cents(rs.findtext("EarningsUSA")),
            }
    tot = {"starts": 0, "wins": 0, "places": 0, "shows": 0, "earnings": 0}
    for b in best.values():
        for k in tot:
            tot[k] += b[k]
    return tot


def parse_runner(runner: ET.Element) -> dict | None:
    h = runner.find("Horse")
    if h is None:
        return None
    name = (h.findtext("HorseName") or "").strip()
    yob = _int(h.findtext("YearOfBirth"))
    if not name or not yob:
        return None
    reg = (h.findtext("RegistrationNumber") or "").strip() or f"{name}|{yob}"
    sex_el = h.find("Sex")
    sex = (sex_el.findtext("Value") if sex_el is not None else "") or ""
    sire = h.find("Sire")
    sire_name = (sire.findtext("HorseName") if sire is not None else None) or None
    rec = career_from_summaries(runner)
    return {
        "reg": reg, "name": name, "foalingYear": yob,
        "sex": SEX_MAP.get(sex.strip().upper()),
        "sireName": sire_name.strip() if sire_name else None,
        **rec,
    }


def iter_xml_bytes(outer_zip: str, limit: int | None):
    with zipfile.ZipFile(outer_zip) as z:
        names = [n for n in z.namelist() if "__MACOSX" not in n
                 and (n.endswith(".zip") or n.endswith(".xml"))]
        if limit:
            names = names[:limit]
        for n in names:
            raw = z.read(n)
            if n.endswith(".zip"):
                try:
                    with zipfile.ZipFile(io.BytesIO(raw)) as inner:
                        for m in inner.namelist():
                            if m.endswith(".xml") and "__MACOSX" not in m:
                                yield inner.read(m)
                except zipfile.BadZipFile:
                    continue
            else:
                yield raw


def parse_pps(pp_zip: str, limit: int | None) -> dict:
    horses: dict[str, dict] = {}
    files = 0
    for data in iter_xml_bytes(pp_zip, limit):
        try:
            root = ET.fromstring(data)
        except ET.ParseError:
            continue
        files += 1
        for runner in root.iter("Starters"):
            r = parse_runner(runner)
            if not r:
                continue
            prev = horses.get(r["reg"])
            # Keep the most complete copy (career grows across the year).
            if prev is None or r["starts"] > prev["starts"]:
                horses[r["reg"]] = r
    return {"files": files, "horses": horses}


def merge_figures(payload: list[dict], figures_path: str | None) -> None:
    if not figures_path:
        return
    try:
        charts = json.load(open(figures_path))
    except OSError:
        return
    # name -> figure, but only when the name maps to a single figure (unambiguous).
    by_name: dict[str, set] = defaultdict(set)
    for c in charts:
        if c.get("bestSpeedFigure"):
            by_name[c["name"].upper()].add(c["bestSpeedFigure"])
    for p in payload:
        figs = by_name.get(p["name"].upper())
        if figs and len(figs) == 1:
            p["bestSpeedFigure"] = next(iter(figs))


def post(payload: list[dict]) -> dict:
    totals = {"received": 0, "matched": 0, "updated": 0, "unmatched": 0}
    with httpx.Client(timeout=600) as c:
        for i in range(0, len(payload), 1000):
            r = c.post(f"{API}/ingest/racing-records", json=payload[i:i + 1000])
            r.raise_for_status()
            j = r.json()
            for k in totals:
                totals[k] += j.get(k, 0)
    return totals


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pp_zip", help="path to '2023 PPs.zip'")
    ap.add_argument("--figures", default=None, help="racing_2023.json (charts) for speed figures")
    ap.add_argument("--out", default=None)
    ap.add_argument("--no-post", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    t0 = time.time()
    res = parse_pps(args.pp_zip, args.limit)
    payload = [
        {"name": h["name"], "foalingYear": h["foalingYear"], "sex": h["sex"],
         "sireName": h["sireName"], "starts": h["starts"], "wins": h["wins"],
         "places": h["places"], "shows": h["shows"], "earningsCents": h["earnings"],
         "bestSpeedFigure": None}
        for h in res["horses"].values() if h["starts"] > 0
    ]
    merge_figures(payload, args.figures)
    starts = sum(p["starts"] for p in payload)
    print(f"parsed {res['files']} PP files -> {len(payload)} unique horses, "
          f"{starts} career starts  [{time.time()-t0:.1f}s]")
    for p in sorted(payload, key=lambda x: x["earningsCents"], reverse=True)[:5]:
        print(f"  {p['name']} ({p['foalingYear']}) by {p['sireName']}: "
              f"{p['starts']}st {p['wins']}w ${p['earningsCents']//100:,} fig {p['bestSpeedFigure']}")

    if args.out:
        import os
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        json.dump(payload, open(args.out, "w"))
        print(f"wrote {args.out}")

    if not args.no_post:
        print("posting (exact name+foalingYear match)...")
        print("== loaded:", post(payload), "==")


if __name__ == "__main__":
    sys.exit(main())
