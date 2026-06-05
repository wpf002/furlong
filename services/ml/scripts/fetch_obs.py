"""Fetch OBS (Ocala Breeders' Sales) 2YO-in-training results and load them.

Data source: the OBS legacy results host, which renders each sale as a jQuery
DataTables page with the full row set inlined as `var arrData = [[...], ...]`:
  https://www.obscatalog.com/<mon>results/<year>/
Columns: _, Hip(<a>), Video, UT Time, Sex, Sire, Dam, State, Consignor, Buyer,
Price, ... (sort-helper columns follow).

The UT ("under-tack") time is the pre-sale breeze — the single most predictive
2YO-in-training signal. We normalize it to seconds-per-furlong so 1/8- and
1/4-mile works compare, and store the raw time for display.

NOTE (per ROADMAP): LOCAL DEV/TEST data; the product path is a license, not
scraping. Nothing here is committed (data/ is gitignored).

Usage:
  PYTHONPATH=. ./.venv/bin/python scripts/fetch_obs.py            # 2YO sales, 2018-2023
  PYTHONPATH=. ./.venv/bin/python scripts/fetch_obs.py 2021 2023  # year range
"""
from __future__ import annotations

import io
import json
import re
import sys
import time

import httpx

OBS = "https://www.obscatalog.com"
API = "http://localhost:4100"
HDR = {"User-Agent": "Mozilla/5.0"}

# month-code -> (sale name, category). The 2YO-in-training sales only.
SALES = {
    "mar": ("March Two-Year-Olds in Training Sale", "TWO_YEAR_OLD"),
    "apr": ("Spring Two-Year-Olds in Training Sale", "TWO_YEAR_OLD"),
    "jun": ("June Two-Year-Olds & Horses of Racing Age Sale", "TWO_YEAR_OLD"),
    "jul": ("June Two-Year-Olds & Horses of Racing Age Sale", "TWO_YEAR_OLD"),
}
SEX = {"C": "COLT", "F": "FILLY", "G": "GELDING", "R": "COLT", "H": "STALLION", "M": "MARE"}

_TAG = re.compile(r"<[^>]+>")
_BREEZE = re.compile(r"^(\d+)(?:\.(\d+))?$")
_TH = re.compile(r"<th[^>]*>(.*?)</th>", re.S | re.I)
_THEAD = re.compile(r"<thead.*?</thead>", re.S | re.I)


def header_map(html: str) -> dict:
    """Map column NAME -> arrData index from the table header. OBS shifts columns
    between sales (e.g. April adds a 'Walk' column), so positional parsing breaks;
    the <th> order matches arrData order 1:1, so we key off names instead."""
    m = _THEAD.search(html)
    if not m:
        return {}
    labels = [strip(x) for x in _TH.findall(m.group(0))]
    idx: dict = {}
    for i, lab in enumerate(labels):
        low = lab.lower()
        if low.startswith("hip"):
            idx["hip"] = i
        elif "ut time" in low or "under tack" in low:
            idx["breeze"] = i
        elif low == "sex":
            idx["sex"] = i
        elif low == "sire":
            idx["sire"] = i
        elif low == "dam":
            idx["dam"] = i
        elif low == "consignor":
            idx["consignor"] = i
        elif low == "buyer":
            idx["buyer"] = i
        elif low == "price":
            idx["price"] = i
    return idx


def strip(s) -> str:
    return _TAG.sub("", str(s)).replace("&amp;", "&").strip()


def title(s):
    if s is None:
        return None
    s = strip(s)
    return s or None


def parse_breeze(raw: str):
    """('10.1') -> ('10.1 (1f)', sec_per_furlong). Single-decimal = fifths
    (OBS convention); two-decimal = hundredths. 1/8mi if <15s else 1/4mi."""
    raw = strip(raw)
    m = _BREEZE.match(raw)
    if not m:
        return None, None
    whole, frac = int(m.group(1)), m.group(2)
    if frac is None:
        sec = float(whole)
    elif len(frac) == 1:
        sec = whole + int(frac) / 5.0
    else:
        sec = float(raw)
    if sec <= 0:
        return None, None
    furlongs = 1.0 if sec < 15 else 2.0
    return f"{raw} ({int(furlongs)}f)", round(sec / furlongs, 2)


def price_cents(raw: str):
    s = strip(raw).replace(",", "").replace("$", "")
    if not s or not s.isdigit():
        return None  # RNA / out / not sold
    v = int(s)
    return v * 100 if v > 0 else None


def extract_arrdata(html: str) -> list:
    i = html.find("var arrData")
    if i < 0:
        return []
    start = html.find("[", i)
    depth, end = 0, -1
    for j in range(start, len(html)):
        c = html[j]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                end = j + 1
                break
    if end < 0:
        return []
    return json.loads(html[start:end])


def build(year: int, rows: list, col: dict) -> tuple[dict, str, str, str]:
    name, category = None, None  # set by caller
    hips, res = [], io.StringIO()
    res.write("hipNumber,priceCents,rna,buyer\n")
    seen = set()

    def cell(r, key):
        i = col.get(key)
        return r[i] if i is not None and i < len(r) else None

    for r in rows:
        h = cell(r, "hip")
        try:
            hip = int(strip(h))
        except (ValueError, TypeError):
            continue
        if hip in seen:
            continue
        seen.add(hip)
        bt, bs = parse_breeze(cell(r, "breeze") or "")
        hips.append({
            "hipNumber": hip,
            "sessionNumber": None,
            "name": None,
            "sex": SEX.get(strip(cell(r, "sex") or "").upper()[:1]) or None,
            "color": None,
            "foalingYear": year - 2,  # a 2YO in <year> was foaled <year>-2
            "sireName": title(cell(r, "sire")),
            "damName": title(cell(r, "dam")),
            "damsireName": None,
            "consignorName": title(cell(r, "consignor")),
            "breederName": None,
            "breezeTime": bt,
            "breezeSeconds": bs,
        })
        pc = price_cents(cell(r, "price") or "")
        buyer = title(cell(r, "buyer"))
        if pc:
            res.write(f"{hip},{pc},false,{(buyer or '').replace(',', ' ')}\n")
    n = len(hips)
    catalog = {
        "auctionHouse": "OBS", "saleName": name, "year": year, "hips": hips,
        "report": {"pagesScanned": n, "blocksDetected": n, "hipsParsed": n,
                   "hipsSkipped": 0, "parseRate": 1.0 if n else 0.0, "skipped": []},
    }
    return catalog, res.getvalue(), name, category


def main(lo: int, hi: int) -> None:
    with httpx.Client(headers=HDR, timeout=120) as c, httpx.Client(timeout=600) as api:
        for mon, (name, category) in SALES.items():
            for year in range(lo, hi + 1):
                url = f"{OBS}/{mon}results/{year}/"
                try:
                    r = c.get(url)
                except httpx.HTTPError:
                    continue
                if r.status_code != 200:
                    continue
                rows = extract_arrdata(r.text)
                col = header_map(r.text)
                if not rows or "hip" not in col or "price" not in col:
                    continue
                t0 = time.time()
                catalog, csv_text, _, _ = build(year, rows, col)
                catalog["saleName"] = name
                rc = api.post(f"{API}/ingest/catalog-json",
                              json={**catalog, "category": category})
                rc.raise_for_status()
                sale_id = rc.json()["saleId"]
                files = {"file": ("results.csv", csv_text, "text/csv")}
                rr = api.post(f"{API}/ingest/results",
                              data={"saleId": sale_id}, files=files)
                rr.raise_for_status()
                breezes = sum(1 for h in catalog["hips"] if h["breezeSeconds"])
                sold = csv_text.count(",false,")
                # value via the category dispatcher (racing-age path)
                rv = api.post(f"{API}/sales/{sale_id}/value")
                valued = rv.json().get("valued") if rv.status_code == 200 else "?"
                print(f"{name[:18]} {year}: {len(catalog['hips'])} hips, {breezes} breezes, "
                      f"{sold} sold -> {rc.json()['created']}c/{rc.json()['updated']}u, "
                      f"valued {valued}  [{time.time()-t0:.1f}s]")


if __name__ == "__main__":
    args = [int(a) for a in sys.argv[1:]]
    lo, hi = (args + [2018, 2023])[:2] if len(args) >= 2 else (2018, 2023)
    main(lo, hi)
