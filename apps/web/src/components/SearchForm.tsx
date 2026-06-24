'use client';

import { useEffect, useState } from 'react';
import type { SearchQuery } from '@furlong/shared';
import type { Sale } from '../lib/api';
import {
  dollarsToCents,
  nonDefaultCategoryLabel,
  nonUsdCurrency,
  parseSires,
} from '../lib/format';
import { Badge } from './Badge';
import { ChevronDownIcon } from './icons';

function isCatalogPending(sale: Sale): boolean {
  return sale.hipCount === 0;
}

function saleSuffix(sale: Sale): string {
  const cat = nonDefaultCategoryLabel(sale.category);
  const cur = nonUsdCurrency(sale.currency);
  const tags = [cat, cur, isCatalogPending(sale) ? 'Catalog pending' : null].filter(Boolean);
  return tags.length ? ` · ${tags.join(' · ')}` : '';
}

export interface SearchSubmit {
  query: SearchQuery;
}

const FIELD =
  'mt-1.5 w-full rounded-lg border border-ink/15 bg-paper-50 px-3 py-2.5 text-sm text-ink-900 shadow-sm transition placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-ink-600';

export function SearchForm({
  sales,
  onSubmit,
  loading,
  onSaleChange,
  showBudget = true,
}: {
  sales: Sale[];
  onSubmit: (s: SearchSubmit) => void;
  loading: boolean;
  onSaleChange?: (saleId: string) => void;
  showBudget?: boolean;
}) {
  const [saleId, setSaleId] = useState(
    () => (sales.find((s) => (s.hipCount ?? 1) > 0) ?? sales[0])?.id ?? '',
  );
  const [budgetLow, setBudgetLow] = useState('');
  const [budgetHigh, setBudgetHigh] = useState('');
  const [sires, setSires] = useState('');

  useEffect(() => {
    onSaleChange?.(saleId);
  }, [saleId, onSaleChange]);

  function buildQuery(): SearchQuery {
    const q: SearchQuery = { saleId };
    const low = dollarsToCents(budgetLow);
    const high = dollarsToCents(budgetHigh);
    if (low !== undefined) q.budgetLowCents = low;
    if (high !== undefined && high > 0) q.budgetHighCents = high;
    const preferred = parseSires(sires);
    if (preferred.length) q.preferredSires = preferred;
    return q;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!saleId) return;
    onSubmit({ query: buildQuery() });
  }

  const noSales = sales.length === 0;
  const selectedSale = sales.find((s) => s.id === saleId);
  const selCategory = nonDefaultCategoryLabel(selectedSale?.category);
  const selCurrency = nonUsdCurrency(selectedSale?.currency);
  const selPending = selectedSale ? isCatalogPending(selectedSale) : false;

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-2xl border border-ink/10 bg-paper-50 p-6 shadow-card"
    >
      <div>
        <label className={LABEL}>Sale</label>
        <div className="relative mt-1.5">
          <select
            value={saleId}
            onChange={(e) => setSaleId(e.target.value)}
            disabled={noSales}
            className="w-full cursor-pointer appearance-none rounded-xl border border-ink/15 bg-paper-50 py-3 pl-4 pr-11 font-serif text-base text-ink-900 shadow-card transition hover:border-brass-400/70 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15 disabled:cursor-not-allowed disabled:bg-paper-200/60"
          >
            {noSales && <option value="">No sales available</option>}
            {sales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.year}) — {s.auctionHouse}
                {saleSuffix(s)}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-brass-600" />
        </div>
        {(selCategory || selCurrency || selPending) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {selCategory && <Badge tone="neutral">{selCategory}</Badge>}
            {selCurrency && <Badge tone="brass">{selCurrency}</Badge>}
            {selPending && <Badge tone="amber">Catalog pending</Badge>}
          </div>
        )}
        {selPending && (
          <p className="mt-2 text-xs text-ink-500">
            This sale is on the calendar, but its catalog hasn’t been published yet — no
            HIP&apos;s to search until it drops.
          </p>
        )}
      </div>

      {showBudget && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Budget — Low End ($)</label>
            <input
              inputMode="decimal"
              value={budgetLow}
              onChange={(e) => setBudgetLow(e.target.value)}
              placeholder="e.g. 50,000"
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL}>Budget — High End ($)</label>
            <input
              inputMode="decimal"
              value={budgetHigh}
              onChange={(e) => setBudgetHigh(e.target.value)}
              placeholder="e.g. 250,000"
              className={FIELD}
            />
          </div>
        </div>
      )}

      <div>
        <label className={LABEL}>Preferred Sires</label>
        <input
          value={sires}
          onChange={(e) => setSires(e.target.value)}
          placeholder="Tapit, Into Mischief, Curlin"
          className={FIELD}
        />
        <p className="mt-1.5 text-xs text-ink-500">Comma-separated.</p>
      </div>

      <div className="border-t border-ink/10 pt-5">
        <button
          type="submit"
          disabled={loading || noSales}
          className="rounded-lg bg-racing-800 px-5 py-2.5 text-sm font-semibold tracking-wide text-paper-50 shadow-sm transition hover:bg-racing-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search Catalog'}
        </button>
      </div>
    </form>
  );
}
