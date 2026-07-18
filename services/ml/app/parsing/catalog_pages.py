"""Catalog-page pipeline: turn a sales-catalog PDF into per-hip black-type
"catalog page" text and load it into Hip.catalogPageText for a sale.

This is the same page a buyer reads in the printed catalog — the pedigree tree,
produce record, and black-type family — which the app's pedigree grader parses
for [G1]/[G2] markers and dam sections. Structured data feeds (the house APIs)
don't carry it; only the catalog PDF does.

Text comes from `pdftotext -layout` (preserves the pedigree-tree columns); hip
numbers from PyMuPDF (fitz). One page == one hip. Reused by the ML `/catalog-
pages` endpoint (automated ingest) and the `load_catalog_pages.py` CLI (backfill).
"""
from __future__ import annotations

import re
import tempfile
import urllib.request

FOOTER = re.compile(r'^\s*\d{1,2}-\d{2}\s*$', re.M)  # catalog page marker e.g. "4-26"
BLANKS = re.compile(r'\n[ \t]*\n[ \t]*\n+')  # 3+ blank lines
_UA = 'Mozilla/5.0 (compatible; FurlongBot/1.0)'


def clean(text: str) -> str:
    text = FOOTER.sub('', text)
    text = '\n'.join(line.rstrip() for line in text.splitlines())
    text = BLANKS.sub('\n\n', text)
    return text.strip()


def extract(pdf_path: str) -> dict[int, str]:
    """Map hipNumber -> cleaned catalog-page text for every page that carries a hip.

    Uses pdfplumber's layout mode (pure-Python; no system `pdftotext` binary) to
    preserve the pedigree-tree columns, and PyMuPDF (fitz) for reliable hip-number
    detection. One page == one hip.
    """
    import fitz
    import pdfplumber

    out: dict[int, str] = {}
    doc = fitz.open(pdf_path)
    with pdfplumber.open(pdf_path) as pdf:
        for pno, page in enumerate(pdf.pages):
            ftext = doc[pno].get_text() if pno < len(doc) else ''
            m = re.search(r'Hip No\.\s*\n\s*(\d+)', ftext) or re.search(
                r'\n\s*(\d{1,4})\s*\n\s*Barn', ftext
            )
            if not m:
                continue
            hip = int(m.group(1))
            body = clean(page.extract_text(layout=True) or '')
            if len(body) > 200:  # skip index / condition pages that slipped the hip regex
                out[hip] = body
    return out


def _download(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': _UA})
    with urllib.request.urlopen(req, timeout=180) as resp:  # noqa: S310 (trusted house URL)
        data = resp.read()
    tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
    tmp.write(data)
    tmp.close()
    return tmp.name


def load_for_sale(sale_id: str, pdf_source: str, dry_run: bool = False) -> dict:
    """Extract catalog pages from a PDF (local path or http URL) and write them to
    Hip.catalogPageText for the matching hips of `sale_id`. Returns a summary."""
    from app.training.features import _database_url

    path = _download(pdf_source) if pdf_source.startswith('http') else pdf_source
    pages = extract(path)
    if not pages:
        return {'extracted': 0, 'matched': 0, 'written': 0}

    import psycopg

    with psycopg.connect(_database_url()) as c, c.cursor() as cur:
        cur.execute('SELECT "hipNumber" FROM "Hip" WHERE "saleId"=%s', (sale_id,))
        db_hips = {r[0] for r in cur.fetchall()}
        matched = [h for h in pages if h in db_hips]
        if dry_run:
            return {'extracted': len(pages), 'matched': len(matched), 'written': 0, 'dryRun': True}
        written = 0
        for h in matched:
            cur.execute(
                'UPDATE "Hip" SET "catalogPageText"=%s WHERE "saleId"=%s AND "hipNumber"=%s',
                (pages[h], sale_id, h),
            )
            written += cur.rowcount
        c.commit()
        return {'extracted': len(pages), 'matched': len(matched), 'written': written}


# Fasig-Tipton publishes each sale's catalog at
#   https://www.fasigtipton.com/catalogs/<YYYY>/<MMDD>/web.pdf
# keyed by the sale's start date. Derive it so ingest can fetch it automatically.
def ft_catalog_url(start_date_iso: str | None) -> str | None:
    if not start_date_iso:
        return None
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', start_date_iso)
    if not m:
        return None
    y, mo, d = m.groups()
    return f'https://www.fasigtipton.com/catalogs/{y}/{mo}{d}/web.pdf'
