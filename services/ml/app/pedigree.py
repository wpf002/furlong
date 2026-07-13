"""Catalog-pedigree score from a black-type page.

A Python port of the API's `computePedigreeGrade` heuristic
(apps/api/src/pedigreeGrade.ts), kept deliberately in sync so the valuation
model TRAINS on the same 0–100 pedigree signal the app SHOWS buyers. Only the
score is ported here — the letter grade/badge and the per-sale expert override
stay in TS (the model wants the continuous number).

Leakage-safe: the score reads only the catalog page (known before the hip sells),
never the outcome, so it's a plain intrinsic feature like sex or color.
"""
from __future__ import annotations

import math
import re


def _bt_points(s: str, g1: float, g2: float, g3: float, l: float) -> float:
    # Weighted black-type "points" in a slice of the page. [LR] never contains
    # [L] as a substring, so the two counts don't overlap.
    return (
        s.count("[G1]") * g1
        + s.count("[G2]") * g2
        + s.count("[G3]") * g3
        + (s.count("[L]") + s.count("[LR]")) * l
    )


def _dam_at(text: str, n: int) -> int:
    m = re.search(rf"\n\s*{n}(?:st|nd|rd|th)\s+dam", text, re.IGNORECASE)
    return m.start() if m else -1


def pedigree_score(text) -> float:
    """0–100 catalog-pedigree score, or NaN when there's no page to read.

    Mirrors pedigreeGrade.ts: sire's own top black type (weighted highest) plus
    proximity-weighted female-family black type — 1st dam ≫ 2nd dam ≫ deep family.
    """
    if not isinstance(text, str) or not text.strip():
        return math.nan

    i1 = _dam_at(text, 1)
    i2 = _dam_at(text, 2)
    i3 = _dam_at(text, 3)
    end = len(text)
    sire_block = text[: i1 if i1 >= 0 else end]
    dam1 = "" if i1 < 0 else text[i1 : i2 if i2 >= 0 else end]
    dam2 = "" if i2 < 0 else text[i2 : i3 if i3 >= 0 else end]
    deep = "" if i3 < 0 else text[i3:]

    sire_top = (
        22 if "[G1]" in sire_block
        else 15 if "[G2]" in sire_block
        else 9 if "[G3]" in sire_block
        else 0
    )
    p1 = _bt_points(dam1, 9, 6, 3.5, 1.5)
    p2 = _bt_points(dam2, 3.5, 2.2, 1.2, 0.5)
    p_deep = min(9.0, _bt_points(deep, 0.6, 0.4, 0.22, 0.08))

    # math.floor(x + 0.5) matches JS Math.round (round half up), not Python's
    # banker's rounding, so the Python and TS scores agree exactly.
    raw = 30 + sire_top + p1 + p2 + p_deep
    return float(max(20, min(100, math.floor(raw + 0.5))))
