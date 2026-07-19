"""Out-of-fold broodmare valuations for the historical November sales, so the
Track Record reflects the trained model HONESTLY (not in-sample).

For each completed Nov sale year Y, the model is trained only on mares sold in
STRICTLY earlier years, then predicts year Y — the same protocol as the held-out
experiment (~2.07x). Writes a Valuation per sold mare hip. The live model bundle
(trained on all years) still values FUTURE sales out-of-sample; this is only to
score the past honestly.

  cd services/ml
  DATABASE_URL=<prod> .venv/bin/python scripts/value_broodmare_oof.py [--dry-run]
"""
from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

import numpy as np
import psycopg
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.valuation.broodmare_model import (  # noqa: E402
    FEATURES, QUANTILES, _attach_features, _load_mares, _produce_table, _url,
)

DRY = "--dry-run" in sys.argv


def main() -> None:
    sold = _load_mares(only_sold=True)
    sold["log_price"] = np.log(sold["price"])
    produce = _produce_table()
    feat_all = _attach_features(sold, sold, produce)
    feat_all["log_price"] = sold["log_price"].to_numpy()

    years = sorted(int(y) for y in feat_all["year"].unique())
    with psycopg.connect(_url()) as c, c.cursor() as cur:
        for y in years:
            tr = feat_all[feat_all["year"] < y]
            te = feat_all[feat_all["year"] == y]
            if len(tr) < 200 or te.empty:
                print(f"  {y}: too little earlier data ({len(tr)}) — skip")
                continue
            models = {}
            for a in QUANTILES:
                m = HistGradientBoostingRegressor(loss="quantile", quantile=a, max_iter=300,
                                                  learning_rate=0.05, max_leaf_nodes=31,
                                                  min_samples_leaf=20, l2_regularization=1.0)
                m.fit(tr[FEATURES], tr["log_price"])
                models[a] = m
            preds = {a: np.exp(models[a].predict(te[FEATURES])) for a in QUANTILES}
            err = float(np.median(np.exp(np.abs(te["log_price"].to_numpy() - np.log(preds[0.5])))))
            print(f"  {y}: OOF median error {err:.2f}x over {len(te)} mares")
            if DRY:
                continue
            for i, hip_id in enumerate(te["hip_id"].to_numpy()):
                lo, hi = int(round(preds[0.35][i])), int(round(preds[0.65][i]))
                elo, ehi = int(round(preds[0.25][i])), int(round(preds[0.75][i]))
                pn, inf = te["produce_n"].to_numpy()[i], te["in_foal"].to_numpy()[i]
                conf = min(0.9, 0.3 + 0.12 * min(pn, 3) + (0.15 if inf else 0.0))
                cur.execute(
                    '''INSERT INTO "Valuation"
                       ("id","hipId","estValueLowCents","estValueHighCents",
                        "predPriceLowCents","predPriceHighCents","confidence",
                        "limitedComparables","modelVersion","createdAt")
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())''',
                    (secrets.token_hex(12), str(hip_id), elo, ehi, lo, hi,
                     round(float(conf), 3), bool(pn == 0 and not inf), "broodmare-gbm-1.0.0"),
                )
        if not DRY:
            c.commit()
    print("[dry run] nothing written" if DRY else "done")


if __name__ == "__main__":
    main()
