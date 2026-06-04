"""Fetch ALL Fasig-Tipton yearling-sale results (every year available) and load
them into Furlong as comparables.

Generalizes fetch_ft_july_history.py to every Fasig-Tipton YEARLING sale. Sale
identifiers follow {location}{yy}{suffix}:
  The July Sale .............. K{yy}B
  The Saratoga Sale .......... N{yy}A
  New York Bred Yearlings .... N{yy}B
  Kentucky October Yearlings . K{yy}C
  California Fall Yearlings ... C{yy}B
  Midlantic Fall Yearlings ... M{yy}B

We deliberately EXCLUDE non-yearling sales (2YO-in-training, breeding stock,
mixed, horses of racing age) — they are different markets and would corrupt
yearling comparables.

API:  GET /django/api/sales/?sale_identifier=<code>  ->  numeric id
      GET /django/api/horses/?sale=<id>              ->  hips + results
Loads via local API: POST /ingest/catalog-json + POST /ingest/results.

NOTE (per ROADMAP): LOCAL DEV/TEST data; product path is a license, not scraping.

Usage:
  PYTHONPATH=. ./.venv/bin/python scripts/fetch_ft_yearlings.py            # all sales, 2000-2025
  PYTHONPATH=. ./.venv/bin/python scripts/fetch_ft_yearlings.py 2009 2025  # year range
"""
from __future__ import annotations

import io
import re
import sys
import time

import httpx

FT = "https://www.fasigtipton.com/django/api"
API = "http://localhost:4100"
HDR = {"User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest"}

# (location letter, suffix letter, sale name)
SALES = [
    ("K", "B", "The July Sale"),
    ("N", "A", "The Saratoga Sale"),
    ("N", "B", "New York Bred Yearlings"),
    ("K", "C", "Kentucky October Yearlings"),
    ("C", "B", "California Fall Yearlings"),
    ("M", "B", "Midlantic Fall Yearlings"),
]

SEX = {"C": "COLT", "F": "FILLY", "G": "GELDING", "R": "COLT", "H": "STALLION", "M": "MARE"}
COLOR = {
    "B": "Bay", "BAY": "Bay", "DKB": "Dark Bay or Brown", "DB": "Dark Bay or Brown",
    "DKBBR": "Dark Bay or Brown", "CH": "Chestnut", "CHE": "Chestnut",
    "GR": "Gray", "GRO": "Gray or Roan", "RO": "Roan", "BL": "Black", "BLK": "Black",
    "WH": "White", "PA": "Palomino",
}


def smart_title(name):
    if not name:
        return None
    s = name.strip()
    if not s:
        return None
    letters = [c for c in s if c.isalpha()]
    if letters and all(c.isupper() for c in letters):
        s = s.lower()
        s = re.sub(r"(?<![A-Za-z'’])([a-z])", lambda m: m.group(1).upper(), s)
    return s


def resolve_sale(c: httpx.Client, code: str):
    r = c.get(f"{FT}/sales/", params={"sale_identifier": code})
    if r.status_code != 200:
        return None
    d = r.json()
    return d[0] if isinstance(d, list) and d else None


def fetch_horses(c: httpx.Client, sale_id) -> list[dict]:
    r = c.get(f"{FT}/horses/", params={"sale": sale_id})
    r.raise_for_status()
    d = r.json()
    return d if isinstance(d, list) else d.get("results", [])


def foaling_year(yob):
    if not yob:
        return None
    m = re.search(r"(\d{4})", str(yob))
    return int(m.group(1)) if m else None


def build_catalog(name: str, year: int, horses: list[dict]) -> dict:
    hips = []
    for h in horses:
        nm = (h.get("name") or "").strip() or None
        # FT labels unnamed yearlings "YYYY-<dam>"; treat those as unnamed.
        if nm and re.match(r"^(19|20)\d\d[\s-]", nm):
            nm = None
        hips.append({
            "hipNumber": int(h["hip"]),
            "sessionNumber": h.get("session") if isinstance(h.get("session"), int) else None,
            "name": smart_title(nm) if nm else None,
            "sex": SEX.get((h.get("sex") or "").strip().upper()),
            "color": COLOR.get((h.get("color") or "").strip().upper()),
            "foalingYear": foaling_year(h.get("year_of_birth")),
            "sireName": smart_title(h.get("sire")),
            "damName": smart_title(h.get("dam")),
            "damsireName": smart_title(h.get("sire_of_dam")),
            "consignorName": smart_title(h.get("consignor_name")),
            "breederName": None,
        })
    n = len(hips)
    return {
        "auctionHouse": "FASIG_TIPTON", "saleName": name, "year": year, "hips": hips,
        "report": {"pagesScanned": n, "blocksDetected": n, "hipsParsed": n,
                   "hipsSkipped": 0, "parseRate": 1.0 if n else 0.0, "skipped": []},
    }


def build_results_csv(horses: list[dict]) -> str:
    out = io.StringIO()
    out.write("hipNumber,priceCents,rna,buyer\n")
    for h in horses:
        if h.get("out"):
            continue
        try:
            price = float(h.get("price") or 0)
        except ValueError:
            price = 0.0
        buyer = (h.get("purchaser") or "").strip().replace(",", " ")
        # Only emit SOLD results. A price of 0 is ambiguous (RNA vs not-yet-sold
        # for an upcoming sale) — skip it so upcoming catalogs stay result-free
        # and show model predictions, not "RNA".
        if price > 0:
            out.write(f"{h.get('hip')},{int(round(price * 100))},false,{buyer}\n")
    return out.getvalue()


def main(year_lo: int, year_hi: int) -> None:
    with httpx.Client(headers=HDR, timeout=180) as c, httpx.Client(timeout=600) as api:
        for loc, suf, name in SALES:
            loaded = []
            for year in range(year_lo, year_hi + 1):
                code = f"{loc}{year % 100:02d}{suf}"
                sale = resolve_sale(c, code)
                if not sale:
                    continue
                horses = fetch_horses(c, sale["id"])
                if not horses:
                    continue
                t0 = time.time()
                catalog = build_catalog(name, year, horses)
                rc = api.post(f"{API}/ingest/catalog-json", json=catalog)
                rc.raise_for_status()
                sale_db_id = rc.json()["saleId"]
                files = {"file": ("results.csv", build_results_csv(horses), "text/csv")}
                rr = api.post(f"{API}/ingest/results", data={"saleId": sale_db_id}, files=files)
                rr.raise_for_status()
                sold = build_results_csv(horses).count(",false,")
                loaded.append(year)
                print(f"{name} {year} ({code}): {len(horses)} hips, {sold} sold "
                      f"-> {rc.json()['created']}c/{rc.json()['updated']}u, "
                      f"results {rr.json()['imported']}  [{time.time()-t0:.1f}s]")
            print(f"== {name}: {len(loaded)} years loaded ({min(loaded) if loaded else '-'}"
                  f"-{max(loaded) if loaded else '-'}) ==")


if __name__ == "__main__":
    args = [int(a) for a in sys.argv[1:]]
    lo, hi = (args + [2000, 2025])[:2] if len(args) >= 2 else (2000, 2025)
    main(lo, hi)
