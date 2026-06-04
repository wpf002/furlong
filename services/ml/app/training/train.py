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
QUANTILES = [0.10, 0.25, 0.50, 0.75, 0.90]
HOLDOUT_YEARS = [2024, 2025]
MODEL_FAMILY = "gbm-quantile"
MODEL_VERSION = "2.0.0"

# Pedigree-only features for the intrinsic "value" model (no sale context).
VALUE_NUMERIC = ["sire_prior_mean", "sire_prior_count",
                 "damsire_prior_mean", "damsire_prior_count",
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


def main() -> None:
    t0 = time.time()
    raw = load_sold_hips()
    feat = build_features(raw)
    print(f"loaded {len(feat):,} sold rows ({feat['year'].min()}-{feat['year'].max()})")

    train = feat[~feat["year"].isin(HOLDOUT_YEARS)].copy()
    test = feat[feat["year"].isin(HOLDOUT_YEARS)].copy()
    print(f"train {len(train):,} | test {len(test):,} (holdout {HOLDOUT_YEARS})")

    # ---- price model (context-aware) ----
    price_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    price_models = _fit_quantiles(train[price_cols], train[TARGET].to_numpy(), CATEGORICAL_FEATURES)

    # ---- value model (pedigree only) ----
    value_cols = VALUE_NUMERIC + VALUE_CATEGORICAL
    value_models = _fit_quantiles(train[value_cols], train[TARGET].to_numpy(), VALUE_CATEGORICAL)

    # ---- evaluation on holdout ----
    yte = test[TARGET].to_numpy()
    price_pred = _predict_quantiles(price_models, test[price_cols])
    model_p50 = price_pred[0.50]

    # baseline: comparables = same-sire prior mean (fallback to market prior)
    baseline = test["sire_prior_mean"].to_numpy()
    mkt = test["market_prior_mean"].to_numpy()
    baseline = np.where(np.isnan(baseline), mkt, baseline)
    have_baseline = ~np.isnan(baseline)

    model_mae = _mae(model_p50[have_baseline], yte[have_baseline])
    base_mae = _mae(baseline[have_baseline], yte[have_baseline])
    # interval coverage (P10-P90 should cover ~80%)
    covered = (yte >= price_pred[0.10]) & (yte <= price_pred[0.90])
    coverage = float(np.mean(covered))

    # error by segment — house and sale (where the model is weak/strong)
    def _segment(col: str) -> dict:
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

    seg = _segment("auctionHouse")

    # data fingerprint so each retrain on fresh data yields a distinct version
    version = f"{MODEL_FAMILY}-{MODEL_VERSION}+n{len(train)}"

    metrics = {
        "model": version,
        "trained_through_year": int(train["year"].max()),
        "n_train": int(len(train)), "n_test": int(len(test)),
        "holdout_years": HOLDOUT_YEARS,
        "model_mae_log": round(model_mae, 4),
        "baseline_mae_log": round(base_mae, 4),
        "improvement_pct": round(100 * (base_mae - model_mae) / base_mae, 1),
        "p10_p90_coverage": round(coverage, 3),
        "by_house": seg,
        "by_sale": _segment("saleName"),
        "n_sales_seen": int(feat.groupby(["auctionHouse", "saleName", "year"]).ngroups),
        "n_results_seen": int(len(feat)),
        "model_beats_baseline": bool(model_mae < base_mae),
    }
    print(json.dumps({k: metrics[k] for k in
                      ["model", "model_mae_log", "baseline_mae_log", "improvement_pct",
                       "p10_p90_coverage", "model_beats_baseline"]}, indent=2))

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    bundle = {
        "version": version,
        "price_models": price_models, "price_cols": price_cols,
        "value_models": value_models, "value_cols": value_cols,
        "quantiles": QUANTILES,
        "categorical_features": CATEGORICAL_FEATURES,
        "metrics": metrics,
    }
    # Registry: keep every version, never overwrite; "current" points to latest.
    joblib.dump(bundle, MODELS_DIR / f"valuation_model_{version}.joblib")
    joblib.dump(bundle, MODELS_DIR / "valuation_model.joblib")
    (MODELS_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2))
    registry_path = MODELS_DIR / "registry.json"
    registry = json.loads(registry_path.read_text()) if registry_path.exists() else []
    registry = [r for r in registry if r.get("version") != version]  # idempotent
    registry.append({k: metrics[k] for k in
                     ["model", "trained_through_year", "n_train", "n_test",
                      "model_mae_log", "baseline_mae_log", "improvement_pct",
                      "p10_p90_coverage", "n_sales_seen", "n_results_seen"]})
    registry_path.write_text(json.dumps(registry, indent=2))
    print(f"saved model {version} (+registry, {len(registry)} versions) to {MODELS_DIR}  [{time.time()-t0:.1f}s]")


if __name__ == "__main__":
    main()
