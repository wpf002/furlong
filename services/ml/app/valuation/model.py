"""Comparables-baseline valuation (Phase 1, deterministic — no ML/LightGBM).

A yearling is valued by finding historical SOLD hips ("comparables") that match
it, most-specific-first, and reading price percentiles off the chosen tier.

Pipeline:
  load_comparables()  -> read SOLD comps from Postgres, cache in module state.
  reload_comparables() -> refresh the cache; returns the count.
  compute_valuation(features, comps) -> PURE function (no DB), unit-testable.
  predict(features)   -> uses the cached comps + compute_valuation.

Money is always integer cents. Output bands are rounded to int. The function is
fully deterministic: same inputs -> same outputs, no randomness, no LLM.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from statistics import median

from dotenv import load_dotenv

MODEL_VERSION = "comparables-1.0.0"

MIN_COMPS = 5
TIER_BASE = {"T1": 0.9, "T2": 0.75, "T3": 0.55, "T4": 0.30}
RECENT_YEARS = 3  # window used for the year-over-year market trend factor

# --- Entity-name normalization (mirror of TS normalizeEntityName) -----------
_COUNTRY_SUFFIX = re.compile(
    r"\s*\((?:IRE|GB|USA|US|FR|GER|CAN|AUS|NZ|JPN|ARG|BRZ|ITY|SAF|CHI|URU)\)\s*$",
    re.IGNORECASE,
)
_PUNCT = re.compile(r"[.,'`’]")  # . , ' ` ’
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_WS = re.compile(r"\s+")


def normalize_entity_name(name: str | None) -> str | None:
    """Match the TS normalizeEntityName exactly: lowercase, strip trailing
    country code, & -> ' and ', drop . , ' ` ’, non-alphanumeric -> space,
    collapse whitespace, trim; empty -> None."""
    if name is None:
        return None
    s = name.strip()
    if not s:
        return None
    s = _COUNTRY_SUFFIX.sub("", s)
    s = s.lower()
    s = s.replace("&", " and ")
    s = _PUNCT.sub("", s)
    s = _NON_ALNUM.sub(" ", s)
    s = _WS.sub(" ", s).strip()
    return s or None


# --- Percentile helper (deterministic, linear interpolation) ----------------
def _percentile(sorted_vals: list[float], pct: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return float(sorted_vals[0])
    rank = pct * (len(sorted_vals) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = rank - lo
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * frac


def _trend_factor(comps: list[dict]) -> float:
    """median(recent-year prices) / median(all prices). 1.0 if either is empty."""
    prices_all = [c["priceCents"] for c in comps if c.get("priceCents") is not None]
    if not prices_all:
        return 1.0
    years = [c["saleYear"] for c in comps if c.get("saleYear") is not None]
    if not years:
        return 1.0
    max_year = max(years)
    recent = [
        c["priceCents"]
        for c in comps
        if c.get("saleYear") is not None
        and c["saleYear"] > max_year - RECENT_YEARS
        and c.get("priceCents") is not None
    ]
    if not recent:
        return 1.0
    base = median(prices_all)
    if base <= 0:
        return 1.0
    return median(recent) / base


def _consignor_terciles(comps: list[dict]) -> dict[str, int]:
    """Bucket consignors into terciles (0/1/2) by their historical avg price."""
    by_consignor: dict[str, list[int]] = {}
    for c in comps:
        cn = c.get("consignorNorm")
        p = c.get("priceCents")
        if cn and p is not None:
            by_consignor.setdefault(cn, []).append(p)
    if not by_consignor:
        return {}
    avgs = {cn: sum(ps) / len(ps) for cn, ps in by_consignor.items()}
    ordered = sorted(avgs.items(), key=lambda kv: kv[1])
    n = len(ordered)
    buckets: dict[str, int] = {}
    for idx, (cn, _avg) in enumerate(ordered):
        # 0 = lowest tercile, 2 = highest
        buckets[cn] = min(2, (idx * 3) // max(n, 1))
    return buckets


def _zeroed() -> dict:
    return {
        "estValueLowCents": 0,
        "estValueHighCents": 0,
        "predPriceLowCents": 0,
        "predPriceHighCents": 0,
        "confidence": 0.0,
        "modelVersion": MODEL_VERSION,
        "limitedComparables": True,
    }


def compute_valuation(features: dict, comps: list[dict]) -> dict:
    """Pure comparables valuation. See module docstring for the algorithm."""
    if not comps:
        return _zeroed()

    target_sire = normalize_entity_name(features.get("sireName"))
    target_session = features.get("sessionNumber")
    target_consignor = normalize_entity_name(features.get("consignorName"))

    terciles = _consignor_terciles(comps)
    target_tier = terciles.get(target_consignor) if target_consignor else None

    # Build the candidate subsets, most-specific first.
    def t1(c: dict) -> bool:
        return (
            target_sire is not None
            and c.get("sireNorm") == target_sire
            and target_session is not None
            and c.get("sessionNumber") == target_session
        )

    def t2(c: dict) -> bool:
        return target_sire is not None and c.get("sireNorm") == target_sire

    def t3(c: dict) -> bool:
        if target_tier is None or target_session is None:
            return False
        cn = c.get("consignorNorm")
        return (
            cn is not None
            and terciles.get(cn) == target_tier
            and c.get("sessionNumber") == target_session
        )

    tiers = [
        ("T1", [c for c in comps if t1(c)]),
        ("T2", [c for c in comps if t2(c)]),
        ("T3", [c for c in comps if t3(c)]),
        ("T4", list(comps)),
    ]

    # First tier with n >= MIN_COMPS; else the most specific NON-EMPTY tier.
    chosen_tier = None
    chosen = None
    for name, subset in tiers:
        if len(subset) >= MIN_COMPS:
            chosen_tier, chosen = name, subset
            break
    if chosen is None:
        for name, subset in tiers:
            if subset:
                chosen_tier, chosen = name, subset
                break
    if chosen is None:  # defensive; comps was non-empty so T4 always matches
        return _zeroed()

    prices = sorted(
        c["priceCents"] for c in chosen if c.get("priceCents") is not None
    )
    if not prices:
        return _zeroed()

    n = len(prices)
    trend = _trend_factor(comps)

    # Both bands are trend-adjusted to current-market terms (so neither is
    # systematically biased by deep history). They differ in WIDTH, not basis:
    #   est value  = broad comparable range  (p10-p90) — the full spread seen
    #   pred price = central likely range    (p25-p75) — where it most likely lands
    # so est_low <= pred_low <= pred_high <= est_high. (A true intrinsic-vs-market
    # split is a Phase 2 model feature; here both come from the same comparables.)
    def _r100(x: float) -> int:
        return int(round(x * trend / 100.0)) * 100

    est_low = _r100(_percentile(prices, 0.10))
    est_high = _r100(_percentile(prices, 0.90))
    pred_low = _r100(_percentile(prices, 0.25))
    pred_high = _r100(_percentile(prices, 0.75))

    base = TIER_BASE[chosen_tier]
    confidence = max(0.0, min(1.0, base * min(1.0, n / 20.0)))

    limited = n < MIN_COMPS or chosen_tier in ("T3", "T4")

    return {
        "estValueLowCents": int(est_low),
        "estValueHighCents": int(est_high),
        "predPriceLowCents": int(pred_low),
        "predPriceHighCents": int(pred_high),
        "confidence": float(confidence),
        "modelVersion": MODEL_VERSION,
        "limitedComparables": bool(limited),
    }


# --- Postgres loading + module cache ----------------------------------------
_COMPS_CACHE: list[dict] | None = None


def _database_url() -> str | None:
    # Resolve .env relative to the repo root (module is services/ml/app/...).
    repo_root = Path(__file__).resolve().parents[4]
    load_dotenv(repo_root / ".env")
    return os.environ.get("DATABASE_URL")


def _psycopg_dsn(url: str) -> str:
    # Prisma-style URL may carry a ?schema=... query psycopg doesn't accept.
    return url.split("?", 1)[0]


def load_comparables() -> list[dict]:
    """Load SOLD comparables from Postgres and cache them in module state.

    Joins SaleResult (priceCents NOT NULL, rna = false) -> Hip (sessionNumber,
    consignor, sale) -> Horse (yearling) -> its sire Horse.name. Returns [] if
    DATABASE_URL is unset or the query fails (DB may be empty in MVP)."""
    global _COMPS_CACHE
    url = _database_url()
    if not url:
        _COMPS_CACHE = []
        return _COMPS_CACHE
    try:
        import psycopg
    except Exception:
        _COMPS_CACHE = []
        return _COMPS_CACHE

    query = """
        SELECT
            r."priceCents"      AS price_cents,
            h."sessionNumber"   AS session_number,
            sire."name"         AS sire_name,
            cons."name"         AS consignor_name,
            s."year"            AS sale_year
        FROM "SaleResult" r
        JOIN "Hip" h        ON h."id" = r."hipId"
        JOIN "Sale" s       ON s."id" = h."saleId"
        JOIN "Horse" yh     ON yh."id" = h."horseId"
        LEFT JOIN "Horse" sire ON sire."id" = yh."sireId"
        LEFT JOIN "Consignor" cons ON cons."id" = h."consignorId"
        WHERE r."priceCents" IS NOT NULL
          AND r."rna" = false
    """
    comps: list[dict] = []
    try:
        with psycopg.connect(_psycopg_dsn(url)) as conn:
            with conn.cursor() as cur:
                cur.execute(query)
                for price_cents, session_number, sire_name, consignor_name, sale_year in cur.fetchall():
                    if price_cents is None:
                        continue
                    comps.append(
                        {
                            "priceCents": int(price_cents),
                            "sireNorm": normalize_entity_name(sire_name),
                            "sessionNumber": session_number,
                            "consignorNorm": normalize_entity_name(consignor_name),
                            "saleYear": int(sale_year) if sale_year is not None else 0,
                        }
                    )
    except Exception:
        comps = []
    _COMPS_CACHE = comps
    return comps


def reload_comparables() -> list[dict]:
    """Force a refresh of the comparables cache; returns the new list."""
    return load_comparables()


def _get_comps() -> list[dict]:
    global _COMPS_CACHE
    if _COMPS_CACHE is None:
        load_comparables()
    return _COMPS_CACHE or []


def predict(features: dict) -> dict:
    return compute_valuation(features, _get_comps())
