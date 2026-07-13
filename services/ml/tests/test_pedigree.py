"""Unit tests for the catalog-pedigree score (port of pedigreeGrade.ts)."""
from __future__ import annotations

import math

from app.pedigree import pedigree_score


def test_no_page_is_nan():
    assert math.isnan(pedigree_score(None))
    assert math.isnan(pedigree_score(""))
    assert math.isnan(pedigree_score("   "))


def test_score_bounds_and_baseline():
    # A bare page with no black type sits at the base (30), clamped floor 20.
    s = pedigree_score("By SIRE.\n1st dam\nDAM, by X. Unraced.")
    assert 20 <= s <= 100
    assert s == 30


def test_first_dam_black_type_outweighs_deep_family():
    strong = pedigree_score("By SIRE [G1].\n1st dam\nDAM, by X. Dam of BIG [G1], BIG2 [G1].")
    deep = pedigree_score(
        "By SIRE.\n1st dam\nDAM, by X.\n3rd dam\nOLD, by Y. Dam of FAR [G1], FAR2 [G1]."
    )
    assert strong > deep


def test_matches_ts_heuristic_example():
    # sireTop 22 (G1) + 1st-dam 2×[G1] (2×9) = 30 + 22 + 18 = 70, matching the TS
    # computePedigreeGrade for the same page.
    s = pedigree_score("By SIRE [G1].\n1st dam\nDAM, by X. Dam of BIG [G1], BIG2 [G1].")
    assert s == 70
