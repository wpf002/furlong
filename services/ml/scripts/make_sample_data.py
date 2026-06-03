"""Generate synthetic Keeneland-style sample data for local demos / smoke tests.

This is a DEV ONLY helper so the pipeline can be exercised end to end before a
real licensed Keeneland September catalog PDF is available. It writes:

  data/catalogs/keeneland_<year>.pdf   — a catalog laid out per the parser's
                                         documented conventions
  data/results/keeneland_<year>.csv    — sold/RNA results for a historical year
                                         (the comparable label set)

It is deterministic (no RNG) so runs are reproducible.

Usage:
  ./.venv/bin/python scripts/make_sample_data.py
"""
from __future__ import annotations

import csv
import os

import fitz  # pymupdf

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CATALOG_DIR = os.path.join(REPO_ROOT, "data", "catalogs")
RESULTS_DIR = os.path.join(REPO_ROOT, "data", "results")

SIRES = ["Tapit", "Into Mischief", "Curlin", "Justify"]
DAMSIRES = ["Giant's Causeway", "Distorted Humor", "Unbridled's Song", "Storm Cat"]
DAMS = ["Misty For Me", "Lady Luck", "Sweet Song", "Quiet Storm",
        "Morning Light", "Silver Lining", "Bold Promise", "Gentle Breeze"]
CONSIGNORS = ["Lane's End, Agent", "Taylor Made Sales Agency, Agent II",
              "Gainesway", "Hill 'n' Dale"]
BREEDERS = ["John Smith (KY)", "Stonehaven (KY)", "Jane Doe (KY)", "ABC Farm (KY)"]
COLORS = ["Bay", "Chestnut", "Dark Bay or Brown", "Gray"]
SEXES = ["Colt", "Filly", "Gelding", "Filly"]

# Base hammer price per sire, in whole dollars. Comparables math keys off these.
BASE_PRICE = {"Tapit": 300_000, "Into Mischief": 250_000,
              "Curlin": 180_000, "Justify": 220_000}


def _hip_block(hip: int, foaling_year: int) -> str:
    i = hip - 1
    sire = SIRES[i % len(SIRES)]
    return "\n".join([
        f"Hip {hip}",
        f"{COLORS[i % len(COLORS)]} {SEXES[i % len(SEXES)]}",
        f"By {sire} out of {DAMS[i % len(DAMS)]}, by {DAMSIRES[i % len(DAMSIRES)]}",
        f"Foaled {foaling_year}",
        f"Consigned by {CONSIGNORS[i % len(CONSIGNORS)]}",
        f"Bred by {BREEDERS[i % len(BREEDERS)]}",
    ])


def _price_for(hip: int) -> int:
    """Deterministic dollar price that varies by hip but clusters by sire."""
    i = hip - 1
    sire = SIRES[i % len(SIRES)]
    base = BASE_PRICE[sire]
    # +/- up to 40% in deterministic steps
    factor = 1.0 + ((i * 7) % 9 - 4) * 0.1
    return int(round(base * factor / 1000.0)) * 1000


def make_catalog(sale_year: int, n_hips: int, hips_per_page: int = 6) -> str:
    """Write a catalog PDF for a sale year (yearlings foaled the prior year)."""
    foaling_year = sale_year - 1
    os.makedirs(CATALOG_DIR, exist_ok=True)
    doc = fitz.open()
    hip = 1
    session = 1
    while hip <= n_hips:
        page = doc.new_page()
        lines = [f"SESSION {session}"]
        for _ in range(hips_per_page):
            if hip > n_hips:
                break
            lines.append(_hip_block(hip, foaling_year))
            hip += 1
        page.insert_text((36, 50), "\n\n".join(lines), fontsize=9)
        session += 1
    path = os.path.join(CATALOG_DIR, f"keeneland_{sale_year}.pdf")
    doc.save(path)
    doc.close()
    return path


def make_results(sale_year: int, n_hips: int) -> str:
    """Write a results CSV: most hips sold, every 7th an RNA (kept as signal)."""
    os.makedirs(RESULTS_DIR, exist_ok=True)
    path = os.path.join(RESULTS_DIR, f"keeneland_{sale_year}.csv")
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["hipNumber", "price", "rna", "buyer"])
        for hip in range(1, n_hips + 1):
            if hip % 7 == 0:
                w.writerow([hip, "", "true", ""])  # RNA: no price
            else:
                w.writerow([hip, _price_for(hip), "false", f"Buyer {hip % 5 + 1}"])
    return path


if __name__ == "__main__":
    # Historical sale (with results -> comparables) and an upcoming sale (to value).
    c24 = make_catalog(2024, 48)
    r24 = make_results(2024, 48)
    c25 = make_catalog(2025, 24)
    print("wrote:")
    for p in (c24, r24, c25):
        print(" ", os.path.relpath(p, REPO_ROOT))
