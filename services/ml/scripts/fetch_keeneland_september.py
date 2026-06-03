"""Fetch Keeneland September Yearling Sale results and load them into Furlong.

Data source: the public Keeneland "Sale Summaries" backend that powers
https://flex.keeneland.com/summaries/summaries.html
  GET /misc/GenerateJson.do?actionName=SalesSummarySales            -> sale list
  GET /misc/GenerateJson.do?actionName=SalesSummary&paramNames=sale_id^!^session
      &paramValues=<id>^!^<n>                                       -> per-hip rows

Per-hip rows carry Hip, Sire, Dam, Sex, Color, Consignor, Buyer, SalePrice and
RNA/Out indicators (no damsire — fine, comparables key on sire). We combine all
sessions of a year into one sale and POST to the local API:
  POST /ingest/catalog-json   (pedigree, entity resolution)
  POST /ingest/results        (price / RNA / buyer)

NOTE (per ROADMAP): LOCAL DEV/TEST data; the product path is a data license,
not scraping. Nothing here is committed (data/ is gitignored).

Usage:
  PYTHONPATH=. ./.venv/bin/python scripts/fetch_keeneland_september.py all
  PYTHONPATH=. ./.venv/bin/python scripts/fetch_keeneland_september.py 2025 2024
"""
from __future__ import annotations

import io
import re
import sys
import time

import httpx

FLEX = "https://flex.keeneland.com/misc/GenerateJson.do"
API = "http://localhost:4100"
HDR = {"User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest"}
DELIM = "^!^"

SEX = {"COLT": "COLT", "FILLY": "FILLY", "GELDING": "GELDING", "RIDGLING": "COLT"}
COLOR = {
    "B": "Bay", "BAY": "Bay", "BL": "Black", "BLK": "Black", "BLACK": "Black",
    "CH": "Chestnut", "CHESTNUT": "Chestnut",
    "DB/BR": "Dark Bay or Brown", "DKB/BR": "Dark Bay or Brown", "DKBBR": "Dark Bay or Brown",
    "GR": "Gray", "GRAY": "Gray", "GREY": "Gray", "RO": "Roan",
    "GR/RO": "Gray or Roan", "GRRO": "Gray or Roan",
    "WH": "White", "PAL": "Palomino", "PALOMINO": "Palomino",
}


def _client() -> httpx.Client:
    return httpx.Client(headers=HDR, timeout=120)


def list_september_sales(c: httpx.Client) -> dict[int, tuple[str, int]]:
    r = c.get(FLEX, params={"actionName": "SalesSummarySales", "paramNames": "", "paramValues": ""})
    r.raise_for_status()
    out: dict[int, tuple[str, int]] = {}
    for s in r.json():
        desc = s.get("sale_description", "")
        if "September Yearling Sale" not in desc:
            continue
        m = re.match(r"(\d{4})", desc)
        if not m:
            continue
        year = int(m.group(1))
        out[year] = (s["sale_id"], int(s.get("number_of_sessions") or 1))
    return out


def fetch_session(c: httpx.Client, sale_id: str, session: int) -> list[dict]:
    pv = f"{sale_id}{DELIM}{session}"
    r = c.get(FLEX, params={
        "actionName": "SalesSummary",
        "paramNames": f"sale_id{DELIM}session",
        "paramValues": pv,
    })
    r.raise_for_status()
    try:
        return r.json()
    except Exception:
        return []


def map_sex(v: str | None) -> str | None:
    return SEX.get((v or "").strip().upper()) if v else None


def map_color(v: str | None) -> str | None:
    if not v:
        return None
    key = v.strip().upper()
    return COLOR.get(key, v.strip() or None)


def clean_consignor(v: str | None) -> str | None:
    if not v:
        return None
    s = re.sub(r",?\s*Agent\b.*$", "", v.strip(), flags=re.IGNORECASE).strip().rstrip(",")
    return s or None


def build_year_payload(year: int, rows: list[dict]) -> tuple[dict, str]:
    hips: list[dict] = []
    seen: set[int] = set()
    res = io.StringIO()
    res.write("hipNumber,priceCents,rna,buyer\n")
    for r in rows:
        try:
            hip = int(str(r.get("Hip", "")).strip())
        except ValueError:
            continue
        out_ind = (r.get("OutIndicator") or "").strip().upper() == "Y"
        rna_ind = (r.get("RnaIndicator") or "").strip().upper() in ("Y", "P")
        if hip not in seen:
            seen.add(hip)
            hips.append({
                "hipNumber": hip,
                "sessionNumber": r.get("_session"),
                "name": (r.get("Name") or "").strip() or None,
                "sex": map_sex(r.get("Sex")),
                "color": map_color(r.get("Color")),
                "foalingYear": year - 1,
                "sireName": (r.get("Sire") or "").strip() or None,
                "damName": (r.get("Dam") or "").strip() or None,
                "damsireName": None,  # not provided by Keeneland summaries
                "consignorName": clean_consignor(r.get("Consignor")),
                "breederName": None,
            })
        # results row (skip withdrawn)
        if out_ind:
            continue
        try:
            price = float(r.get("SalePrice") or 0)
        except ValueError:
            price = 0.0
        buyer = (r.get("Buyer") or "").strip().replace(",", " ")
        if not rna_ind and price > 0:
            res.write(f"{hip},{int(round(price * 100))},false,{buyer}\n")
        else:
            res.write(f"{hip},,true,\n")  # RNA / not sold
    n = len(hips)
    catalog = {
        "auctionHouse": "KEENELAND",
        "saleName": "September Yearling Sale",
        "year": year,
        "hips": hips,
        "report": {"pagesScanned": n, "blocksDetected": n, "hipsParsed": n,
                   "hipsSkipped": 0, "parseRate": 1.0 if n else 0.0, "skipped": []},
    }
    return catalog, res.getvalue()


def main(years_arg: list[str]) -> None:
    with _client() as c:
        sales = list_september_sales(c)
        if years_arg == ["all"]:
            years = sorted(sales)
        else:
            years = [int(y) for y in years_arg]
        print(f"available September sales: {min(sales)}-{max(sales)} ({len(sales)})")
        for year in years:
            if year not in sales:
                print(f"{year}: not available, skipping")
                continue
            sale_id, n_sessions = sales[year]
            t0 = time.time()
            rows: list[dict] = []
            for s in range(1, n_sessions + 1):
                recs = fetch_session(c, sale_id, s)
                for r in recs:
                    r["_session"] = s
                rows.extend(recs)
            catalog, csv_text = build_year_payload(year, rows)
            with httpx.Client(timeout=600) as api:
                rc = api.post(f"{API}/ingest/catalog-json", json=catalog)
                rc.raise_for_status()
                sale_db_id = rc.json()["saleId"]
                files = {"file": ("results.csv", csv_text, "text/csv")}
                rr = api.post(f"{API}/ingest/results", data={"saleId": sale_db_id}, files=files)
                rr.raise_for_status()
            sold = csv_text.count(",false,")
            print(f"{year}: {len(catalog['hips'])} hips ({n_sessions} sessions), {sold} sold "
                  f"-> {rc.json()['created']}c/{rc.json()['updated']}u, "
                  f"results {rr.json()['imported']}  [{time.time()-t0:.1f}s]")


if __name__ == "__main__":
    main(sys.argv[1:] or ["all"])
