"""Unit tests for the pure comparables valuation function."""
from __future__ import annotations

import pytest

from app.valuation.model import (
    MODEL_VERSION,
    compute_valuation,
    normalize_entity_name,
)


def _comp(price: int, sire: str | None = None, session: int | None = None,
          consignor: str | None = None, year: int = 2024) -> dict:
    return {
        "priceCents": price,
        "sireNorm": normalize_entity_name(sire),
        "sessionNumber": session,
        "consignorNorm": normalize_entity_name(consignor),
        "saleYear": year,
    }


def test_normalize_entity_name():
    assert normalize_entity_name("Tapit (USA)") == "tapit"
    assert normalize_entity_name("Into Mischief") == "into mischief"
    assert normalize_entity_name("A. P. Indy") == "a p indy"
    assert normalize_entity_name("Smith & Sons") == "smith and sons"
    assert normalize_entity_name("  ") is None
    assert normalize_entity_name(None) is None


def test_empty_comps_returns_zeroed():
    out = compute_valuation({"sireName": "Tapit"}, [])
    assert out["estValueLowCents"] == 0
    assert out["estValueHighCents"] == 0
    assert out["predPriceLowCents"] == 0
    assert out["predPriceHighCents"] == 0
    assert out["confidence"] == 0.0
    assert out["limitedComparables"] is True
    assert out["modelVersion"] == MODEL_VERSION


def test_t1_tier_sire_and_session():
    # 6 comps same sire + same session -> T1
    comps = [
        _comp(p, sire="Tapit", session=1)
        for p in (1000_00, 1500_00, 2000_00, 2500_00, 3000_00, 3500_00)
    ]
    # add noise that should not be selected
    comps += [_comp(50_00, sire="Other", session=2) for _ in range(10)]

    out = compute_valuation(
        {"sireName": "Tapit", "sessionNumber": 1, "consignorName": None}, comps
    )
    # T1 base 0.9 * min(1, 6/20) = 0.9 * 0.3 = 0.27
    assert out["confidence"] == pytest.approx(0.9 * (6 / 20))
    # n=6 >= MIN_COMPS and tier T1 -> not limited
    assert out["limitedComparables"] is False
    assert out["estValueLowCents"] <= out["estValueHighCents"]


def test_t2_when_session_differs():
    # same sire but no 5+ matching session -> falls to T2
    comps = [
        _comp(p, sire="Tapit", session=s)
        for p, s in [
            (1000_00, 1), (1500_00, 2), (2000_00, 1),
            (2500_00, 3), (3000_00, 2), (3500_00, 4),
        ]
    ]
    out = compute_valuation(
        {"sireName": "Tapit", "sessionNumber": 9, "consignorName": None}, comps
    )
    # session 9 never matches -> T1 empty, T2 has 6 -> chosen
    assert out["confidence"] == pytest.approx(0.75 * (6 / 20))
    assert out["limitedComparables"] is False  # T2 not in limited tiers, n>=5


def test_t4_market_baseline_is_limited():
    # no sire match, no consignor match -> T4
    comps = [_comp(p, sire="Other", session=1) for p in range(1000_00, 1000_00 + 8 * 100_00, 100_00)]
    out = compute_valuation(
        {"sireName": "Unmatched", "sessionNumber": 5, "consignorName": None}, comps
    )
    assert out["limitedComparables"] is True  # T4 always limited
    assert out["confidence"] == pytest.approx(0.30 * min(1.0, len(comps) / 20))


def test_thin_data_flips_limited():
    # only 2 same-sire comps, nothing else -> most specific non-empty tier (T2)
    comps = [_comp(1000_00, sire="Tapit"), _comp(2000_00, sire="Tapit")]
    out = compute_valuation(
        {"sireName": "Tapit", "sessionNumber": None, "consignorName": None}, comps
    )
    assert out["limitedComparables"] is True  # n=2 < MIN_COMPS


def test_bands_ordered_and_integer_cents():
    comps = [
        _comp(p, sire="Tapit", session=1)
        for p in (1000_00, 1500_00, 2000_00, 2500_00, 3000_00, 3500_00, 4000_00)
    ]
    out = compute_valuation(
        {"sireName": "Tapit", "sessionNumber": 1, "consignorName": None}, comps
    )
    for key in ("estValueLowCents", "estValueHighCents", "predPriceLowCents", "predPriceHighCents"):
        assert isinstance(out[key], int)
    assert out["estValueLowCents"] <= out["estValueHighCents"]
    assert out["predPriceLowCents"] <= out["predPriceHighCents"]
    assert 0.0 <= out["confidence"] <= 1.0


def test_confidence_clamped_at_one():
    # 30 comps same sire+session -> min(1, 30/20)=1 -> conf = 0.9
    comps = [_comp(1000_00 + i * 100, sire="Tapit", session=1) for i in range(30)]
    out = compute_valuation(
        {"sireName": "Tapit", "sessionNumber": 1, "consignorName": None}, comps
    )
    assert out["confidence"] == 0.9


def test_trend_factor_scales_pred_not_est():
    # older years cheaper, recent years pricier -> trend > 1 -> pred > est
    comps = []
    comps += [_comp(1000_00, sire="Tapit", session=1, year=2020) for _ in range(3)]
    comps += [_comp(4000_00, sire="Tapit", session=1, year=2024) for _ in range(3)]
    out = compute_valuation(
        {"sireName": "Tapit", "sessionNumber": 1, "consignorName": None}, comps
    )
    assert out["predPriceHighCents"] >= out["estValueHighCents"]


def test_t3_consignor_tier_and_session():
    # Build consignor terciles. High-priced consignor, target shares its tier.
    comps = []
    # low tercile consignor
    comps += [_comp(500_00, consignor="CheapBarn", session=1) for _ in range(3)]
    # mid
    comps += [_comp(1500_00, consignor="MidBarn", session=1) for _ in range(3)]
    # high tercile consignor (target's consignor) -> session 1
    comps += [_comp(p, consignor="TopBarn", session=1)
              for p in (3000_00, 3200_00, 3400_00, 3600_00, 3800_00, 4000_00)]
    out = compute_valuation(
        {"sireName": "NoMatchSire", "sessionNumber": 1, "consignorName": "TopBarn"},
        comps,
    )
    # T1/T2 empty (sire no match). T3 = same consignor tier + session.
    # TopBarn is the high tercile with 6 comps at session 1 -> T3 chosen.
    assert out["limitedComparables"] is True  # T3 always limited
    assert out["confidence"] == pytest.approx(0.55 * min(1.0, 6 / 20))
