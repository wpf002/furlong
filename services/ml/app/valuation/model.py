"""Valuation model.

Phase 1: LightGBM regression on log(price) over tabular pedigree + sale-context
features, trained on historical results. Outputs a predicted price band, an
intrinsic value band, and a confidence derived from prediction interval width
and comparable density. `limited_comparables` flags thin-data hips so the UI
never fakes precision.

Stub returns a deterministic placeholder until the model is trained.
"""
from __future__ import annotations

MODEL_VERSION = "0.0.0-stub"


def predict(features: dict) -> dict:
    return {
        "estValueLowCents": 0,
        "estValueHighCents": 0,
        "predPriceLowCents": 0,
        "predPriceHighCents": 0,
        "confidence": 0.0,
        "modelVersion": MODEL_VERSION,
        "limitedComparables": True,
    }
