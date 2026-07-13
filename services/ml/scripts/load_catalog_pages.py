"""Extract each hip's full black-type "catalog page" from a sales-catalog PDF and
load it into Hip.catalogPageText for a sale — giving the app the same page-level
info a buyer reads in the printed catalog.

Text comes from `pdftotext -layout` (preserves the pedigree-tree columns);
hip numbers from PyMuPDF (fitz). One page == one hip. Matches by hipNumber
within the given sale; pages without a hip or without a matching Hip are skipped.

  cd services/ml
  .venv/bin/python scripts/load_catalog_pages.py <catalog.pdf> --sale-id <id> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.training.features import _database_url  # noqa: E402

FOOTER = re.compile(r'^\s*\d{1,2}-\d{2}\s*$', re.M)          # catalog page marker e.g. "4-26"
BLANKS = re.compile(r'\n[ \t]*\n[ \t]*\n+')                   # 3+ blank lines


def clean(text: str) -> str:
    text = FOOTER.sub('', text)
    text = '\n'.join(line.rstrip() for line in text.splitlines())
    text = BLANKS.sub('\n\n', text)
    return text.strip()


def extract(pdf: str):
    import fitz

    layout = subprocess.run(['pdftotext', '-layout', pdf, '-'],
                            capture_output=True, text=True, check=True).stdout
    pages = layout.split('\f')
    doc = fitz.open(pdf)
    out = {}
    for pno in range(len(doc)):
        ftext = doc[pno].get_text()
        m = re.search(r'Hip No\.\s*\n\s*(\d+)', ftext) or re.search(r'\n\s*(\d{1,4})\s*\n\s*Barn', ftext)
        if not m:
            continue
        hip = int(m.group(1))
        body = clean(pages[pno]) if pno < len(pages) else clean(ftext)
        if len(body) > 200:  # skip index/condition pages that slipped the hip regex
            out[hip] = body
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--sale-id', required=True)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    pages = extract(args.pdf)
    hips = sorted(pages)
    print(f'extracted {len(pages)} hip pages  (hip range {hips[0]}–{hips[-1]})')

    import psycopg
    with psycopg.connect(_database_url()) as c, c.cursor() as cur:
        cur.execute('SELECT "hipNumber" FROM "Hip" WHERE "saleId"=%s', (args.sale_id,))
        db_hips = {r[0] for r in cur.fetchall()}
        if not db_hips:
            print('no hips found for that sale id — check --sale-id')
            return
        matched = [h for h in pages if h in db_hips]
        print(f'sale has {len(db_hips)} hips; {len(matched)} will get a catalog page '
              f'({len(pages) - len(matched)} PDF pages have no matching hip)')
        sample = pages[matched[0]]
        print(f'\n--- sample (hip {matched[0]}, {len(sample)} chars) ---\n{sample[:400]}…')
        if args.dry_run:
            print('\n[dry run — nothing written]')
            return
        n = 0
        for h in matched:
            cur.execute('UPDATE "Hip" SET "catalogPageText"=%s WHERE "saleId"=%s AND "hipNumber"=%s',
                        (pages[h], args.sale_id, h))
            n += cur.rowcount
        c.commit()
        print(f'\nwrote catalogPageText for {n} hips')


if __name__ == '__main__':
    main()
