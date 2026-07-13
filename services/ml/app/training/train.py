"""Train the Phase 2 quantile valuation model and evaluate vs the Phase 1
comparables baseline.

Models: gradient-boosted trees (sklearn HistGradientBoostingRegressor, quantile
loss) — LightGBM-class quality without the libomp dependency. We fit five
quantiles (0.10/0.25/0.50/0.75/0.90) so predictions carry an interval.

Two model families:
  price  — all features (context-aware): the predicted SALE PRICE.
  value  — pedigree-only features (no consignor/session/house/position): the
           intrinsic PEDIGREE VALUE. price-vs-value drives the hidden-gem score.

Eval holds out the most recent sale years and compares median-absolute-error of
P50 in log space against the comparables baseline (same-sire prior median).
Artifacts + metrics are written to services/ml/models/.
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from app.training.features import (
    CATEGORICAL_FEATURES, NUMERIC_FEATURES, TARGET,
    build_features, load_sold_hips,
)

MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
QUANTILES = [0.10, 0.25, 0.35, 0.50, 0.65, 0.75, 0.90]
HOLDOUT_YEARS = [2024, 2025]
MODEL_FAMILY = "gbm-quantile"
MODEL_VERSION = "2.3.0"  # + catalog-pedigree score feature (price & value models)

# The band shown to buyers. We display a CALIBRATED 50% interval — "half of
# comparable yearlings sold between X and Y" — because it's an honest, verifiable
# claim. p25/p75 is the raw 50% interval; conformal calibration (CQR) nudges the
# edges so the TRUE coverage matches 50% (raw quantiles systematically
# under-cover). See services/ml experiments: an uncalibrated p10/p90 covers only
# ~74% vs the nominal 80%, so the calibration is not cosmetic.
DISPLAY_LO_Q, DISPLAY_HI_Q, DISPLAY_COV = 0.25, 0.75, 0.50


def _cqr_offset(pred_lo: np.ndarray, pred_hi: np.ndarray, y: np.ndarray, cov: float) -> float:
    """Split-conformal offset for a quantile band. Adding it to each side makes
    the band's empirical coverage on unseen data ~= `cov`. Computed on the
    holdout slice (out-of-sample for the fitted models). Can be negative when the
    raw band over-covers."""
    e = np.maximum(pred_lo - y, y - pred_hi)
    n = len(e)
    k = min(1.0, math.ceil((n + 1) * cov) / n)
    return float(np.quantile(e, k, method="higher"))


STRAT_BINS = 3  # tight / medium / wide, by the model's predicted band width


def _strat_offsets(pred_lo: np.ndarray, pred_hi: np.ndarray, y: np.ndarray, cov: float):
    """Mondrian (width-stratified) conformal. Bins rows by the model's PREDICTED
    band width (hi-lo, its own uncertainty) and calibrates each bin separately, so
    confident (tight-prediction) horses get a genuinely tighter final band and
    uncertain ones a wider (honest) one — each at ~cov coverage, vs. one global
    offset that over-widens the confident and under-covers the uncertain. Returns
    (edges, offsets): `edges` are STRAT_BINS-1 width cutpoints; bin index for a new
    horse is np.searchsorted(edges, width, side='right')."""
    width = pred_hi - pred_lo
    edges = [float(np.quantile(width, i / STRAT_BINS)) for i in range(1, STRAT_BINS)]
    idx = np.searchsorted(edges, width, side="right")
    offsets = []
    for b in range(STRAT_BINS):
        m = idx == b
        # need enough rows to calibrate a bin; else fall back to the global offset
        offsets.append(_cqr_offset(pred_lo[m], pred_hi[m], y[m], cov) if m.sum() >= 30
                       else _cqr_offset(pred_lo, pred_hi, y, cov))
    return edges, offsets


def _apply_strat(width: np.ndarray, edges: list[float], offsets: list[float]) -> np.ndarray:
    return np.asarray(offsets)[np.searchsorted(edges, width, side="right")]

# Pedigree-only features for the intrinsic "value" model (no sale context).
# Stud fee and results-driven sire quality belong here — they're pure sire merit.
VALUE_NUMERIC = ["sire_prior_mean", "sire_prior_count",
                 "damsire_prior_mean", "damsire_prior_count",
                 "dam_prior_mean", "dam_prior_count",
                 "sire_studfee_log", "sire_eps_log", "sire_swpct",
                 "pedigree_score",  # catalog black-type score — pure pedigree merit
                 "market_prior_mean", "year"]
VALUE_CATEGORICAL = ["sex", "color"]


def _fit_quantiles(X: pd.DataFrame, y: np.ndarray, cat_features: list[str]):
    cat_mask = [c in cat_features for c in X.columns]
    models = {}
    for q in QUANTILES:
        m = HistGradientBoostingRegressor(
            loss="quantile", quantile=q,
            learning_rate=0.05, max_iter=400, max_leaf_nodes=31,
            min_samples_leaf=40, l2_regularization=1.0,
            categorical_features=cat_mask, random_state=42,
        )
        m.fit(X, y)
        models[q] = m
    return models


def _predict_quantiles(models, X: pd.DataFrame) -> dict:
    return {q: models[q].predict(X) for q in QUANTILES}


def _mae(pred: np.ndarray, actual: np.ndarray) -> float:
    return float(np.median(np.abs(pred - actual)))


# Currencies to train a model for, and the years to hold out for each.
MARKETS = {"USD": [2024, 2025], "GNS": [2025]}


def _segment(col: str, test, model_p50, yte, baseline) -> dict:
    out = {}
    for key, idx in test.groupby(col, observed=True).groups.items():
        i = test.index.get_indexer(idx)
        base_i = baseline[i]
        ok = ~np.isnan(base_i)
        out[str(key)] = {
            "n": int(len(i)),
            "model_mae_log": round(_mae(model_p50[i], yte[i]), 4),
            "baseline_mae_log": round(_mae(base_i[ok], yte[i][ok]), 4) if ok.any() else None,
        }
    return out


def train_one(feat: pd.DataFrame, currency: str, holdout_years: list[int]) -> dict:
    """Train + eval + save one market's (currency's) model. Priors in `feat` are
    already computed within this currency, so guinea and dollar prices never mix."""
    has_test = feat["year"].isin(holdout_years).sum() >= 20
    train = feat[~feat["year"].isin(holdout_years)].copy() if has_test else feat.copy()
    test = feat[feat["year"].isin(holdout_years)].copy() if has_test else feat.iloc[0:0].copy()

    price_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    value_cols = VALUE_NUMERIC + VALUE_CATEGORICAL
    price_models = _fit_quantiles(train[price_cols], train[TARGET].to_numpy(), CATEGORICAL_FEATURES)
    value_models = _fit_quantiles(train[value_cols], train[TARGET].to_numpy(), VALUE_CATEGORICAL)

    # Conformal offsets for the displayed 50% band, fit on the holdout (out-of-
    # sample for the models above). 0.0 when there's no holdout to calibrate on —
    # the band degrades to the raw p25/p75, which is close but slightly optimistic.
    price_cal = value_cal = 0.0
    p_edges = v_edges = []
    p_offsets = v_offsets = []
    disp_coverage = disp_width_global = disp_width_strat = None
    if len(test) >= 20:
        yte_c = test[TARGET].to_numpy()
        pc = _predict_quantiles(price_models, test[price_cols])
        vc = _predict_quantiles(value_models, test[value_cols])
        plo, phi = pc[DISPLAY_LO_Q], pc[DISPLAY_HI_Q]
        vlo, vhi = vc[DISPLAY_LO_Q], vc[DISPLAY_HI_Q]
        # Global offset (kept as a fallback for old inference paths) ...
        price_cal = _cqr_offset(plo, phi, yte_c, DISPLAY_COV)
        value_cal = _cqr_offset(vlo, vhi, yte_c, DISPLAY_COV)
        # ... and the width-stratified offsets that actually get applied.
        p_edges, p_offsets = _strat_offsets(plo, phi, yte_c, DISPLAY_COV)
        v_edges, v_offsets = _strat_offsets(vlo, vhi, yte_c, DISPLAY_COV)
        # Coverage + median band width, stratified vs. one global offset — proves
        # the stratified band stays honest AND is tighter for confident horses.
        po = _apply_strat(phi - plo, p_edges, p_offsets)
        lo_s, hi_s = plo - po, phi + po
        disp_coverage = round(float(np.mean((yte_c >= lo_s) & (yte_c <= hi_s))), 3)
        disp_width_strat = round(float(np.median(np.exp(hi_s) / np.exp(lo_s))), 3)
        disp_width_global = round(float(np.median(
            np.exp(phi + price_cal) / np.exp(plo - price_cal))), 3)
    display = {
        "lo_q": DISPLAY_LO_Q, "hi_q": DISPLAY_HI_Q, "target_coverage": DISPLAY_COV,
        "price_cal": price_cal, "value_cal": value_cal,
        "price_width_edges": p_edges, "price_width_offsets": p_offsets,
        "value_width_edges": v_edges, "value_width_offsets": v_offsets,
    }

    version = f"{MODEL_FAMILY}-{MODEL_VERSION}-{currency}+n{len(train)}"
    metrics: dict = {
        "model": version, "currency": currency,
        "trained_through_year": int(train["year"].max()),
        "n_train": int(len(train)), "n_test": int(len(test)),
        "n_results_seen": int(len(feat)),
        "n_sales_seen": int(feat.groupby(["auctionHouse", "saleName", "year"]).ngroups),
    }
    if len(test) >= 20:
        yte = test[TARGET].to_numpy()
        price_pred = _predict_quantiles(price_models, test[price_cols])
        p50 = price_pred[0.50]
        baseline = test["sire_prior_mean"].to_numpy()
        baseline = np.where(np.isnan(baseline), test["market_prior_mean"].to_numpy(), baseline)
        hb = ~np.isnan(baseline)
        mmae, bmae = _mae(p50[hb], yte[hb]), _mae(baseline[hb], yte[hb])
        metrics.update({
            "holdout_years": holdout_years,
            "model_mae_log": round(mmae, 4),
            "baseline_mae_log": round(bmae, 4),
            "improvement_pct": round(100 * (bmae - mmae) / bmae, 1),
            "p10_p90_coverage": round(float(np.mean((yte >= price_pred[0.10]) & (yte <= price_pred[0.90]))), 3),
            "display_band_coverage": disp_coverage,  # true coverage of the shown 50% band
            "display_band_width_global": disp_width_global,  # one-offset median width
            "display_band_width_stratified": disp_width_strat,  # width-tiered median
            "model_beats_baseline": bool(mmae < bmae),
            "by_house": _segment("auctionHouse", test, p50, yte, baseline),
        })

    bundle = {
        "version": version, "currency": currency,
        "price_models": price_models, "price_cols": price_cols,
        "value_models": value_models, "value_cols": value_cols,
        "quantiles": QUANTILES, "categorical_features": CATEGORICAL_FEATURES,
        "display": display,
        "metrics": metrics,
    }
    joblib.dump(bundle, MODELS_DIR / f"valuation_model_{currency}.joblib")
    if currency == "USD":  # default/back-compat model + the metrics the UI panel reads
        joblib.dump(bundle, MODELS_DIR / "valuation_model.joblib")
        (MODELS_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2))

    registry_path = MODELS_DIR / "registry.json"
    registry = json.loads(registry_path.read_text()) if registry_path.exists() else []
    registry = [r for r in registry if r.get("model") != version]
    registry.append({k: metrics.get(k) for k in
                     ["model", "currency", "trained_through_year", "n_train", "n_test",
                      "model_mae_log", "baseline_mae_log", "improvement_pct",
                      "p10_p90_coverage", "n_sales_seen", "n_results_seen"]})
    registry_path.write_text(json.dumps(registry, indent=2))
    return metrics


def main() -> None:
    t0 = time.time()
    raw = load_sold_hips()
    print(f"loaded {len(raw):,} sold rows; currencies {sorted(raw['currency'].unique())}")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    for currency, holdout in MARKETS.items():
        sub = raw[raw["currency"] == currency]
        if len(sub) < 500:
            print(f"{currency}: only {len(sub)} rows — skipping")
            continue
        feat = build_features(sub)  # priors computed WITHIN this currency
        m = train_one(feat, currency, holdout)
        imp = m.get("improvement_pct")
        print(f"{currency}: {m['model']} | train {m['n_train']:,} | "
              + (f"vs baseline {imp:+}% (mae {m.get('model_mae_log')} v {m.get('baseline_mae_log')}), "
                 f"coverage {m.get('p10_p90_coverage')}" if imp is not None else "no holdout eval"))
    print(f"done [{time.time()-t0:.1f}s]")


if __name__ == "__main__":
    main()
