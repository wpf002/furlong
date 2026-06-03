"""Generate ILLUSTRATIVE historical comparables for a real upcoming catalog.

The valuation engine needs historical SOLD results (comparables). When only the
upcoming catalog is available, this builds prior-year sales (catalog PDFs +
results CSVs) that reuse the REAL sires from the upcoming catalog, so the
comparable lookup matches by sire and produces meaningful bands. The prices are
synthetic but sire-dependent and deterministic.

This is DEV/DEMO ONLY — replace with real published results when available.

Usage:
  ./.venv/bin/python scripts/make_history_for_catalog.py /path/to/upcoming.pdf
"""
from __future__ import annotations

import csv
import hashlib
import os
import sys

import fitz  # pymupdf

from app.parsing.keeneland import parse_keeneland_catalog

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CATALOG_DIR = os.path.join(REPO_ROOT, "data", "catalogs")
RESULTS_DIR = os.path.join(REPO_ROOT, "data", "results")

COLOR_SEX = ["Bay Colt", "Chestnut Filly", "Dark Bay or Brown Colt", "Gray or Roan Filly"]
MONTHS = ["January", "February", "March", "April", "May"]


def _base_price_dollars(sire: str) -> int:
    """Deterministic per-sire base price, $60k–$960k."""
    hd = int(hashlib.md5(sire.encode("utf-8")).hexdigest(), 16)
    return 60_000 + (hd % 37) * 25_000


def _hip_text(hip: int, sire: str, dam: str, damsire: str, consignor: str,
              foaling_year: int, idx: int) -> str:
    return "\n".join([
        "Hip No.",
        str(hip),
        f"Barn {idx % 9 + 1}",
        f"Consigned by {consignor}, Agent",
        COLOR_SEX[idx % len(COLOR_SEX)],
        f"{MONTHS[idx % len(MONTHS)]} {idx % 27 + 1}, {foaling_year}",
        # Sire must be UPPER CASE to match the catalog convention the parser keys on.
        f"By {sire.upper()} (2016), $1,000,000, Big Memorial S. [G1].",
        "1st dam",
        f"{dam.upper()}, by {damsire}. Winner at 3, $50,000.",
    ])


def build_year(sires: list[str], consignors: list[str], sale_year: int, n: int):
    foaling_year = sale_year - 1
    year_factor = {2024: 1.08, 2025: 0.94}.get(sale_year, 1.0)  # mild market drift
    os.makedirs(CATALOG_DIR, exist_ok=True)
    os.makedirs(RESULTS_DIR, exist_ok=True)

    doc = fitz.open()
    rows = [("hipNumber", "price", "rna", "buyer")]
    for i in range(1, n + 1):
        sire = sires[i % len(sires)]
        damsire = sires[(i * 5) % len(sires)]
        consignor = consignors[i % len(consignors)]
        dam = f"Historic Mare {sale_year} {i}"
        page = doc.new_page()
        page.insert_text((36, 50),
                         _hip_text(i, sire, dam, damsire, consignor, foaling_year, i),
                         fontsize=9)
        # price: sire base * market drift * deterministic per-hip variation
        var = 1.0 + ((i * 7) % 9 - 4) * 0.08
        price = int(round(_base_price_dollars(sire) * year_factor * var / 1000.0)) * 1000
        if i % 11 == 0:
            rows.append((i, "", "true", ""))           # RNA
        else:
            rows.append((i, price, "false", f"Buyer {i % 6 + 1}"))

    cat_path = os.path.join(CATALOG_DIR, f"ft_july_{sale_year}_history.pdf")
    doc.save(cat_path)
    doc.close()
    res_path = os.path.join(RESULTS_DIR, f"ft_july_{sale_year}_history.csv")
    with open(res_path, "w", newline="") as f:
        csv.writer(f).writerows(rows)
    return cat_path, res_path


def main(upcoming_pdf: str) -> None:
    raw = open(upcoming_pdf, "rb").read()
    parsed = parse_keeneland_catalog(raw, os.path.basename(upcoming_pdf))
    sires = list(dict.fromkeys(h["sireName"] for h in parsed["hips"] if h["sireName"]))
    consignors = list(dict.fromkeys(
        h["consignorName"] for h in parsed["hips"] if h["consignorName"]
    )) or ["Demo Consignor"]
    print(f"real sires: {len(sires)}, real consignors: {len(consignors)}")
    for year in (2024, 2025):
        cat, res = build_year(sires, consignors, year, n=200)
        print("wrote", os.path.relpath(cat, REPO_ROOT), "+", os.path.relpath(res, REPO_ROOT))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/Users/willfoti/Downloads/web.pdf")
