"""Yearling sale catalog parser (Jockey Club pedigree-page format).

Targets the standard North American auction catalog layout (Keeneland /
Fasig-Tipton and the like): one hip per page (occasionally spilling onto a
continuation page), each a full pedigree page. We anchor on the stable
landmarks rather than trying to reconstruct the tabular pedigree box (which
extracts as a jumble):

    Hip No.
    <number>
    Barn <n>
    Consigned by <Consignor>, Agent ...
    <Color> <Sex>            e.g. "Dark Bay or Brown Colt"
    ...
    <Month DD, YYYY>         the foaling date
    By <SIRE> (<year>), ...  the sire (ALL CAPS in the source)
    1st dam
    <DAM>, by <Damsire>.     the dam + damsire

The sale's own identity (auction house / sale name) is NOT printed on the hip
pages, so it cannot be derived here — the ingest layer supplies it. We default
to a placeholder and let the API override.

Failure modes are explicit: a block with a hip number but no recoverable
pedigree is logged to report.skipped (never silently dropped); a single missing
field becomes null, never guessed.
"""
from __future__ import annotations

import re
import subprocess
from collections import Counter

import fitz  # pymupdf — preserves this catalog's reading order better than
            # pdfplumber, which scrambles the right-aligned hip number.

HIP_MARKER = "Hip No."

# Layout-page cleanup (footer page-marker like "4-26"; runs of blank lines).
_PAGE_FOOTER_RE = re.compile(r"^\s*\d{1,2}-\d{2}\s*$", re.M)
_PAGE_BLANKS_RE = re.compile(r"\n[ \t]*\n[ \t]*\n+")


def _clean_page(text: str) -> str:
    text = _PAGE_FOOTER_RE.sub("", text)
    text = "\n".join(line.rstrip() for line in text.splitlines())
    return _PAGE_BLANKS_RE.sub("\n\n", text).strip()


def _layout_pages(raw: bytes) -> list[str] | None:
    """Per-page layout-preserving text via poppler's `pdftotext -layout`, which
    keeps the pedigree-tree columns and produce-entry indentation that the web's
    structured catalog-page parser (catalogPage.ts) relies on. Returns None if
    pdftotext isn't on the PATH — callers then fall back to the fitz block text
    (still displayable, just less cleanly structured)."""
    try:
        res = subprocess.run(
            ["pdftotext", "-layout", "-", "-"], input=raw, capture_output=True, check=True
        )
        return res.stdout.decode("utf-8", "replace").split("\f")
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None

# Colors longest-first so multi-word colors win over their prefixes.
_COLORS = [
    "Dark Bay or Brown",
    "Bay or Brown",
    "Gray or Roan",
    "Dark Bay/Br.",
    "Dark Bay",
    "Chestnut",
    "Palomino",
    "Brown",
    "Black",
    "Gray",
    "Grey",
    "Roan",
    "White",
    "Bay",
]
_COLOR_ALT = "|".join(re.escape(c) for c in _COLORS)

_SEX_MAP = {
    "colt": "COLT",
    "filly": "FILLY",
    "gelding": "GELDING",
    "ridgling": "COLT",   # an entire male; no separate enum value
    "rig": "COLT",
    "mare": "MARE",
    "stallion": "STALLION",
}

# Color + sex header line, e.g. "Dark Bay or Brown Colt".
_COLOR_SEX_RE = re.compile(
    rf"(?im)^\s*({_COLOR_ALT})\s+(Colt|Filly|Gelding|Ridgling|Mare|Stallion)\b"
)
_HIP_RE = re.compile(r"Hip No\.\s*\n?\s*(\d{1,4})")
_MONTHS = (
    "January|February|March|April|May|June|July|August|"
    "September|October|November|December"
)
_FOAL_RE = re.compile(rf"\b(?:{_MONTHS})\.?\s+\d{{1,2}},\s+((?:19|20)\d\d)\b")
_SIRE_RE = re.compile(r"\bBy\s+([A-Z0-9][A-Z0-9 .,'’/&()-]+?)\s*\((?:19|20)\d\d\)")
_DAM_RE = re.compile(
    r"1st\s+dam\s*[:\n]?\s*([A-Z0-9][^,\n]+?),\s*by\s+([A-Za-z0-9][^.\n]+?)\."
)
_CONSIGN_RE = re.compile(r"Consigned by\s+(.+)")
_PROPERTY_RE = re.compile(r"Property of\s+(.+)")
_RAISED_RE = re.compile(r"(?m)^(.+?)\s+Raised\s+(?:&|and)\s+Offered\b")
_BRED_RE = re.compile(r"Bred by\s+(.+)")
_SEX_FALLBACK_RE = re.compile(r"\b(Colt|Filly|Gelding|Ridgling|Mare|Stallion)\b")


def _smart_title(name: str | None) -> str | None:
    """Title-case ALL-CAPS catalog names for display; leave mixed case alone.
    'BARBARA GORDON' -> 'Barbara Gordon', "TWO PHIL'S" -> "Two Phil's".
    Matching is done on the normalized form elsewhere, so this is cosmetic."""
    if name is None:
        return None
    s = name.strip()
    if not s:
        return None
    letters = [c for c in s if c.isalpha()]
    if letters and all(c.isupper() for c in letters):
        s = s.lower()
        # Capitalize the first letter of each word, but NOT a letter following an
        # apostrophe ("phil's" -> "Phil's", not "Phil'S").
        s = re.sub(r"(?<![A-Za-z'’])([a-z])", lambda m: m.group(1).upper(), s)
    return s


def _norm_color(color: str) -> str:
    c = color.strip()
    if c == "Dark Bay/Br.":
        return "Dark Bay or Brown"
    if c == "Grey":
        return "Gray"
    return c


def _clean_consignor(s: str) -> str | None:
    s = s.strip()
    s = re.sub(r",?\s*Agent\b.*$", "", s, flags=re.IGNORECASE)  # drop ", Agent ..."
    s = s.strip().rstrip(",")
    return s or None


def _extract_consignor(text: str) -> str | None:
    """Consignor appears as one of several phrasings between Barn and the
    color+sex line: 'Consigned by X', 'Property of X', or 'X Raised & Offered'."""
    m = _CONSIGN_RE.search(text)
    if m:
        return _clean_consignor(m.group(1))
    m = _RAISED_RE.search(text)  # e.g. "Airdrie Stud Raised & Offered, Agent"
    if m:
        return _clean_consignor(m.group(1))
    m = _PROPERTY_RE.search(text)
    if m:
        return _clean_consignor(m.group(1))
    return None


def _parse_block(text: str, page: int) -> tuple[dict | None, str | None]:
    """Return (hip_record, skip_reason). Exactly one is non-None."""
    m_hip = _HIP_RE.search(text)
    if not m_hip:
        return None, "no hip number"
    hip_number = int(m_hip.group(1))

    m_cs = _COLOR_SEX_RE.search(text)
    color = _norm_color(m_cs.group(1)) if m_cs else None
    if m_cs:
        sex = _SEX_MAP.get(m_cs.group(2).lower())
    else:
        m_sx = _SEX_FALLBACK_RE.search(text)
        sex = _SEX_MAP.get(m_sx.group(1).lower()) if m_sx else None

    m_foal = _FOAL_RE.search(text)
    foaling_year = int(m_foal.group(1)) if m_foal else None

    m_sire = _SIRE_RE.search(text)
    sire = _smart_title(m_sire.group(1).strip()) if m_sire else None

    m_dam = _DAM_RE.search(text)
    if m_dam:
        dam = _smart_title(m_dam.group(1).strip())
        damsire = _smart_title(m_dam.group(2).strip())
    else:
        dam = damsire = None

    consignor = _extract_consignor(text)

    m_bred = _BRED_RE.search(text)
    breeder = m_bred.group(1).strip().rstrip(".") if m_bred else None

    # A block with a hip number but no pedigree at all is unusable -> skip.
    if sire is None and dam is None:
        return None, "no pedigree (sire/dam) found"

    record = {
        "hipNumber": hip_number,
        "sessionNumber": None,  # not printed on these pages
        "name": None,           # yearlings are catalogued unnamed
        "sex": sex,
        "color": color,
        "foalingYear": foaling_year,
        "sireName": sire,
        "damName": dam,
        "damsireName": damsire,
        "consignorName": consignor,
        "breederName": breeder,
    }
    return record, None


def _split_blocks(pages: list[str]) -> list[tuple[int, str]]:
    """Split the document into (page_index, block_text) on Hip No. markers,
    folding continuation pages (no marker) into the preceding block."""
    blocks: list[list] = []  # [page, text]
    for pi, page in enumerate(pages):
        segments = page.split(HIP_MARKER)
        if len(segments) == 1:
            if blocks:
                blocks[-1][1] += "\n" + page  # continuation page
            continue
        # text before the first marker belongs to the previous block
        if blocks and segments[0].strip():
            blocks[-1][1] += "\n" + segments[0]
        for seg in segments[1:]:
            blocks.append([pi, HIP_MARKER + seg])
    return [(p, t) for p, t in blocks]


def parse_keeneland_catalog(raw: bytes, filename: str) -> dict:
    """Parse a catalog PDF into the ParseCatalogResponse shape (validated by the
    API against @furlong/shared). Auction house / sale name default to a
    placeholder; the ingest layer overrides them with the real sale identity."""
    pages: list[str] = []
    doc = fitz.open(stream=raw, filetype="pdf")
    try:
        for page in doc:
            pages.append(page.get_text() or "")
    finally:
        doc.close()

    blocks = _split_blocks(pages)
    # Capture each hip's full black-type page verbatim (layout-preserving) so the
    # app shows the same info as the printed catalog — automatically, at ingest.
    layout = _layout_pages(raw)

    hips: list[dict] = []
    skipped: list[dict] = []
    for page, text in blocks:
        record, reason = _parse_block(text, page)
        if record is not None:
            page_text = layout[page] if layout and page < len(layout) else text
            record["catalogPageText"] = _clean_page(page_text)
            hips.append(record)
        else:
            snippet = " ".join(text.split())[:120]
            skipped.append({"page": page, "reason": reason or "unparseable", "snippet": snippet})

    blocks_detected = len(blocks)
    hips_parsed = len(hips)
    hips_skipped = len(skipped)
    parse_rate = hips_parsed / max(blocks_detected, 1)

    # Yearling sale year = most common foaling year + 1.
    years = [h["foalingYear"] for h in hips if h["foalingYear"] is not None]
    if years:
        most_common_foal = Counter(years).most_common(1)[0][0]
        sale_year = most_common_foal + 1
    else:
        sale_year = 0

    return {
        "auctionHouse": "KEENELAND",          # placeholder; overridden at ingest
        "saleName": "Yearling Sale",          # placeholder; overridden at ingest
        "year": sale_year,
        "hips": hips,
        "report": {
            "pagesScanned": len(pages),
            "blocksDetected": blocks_detected,
            "hipsParsed": hips_parsed,
            "hipsSkipped": hips_skipped,
            "parseRate": parse_rate,
            "skipped": skipped,
        },
    }
