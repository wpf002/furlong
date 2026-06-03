"""Parser tests against an in-memory synthetic catalog PDF in the real
Jockey-Club pedigree-page format (the layout used by web.pdf).

Covers the three consignor phrasings (Consigned by / Property of / Raised &
Offered), ALL-CAPS name title-casing incl. apostrophes, and a malformed block
that must land in report.skipped.
"""
from __future__ import annotations

import fitz  # pymupdf
import pytest

from app.parsing.keeneland import parse_keeneland_catalog


def _hip_page(hip: int, color_sex: str, consignor_line: str, foaled: str,
              sire: str, dam: str, damsire: str) -> str:
    return "\n".join([
        "Hip No.",
        str(hip),
        "Barn 5",
        consignor_line,
        color_sex,
        foaled,
        f"By {sire} (2018), $1,000,000, Some Big S. [G1].",
        "1st dam",
        f"{dam}, by {damsire}. Placed at 2, $10,000.",
    ])


def _build_synthetic_catalog() -> bytes:
    pages = [
        _hip_page(1, "Dark Bay or Brown Colt", "Consigned by Gainesway, Agent I",
                  "March 24, 2025", "OLYMPIAD", "BARBARA GORDON", "Commissioner"),
        _hip_page(2, "Chestnut Filly", "Property of BTE Stables",
                  "February 18, 2025", "TWO PHIL'S", "BECCA'S DIAMOND", "Graydar"),
        _hip_page(3, "Gray or Roan Colt", "Airdrie Stud Raised & Offered, Agent",
                  "April 1, 2025", "CURLIN", "GLINDA THE GOOD", "Big Brown"),
    ]
    # Malformed: a hip marker with no pedigree at all -> must be skipped.
    pages.append("\n".join(["Hip No.", "4", "Barn 9", "???"]))

    doc = fitz.open()
    for text in pages:
        page = doc.new_page()
        page.insert_text((36, 50), text, fontsize=10)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


@pytest.fixture
def synthetic_catalog() -> bytes:
    return _build_synthetic_catalog()


def test_parses_good_hips(synthetic_catalog: bytes) -> None:
    result = parse_keeneland_catalog(synthetic_catalog, "synthetic.pdf")
    assert result["auctionHouse"] == "KEENELAND"  # placeholder, overridden at ingest
    assert result["year"] == 2026  # foaled 2025 -> yearling sale 2026

    hips = {h["hipNumber"]: h for h in result["hips"]}
    assert set(hips) == {1, 2, 3}

    h1 = hips[1]
    assert h1["sex"] == "COLT"
    assert h1["color"] == "Dark Bay or Brown"
    assert h1["foalingYear"] == 2025
    assert h1["sireName"] == "Olympiad"            # ALL CAPS -> title-cased
    assert h1["damName"] == "Barbara Gordon"
    assert h1["damsireName"] == "Commissioner"
    assert h1["consignorName"] == "Gainesway"      # ", Agent I" stripped
    assert h1["name"] is None                        # yearlings unnamed

    h2 = hips[2]
    assert h2["sex"] == "FILLY"
    assert h2["consignorName"] == "BTE Stables"     # "Property of"
    assert h2["sireName"] == "Two Phil's"          # apostrophe not up-cased

    h3 = hips[3]
    assert h3["color"] == "Gray or Roan"
    assert h3["consignorName"] == "Airdrie Stud"    # "Raised & Offered, Agent"
    assert h3["damName"] == "Glinda The Good"  # simple title-case (every word)


def test_malformed_block_skipped(synthetic_catalog: bytes) -> None:
    report = parse_keeneland_catalog(synthetic_catalog, "synthetic.pdf")["report"]
    assert report["blocksDetected"] == 4
    assert report["hipsParsed"] == 3
    assert report["hipsSkipped"] == 1
    assert len(report["skipped"]) == 1
    assert "4" in report["skipped"][0]["snippet"]


def test_parse_rate(synthetic_catalog: bytes) -> None:
    report = parse_keeneland_catalog(synthetic_catalog, "synthetic.pdf")["report"]
    assert report["pagesScanned"] >= 1
    assert report["parseRate"] == pytest.approx(3 / 4)


def test_empty_pdf_does_not_crash() -> None:
    doc = fitz.open()
    doc.new_page()
    pdf_bytes = doc.tobytes()
    doc.close()
    result = parse_keeneland_catalog(pdf_bytes, "empty.pdf")
    assert result["hips"] == []
    assert result["report"]["blocksDetected"] == 0
    assert result["report"]["parseRate"] == 0.0
