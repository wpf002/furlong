"""Backtest: can a value signal known AT SALE TIME predict which yearling
purchases paid off on the racetrack? Answers the product question "can we train
the AI to CHOOSE winners?" with evidence rather than assumption.

Cohort: USD yearlings sold <= 2022 (careers ~mature) that later got a racing
record matched (~5k horses). Every predictor is leakage-safe — a sire's
reputation is built only from foals sold in STRICTLY earlier years.

Findings (see docs/can-the-ai-choose.md for the writeup): price + pedigree
explain ~1% of racing earnings; the market itself pays a 35x price range for a
2x earnings range with a flat win rate; and the "buy cheap = high ROI" signal is
a survivorship + denominator artifact (racing-record coverage rises 3.4% -> 9.4%
from cheapest to priciest tier).

Run:  cd services/ml && .venv/bin/python scripts/backtest_can_ai_choose.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.training.features import _database_url  # noqa: E402

QUERY = """
SELECT r."priceCents"::float8       AS price_cents,
       s."year"                     AS year,
       sire."normalizedName"        AS sire_norm,
       yh."starts" AS starts, yh."wins" AS wins,
       yh."earningsCents"::float8   AS earn_cents
FROM "SaleResult" r
JOIN "Hip" h    ON h."id" = r."hipId"
JOIN "Sale" s   ON s."id" = h."saleId"
JOIN "Horse" yh ON yh."id" = h."horseId"
LEFT JOIN "Horse" sire ON sire."id" = yh."sireId"
WHERE r."rna" = false AND r."priceCents" > 0 AND s."currency" = 'USD' AND s."year" <= 2022
"""


def spearman(a: np.ndarray, b: np.ndarray) -> float:
    m = np.isfinite(a) & np.isfinite(b)
    return float(np.corrcoef(pd.Series(a[m]).rank(), pd.Series(b[m]).rank())[0, 1])


def r2(y: np.ndarray, X: np.ndarray) -> float:
    # Use lstsq's returned residual sum-of-squares — avoids a manual matmul that
    # trips a spurious BLAS RuntimeWarning on some numpy builds.
    X = np.ascontiguousarray(X, dtype=np.float64)
    y = np.ascontiguousarray(y, dtype=np.float64)
    _, residuals, rank, _ = np.linalg.lstsq(X, y, rcond=None)
    if residuals.size == 0:  # rank-deficient; fall back
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        ss_res = float(np.sum((y - X.dot(beta)) ** 2))
    else:
        ss_res = float(residuals[0])
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    return 1 - ss_res / ss_tot


def load() -> pd.DataFrame:
    import psycopg

    with psycopg.connect(_database_url()) as conn, conn.cursor() as cur:
        cur.execute(QUERY)
        cols = [d.name for d in cur.description]
        df = pd.DataFrame(cur.fetchall(), columns=cols)
    # Cast everything to float up front — the DB driver hands back Decimals, and
    # object-dtype arrays make numpy's linear algebra overflow.
    for c in ("price_cents", "earn_cents", "starts", "wins"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["log_price"] = np.log(df["price_cents"])
    df["has_record"] = df["starts"].notna()
    return df


def sire_reputation(df: pd.DataFrame) -> pd.DataFrame:
    """Leakage-safe: a sire's mean log sale price over STRICTLY earlier years."""
    g = (df.dropna(subset=["sire_norm"])
         .groupby(["sire_norm", "year"])["log_price"].agg(s="sum", c="size")
         .reset_index().sort_values(["sire_norm", "year"]))
    g["cs"] = g.groupby("sire_norm")["s"].cumsum() - g["s"]
    g["cc"] = g.groupby("sire_norm")["c"].cumsum() - g["c"]
    g["sire_rep"] = np.where(g["cc"] > 0, g["cs"] / g["cc"], np.nan)
    return g[["sire_norm", "year", "sire_rep"]]


def main() -> None:
    full = load()

    # --- Coverage / survivorship: does "has a racing record" depend on price? ---
    full["price_decile"] = pd.qcut(full["log_price"], 10, labels=False)
    cov = full.groupby("price_decile").agg(
        n=("price_cents", "size"), med_price=("price_cents", "median"),
        pct=("has_record", "mean")).reset_index()
    print("COVERAGE / SURVIVORSHIP — % of sold horses with a racing record, by price tier")
    print("(rises with price => cheap 'winners' are survivors; cheap busts are missing)\n")
    for _, r in cov.iterrows():
        print(f"  ${r.med_price/100:>9,.0f}  n={int(r.n):>6}  {r.pct*100:>4.1f}%  {'#' * int(r.pct * 100)}")

    full = full.merge(sire_reputation(full), on=["sire_norm", "year"], how="left")
    d = full[full["has_record"] & full["sire_rep"].notna()].copy()
    d["earn"] = d["earn_cents"].fillna(0).clip(lower=0)
    d["log_earn"] = np.log(d["earn"] + 1)
    y = d["log_earn"].to_numpy(dtype=float)
    n = len(d)
    for col in ("log_price", "sire_rep"):
        d[col + "_z"] = (d[col] - d[col].mean()) / d[col].std()
    ones = np.ones(n)
    r2_price = r2(y, np.c_[ones, d.log_price_z])
    r2_ped = r2(y, np.c_[ones, d.sire_rep_z])
    r2_both = r2(y, np.c_[ones, d.log_price_z, d.sire_rep_z])
    print(f"\nHOW MUCH OF RACING EARNINGS IS PREDICTABLE? (cohort {n:,})")
    print(f"  price alone     R^2 = {r2_price:.3f}")
    print(f"  pedigree alone  R^2 = {r2_ped:.3f}")
    print(f"  price+pedigree  R^2 = {r2_both:.3f}  => ~{(1 - r2_both) * 100:.0f}% is outside the data")

    # --- Value-signal quintiles: absolute payoff vs ROI (the value illusion) ---
    d["value_resid"] = d["sire_rep"] - d["log_price"]  # >0 => cheap vs pedigree
    d["roi"] = d["earn"] / d["price_cents"]
    d["q"] = pd.qcut(d.value_resid, 5, labels=["Q1 pricey", "Q2", "Q3", "Q4", "Q5 cheap"])
    print(f"\n  {'bucket':<10}{'med price':>11}{'med EARN':>11}{'ROI earn/$':>12}{'won a race':>12}")
    for q, g in d.groupby("q", observed=True):
        print(f"  {str(q):<10}{g.price_cents.median()/100:>11,.0f}{g.earn.median()/100:>11,.0f}"
              f"{g.roi.median():>12.2f}{(g.wins.fillna(0) > 0).mean() * 100:>11.0f}%")
    print(f"\n  market efficiency  Spearman(price, earnings) = {spearman(d.log_price.to_numpy(), y):+.3f}")


if __name__ == "__main__":
    main()
