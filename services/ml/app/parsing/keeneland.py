"""Keeneland September catalog parser.

Stub: returns the structure the API expects. Phase 1 implements real layout
parsing with pdfplumber (per-session headers, hip blocks, sire/dam lines).
"""
from __future__ import annotations


def parse_keeneland_catalog(raw: bytes, filename: str) -> dict:
    # TODO Phase 1: open with pdfplumber, walk pages, extract hip blocks.
    return {
        "auctionHouse": "KEENELAND",
        "saleName": "September Yearling Sale",
        "year": 0,
        "hips": [],
        "_meta": {"filename": filename, "bytes": len(raw), "parsed": False},
    }
