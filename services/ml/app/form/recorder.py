"""Turn one settled race day into form lines, and write a whole day in ONE
chunked insert.

Profiling lesson (GateSmart): the API was never the bottleneck. Fetching a full
race day took ~0.6s while writing it took ~100s, because the recorder opened a
connection and INSERTed per race. Batching a day into one chunked insert was a
~40x speedup. Do not "optimize" the fetch layer.

Failure lesson: a day that errors must PROPAGATE, never return 0. A swallowed
error leaves the date looking covered, so it is skipped on re-run and the loss
becomes permanent.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, asdict
from datetime import date as _date
from typing import Any, Iterable

from app.form.parse import (
    parse_also_ran, horse_key, clean_name, suspicious_name, implausible_field_size,
)

CHUNK = 1000


def _first(d: dict, *names: str) -> Any:
    """Field names vary by feed region, so never bind to a single spelling."""
    for n in names:
        if n in d and d[n] not in (None, ""):
            return d[n]
    return None


def _to_int(v: Any) -> int | None:
    try:
        if v is None or v == "":
            return None
        return int(str(v).strip().split()[0])
    except (ValueError, IndexError):
        return None


def _to_float(v: Any) -> float | None:
    try:
        return float(str(v).strip()) if v not in (None, "") else None
    except ValueError:
        return None


def _purse_cents(v: Any) -> int | None:
    if v in (None, ""):
        return None
    s = str(v)
    digits = "".join(ch for ch in s if ch.isdigit() or ch == ".")
    try:
        return int(round(float(digits) * 100)) if digits else None
    except ValueError:
        return None


def derive_black_type(race_class: str | None, grade: str | None, finish: int | None) -> tuple[str | None, str | None]:
    """(normalized grade, black type). Black type is the biggest value driver in
    a sales catalogue: a WIN or a PLACING (2nd/3rd) in a stakes/graded race is
    what gets a horse's name printed in bold."""
    blob = f"{race_class or ''} {grade or ''}".lower()
    g = None
    if any(k in blob for k in ("group 1", "grade 1", "g1", "gi ")) or (grade or "").strip() in ("1", "I"):
        g = "G1"
    elif any(k in blob for k in ("group 2", "grade 2", "g2", "gii")) or (grade or "").strip() in ("2", "II"):
        g = "G2"
    elif any(k in blob for k in ("group 3", "grade 3", "g3", "giii")) or (grade or "").strip() in ("3", "III"):
        g = "G3"
    elif "listed" in blob:
        g = "Listed"

    is_black_type_race = g is not None or "stakes" in blob
    bt = None
    if is_black_type_race and finish is not None:
        if finish == 1:
            bt = "WIN"
        elif finish in (2, 3):
            bt = "PLACED"
    return g, bt


@dataclass
class FormLine:
    horseKey: str
    horseName: str
    regNumber: str | None
    raceId: str
    date: _date
    track: str
    region: str | None
    finishPos: int | None
    fieldSize: int | None
    distanceFurlongs: float | None
    surface: str | None
    going: str | None
    raceClass: str | None
    grade: str | None
    blackType: str | None
    totalPurseCents: int | None
    jockey: str | None
    trainer: str | None
    winningTime: str | None
    sireName: str | None
    damName: str | None
    damSireName: str | None
    sireKey: str | None
    damKey: str | None
    breederName: str | None
    ownerName: str | None


def race_to_form_lines(race: dict, day: _date) -> list[FormLine]:
    """One race -> a form line per runner, INCLUDING also-rans (finishPos=None)."""
    race_id = str(_first(race, "race_id", "raceId", "id") or "")
    if not race_id:
        raise ValueError("race payload has no race_id")
    track = clean_name(_first(race, "course", "track", "track_name")) or "unknown"
    region = _first(race, "region", "country")
    going = _first(race, "going", "track_condition")
    surface = _first(race, "surface", "type", "track_surface")
    race_class = _first(race, "race_class", "class", "race_type", "race_name")
    grade_raw = _first(race, "grade", "group")
    purse = _purse_cents(_first(race, "total_purse", "purse", "prize", "prize_money"))
    dist_f = _to_float(_first(race, "dist_f", "distance_furlongs", "furlongs"))
    win_time = _first(race, "winning_time", "time", "win_time")

    runners = _first(race, "runners", "finishers", "horses") or []
    if isinstance(runners, dict):
        runners = [runners]

    lines: list[FormLine] = []
    seen: set[str] = set()

    def add(name: str | None, finish: int | None, r: dict | None):
        nm = clean_name(name)
        if not nm:
            return
        key = horse_key(nm)
        if not key or key in seen:
            return
        seen.add(key)
        r = r or {}
        sire = clean_name(_first(r, "sire", "sire_name"))
        dam = clean_name(_first(r, "dam", "dam_name"))
        damsire = clean_name(_first(r, "damsire", "dam_sire_name", "damsire_name"))
        g, bt = derive_black_type(str(race_class or ""), str(grade_raw or ""), finish)
        lines.append(FormLine(
            horseKey=key, horseName=nm,
            regNumber=_first(r, "registration_number", "reg_number", "horse_id"),
            raceId=race_id, date=day, track=str(track), region=region,
            finishPos=finish, fieldSize=None,
            distanceFurlongs=dist_f, surface=surface, going=going,
            raceClass=race_class, grade=g, blackType=bt, totalPurseCents=purse,
            jockey=clean_name(_first(r, "jockey", "jockey_name")),
            trainer=clean_name(_first(r, "trainer", "trainer_name")),
            winningTime=win_time if finish == 1 else None,
            sireName=sire, damName=dam, damSireName=damsire,
            sireKey=horse_key(sire), damKey=horse_key(dam),
            breederName=clean_name(_first(r, "breeder_name", "breeder")),
            ownerName=clean_name(_first(r, "owner_last_name", "owner", "owner_name")),
        ))

    for r in runners:
        if not isinstance(r, dict):
            add(r, None, None)
            continue
        add(_first(r, "horse", "horse_name", "name"),
            _to_int(_first(r, "position", "finish_position", "finishing_position")), r)

    # Also-rans: ran, finished off the board. finishPos stays None — NEVER drop
    # them, or a beaten horse reads as unraced.
    for nm in parse_also_ran(_first(race, "also_ran", "alsoRan", "also_rans")):
        add(nm, None, None)

    n = len(lines)
    stated = _to_int(_first(race, "field_size", "fieldSize", "runners_count"))
    size = stated if stated else n
    for ln in lines:
        ln.fieldSize = size
    return lines


def integrity_check(lines: Iterable[FormLine]) -> list[str]:
    """Fail loudly on impossible output. Two-character names are LEGITIMATE
    ("Jr", "Oh", "Oz" are real horses) — an over-strict rule failed a good run
    on them, so only a single character is rejected."""
    problems: list[str] = []
    for ln in lines:
        why = suspicious_name(ln.horseName)
        if why:
            problems.append(f"race {ln.raceId}: {why}")
        if implausible_field_size(ln.fieldSize):
            problems.append(f"race {ln.raceId}: field size {ln.fieldSize} > 30")
    return problems


COLUMNS = [
    "horseKey", "horseName", "regNumber", "raceId", "date", "track", "region",
    "finishPos", "fieldSize", "distanceFurlongs", "surface", "going", "raceClass",
    "grade", "blackType", "totalPurseCents", "jockey", "trainer", "winningTime",
    "sireName", "damName", "damSireName", "sireKey", "damKey", "breederName", "ownerName",
]


def write_day(conn, lines: list[FormLine]) -> int:
    """One chunked insert for the WHOLE day (not per race). Idempotent."""
    if not lines:
        return 0
    import secrets
    cols = ", ".join(f'"{c}"' for c in COLUMNS)
    written = 0
    with conn.cursor() as cur:
        for i in range(0, len(lines), CHUNK):
            chunk = lines[i:i + CHUNK]
            vals, params = [], []
            for ln in chunk:
                d = asdict(ln)
                vals.append("(" + ", ".join(["%s"] * (len(COLUMNS) + 1)) + ")")
                params.append(secrets.token_hex(12))
                params.extend(d[c] for c in COLUMNS)
            cur.execute(
                f'INSERT INTO "HorseFormLine" ("id", {cols}) VALUES '
                + ", ".join(vals)
                + ' ON CONFLICT ("horseKey", "raceId") DO NOTHING',
                params,
            )
            written += cur.rowcount
    return written
