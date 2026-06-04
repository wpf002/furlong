"""Feature engineering for the Phase 2 valuation model.

Pulls every SOLD hip from Postgres and builds a leakage-safe feature table:
entity (sire / damsire / consignor) price priors are computed strictly from
PRIOR sale years, so a row never sees its own year's outcomes. High-cardinality
entities (3k+ sires) are encoded by these prior-mean stats rather than one-hot;
low-cardinality fields (sex, color, house, sale) stay native categoricals.

Target is log(price in cents). All money stays integer cents upstream; we only
take logs here for modeling.
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv

# Columns the model consumes.
NUMERIC_FEATURES = [
    "sire_prior_mean", "sire_prior_count",
    "damsire_prior_mean", "damsire_prior_count",
    "consignor_prior_mean", "consignor_prior_count",
    "market_prior_mean",
    "year", "sessionNumber", "hipNumber",
]
CATEGORICAL_FEATURES = ["sex", "color", "auctionHouse", "saleName"]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES
TARGET = "log_price"


def _database_url() -> str:
    # features.py -> training -> app -> ml -> services -> <repo root>
    load_dotenv(Path(__file__).resolve().parents[4] / ".env")
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    return url.split("?", 1)[0]


def load_sold_hips() -> pd.DataFrame:
    """One row per sold hip with raw attributes (no priors yet)."""
    import psycopg

    query = """
        SELECT r."priceCents"::float8       AS price_cents,
               s."year"                      AS year,
               s."currency"                  AS currency,
               s."auctionHouse"             AS "auctionHouse",
               s."name"                      AS "saleName",
               h."sessionNumber"            AS "sessionNumber",
               h."hipNumber"                AS "hipNumber",
               yh."sex"                      AS sex,
               yh."color"                    AS color,
               sire."normalizedName"        AS sire_norm,
               dsire."normalizedName"       AS damsire_norm,
               cons."normalizedName"        AS consignor_norm
        FROM "SaleResult" r
        JOIN "Hip" h        ON h."id" = r."hipId"
        JOIN "Sale" s       ON s."id" = h."saleId"
        JOIN "Horse" yh     ON yh."id" = h."horseId"
        LEFT JOIN "Horse" sire  ON sire."id" = yh."sireId"
        LEFT JOIN "Horse" dam   ON dam."id" = yh."damId"
        LEFT JOIN "Horse" dsire ON dsire."id" = dam."sireId"
        LEFT JOIN "Consignor" cons ON cons."id" = h."consignorId"
        WHERE r."rna" = false AND r."priceCents" IS NOT NULL AND r."priceCents" > 0
    """
    with psycopg.connect(_database_url()) as conn, conn.cursor() as cur:
        cur.execute(query)
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=cols)
    df["price_cents"] = df["price_cents"].astype("float64")
    df["log_price"] = np.log(df["price_cents"])
    return df


def _prior_stats(df: pd.DataFrame, key: str, prefix: str) -> pd.DataFrame:
    """For each (key, year), the mean/count of log_price over STRICTLY earlier
    years for that key. Leakage-safe (current year fully excluded)."""
    grp = (
        df.dropna(subset=[key])
        .groupby([key, "year"])["log_price"]
        .agg(s="sum", c="size")
        .reset_index()
        .sort_values([key, "year"])
    )
    grp["cum_s"] = grp.groupby(key)["s"].cumsum() - grp["s"]
    grp["cum_c"] = grp.groupby(key)["c"].cumsum() - grp["c"]
    grp[f"{prefix}_prior_mean"] = np.where(grp["cum_c"] > 0, grp["cum_s"] / grp["cum_c"], np.nan)
    grp[f"{prefix}_prior_count"] = grp["cum_c"]
    return grp[[key, "year", f"{prefix}_prior_mean", f"{prefix}_prior_count"]]


def _market_prior(df: pd.DataFrame) -> pd.DataFrame:
    """Overall mean log_price over strictly-earlier years (market level / trend)."""
    by_year = df.groupby("year")["log_price"].agg(s="sum", c="size").reset_index().sort_values("year")
    by_year["cum_s"] = by_year["s"].cumsum() - by_year["s"]
    by_year["cum_c"] = by_year["c"].cumsum() - by_year["c"]
    by_year["market_prior_mean"] = np.where(by_year["cum_c"] > 0, by_year["cum_s"] / by_year["cum_c"], np.nan)
    return by_year[["year", "market_prior_mean"]]


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Attach leakage-safe priors and finalize feature dtypes."""
    out = df.copy()
    out = out.merge(_prior_stats(df, "sire_norm", "sire"), on=["sire_norm", "year"], how="left")
    out = out.merge(_prior_stats(df, "damsire_norm", "damsire"), on=["damsire_norm", "year"], how="left")
    out = out.merge(_prior_stats(df, "consignor_norm", "consignor"), on=["consignor_norm", "year"], how="left")
    out = out.merge(_market_prior(df), on="year", how="left")

    for c in ("sire_prior_count", "damsire_prior_count", "consignor_prior_count"):
        out[c] = out[c].fillna(0)
    for c in CATEGORICAL_FEATURES:
        out[c] = out[c].astype("category")
    out["sessionNumber"] = out["sessionNumber"].astype("float64")
    return out


def feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    return df[FEATURES].copy()
