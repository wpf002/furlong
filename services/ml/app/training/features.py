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

from app.pedigree import pedigree_score

# Columns the model consumes.
NUMERIC_FEATURES = [
    "sire_prior_mean", "sire_prior_count",
    "damsire_prior_mean", "damsire_prior_count",
    "dam_prior_mean", "dam_prior_count",
    "consignor_prior_mean", "consignor_prior_count",
    "market_prior_mean",
    # Licensed-data on-ramp (all as-of a STRICTLY earlier year → leakage-safe).
    # NaN until a feed populates SireStats via POST /ingest/sire-stats — HistGBM
    # ignores all-NaN columns, so these are inert today and light up on the first
    # retrain after a feed lands.
    #   sire_studfee_log — market's forward price on the sire; the top signal for
    #     first-crop sires (no prior-sales history to lean on).
    #   sire_eps_log / sire_swpct — RESULTS-driven sire quality: how the sire's
    #     PROGENY actually ran (earnings per starter, stakes-winner %). An
    #     independent measure of sire merit vs sire_prior_mean (past prices), it
    #     de-circularizes pricing for established sires. See docs/can-the-ai-choose.md.
    "sire_studfee_log", "sire_eps_log", "sire_swpct",
    # Catalog-pedigree score (0–100) from the black-type page — the same signal
    # the app grades hips on (app/pedigree.py, ported from pedigreeGrade.ts). It
    # captures first-dam production and family depth beyond the entity priors.
    # NaN when a sold hip carries no page text; HistGBM handles the gaps, and the
    # feature strengthens as page-text coverage grows.
    "pedigree_score",
    "year", "sessionNumber", "hipNumber",
]
CATEGORICAL_FEATURES = ["sex", "color", "auctionHouse", "saleName"]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES
TARGET = "log_price"


def _database_url() -> str:
    # Load the repo-root .env for local dev (features.py -> training -> app -> ml
    # -> services -> repo root). In deployed environments (Railway, service root =
    # services/ml) the tree is shallower and DATABASE_URL is already in the
    # environment, so a failed/missing .env lookup is non-fatal — never let it
    # crash training (this exact `parents[4]` IndexError broke prod retraining).
    try:
        load_dotenv(Path(__file__).resolve().parents[4] / ".env")
    except Exception:
        pass
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
               h."catalogPageText"          AS catalog_page_text,
               yh."sex"                      AS sex,
               yh."color"                    AS color,
               sire."normalizedName"        AS sire_norm,
               dam."normalizedName"         AS dam_norm,
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
        # Small managed Postgres instances have a tiny /dev/shm; a parallel scan of
        # this wide 148k-row join tries to allocate a DSM segment and dies with
        # "could not resize shared memory segment … No space left on device",
        # which silently drops the model back to the baseline on prod. Force a
        # serial plan for this one heavy read.
        try:
            cur.execute("SET max_parallel_workers_per_gather = 0")
        except Exception:
            pass
        cur.execute(query)
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=cols)
    df["price_cents"] = df["price_cents"].astype("float64")
    df["log_price"] = np.log(df["price_cents"])
    # Catalog-pedigree score from the black-type page (NaN where no page text).
    df["pedigree_score"] = df["catalog_page_text"].map(pedigree_score).astype("float64")
    return df


# SireStats columns the model reads → (feature name, log-transform?). All are
# populated by a licensed feed via POST /ingest/sire-stats; empty otherwise.
_SIRE_STAT_COLS = {
    "stud_fee_cents": ("sire_studfee_log", True),   # market forward price on the sire
    "eps_cents":      ("sire_eps_log", True),        # progeny earnings per starter
    "sw_pct":         ("sire_swpct", False),         # progeny stakes-winner fraction
}


def load_sire_stats() -> pd.DataFrame:
    """Per-(sire, year) stats from the SireStats table, keyed by the sire's
    normalizedName so they join to the sold-hip feature table. Returns an empty
    frame (harmless) until a licensed feed populates the table."""
    import psycopg

    query = """
        SELECT sire."normalizedName"          AS sire_norm,
               ss."year"                       AS stat_year,
               ss."studFeeCents"::float8       AS stud_fee_cents,
               ss."earningsPerStarter"::float8 AS eps_cents,
               ss."stakesWinnerPct"::float8    AS sw_pct
        FROM "SireStats" ss
        JOIN "Horse" sire ON sire."id" = ss."sireId"
        WHERE sire."normalizedName" IS NOT NULL
          AND (ss."studFeeCents" IS NOT NULL
               OR ss."earningsPerStarter" IS NOT NULL
               OR ss."stakesWinnerPct" IS NOT NULL)
    """
    empty_cols = ["sire_norm", "stat_year", "stud_fee_cents", "eps_cents", "sw_pct"]
    with psycopg.connect(_database_url()) as conn, conn.cursor() as cur:
        cur.execute(query)
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols if rows else empty_cols)


def _attach_sire_stats(out: pd.DataFrame, stats: pd.DataFrame) -> pd.DataFrame:
    """Leakage-safe: each row gets the sire's stats from the most recent SireStats
    year STRICTLY before the sale year. Each stat is merged independently (from
    its own most-recent non-null year) so sparse feeds don't blank out siblings."""
    left_base = out.reset_index()[["index", "sire_norm", "year"]].dropna(subset=["sire_norm"]).sort_values("year")
    for src, (feat, log_it) in _SIRE_STAT_COLS.items():
        col = stats[["sire_norm", "stat_year", src]].dropna(subset=[src]) if (
            stats is not None and not stats.empty and src in stats) else None
        if col is None or col.empty:
            out[feat] = np.nan
            continue
        merged = pd.merge_asof(
            left_base, col.sort_values("stat_year"),
            left_on="year", right_on="stat_year", by="sire_norm",
            direction="backward", allow_exact_matches=False,
        )
        vals = merged[src].astype(float)
        vals = np.where(vals > 0, np.log(vals), np.nan) if log_it else vals
        out[feat] = pd.Series(vals, index=merged["index"]).reindex(out.index)
    return out


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
    out = out.merge(_prior_stats(df, "dam_norm", "dam"), on=["dam_norm", "year"], how="left")
    out = out.merge(_prior_stats(df, "consignor_norm", "consignor"), on=["consignor_norm", "year"], how="left")
    out = out.merge(_market_prior(df), on="year", how="left")
    out = _attach_sire_stats(out, load_sire_stats())

    for c in ("sire_prior_count", "damsire_prior_count", "dam_prior_count", "consignor_prior_count"):
        out[c] = out[c].fillna(0)
    for c in CATEGORICAL_FEATURES:
        out[c] = out[c].astype("category")
    out["sessionNumber"] = out["sessionNumber"].astype("float64")
    return out


def feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    return df[FEATURES].copy()
