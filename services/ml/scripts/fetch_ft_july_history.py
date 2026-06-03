"""Fetch real historical results for Fasig-Tipton's "The July Sale" and load
them into Furlong as comparables.

Data source: the public Fasig-Tipton results API that backs their results site
  GET /django/api/sales/?sale_identifier=<CODE>   -> resolve a sale's numeric id
  GET /django/api/horses/?sale=<id>               -> that sale's hips + results

The July Sale uses identifiers K{yy}B (K25B=2025, K24B=2024, ...). We walk recent
years, convert each to our ParseCatalogResponse shape, and POST to the local API:
  POST /ingest/catalog-json   (pedigree/catalog, with entity resolution)
  POST /ingest/results        (price/RNA/buyer per hip)

NOTE (per ROADMAP): this is LOCAL DEV/TEST data. The product's path to scale is a
data license, not scraping — this just compiles publicly visible results for the
prototype. Output stays in the gitignored data/ tree implicitly (nothing committed).

Usage:
  PYTHONPATH=. ./.venv/bin/python scripts/fetch_ft_july_history.py 2025 2024 2023 2022 2021
"""
from __future__ import annotations

import io
import re
import sys

import httpx

FT = "https://www.fasigtipton.com/django/api"
API = "http://localhost:4100"
HDR = {"User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest"}

SEX = {"C": "COLT", "F": "FILLY", "G": "GELDING", "R": "COLT", "H": "STALLION", "M": "MARE"}
COLOR = {
    "B": "Bay", "BAY": "Bay",
    "DKB": "Dark Bay or Brown", "DB": "Dark Bay or Brown", "DKBBR": "Dark Bay or Brown",
    "CH": "Chestnut", "CHE": "Chestnut",
    "GR": "Gray", "GRO": "Gray or Roan", "RO": "Roan",
    "BL": "Black", "BLK": "Black", "WH": "White", "PA": "Palomino",
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


def resolve_sale(code: str) -> dict | None:
    r = httpx.get(f"{FT}/sales/", params={"sale_identifier": code}, headers=HDR, timeout=30)
    if r.status_code != 200:
        return None
    data = r.json()
    return data[0] if isinstance(data, list) and data else None


def fetch_horses(sale_id) -> list[dict]:
    r = httpx.get(f"{FT}/horses/", params={"sale": sale_id}, headers=HDR, timeout=180)
    r.raise_for_status()
    d = r.json()
    return d if isinstance(d, list) else d.get("results", [])


def foaling_year(yob: str | None) -> int | None:
    if not yob:
        return None
    m = re.search(r"(\d{4})", yob)
    return int(m.group(1)) if m else None


def build_catalog(year: int, horses: list[dict]) -> dict:
    hips = []
    for h in horses:
        name = (h.get("name") or "").strip() or None
        hips.append({
            "hipNumber": int(h["hip"]),
            "sessionNumber": h.get("session") if isinstance(h.get("session"), int) else None,
            "name": smart_title(name) if name else None,
            "sex": SEX.get((h.get("sex") or "").strip().upper()),
            "color": COLOR.get((h.get("color") or "").strip().upper(), None),
            "foalingYear": foaling_year(h.get("year_of_birth")),
            "sireName": smart_title(h.get("sire")),
            "damName": smart_title(h.get("dam")),
            "damsireName": smart_title(h.get("sire_of_dam")),
            "consignorName": smart_title(h.get("consignor_name")),
            "breederName": None,  # not provided by this endpoint
        })
    n = len(hips)
    return {
        "auctionHouse": "FASIG_TIPTON",
        "saleName": "The July Sale",
        "year": year,
        "hips": hips,
        "report": {
            "pagesScanned": n, "blocksDetected": n, "hipsParsed": n,
            "hipsSkipped": 0, "parseRate": 1.0 if n else 0.0, "skipped": [],
        },
    }


def build_results_csv(horses: list[dict]) -> str:
    out = io.StringIO()
    out.write("hipNumber,priceCents,rna,buyer\n")
    for h in horses:
        if h.get("out"):
            continue  # withdrawn / scratched — no result
        try:
            price = float(h.get("price") or 0)
        except ValueError:
            price = 0.0
        hip = h.get("hip")
        buyer = (h.get("purchaser") or "").strip().replace(",", " ")
        if price > 0:
            out.write(f"{hip},{int(round(price * 100))},false,{buyer}\n")
        else:
            out.write(f"{hip},,true,\n")  # no price -> treat as RNA / not sold
    return out.getvalue()


def main(years: list[int]) -> None:
    for year in years:
        code = f"K{year % 100:02d}B"
        sale = resolve_sale(code)
        if not sale:
            print(f"{year} ({code}): not found, skipping")
            continue
        horses = fetch_horses(sale["id"])
        if not horses:
            print(f"{year} ({code}): no horses, skipping")
            continue
        catalog = build_catalog(year, horses)
        r = httpx.post(f"{API}/ingest/catalog-json", json=catalog, timeout=120)
        r.raise_for_status()
        sale_id = r.json()["saleId"]
        csv_text = build_results_csv(horses)
        files = {"file": ("results.csv", csv_text, "text/csv")}
        rr = httpx.post(f"{API}/ingest/results", data={"saleId": sale_id}, files=files, timeout=120)
        rr.raise_for_status()
        sold = sum(1 for h in horses if not h.get("out") and float(h.get("price") or 0) > 0)
        print(f"{year} ({code}): {len(horses)} hips, {sold} sold -> "
              f"catalog {r.json()['created']}c/{r.json()['updated']}u, results {rr.json()['imported']}")


if __name__ == "__main__":
    years = [int(a) for a in sys.argv[1:]] or [2025, 2024, 2023, 2022, 2021]
    main(years)
