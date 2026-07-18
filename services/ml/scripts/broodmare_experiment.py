"""Experiment: does a TRAINED broodmare model beat the deterministic
produce-tier model (broodmare-comparables-1.1.0, ~2.6x on Keeneland Nov 2025)?

Trains a quantile GBM on sold breeding-stock mares (Keeneland Nov 2023-2024),
holds out 2025, and reports the median error factor + band coverage — the same
metrics the app scorecard uses — so we only productionize a model that helps.

Features are leakage-safe: a mare's produce record uses only foals sold in years
STRICTLY before her sale year; entity priors likewise. Run against the prod DB:

  cd services/ml
  DATABASE_URL=<prod> .venv/bin/python scripts/broodmare_experiment.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd
import psycopg
from sklearn.ensemble import HistGradientBoostingRegressor

URL = os.environ["DATABASE_URL"].split("?", 1)[0]


def q(sql: str) -> pd.DataFrame:
    with psycopg.connect(URL) as c, c.cursor() as cur:
        cur.execute("SET max_parallel_workers_per_gather=0")
        cur.execute(sql)
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def main() -> None:
    # Sold mares (target rows).
    mares = q("""
        SELECT r."priceCents"::float8 AS price, s."year" AS year,
               yh."normalizedName" AS mare, yh."starts" AS starts,
               yh."earningsCents"::float8 AS earn,
               sire."normalizedName" AS sire, dsire."normalizedName" AS damsire
        FROM "SaleResult" r JOIN "Hip" h ON h.id=r."hipId"
        JOIN "Sale" s ON s.id=h."saleId" JOIN "Horse" yh ON yh.id=h."horseId"
        LEFT JOIN "Horse" sire ON sire.id=yh."sireId"
        LEFT JOIN "Horse" dam ON dam.id=yh."damId"
        LEFT JOIN "Horse" dsire ON dsire.id=dam."sireId"
        WHERE s.category='BREEDING_STOCK' AND r.rna=false AND r."priceCents">0
    """)
    mares["log_price"] = np.log(mares["price"])

    # Leakage-safe entity prior: mean log broodmare price for an entity over
    # STRICTLY earlier sale years. Captures sire/damsire quality — the main
    # signal for a maiden mare with no produce record.
    def prior(col: str, name: str) -> None:
        g = mares.dropna(subset=[col]).groupby([col, "year"])["log_price"].agg(s="sum", c="size").reset_index().sort_values([col, "year"])
        g["cs"] = g.groupby(col)["s"].cumsum() - g["s"]
        g["cc"] = g.groupby(col)["c"].cumsum() - g["c"]
        g[name] = np.where(g["cc"] > 0, g["cs"] / g["cc"], np.nan)
        mares[name] = mares.merge(g[[col, "year", name]], on=[col, "year"], how="left")[name].to_numpy()

    prior("sire", "sire_prior")
    prior("damsire", "damsire_prior")

    # Produce: every foal-of-a-mare yearling sale, with the sale year.
    produce = q("""
        SELECT dam."normalizedName" AS mare, fs."year" AS foal_year,
               fr."priceCents"::float8 AS foal_price
        FROM "Horse" dam
        JOIN "Horse" foal ON foal."damId"=dam.id
        JOIN "Hip" fh ON fh."horseId"=foal.id
        JOIN "SaleResult" fr ON fr."hipId"=fh.id
        JOIN "Sale" fs ON fs.id=fh."saleId"
        WHERE fs.category='YEARLING' AND fr.rna=false AND fr."priceCents">0
    """)
    produce["foal_log"] = np.log(produce["foal_price"])

    # Leakage-safe produce features per (mare, sale_year): only foals sold in
    # STRICTLY earlier years than the mare's sale.
    def produce_feats(mare: str, year: int) -> tuple[float, float, float]:
        p = produce[(produce["mare"] == mare) & (produce["foal_year"] < year)]
        if p.empty:
            return 0.0, np.nan, np.nan
        return float(len(p)), float(p["foal_log"].median()), float(p["foal_log"].max())

    feats = mares.apply(
        lambda r: produce_feats(r["mare"], r["year"]), axis=1, result_type="expand"
    )
    mares[["produce_n", "produce_med", "produce_max"]] = feats
    mares["earn_log"] = np.where(mares["earn"] > 0, np.log(mares["earn"]), np.nan)
    mares["starts"] = mares["starts"].astype("float64")

    FEATURES = ["produce_n", "produce_med", "produce_max", "starts", "earn_log",
                "sire_prior", "damsire_prior", "year"]
    train = mares[mares["year"] < 2025]
    test = mares[mares["year"] == 2025]
    print(f"train mares (<=2024): {len(train)}   holdout 2025: {len(test)}")

    def fit(alpha: float) -> HistGradientBoostingRegressor:
        m = HistGradientBoostingRegressor(
            loss="quantile", quantile=alpha, max_iter=300, learning_rate=0.05,
            max_leaf_nodes=31, min_samples_leaf=20, l2_regularization=1.0,
        )
        m.fit(train[FEATURES], train["log_price"])
        return m

    models = {a: fit(a) for a in (0.35, 0.5, 0.65)}
    pred_mid = models[0.5].predict(test[FEATURES])
    lo = models[0.35].predict(test[FEATURES])
    hi = models[0.65].predict(test[FEATURES])

    actual = test["log_price"].to_numpy()
    err_factor = np.exp(np.abs(actual - pred_mid))
    within = ((actual >= np.minimum(lo, hi)) & (actual <= np.maximum(lo, hi))).mean()
    bias = np.median(np.exp(actual) - np.exp(pred_mid)) / np.median(np.exp(pred_mid))

    print("\n=== TRAINED broodmare model — Keeneland Nov 2025 holdout ===")
    print(f"  median error factor : {np.median(err_factor):.2f}x   (deterministic baseline ~2.60x)")
    print(f"  mean  error factor  : {np.mean(err_factor):.2f}x")
    print(f"  within p35-p65 band : {within*100:.0f}%")
    print(f"  median bias         : {bias*100:+.0f}%")

    # Where produce is known vs. maidens (the split that should matter most).
    has = test["produce_n"] > 0
    print(f"\n  with produce record ({has.sum()}): {np.median(err_factor[has.to_numpy()]):.2f}x")
    print(f"  maidens/no produce ({(~has).sum()}): {np.median(err_factor[(~has).to_numpy()]):.2f}x")


if __name__ == "__main__":
    main()
