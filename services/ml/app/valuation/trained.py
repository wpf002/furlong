"""Phase 2 inference: score a hip with the trained quantile models.

Loads the joblib artifact (price + value quantile models) and builds as-of-year
prior-stat lookups from the sold history, so a hip's features are computed the
same leakage-safe way as training. Returns:
  - predicted price band   (price model P25-P75, P50 mid)   -> predPrice*
  - intrinsic value band   (value model P25-P75, P50 mid)   -> estValue*
  - confidence             (data support x interval tightness)
  - limitedComparables     (thin prior support for this sire)

The price-vs-value gap is the hidden-gem signal (computed downstream from the
two mids). Falls back to None if the model artifact isn't present.
"""
from __future__ import annotations

import bisect
import math
from pathlib import Path

import numpy as np
import pandas as pd

from app.training.features import CATEGORICAL_FEATURES
from app.valuation.model import normalize_entity_name

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "valuation_model.joblib"

_BUNDLE = None          # joblib dict
_PRIORS: dict = {}      # {entity_kind: {norm_name: (years, cum_sum, cum_count)}}
_MARKET = None          # (years, cum_sum, cum_count)
_CAT_LEVELS: dict = {}  # observed categories per categorical feature (for dtype)


def _build_prior_lookup(df: pd.DataFrame, key: str):
    out: dict = {}
    sub = df.dropna(subset=[key])
    agg = sub.groupby([key, "year"])["log_price"].agg(s="sum", c="size").reset_index()
    for name, g in agg.sort_values("year").groupby(key):
        years = g["year"].to_numpy()
        cs = np.cumsum(g["s"].to_numpy())
        cc = np.cumsum(g["c"].to_numpy())
        out[name] = (years, cs, cc)
    return out


def _prior(lookup: dict, name, sale_year: int):
    """Mean log_price and count over years strictly before sale_year."""
    if name is None or name not in lookup:
        return math.nan, 0.0
    years, cs, cc = lookup[name]
    idx = bisect.bisect_left(years, sale_year)
    if idx == 0:
        return math.nan, 0.0
    return cs[idx - 1] / cc[idx - 1], float(cc[idx - 1])


def is_loaded() -> bool:
    return _BUNDLE is not None


def model_version() -> str | None:
    return _BUNDLE["version"] if _BUNDLE else None


def metrics() -> dict | None:
    return _BUNDLE.get("metrics") if _BUNDLE else None


def load(history: pd.DataFrame) -> bool:
    """Load the model artifact and build prior lookups from sold history."""
    global _BUNDLE, _PRIORS, _MARKET, _CAT_LEVELS
    if not MODEL_PATH.exists():
        _BUNDLE = None
        return False
    import joblib

    _BUNDLE = joblib.load(MODEL_PATH)
    _PRIORS = {
        "sire": _build_prior_lookup(history, "sire_norm"),
        "damsire": _build_prior_lookup(history, "damsire_norm"),
        "consignor": _build_prior_lookup(history, "consignor_norm"),
    }
    by_year = history.groupby("year")["log_price"].agg(s="sum", c="size").reset_index().sort_values("year")
    _MARKET = (by_year["year"].to_numpy(), np.cumsum(by_year["s"].to_numpy()), np.cumsum(by_year["c"].to_numpy()))
    # remember training category levels so inference frames share the dtype
    _CAT_LEVELS = {
        c: list(pd.Index(history[c].dropna().unique())) for c in CATEGORICAL_FEATURES
    }
    return True


def _market_prior(sale_year: int):
    years, cs, cc = _MARKET
    idx = bisect.bisect_left(years, sale_year)
    if idx == 0:
        return math.nan
    return cs[idx - 1] / cc[idx - 1]


def _feature_row(features: dict) -> dict:
    sale_year = int(features.get("saleYear") or 0)
    sire = normalize_entity_name(features.get("sireName"))
    damsire = normalize_entity_name(features.get("damsireName"))
    consignor = normalize_entity_name(features.get("consignorName"))

    sire_mean, sire_n = _prior(_PRIORS["sire"], sire, sale_year)
    ds_mean, ds_n = _prior(_PRIORS["damsire"], damsire, sale_year)
    cons_mean, cons_n = _prior(_PRIORS["consignor"], consignor, sale_year)

    sess = features.get("sessionNumber")
    return {
        "sire_prior_mean": sire_mean, "sire_prior_count": sire_n,
        "damsire_prior_mean": ds_mean, "damsire_prior_count": ds_n,
        "consignor_prior_mean": cons_mean, "consignor_prior_count": cons_n,
        "market_prior_mean": _market_prior(sale_year),
        "year": sale_year,
        "sessionNumber": float(sess) if sess is not None else math.nan,
        "hipNumber": float(features.get("hipNumber") or math.nan),
        "sex": features.get("sex"),
        "color": features.get("color"),
        "auctionHouse": features.get("auctionHouse"),
        "saleName": features.get("saleName"),
        "_sire_n": sire_n,
    }


def _frame(row: dict, cols: list[str]) -> pd.DataFrame:
    df = pd.DataFrame([{c: row.get(c) for c in cols}])
    for c in cols:
        if c in CATEGORICAL_FEATURES:
            df[c] = pd.Categorical(df[c], categories=_CAT_LEVELS.get(c))
        else:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def _r100(cents: float) -> int:
    return int(round(cents / 100.0)) * 100


def predict(features: dict) -> dict | None:
    if _BUNDLE is None:
        return None
    row = _feature_row(features)
    q = _BUNDLE["quantiles"]

    price_X = _frame(row, _BUNDLE["price_cols"])
    value_X = _frame(row, _BUNDLE["value_cols"])
    pm = {qq: float(_BUNDLE["price_models"][qq].predict(price_X)[0]) for qq in q}
    vm = {qq: float(_BUNDLE["value_models"][qq].predict(value_X)[0]) for qq in q}

    # log -> cents
    pred_low, pred_mid, pred_high = (math.exp(pm[0.25]), math.exp(pm[0.50]), math.exp(pm[0.75]))
    est_low, est_mid, est_high = (math.exp(vm[0.25]), math.exp(vm[0.50]), math.exp(vm[0.75]))

    # confidence: data support x interval tightness (log IQR of the price model)
    support = min(1.0, row["_sire_n"] / 40.0)
    tightness = math.exp(-(pm[0.75] - pm[0.25]))  # tighter interval -> closer to 1
    confidence = max(0.0, min(1.0, 0.1 + 0.9 * support * tightness))

    limited = row["_sire_n"] < 10

    return {
        "estValueLowCents": _r100(est_low),
        "estValueHighCents": _r100(est_high),
        "predPriceLowCents": _r100(pred_low),
        "predPriceHighCents": _r100(pred_high),
        "confidence": float(confidence),
        "modelVersion": _BUNDLE["version"],
        "limitedComparables": bool(limited),
    }
