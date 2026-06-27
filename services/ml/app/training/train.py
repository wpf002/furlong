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
MODEL_VERSION = "2.1.0"

# Pedigree-only features for the intrinsic "value" model (no sale context).
VALUE_NUMERIC = ["sire_prior_mean", "sire_prior_count",
                 "damsire_prior_mean", "damsire_prior_count",
                 "dam_prior_mean", "dam_prior_count",
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
            "model_beats_baseline": bool(mmae < bmae),
            "by_house": _segment("auctionHouse", test, p50, yte, baseline),
        })

    bundle = {
        "version": version, "currency": currency,
        "price_models": price_models, "price_cols": price_cols,
        "value_models": value_models, "value_cols": value_cols,
        "quantiles": QUANTILES, "categorical_features": CATEGORICAL_FEATURES,
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
