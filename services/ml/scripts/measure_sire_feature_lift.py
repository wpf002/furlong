"""Measure the model lift from the licensed sire-stats features — the ROI number
that justifies (or doesn't) paying for a feed.

Trains the P50 price model on the temporal holdout split WITH and WITHOUT the
sire-stats features (sire_studfee_log, sire_eps_log, sire_swpct) and reports the
change in holdout median error. Also reports how much of the holdout those
features are even populated for — a feed that covers few sires can't help much.

With an empty SireStats table the features are all-NaN, so the lift is ~0 by
construction; the point is to RE-RUN this after loading a trial feed
(scripts/evaluate_sire_stats_feed.py --commit) to see the real delta.

  cd services/ml && .venv/bin/python scripts/measure_sire_feature_lift.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.training.features import (  # noqa: E402
    CATEGORICAL_FEATURES, NUMERIC_FEATURES, TARGET, build_features, load_sold_hips,
)

SIRE_FEATURES = ["sire_studfee_log", "sire_eps_log", "sire_swpct"]
HOLDOUT = [2023, 2024, 2025]


def fit_p50(X, y, cats):
    m = HistGradientBoostingRegressor(
        loss="quantile", quantile=0.50, learning_rate=0.05, max_iter=400,
        max_leaf_nodes=31, min_samples_leaf=40, l2_regularization=1.0,
        categorical_features=[c in cats for c in X.columns], random_state=42)
    return m.fit(X, y)


def mae(p, a):
    return float(np.median(np.abs(p - a)))


def main():
    raw = load_sold_hips()
    feat = build_features(raw[raw.currency == "USD"].copy())
    tr = feat[~feat.year.isin(HOLDOUT)]
    te = feat[feat.year.isin(HOLDOUT)]
    yte = te[TARGET].to_numpy()

    pop = {f: float(te[f].notna().mean()) for f in SIRE_FEATURES}
    print(f"USD: train {len(tr):,}  holdout {len(te):,} ({HOLDOUT})")
    print("sire-feature coverage on holdout (0% => no feed loaded yet):")
    for f, p in pop.items():
        print(f"  {f:<18} {p*100:5.1f}%")

    base_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    without_cols = [c for c in base_cols if c not in SIRE_FEATURES]

    m_with = fit_p50(tr[base_cols], tr[TARGET].to_numpy(), CATEGORICAL_FEATURES)
    m_without = fit_p50(tr[without_cols], tr[TARGET].to_numpy(), CATEGORICAL_FEATURES)
    mae_with = mae(m_with.predict(te[base_cols]), yte)
    mae_without = mae(m_without.predict(te[without_cols]), yte)

    print(f"\nHOLDOUT median error (log):")
    print(f"  without sire features : {mae_without:.4f}  ({np.exp(mae_without):.3f}x)")
    print(f"  with sire features    : {mae_with:.4f}  ({np.exp(mae_with):.3f}x)")
    delta = (mae_without - mae_with) / mae_without * 100
    print(f"  lift                  : {delta:+.2f}%  (positive = the feed helps)")
    if max(pop.values()) == 0:
        print("\n  (all sire features are empty — load a trial feed, then re-run to see real lift)")


if __name__ == "__main__":
    main()
