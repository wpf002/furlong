"""Fetch REAL Tattersalls October Yearling Sale results (guineas) and ingest them.

Source: Tattersalls' 4D web server. The lot tables require a session cookie
(obtained from the sale's /Main page), then the sold lots are at
  https://secure.tattersalls.com/4DCGI/Sale/<CODE>/Top%20Lots/<N>
Sale code = OC<book><yy> (OC125 = October Book 1 2025, OC225 = Book 2 2025).
Each row: rank, Lot, "Sire (CTRY) / Dam (CTRY) Colour.Sex (CTRY)", Consignor,
Purchaser, Price (guineas). Prices are GUINEAS; stored as currency GBP
(priceCents = guineas*100). This is the SOLD list (the comparable set we need).

Usage:
  PYENV_DISABLE_REHASH=1 PYTHONPATH=. ./.venv/bin/python scripts/fetch_tattersalls.py 2025 2024 2023 --books 1 2
"""
from __future__ import annotations

import argparse
import html
import io
import re

import httpx

BASE = "https://secure.tattersalls.com/4DCGI/Sale"
API = "http://localhost:4100"
HDR = {"User-Agent": "Mozilla/5.0"}

COUNTRY = re.compile(r"\s*\((?:IRE|GB|FR|USA|GER|ITY|JPN|CAN|AUS|NZ|ARG|SAF|SPA|SWI)\)\s*", re.I)
COLORSEX = re.compile(r"\b([A-Za-z]{1,3}(?:/[A-Za-z]{1,3})?)\.([CFGR])\.")
COLOR = {"b": "Bay", "ch": "Chestnut", "gr": "Gray", "br": "Brown", "bl": "Black",
         "ro": "Roan", "gr/ro": "Gray or Roan", "b/br": "Bay or Brown"}
SEX = {"C": "COLT", "F": "FILLY", "G": "GELDING", "R": "COLT"}


def strip_country(s: str) -> str:
    return COUNTRY.sub("", s or "").strip()


def parse_lots(html_text: str) -> list[dict]:
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html_text, re.S)
    out = []
    for r in rows:
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)
        if len(cells) != 6:
            continue
        cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip() for c in cells]
        _rank, lot, breeding, consignor, purchaser, price = cells
        if not lot.isdigit() or not re.search(r"\d", price):  # skip header/footers
            continue
        sire = dam = color = sex = None
        if "/" in breeding:
            left, right = breeding.split("/", 1)
            sire = strip_country(left)
            m = COLORSEX.search(right)
            if m:
                color = COLOR.get(m.group(1).lower(), m.group(1))
                sex = SEX.get(m.group(2))
                dam = strip_country(right[: m.start()])
            else:
                dam = strip_country(right)
        out.append({
            "lot": int(lot),
            "sire": sire or None, "dam": dam or None,
            "color": color, "sex": sex,
            "consignor": consignor or None, "purchaser": purchaser or None,
            "guineas": int(re.sub(r"[^\d]", "", price) or 0),
        })
    return out


def fetch_sale(client: httpx.Client, code: str) -> list[dict]:
    client.get(f"{BASE}/{code}/Main")  # prime the session cookie
    r = client.get(f"{BASE}/{code}/Top%20Lots/5000")
    r.raise_for_status()
    return parse_lots(r.text)


def main(years: list[int], books: list[int]) -> None:
    with httpx.Client(headers=HDR, timeout=120, follow_redirects=True) as client, \
         httpx.Client(timeout=300) as api:
        for year in years:
            for book in books:
                code = f"OC{book}{year % 100:02d}"
                try:
                    lots = fetch_sale(client, code)
                except Exception as e:
                    print(f"{code}: fetch error {e}")
                    continue
                lots = [l for l in lots if l["guineas"] > 0 and (l["sire"] or l["dam"])]
                if not lots:
                    print(f"{code}: no lots, skipping")
                    continue
                top = max(l["guineas"] for l in lots)
                if top < 10000:  # sanity: top Book yearlings are 6-7 figures
                    print(f"{code}: top {top} gns implausibly low — skipping (parser?)")
                    continue
                hips, res, seen = [], io.StringIO(), set()
                res.write("hipNumber,priceCents,rna,buyer\n")
                for l in lots:
                    if l["lot"] in seen:
                        continue
                    seen.add(l["lot"])
                    hips.append({
                        "hipNumber": l["lot"], "sessionNumber": None, "name": None,
                        "sex": l["sex"], "color": l["color"], "foalingYear": year - 1,
                        "sireName": l["sire"], "damName": l["dam"], "damsireName": None,
                        "consignorName": l["consignor"], "breederName": None,
                    })
                    res.write(f"{l['lot']},{l['guineas'] * 100},false,{(l['purchaser'] or '').replace(',', ' ')}\n")
                n = len(hips)
                catalog = {
                    "auctionHouse": "TATTERSALLS",
                    "saleName": f"October Yearling Sale Book {book}",
                    "year": year, "currency": "GBP", "category": "YEARLING", "hips": hips,
                    "report": {"pagesScanned": n, "blocksDetected": n, "hipsParsed": n,
                               "hipsSkipped": 0, "parseRate": 1.0, "skipped": []},
                }
                rc = api.post(f"{API}/ingest/catalog-json", json=catalog); rc.raise_for_status()
                sid = rc.json()["saleId"]
                rr = api.post(f"{API}/ingest/results", data={"saleId": sid},
                              files={"file": ("r.csv", res.getvalue(), "text/csv")}); rr.raise_for_status()
                print(f"{code} (Book {book} {year}): {n} sold lots, top {top:,} gns -> "
                      f"{rc.json()['created']}c/{rc.json()['updated']}u, results {rr.json()['imported']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("years", nargs="*", type=int)
    ap.add_argument("--books", nargs="+", type=int, default=[1, 2])
    a = ap.parse_args()
    main(a.years or [2025, 2024, 2023], a.books)
