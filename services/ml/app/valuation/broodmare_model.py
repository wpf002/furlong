"""Trained broodmare model (quantile GBM).

Replaces the deterministic produce-tier model for BREEDING_STOCK sales. The
decisive feature is covering-sire / in-foal (Hip.coveringSire) — validated to
drop held-out error from ~2.6x (deterministic) to ~2.1x. Features are all
leakage-safe: a mare's produce record and every entity prior use only sales in
STRICTLY earlier years than the mare's own sale.

  train_broodmare()        -> fit + save models/broodmare_model.joblib, return metrics
  predict_sale(sale_id)    -> {hipId: {predLow, predHigh, estLow, estHigh, confidence}}
"""
from __future__ import annotations

import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import psycopg
from sklearn.ensemble import HistGradientBoostingRegressor

MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "models" / "broodmare_model.joblib"
MODEL_VERSION = "broodmare-gbm-1.0.0"
FEATURES = ["produce_n", "produce_med", "produce_max", "starts", "earn_log",
            "sire_prior", "damsire_prior", "in_foal", "cover_prior", "year"]
QUANTILES = [0.1, 0.25, 0.35, 0.5, 0.65, 0.75, 0.9]


def _url() -> str:
    from app.training.features import _database_url
    return _database_url()


def _q(sql: str) -> pd.DataFrame:
    with psycopg.connect(_url()) as c, c.cursor() as cur:
        cur.execute("SET max_parallel_workers_per_gather=0")
        cur.execute(sql)
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def _norm(s: pd.Series) -> pd.Series:
    return (
        s.fillna("").str.strip().str.lower()
        .str.replace(r"\s*\([a-z]{2,3}\)\s*$", "", regex=True)
        .str.replace("&", " and ", regex=False)
        .str.replace(r"[.,'`’]", "", regex=True)
        .str.replace(r"[^a-z0-9]+", " ", regex=True)
        .str.replace(r"\s+", " ", regex=True).str.strip().replace("", np.nan)
    )


def _load_mares(only_sold: bool) -> pd.DataFrame:
    """All breeding-stock mares (sold, for training) or every hip of a sale's
    mares (for inference). Covering sire from Hip.coveringSire."""
    price = 'r."priceCents"::float8' if only_sold else "NULL::float8"
    join = "JOIN" if only_sold else "LEFT JOIN"
    cond = 'AND r.rna=false AND r."priceCents">0' if only_sold else ""
    df = _q(f"""
        SELECT h."id" AS hip_id, {price} AS price, s."year" AS year, s."id" AS sale_id,
               yh."normalizedName" AS mare, yh."starts" AS starts,
               yh."earningsCents"::float8 AS earn,
               sire."normalizedName" AS sire, dsire."normalizedName" AS damsire,
               h."coveringSire" AS cover_raw
        FROM "Hip" h JOIN "Sale" s ON s.id=h."saleId"
        JOIN "Horse" yh ON yh.id=h."horseId"
        LEFT JOIN "Horse" sire ON sire.id=yh."sireId"
        LEFT JOIN "Horse" dam ON dam.id=yh."damId"
        LEFT JOIN "Horse" dsire ON dsire.id=dam."sireId"
        {join} "SaleResult" r ON r."hipId"=h.id
        WHERE s.category='BREEDING_STOCK' {cond}
    """)
    df["cover"] = _norm(df["cover_raw"])
    df["in_foal"] = df["cover"].notna().astype(float)
    df["earn_log"] = np.where(df["earn"].fillna(0) > 0, np.log(df["earn"].fillna(1)), np.nan)
    df["starts"] = df["starts"].astype("float64")
    return df


def _priors(sold: pd.DataFrame) -> dict[str, dict]:
    """Leakage-safe entity prior tables (mean log broodmare price by entity over
    STRICTLY earlier years), built from the SOLD mares. Returned as {year: mean}
    per entity so inference can look up as-of a sale year."""
    sold = sold.copy()
    sold["log_price"] = np.log(sold["price"])
    tables: dict[str, dict] = {}
    for col in ("sire", "damsire", "cover"):
        g = sold.dropna(subset=[col]).groupby([col, "year"])["log_price"].agg(s="sum", c="size").reset_index().sort_values([col, "year"])
        g["cs"] = g.groupby(col)["s"].cumsum() - g["s"]
        g["cc"] = g.groupby(col)["c"].cumsum() - g["c"]
        g["prior"] = np.where(g["cc"] > 0, g["cs"] / g["cc"], np.nan)
        tables[col] = {(r[col], int(r["year"])): r["prior"] for _, r in g.iterrows()}
    return tables


def _produce_table() -> pd.DataFrame:
    p = _q("""
        SELECT dam."normalizedName" AS mare, fs."year" AS foal_year,
               fr."priceCents"::float8 AS foal_price
        FROM "Horse" dam JOIN "Horse" foal ON foal."damId"=dam.id
        JOIN "Hip" fh ON fh."horseId"=foal.id JOIN "SaleResult" fr ON fr."hipId"=fh.id
        JOIN "Sale" fs ON fs.id=fh."saleId"
        WHERE fs.category='YEARLING' AND fr.rna=false AND fr."priceCents">0
    """)
    p["foal_log"] = np.log(p["foal_price"])
    return p


def _attach_features(df: pd.DataFrame, sold: pd.DataFrame, produce: pd.DataFrame) -> pd.DataFrame:
    priors = _priors(sold)

    def prior_asof(table: dict, key, year: int) -> float:
        if key is None or (isinstance(key, float) and np.isnan(key)):
            return np.nan
        best = np.nan
        for (k, y), v in table.items():  # small tables; linear scan is fine
            if k == key and y <= year and not np.isnan(v):
                best = v
        return best

    df = df.copy()
    df["sire_prior"] = [prior_asof(priors["sire"], k, y) for k, y in zip(df["sire"], df["year"])]
    df["damsire_prior"] = [prior_asof(priors["damsire"], k, y) for k, y in zip(df["damsire"], df["year"])]
    df["cover_prior"] = [prior_asof(priors["cover"], k, y) for k, y in zip(df["cover"], df["year"])]

    # Produce (leakage-safe: foals sold strictly before the mare's sale year).
    pn, pm, px = [], [], []
    by_mare = {m: g for m, g in produce.groupby("mare")}
    for mare, year in zip(df["mare"], df["year"]):
        g = by_mare.get(mare)
        if g is None:
            pn.append(0.0); pm.append(np.nan); px.append(np.nan); continue
        gg = g[g["foal_year"] < year]
        if gg.empty:
            pn.append(0.0); pm.append(np.nan); px.append(np.nan)
        else:
            pn.append(float(len(gg))); pm.append(float(gg["foal_log"].median())); px.append(float(gg["foal_log"].max()))
    df["produce_n"], df["produce_med"], df["produce_max"] = pn, pm, px
    return df


def train_broodmare() -> dict:
    sold = _load_mares(only_sold=True)
    produce = _produce_table()
    feat = _attach_features(sold, sold, produce)
    feat["log_price"] = np.log(feat["price"])

    models = {}
    for a in QUANTILES:
        m = HistGradientBoostingRegressor(loss="quantile", quantile=a, max_iter=300,
                                          learning_rate=0.05, max_leaf_nodes=31,
                                          min_samples_leaf=20, l2_regularization=1.0)
        m.fit(feat[FEATURES], feat["log_price"])
        models[a] = m

    # Held-out sanity: train<=maxyear-1, test on the latest year.
    maxy = int(feat["year"].max())
    tr, te = feat[feat["year"] < maxy], feat[feat["year"] == maxy]
    err = np.nan
    if len(te) and len(tr):
        mm = HistGradientBoostingRegressor(loss="quantile", quantile=0.5, max_iter=300,
                                           learning_rate=0.05, max_leaf_nodes=31,
                                           min_samples_leaf=20, l2_regularization=1.0)
        mm.fit(tr[FEATURES], tr["log_price"])
        pred = mm.predict(te[FEATURES])
        err = float(np.median(np.exp(np.abs(te["log_price"].to_numpy() - pred))))

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"models": models, "features": FEATURES, "version": MODEL_VERSION}, MODEL_PATH)
    return {"modelVersion": MODEL_VERSION, "n_train": int(len(feat)),
            "holdout_year": maxy, "holdout_median_error_factor": err}


def _load_bundle() -> dict | None:
    if not MODEL_PATH.exists():
        return None
    return joblib.load(MODEL_PATH)


def predict_sale(sale_id: str) -> dict:
    """Predict a sale-price band per mare hip. Returns {hipId: {...cents, confidence}}."""
    bundle = _load_bundle()
    if not bundle:
        return {}
    sold = _load_mares(only_sold=True)  # for priors + produce context
    produce = _produce_table()
    hips = _load_mares(only_sold=False)
    hips = hips[hips["sale_id"] == sale_id]
    if hips.empty:
        return {}
    # Use the sale's own year for as-of features.
    feat = _attach_features(hips, sold, produce)
    models = bundle["models"]
    preds = {a: np.exp(models[a].predict(feat[FEATURES])) for a in QUANTILES}

    out: dict[str, dict] = {}
    for i, hip_id in enumerate(feat["hip_id"].to_numpy()):
        lo, hi = float(preds[0.35][i]), float(preds[0.65][i])
        elo, ehi = float(preds[0.25][i]), float(preds[0.75][i])
        # Confidence: produce record + known in-foal status lift it.
        pn = feat["produce_n"].to_numpy()[i]
        inf = feat["in_foal"].to_numpy()[i]
        conf = min(0.9, 0.3 + 0.12 * min(pn, 3) + (0.15 if inf else 0.0))
        out[str(hip_id)] = {
            "predLowCents": int(round(lo)), "predHighCents": int(round(hi)),
            "estLowCents": int(round(elo)), "estHighCents": int(round(ehi)),
            "confidence": round(float(conf), 3),
            "limitedComparables": bool(pn == 0 and not inf),
        }
    return out
