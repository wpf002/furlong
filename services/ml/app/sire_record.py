"""Sire race-record extracted from the 'By SIRE (year). ...' block that opens
every sales-catalogue page.

Why this exists: a stallion's stud fee is the market's forward price on him, and
we cannot licence stud fees (Equibase declined, DRF never answered, Brisnet
refuses app use). But the catalogue page we ALREADY ingest states the very
inputs that set that fee — the sire's own championship, career earnings, and
graded wins — and explicitly flags a first crop.

A sire's record is a property of the SIRE, not of the hip. So we parse it once
per stallion from any page that mentions him, then join it to every historical
sold hip by that sire — which is how a feature extractable from only 5k pages
reaches 149k training rows.
"""
from __future__ import annotations

import re

_MONEY = re.compile(r"\$[\d,\-\s]{4,}")
_BY = re.compile(r"\bBy\s+([A-Z][A-Z'’.\- ]{2,40}?)\s*\((\d{4})\)\s*\.(.{0,900})", re.S)


def _money(blob: str) -> int | None:
    """Career earnings. Catalogue text hyphenates across line breaks
    ('$3,-\\n 029,830'), so strip everything that is not a digit."""
    m = _MONEY.search(blob)
    if not m:
        return None
    digits = re.sub(r"[^\d]", "", m.group(0))
    if not digits or len(digits) > 12:
        return None
    v = int(digits)
    return v if 1_000 <= v <= 100_000_000 else None


def parse_sire_block(page_text: str | None) -> dict | None:
    """Return the sire's own record from a catalogue page, or None."""
    if not page_text:
        return None
    m = _BY.search(page_text)
    if not m:
        return None
    name, yob, blob = m.group(1).strip(), int(m.group(2)), m.group(3)
    # Cut the block at the female-family section so we only read the SIRE.
    blob = re.split(r"\n\s*1st dam", blob)[0]
    flat = re.sub(r"\s+", " ", blob)

    return {
        "sireName": re.sub(r"\s+", " ", name).title(),
        "sireYob": yob,
        "earningsUsd": _money(flat),
        "g1Wins": len(re.findall(r"\[G1\]", flat)),
        "g2Wins": len(re.findall(r"\[G2\]", flat)),
        "g3Wins": len(re.findall(r"\[G3\]", flat)),
        "champion": bool(re.search(r"\bchampion\b", flat, re.I)),
        "blackTypeWinner": bool(re.search(r"black-?type winner", flat, re.I)),
        # "His first foals are yearlings of 2026" — the sire has no sales record
        # yet, which is exactly where price priors fail.
        "firstCrop": bool(re.search(r"first (foals|crop)", flat, re.I)),
        "winsCount": int(m2.group(1)) if (m2 := re.search(r"winner of (\d+) races?", flat, re.I)) else None,
    }
