"""The batch scoring path must agree with the per-hip path exactly.

/value-sale exists purely as a speed fix — sklearn's per-call overhead swamps
the tree walk at one row, so a 4,000-hip catalogue costs ~25ms scored as a batch
vs ~57s scored hip-by-hip. That optimisation is only safe while the two paths
return byte-identical valuations, which is what this asserts. It covers the
cases most likely to diverge under batching: several currencies in one call
(each has its own bundle, priors and categorical levels), an unknown currency
falling back to USD, categorical levels absent from training, and null features.
"""
from __future__ import annotations

import pathlib
import tempfile

import joblib
import numpy as np
import pandas as pd
import pytest
from sklearn.ensemble import HistGradientBoostingRegressor

from app.training.features import CATEGORICAL_FEATURES, NUMERIC_FEATURES
from app.training.train import QUANTILES, VALUE_CATEGORICAL, VALUE_NUMERIC
from app.valuation import trained

HOUSES = ["Keeneland", "Fasig-Tipton", "Tattersalls"]
SALES = [f"Sale {i}" for i in range(8)]
SIRES = [f"sire{i}" for i in range(40)]
DAMS = [f"dam{i}" for i in range(120)]
CONSIGNORS = [f"cons{i}" for i in range(20)]
PRICE_COLS = NUMERIC_FEATURES + CATEGORICAL_FEATURES
VALUE_COLS = VALUE_NUMERIC + VALUE_CATEGORICAL


def _history(rng, n: int) -> pd.DataFrame:
    return pd.DataFrame({
        "sire_norm": rng.choice(SIRES, n), "dam_norm": rng.choice(DAMS, n),
        "damsire_norm": rng.choice(SIRES, n), "consignor_norm": rng.choice(CONSIGNORS, n),
        "year": rng.integers(2018, 2026, n),
        "sex": rng.choice(["COLT", "FILLY"], n),
        "color": rng.choice(["BAY", "GREY", "CHESTNUT"], n),
        "auctionHouse": rng.choice(HOUSES, n), "saleName": rng.choice(SALES, n),
        "log_price": rng.normal(11, 1.2, n),
        "currency": rng.choice(["USD", "GNS"], n),
    })


def _fit(rng, hist, cols, cats, n):
    X = pd.DataFrame({c: rng.normal(size=n) for c in cols if c not in cats})
    for c in cats:
        X[c] = pd.Categorical(rng.choice(hist[c].unique(), n))
    X = X[cols]
    mask = [c in cats for c in X.columns]
    y = rng.normal(11, 1, n)
    return {q: HistGradientBoostingRegressor(
        loss="quantile", quantile=q, max_iter=8, max_leaf_nodes=8,
        categorical_features=mask, random_state=1).fit(X, y) for q in QUANTILES}


@pytest.fixture
def loaded_models(monkeypatch):
    """Two per-currency bundles loaded through the real trained.load() path."""
    rng = np.random.default_rng(7)
    n = 800
    hist = _history(rng, n)
    tmp = pathlib.Path(tempfile.mkdtemp())
    monkeypatch.setattr(trained, "MODELS_DIR", tmp)
    for cur in ("USD", "GNS"):
        joblib.dump({
            "version": f"test-{cur}", "currency": cur,
            "price_models": _fit(rng, hist, PRICE_COLS, CATEGORICAL_FEATURES, n),
            "price_cols": PRICE_COLS,
            "value_models": _fit(rng, hist, VALUE_COLS, VALUE_CATEGORICAL, n),
            "value_cols": VALUE_COLS,
            "quantiles": QUANTILES, "categorical_features": CATEGORICAL_FEATURES,
            # Width-stratified conformal offsets, as a real v2.2+ bundle carries.
            "display": {
                "lo_q": 0.25, "hi_q": 0.75, "target_coverage": 0.5,
                "price_cal": 0.11, "value_cal": 0.09,
                "price_width_edges": [0.4, 0.9], "price_width_offsets": [0.05, 0.1, 0.2],
                "value_width_edges": [0.5], "value_width_offsets": [0.06, 0.12],
            },
            "metrics": {},
        }, tmp / f"valuation_model_{cur}.joblib")
    assert trained.load(hist)
    yield
    trained._BUNDLES = {}


def _hips(rng, count: int) -> list[dict]:
    out = []
    for i in range(count):
        out.append({
            # "Unseen Sire" / "New House" / "Brand New Sale" exercise levels the
            # bundles never trained on; they must land as NaN per row, not shift
            # the encoding of their neighbours in the batch.
            "sireName": str(rng.choice(SIRES + ["Unseen Sire"])),
            "damName": str(rng.choice(DAMS)),
            "damsireName": str(rng.choice(SIRES)),
            "consignorName": str(rng.choice(CONSIGNORS)) if i % 7 else None,
            "sessionNumber": int(rng.integers(1, 5)) if i % 5 else None,
            "saleYear": int(rng.integers(2019, 2027)),
            "sex": str(rng.choice(["COLT", "FILLY"])),
            "color": str(rng.choice(["BAY", "GREY", "PALOMINO"])),
            "auctionHouse": str(rng.choice(HOUSES + ["New House"])),
            "saleName": str(rng.choice(SALES + ["Brand New Sale"])),
            "hipNumber": int(rng.integers(1, 3000)),
            # EUR has no bundle and must fall back to USD.
            "currency": str(rng.choice(["USD", "GNS", "EUR"])),
            "sireStudFeeCents": int(rng.integers(1e5, 1e7)) if i % 3 else None,
            "sireEpsCents": int(rng.integers(1e4, 1e6)) if i % 4 else None,
            "sireStakesPct": float(rng.random()) if i % 6 else None,
            "pedigreeScore": float(rng.integers(0, 100)) if i % 2 else None,
        })
    return out


def test_batch_matches_per_hip(loaded_models):
    hips = _hips(np.random.default_rng(11), 120)
    assert [trained.predict(h) for h in hips] == trained.predict_many(hips)


def test_batch_preserves_order_when_currencies_interleave(loaded_models):
    """Hips are grouped by currency to score, so results must be scattered back
    to their original positions rather than returned in group order."""
    hips = _hips(np.random.default_rng(12), 30)
    for h, cur in zip(hips, ["USD", "GNS"] * 15):
        h["currency"] = cur
    batch = trained.predict_many(hips)
    assert [trained.predict(h) for h in hips] == batch
    # A USD and a GNS bundle must actually produce different versions, otherwise
    # the ordering assertion above would pass trivially.
    assert {b["modelVersion"] for b in batch} == {"test-USD", "test-GNS"}


def test_empty_batch_and_no_models():
    assert trained.predict_many([]) == []
    trained._BUNDLES = {}
    assert trained.predict_many([{"currency": "USD"}]) == [None]
