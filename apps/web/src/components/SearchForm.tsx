'use client';

import { useEffect, useState } from 'react';
import type { SearchQuery } from '@furlong/shared';
import type { Sale } from '../lib/api';
import { dollarsToCents, parseSires } from '../lib/format';

export type SortMode = 'rank' | 'value';

export interface SearchSubmit {
  query: SearchQuery;
  sort: SortMode;
}

const FIELD =
  'mt-1.5 w-full rounded-lg border border-ink/15 bg-paper-50 px-3 py-2.5 text-sm text-ink-900 shadow-sm transition placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-ink-600';

export function SearchForm({
  sales,
  onSubmit,
  loading,
  onSaleChange,
}: {
  sales: Sale[];
  onSubmit: (s: SearchSubmit) => void;
  loading: boolean;
  onSaleChange?: (saleId: string) => void;
}) {
  const [saleId, setSaleId] = useState(sales[0]?.id ?? '');
  const [budgetLow, setBudgetLow] = useState('');
  const [budgetHigh, setBudgetHigh] = useState('');
  const [sires, setSires] = useState('');
  const [hiddenGemsOnly, setHiddenGemsOnly] = useState(false);
  const [quickBudget, setQuickBudget] = useState('');

  // Report the selected sale upward (initial + on change) so the parent can
  // offer "Show my matches" for the currently-chosen sale before a search.
  useEffect(() => {
    onSaleChange?.(saleId);
  }, [saleId, onSaleChange]);

  function buildQuery(overrideHigh?: number): SearchQuery {
    const q: SearchQuery = { saleId };
    const low = dollarsToCents(budgetLow);
    const high = overrideHigh ?? dollarsToCents(budgetHigh);
    if (low !== undefined) q.budgetLowCents = low;
    if (high !== undefined && high > 0) q.budgetHighCents = high;
    const preferred = parseSires(sires);
    if (preferred.length) q.preferredSires = preferred;
    if (hiddenGemsOnly) q.hiddenGemsOnly = true;
    return q;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!saleId) return;
    onSubmit({ query: buildQuery(), sort: 'rank' });
  }

  function bestValueUnder() {
    const high = dollarsToCents(quickBudget);
    if (!saleId || high === undefined || high <= 0) return;
    setBudgetHigh(quickBudget);
    onSubmit({ query: buildQuery(high), sort: 'value' });
  }

  const noSales = sales.length === 0;

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-2xl border border-ink/10 bg-paper-50 p-6 shadow-card"
    >
      <div>
        <label className={LABEL}>Sale</label>
        <select
          value={saleId}
          onChange={(e) => setSaleId(e.target.value)}
          disabled={noSales}
          className={`${FIELD} disabled:cursor-not-allowed disabled:bg-paper-200/60`}
        >
          {noSales && <option value="">No sales available</option>}
          {sales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.year}) — {s.auctionHouse}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Budget low ($)</label>
          <input
            inputMode="decimal"
            value={budgetLow}
            onChange={(e) => setBudgetLow(e.target.value)}
            placeholder="e.g. 50,000"
            className={FIELD}
          />
        </div>
        <div>
          <label className={LABEL}>Budget high ($)</label>
          <input
            inputMode="decimal"
            value={budgetHigh}
            onChange={(e) => setBudgetHigh(e.target.value)}
            placeholder="e.g. 250,000"
            className={FIELD}
          />
        </div>
      </div>

      <div>
        <label className={LABEL}>Preferred sires</label>
        <input
          value={sires}
          onChange={(e) => setSires(e.target.value)}
          placeholder="Tapit, Into Mischief, Curlin"
          className={FIELD}
        />
        <p className="mt-1.5 text-xs text-ink-500">Comma-separated.</p>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2.5 rounded-lg border border-transparent py-1 text-sm text-ink-700 transition hover:text-ink-900">
        <input
          type="checkbox"
          checked={hiddenGemsOnly}
          onChange={(e) => setHiddenGemsOnly(e.target.checked)}
          className="h-4 w-4 rounded border-ink/30 text-brass-500 focus:ring-brass-400/40"
        />
        <span className="font-medium">Hidden gems only</span>
      </label>

      <div className="flex flex-col gap-3 border-t border-ink/10 pt-5 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={loading || noSales}
          className="rounded-lg bg-racing-800 px-5 py-2.5 text-sm font-semibold tracking-wide text-paper-50 shadow-sm transition hover:bg-racing-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search catalog'}
        </button>

        <div className="flex items-center gap-2 sm:ml-auto">
          <input
            inputMode="decimal"
            value={quickBudget}
            onChange={(e) => setQuickBudget(e.target.value)}
            placeholder="Best value under $"
            className="w-44 rounded-lg border border-ink/15 bg-paper-50 px-3 py-2.5 text-sm text-ink-900 shadow-sm transition placeholder:text-ink-500/60 focus:border-brass-400 focus:outline-none focus:ring-2 focus:ring-brass-400/20"
          />
          <button
            type="button"
            onClick={bestValueUnder}
            disabled={loading || noSales}
            className="whitespace-nowrap rounded-lg border border-brass-400/60 bg-brass-50 px-4 py-2.5 text-sm font-semibold text-brass-700 shadow-sm transition hover:bg-brass-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Best value
          </button>
        </div>
      </div>
    </form>
  );
}
