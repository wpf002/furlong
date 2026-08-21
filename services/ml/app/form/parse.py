"""Shape-safe parsing of the results feed into form lines.

Every rule here was paid for. Read the comments before "simplifying" any of it:

* `also_ran` is not one shape. Some meets send a list, some send a single
  string, some send a list of dicts, some send null. Iterating a string yields
  CHARACTERS — that silently wrote 517,000 single-letter "horses" once.
* In the string form the separator is a MULTI-SPACE "and", not any " and ".
  "Me and Chili" and "Rock and Roll" are single horses; splitting on a bare
  " and " tears them in half.
* Also-rans are recorded with finishPos = None. "Ran and finished off the
  board" is real form; dropping those horses makes a beaten horse look unraced.
"""
from __future__ import annotations

import re
from typing import Any

# Only a multi-space "and" separates names. Single-spaced "and" is part of a
# name ("Me and Chili"). The feed pads the final separator with 2+ spaces.
_AND_SEP = re.compile(r"\s{2,}and\s{2,}", re.I)
# Mirrors normalizeEntityName() in packages/shared — the form archive joins to
# Horse.normalizedName, so the two MUST agree character for character.
_DROP = re.compile(r"[.,'`\u2019]")      # apostrophes/periods are DELETED, not spaced
_PUNCT = re.compile(r"[^a-z0-9]+")
# Trailing country/registry suffix: "Ferdan (IRE)" -> "Ferdan".
_COUNTRY = re.compile(r"\s*\([a-z]{2,3}\)\s*$", re.I)


def horse_key(name: str | None) -> str | None:
    """Punctuation-proof match key. Sources disagree on apostrophes and dots
    ("O'Brien's Lad" vs "OBriens Lad"); without stripping them a horse never
    matches its own history, and a mis-keyed SIRE silently splits one
    stallion's progeny record in two."""
    if not name:
        return None
    s = _COUNTRY.sub("", str(name).strip()).lower()
    s = s.replace("&", " and ")
    s = _DROP.sub("", s)          # "O'Brien's Lad" -> "obriens lad"
    s = _PUNCT.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


def clean_name(name: Any) -> str | None:
    if name is None:
        return None
    s = str(name).strip()
    # Strip a leading finishing position some feeds prefix ("4 Ferdan").
    s = re.sub(r"^\d{1,2}\s+", "", s)
    s = re.sub(r"\s+", " ", s).strip(" ,;")
    return s or None


def parse_also_ran(value: Any) -> list[str]:
    """Return horse names from an `also_ran` field of ANY shape.

    Handles: None, list[str], list[dict], and the comma+multi-space-"and"
    string form. Never iterates a bare string.
    """
    if value is None:
        return []

    # list / tuple — of strings or of dicts
    if isinstance(value, (list, tuple)):
        out: list[str] = []
        for item in value:
            if isinstance(item, dict):
                nm = item.get("horse") or item.get("name") or item.get("horse_name")
                nm = clean_name(nm)
            elif isinstance(item, str):
                nm = clean_name(item)
            else:
                nm = clean_name(item) if item is not None else None
            if nm:
                out.append(nm)
        return out

    if isinstance(value, dict):
        nm = clean_name(value.get("horse") or value.get("name"))
        return [nm] if nm else []

    if isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        names: list[str] = []
        for chunk in s.split(","):
            # Only a MULTI-space "and" splits; single-spaced "and" is a name.
            for piece in _AND_SEP.split(chunk):
                nm = clean_name(piece)
                if nm:
                    names.append(nm)
        return names

    return []


# --- integrity ------------------------------------------------------------
# Two-character names are LEGITIMATE: "Jr", "Oh" and "Oz" are real horses. An
# over-strict length check failed a good run on them. Only a single character
# is impossible.
MAX_PLAUSIBLE_FIELD = 30


def suspicious_name(name: str | None) -> str | None:
    """Return a reason string when a name is impossible, else None."""
    if not name:
        return "empty"
    if len(name.strip()) < 2:
        return f"single-character name {name!r}"
    return None


def implausible_field_size(n: int | None) -> bool:
    return n is not None and n > MAX_PLAUSIBLE_FIELD
