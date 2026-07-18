"""Backfill each hip's black-type "catalog page" into Hip.catalogPageText for a
sale, from a sales-catalog PDF (local path or http URL).

Shares the extraction/loading with the ML `/catalog-pages` endpoint
(app/parsing/catalog_pages.py), so the manual backfill and the automated ingest
produce identical text.

  cd services/ml
  .venv/bin/python scripts/load_catalog_pages.py <catalog.pdf | URL> --sale-id <id> [--dry-run]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.parsing.catalog_pages import load_for_sale  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf', help='catalog PDF path or http(s) URL')
    ap.add_argument('--sale-id', required=True)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    res = load_for_sale(args.sale_id, args.pdf, dry_run=args.dry_run)
    print(
        f"extracted {res['extracted']} hip pages; matched {res['matched']} to the sale; "
        f"wrote {res['written']}" + (' [dry run]' if res.get('dryRun') else '')
    )


if __name__ == '__main__':
    main()
