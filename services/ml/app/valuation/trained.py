"""Phase 2/4 inference: score a hip with the trained quantile models.

Multi-currency: one model per market (USD, GNS, ...) plus per-currency as-of-year
prior lookups, so guinea and dollar prices never mix. predict() routes by the
hip's sale currency (features["currency"]), falling back to USD. Returns the
predicted-price band, intrinsic-value band, confidence and limitedComparables.
"""
from __future__ import annotations

import bisect
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

from app.training.features import CATEGORICAL_FEATURES
from app.valuation.model import normalize_entity_name

MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
_MODEL_RE = re.compile(r"^valuation_model_([A-Z]{2,4})\.joblib$")

_BUNDLES: dict = {}          # currency -> joblib bundle
_PRIORS: dict = {}           # currency -> {kind: {norm_name: (years, cum_sum, cum_count)}}
_MARKET: dict = {}           # currency -> (years, cum_sum, cum_count)
_CAT_LEVELS: dict = {}       # currency -> {cat_feature: [levels]}
_DEFAULT = "USD"


def _build_prior_lookup(df: pd.DataFrame, key: str):
    out: dict = {}
    sub = df.dropna(subset=[key])
    agg = sub.groupby([key, "year"])["log_price"].agg(s="sum", c="size").reset_index()
    for name, g in agg.sort_values("year").groupby(key):
        years = g["year"].to_numpy()
        out[name] = (years, np.cumsum(g["s"].to_numpy()), np.cumsum(g["c"].to_numpy()))
    return out


def _prior(lookup: dict, name, sale_year: int):
    if name is None or name not in lookup:
        return math.nan, 0.0
    years, cs, cc = lookup[name]
    idx = bisect.bisect_left(years, sale_year)
    if idx == 0:
        return math.nan, 0.0
    return cs[idx - 1] / cc[idx - 1], float(cc[idx - 1])


def is_loaded() -> bool:
    return bool(_BUNDLES)


def _default_bundle():
    return _BUNDLES.get(_DEFAULT) or (next(iter(_BUNDLES.values())) if _BUNDLES else None)


def model_version() -> str | None:
    b = _default_bundle()
    return b["version"] if b else None


def metrics() -> dict | None:
    b = _default_bundle()
    return b.get("metrics") if b else None


def load(history: pd.DataFrame) -> bool:
    """Load every per-currency model + build per-currency prior lookups."""
    global _BUNDLES, _PRIORS, _MARKET, _CAT_LEVELS
    _BUNDLES, _PRIORS, _MARKET, _CAT_LEVELS = {}, {}, {}, {}
    if not MODELS_DIR.exists():
        return False
    import joblib

    for f in MODELS_DIR.glob("valuation_model_*.joblib"):
        m = _MODEL_RE.match(f.name)
        if m:
            _BUNDLES[m.group(1)] = joblib.load(f)
    if not _BUNDLES:
        return False

    for cur in _BUNDLES:
        h = history[history["currency"] == cur] if "currency" in history else history
        if h.empty:
            h = history
        _PRIORS[cur] = {
            "sire": _build_prior_lookup(h, "sire_norm"),
            "damsire": _build_prior_lookup(h, "damsire_norm"),
            "consignor": _build_prior_lookup(h, "consignor_norm"),
        }
        by_year = h.groupby("year")["log_price"].agg(s="sum", c="size").reset_index().sort_values("year")
        _MARKET[cur] = (by_year["year"].to_numpy(), np.cumsum(by_year["s"].to_numpy()),
                        np.cumsum(by_year["c"].to_numpy()))
        _CAT_LEVELS[cur] = {c: list(pd.Index(h[c].dropna().unique())) for c in CATEGORICAL_FEATURES}
    return True


def _market_prior(cur: str, sale_year: int):
    years, cs, cc = _MARKET[cur]
    idx = bisect.bisect_left(years, sale_year)
    return math.nan if idx == 0 else cs[idx - 1] / cc[idx - 1]


def _feature_row(features: dict, priors: dict, cur: str) -> dict:
    sale_year = int(features.get("saleYear") or 0)
    sire_mean, sire_n = _prior(priors["sire"], normalize_entity_name(features.get("sireName")), sale_year)
    ds_mean, ds_n = _prior(priors["damsire"], normalize_entity_name(features.get("damsireName")), sale_year)
    cons_mean, cons_n = _prior(priors["consignor"], normalize_entity_name(features.get("consignorName")), sale_year)
    sess = features.get("sessionNumber")
    return {
        "sire_prior_mean": sire_mean, "sire_prior_count": sire_n,
        "damsire_prior_mean": ds_mean, "damsire_prior_count": ds_n,
        "consignor_prior_mean": cons_mean, "consignor_prior_count": cons_n,
        "market_prior_mean": _market_prior(cur, sale_year),
        "year": sale_year,
        "sessionNumber": float(sess) if sess is not None else math.nan,
        "hipNumber": float(features.get("hipNumber") or math.nan),
        "sex": features.get("sex"), "color": features.get("color"),
        "auctionHouse": features.get("auctionHouse"), "saleName": features.get("saleName"),
        "_sire_n": sire_n,
    }


def _frame(row: dict, cols: list[str], cat_levels: dict) -> pd.DataFrame:
    df = pd.DataFrame([{c: row.get(c) for c in cols}])
    for c in cols:
        if c in CATEGORICAL_FEATURES:
            df[c] = pd.Categorical(df[c], categories=cat_levels.get(c))
        else:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def _r100(cents: float) -> int:
    return int(round(cents / 100.0)) * 100


def predict(features: dict) -> dict | None:
    if not _BUNDLES:
        return None
    cur = features.get("currency") or _DEFAULT
    if cur not in _BUNDLES:
        cur = _DEFAULT if _DEFAULT in _BUNDLES else next(iter(_BUNDLES))
    bundle = _BUNDLES[cur]
    priors, cat_levels = _PRIORS[cur], _CAT_LEVELS[cur]
    q = bundle["quantiles"]

    row = _feature_row(features, priors, cur)
    pm = {qq: float(bundle["price_models"][qq].predict(_frame(row, bundle["price_cols"], cat_levels))[0]) for qq in q}
    vm = {qq: float(bundle["value_models"][qq].predict(_frame(row, bundle["value_cols"], cat_levels))[0]) for qq in q}

    pred_low, pred_high = math.exp(pm[0.25]), math.exp(pm[0.75])
    est_low, est_high = math.exp(vm[0.25]), math.exp(vm[0.75])
    support = min(1.0, row["_sire_n"] / 40.0)
    tightness = math.exp(-(pm[0.75] - pm[0.25]))
    confidence = max(0.0, min(1.0, 0.1 + 0.9 * support * tightness))

    return {
        "estValueLowCents": _r100(est_low), "estValueHighCents": _r100(est_high),
        "predPriceLowCents": _r100(pred_low), "predPriceHighCents": _r100(pred_high),
        "confidence": float(confidence),
        "modelVersion": bundle["version"],
        "limitedComparables": bool(row["_sire_n"] < 10),
    }
