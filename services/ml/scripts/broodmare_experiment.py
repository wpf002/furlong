"""Experiment: does a TRAINED broodmare model beat the deterministic
produce-tier model (broodmare-comparables-1.1.0, ~2.6x on Keeneland Nov 2025)?

Trains a quantile GBM on sold breeding-stock mares (Keeneland Nov 2023-2024),
holds out 2025, and reports the median error factor + band coverage — the same
metrics the app scorecard uses — so we only productionize a model that helps.

Features are leakage-safe. Adds the covering-sire / in-foal signal pulled live
from the Keeneland feed (the biggest gap: a maiden mare in foal to a top sire is
a different proposition than the flat "no produce" bucket).

  cd services/ml
  DATABASE_URL=<prod> .venv/bin/python scripts/broodmare_experiment.py
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

import numpy as np
import pandas as pd
import psycopg
from sklearn.ensemble import HistGradientBoostingRegressor

URL = os.environ["DATABASE_URL"].split("?", 1)[0]
FLEX = "https://flex.keeneland.com/misc/GenerateJson.do"
# Keeneland Nov Breeding Stock sale ids by our DB sale year.
KEE_NOV = {2023: "202403", 2024: "202503", 2025: "202603"}


def norm(name: str | None) -> str | None:
    if not name:
        return None
    s = re.sub(r"\s*\([A-Za-z]{2,3}\)\s*$", "", name.strip()).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[.,'`’]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip() or None


def q(sql: str) -> pd.DataFrame:
    with psycopg.connect(URL) as c, c.cursor() as cur:
        cur.execute("SET max_parallel_workers_per_gather=0")
        cur.execute(sql)
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def fetch_covering() -> dict:
    """{(year, normalized mare name): covering sire (raw)} from the Keeneland feed."""
    out: dict[tuple[int, str], str] = {}
    for year, sid in KEE_NOV.items():
        for session in range(1, 8):
            url = f"{FLEX}?actionName=SalesSummary&paramNames=sale_id%5E%21%5Esession&paramValues={sid}%5E%21%5E{session}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest"})
            try:
                rows = json.load(urllib.request.urlopen(req, timeout=60))
            except Exception:
                continue
            rows = rows if isinstance(rows, list) else rows.get("results", [])
            if not rows:
                continue
            for r in rows:
                nn = norm(r.get("Name"))
                if nn:
                    out[(year, nn)] = (r.get("CoveringSire") or "").strip()
    return out


def main() -> None:
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

    # Covering sire / in-foal from the Keeneland feed, joined by (year, name).
    cover = fetch_covering()
    mares["cover"] = mares.apply(lambda r: norm(cover.get((r["year"], r["mare"]), "")), axis=1)
    mares["in_foal"] = mares["cover"].notna().astype(float)
    matched = sum((r["year"], r["mare"]) in cover for _, r in mares.iterrows())
    print(f"covering-sire feed rows: {len(cover)}   mares matched to feed: {matched}/{len(mares)}   in foal: {int(mares['in_foal'].sum())}")

    # Leakage-safe entity prior: mean log broodmare price for an entity over
    # STRICTLY earlier sale years.
    def prior(col: str, name: str) -> None:
        g = mares.dropna(subset=[col]).groupby([col, "year"])["log_price"].agg(s="sum", c="size").reset_index().sort_values([col, "year"])
        g["cs"] = g.groupby(col)["s"].cumsum() - g["s"]
        g["cc"] = g.groupby(col)["c"].cumsum() - g["c"]
        g[name] = np.where(g["cc"] > 0, g["cs"] / g["cc"], np.nan)
        mares[name] = mares.merge(g[[col, "year", name]], on=[col, "year"], how="left")[name].to_numpy()

    prior("sire", "sire_prior")
    prior("damsire", "damsire_prior")
    prior("cover", "cover_prior")  # covering-sire quality — the new signal

    # Produce record (leakage-safe: foals sold in STRICTLY earlier years).
    produce = q("""
        SELECT dam."normalizedName" AS mare, fs."year" AS foal_year,
               fr."priceCents"::float8 AS foal_price
        FROM "Horse" dam JOIN "Horse" foal ON foal."damId"=dam.id
        JOIN "Hip" fh ON fh."horseId"=foal.id JOIN "SaleResult" fr ON fr."hipId"=fh.id
        JOIN "Sale" fs ON fs.id=fh."saleId"
        WHERE fs.category='YEARLING' AND fr.rna=false AND fr."priceCents">0
    """)
    produce["foal_log"] = np.log(produce["foal_price"])

    def produce_feats(mare: str, year: int) -> tuple[float, float, float]:
        p = produce[(produce["mare"] == mare) & (produce["foal_year"] < year)]
        if p.empty:
            return 0.0, np.nan, np.nan
        return float(len(p)), float(p["foal_log"].median()), float(p["foal_log"].max())

    feats = mares.apply(lambda r: produce_feats(r["mare"], r["year"]), axis=1, result_type="expand")
    mares[["produce_n", "produce_med", "produce_max"]] = feats
    mares["earn_log"] = np.where(mares["earn"] > 0, np.log(mares["earn"]), np.nan)
    mares["starts"] = mares["starts"].astype("float64")

    FEATURES = ["produce_n", "produce_med", "produce_max", "starts", "earn_log",
                "sire_prior", "damsire_prior", "in_foal", "cover_prior", "year"]
    train = mares[mares["year"] < 2025]
    test = mares[mares["year"] == 2025]
    print(f"train mares (<=2024): {len(train)}   holdout 2025: {len(test)}")

    def fit(alpha: float) -> HistGradientBoostingRegressor:
        m = HistGradientBoostingRegressor(loss="quantile", quantile=alpha, max_iter=300,
                                          learning_rate=0.05, max_leaf_nodes=31,
                                          min_samples_leaf=20, l2_regularization=1.0)
        m.fit(train[FEATURES], train["log_price"])
        return m

    models = {a: fit(a) for a in (0.35, 0.5, 0.65)}
    pred_mid = models[0.5].predict(test[FEATURES])
    lo, hi = models[0.35].predict(test[FEATURES]), models[0.65].predict(test[FEATURES])
    actual = test["log_price"].to_numpy()
    err = np.exp(np.abs(actual - pred_mid))
    within = ((actual >= np.minimum(lo, hi)) & (actual <= np.maximum(lo, hi))).mean()

    print("\n=== TRAINED broodmare model + covering-sire — Keeneland Nov 2025 holdout ===")
    print(f"  median error factor : {np.median(err):.2f}x   (deterministic baseline ~2.60x)")
    print(f"  within p35-p65 band : {within*100:.0f}%")
    inf = test["in_foal"] == 1
    print(f"  in foal ({int(inf.sum())}): {np.median(err[inf.to_numpy()]):.2f}x   "
          f"barren/maiden ({int((~inf).sum())}): {np.median(err[(~inf).to_numpy()]):.2f}x")


if __name__ == "__main__":
    main()
