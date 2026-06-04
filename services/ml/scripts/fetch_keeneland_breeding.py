"""Fetch Keeneland November Breeding Stock broodmares (real data) for the Phase 4
non-yearling valuation path. Mares only; loaded as category=BREEDING_STOCK.

Same flex Sale Summaries backend as the September fetcher. A mare's "Sire" is her
own sire (sire-of-mare); "Dam" her dam. Her produce record (foals' yearling
prices) is derived later by name-matching against the yearling data.

Usage: PYENV_DISABLE_REHASH=1 PYTHONPATH=. ./.venv/bin/python scripts/fetch_keeneland_breeding.py
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
COLOR = {"B": "Bay", "DB/BR": "Dark Bay or Brown", "CH": "Chestnut", "GR": "Gray",
         "RO": "Roan", "GR/RO": "Gray or Roan", "BL": "Black"}


def clean_consignor(v):
    if not v:
        return None
    s = re.sub(r",?\s*Agent\b.*$", "", v.strip(), flags=re.IGNORECASE).strip().rstrip(",")
    return s or None


def list_breeding_sales(c):
    r = c.get(FLEX, params={"actionName": "SalesSummarySales", "paramNames": "", "paramValues": ""})
    out = {}
    for s in r.json():
        desc = s.get("sale_description", "")
        if "November Breeding Stock" in desc:
            m = re.match(r"(\d{4})", desc)
            if m:
                out[int(m.group(1))] = (s["sale_id"], int(s.get("number_of_sessions") or 1))
    return out


def fetch_session(c, sale_id, session):
    r = c.get(FLEX, params={"actionName": "SalesSummary",
                            "paramNames": f"sale_id{DELIM}session",
                            "paramValues": f"{sale_id}{DELIM}{session}"})
    try:
        return r.json()
    except Exception:
        return []


def main(years):
    with httpx.Client(headers=HDR, timeout=120) as c, httpx.Client(timeout=600) as api:
        sales = list_breeding_sales(c)
        for year in years:
            if year not in sales:
                print(f"{year}: no breeding stock sale"); continue
            sale_id, n_sessions = sales[year]
            t0 = time.time()
            rows = []
            for s in range(1, n_sessions + 1):
                for r in fetch_session(c, sale_id, s):
                    r["_session"] = s
                    rows.append(r)
            hips, seen = [], set()
            res = io.StringIO(); res.write("hipNumber,priceCents,rna,buyer\n")
            for r in rows:
                if (r.get("Sex") or "") != "Mare":
                    continue  # broodmares only
                try:
                    hip = int(str(r.get("Hip", "")).strip())
                except ValueError:
                    continue
                if hip in seen:
                    continue
                seen.add(hip)
                hips.append({
                    "hipNumber": hip, "sessionNumber": r.get("_session"),
                    "name": (r.get("Name") or "").strip() or None,
                    "sex": "MARE",
                    "color": COLOR.get((r.get("Color") or "").strip().upper()),
                    "foalingYear": None,
                    "sireName": (r.get("Sire") or "").strip() or None,
                    "damName": (r.get("Dam") or "").strip() or None,
                    "damsireName": None,
                    "consignorName": clean_consignor(r.get("Consignor")),
                    "breederName": None,
                })
                out = (r.get("OutIndicator") or "").upper() == "Y"
                rna = (r.get("RnaIndicator") or "").upper() in ("Y", "P")
                if out:
                    continue
                try:
                    price = float(r.get("SalePrice") or 0)
                except ValueError:
                    price = 0.0
                buyer = (r.get("Buyer") or "").strip().replace(",", " ")
                if not rna and price > 0:
                    res.write(f"{hip},{int(round(price*100))},false,{buyer}\n")
                else:
                    res.write(f"{hip},,true,\n")
            n = len(hips)
            catalog = {"auctionHouse": "KEENELAND", "saleName": "November Breeding Stock Sale",
                       "year": year, "hips": hips,
                       "report": {"pagesScanned": n, "blocksDetected": n, "hipsParsed": n,
                                  "hipsSkipped": 0, "parseRate": 1.0 if n else 0.0, "skipped": []},
                       "category": "BREEDING_STOCK", "currency": "USD"}
            rc = api.post(f"{API}/ingest/catalog-json", json=catalog); rc.raise_for_status()
            sid = rc.json()["saleId"]
            rr = api.post(f"{API}/ingest/results", data={"saleId": sid},
                          files={"file": ("r.csv", res.getvalue(), "text/csv")}); rr.raise_for_status()
            sold = res.getvalue().count(",false,")
            print(f"{year}: {n} mares, {sold} sold -> {rc.json()['created']}c/{rc.json()['updated']}u, "
                  f"results {rr.json()['imported']}  [{time.time()-t0:.1f}s]")


if __name__ == "__main__":
    yrs = [int(a) for a in sys.argv[1:]] or [2025, 2024, 2023]
    main(yrs)
