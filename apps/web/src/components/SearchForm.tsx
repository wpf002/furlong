'use client';

import { useEffect, useState } from 'react';
import type { SearchQuery } from '@furlong/shared';
import type { Sale } from '../lib/api';
import { dollarsToCents, nonDefaultCategoryLabel, nonUsdCurrency, parseSires } from '../lib/format';

import { Badge } from './Badge';
import { SaleSelect } from './SaleSelect';

function isCatalogPending(sale: Sale): boolean {
  return sale.hipCount === 0;
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
  const [minGrade, setMinGrade] = useState(''); // '' = any; otherwise a min score threshold

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
    if (minGrade) q.minPedigreeScore = Number(minGrade);
    return q;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!saleId) return;
    onSubmit({ query: buildQuery() });
  }

  // Reset every filter back to its default and re-run an unconstrained search
  // over the whole catalog (SearchExperience clears the text/gem filters too).
  function clear() {
    setBudgetLow('');
    setBudgetHigh('');
    setSires('');
    setMinGrade('');
    if (saleId) onSubmit({ query: { saleId } });
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
        <div className="mt-1.5">
          <SaleSelect sales={sales} value={saleId} onChange={setSaleId} disabled={noSales} />
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
            This sale is on the calendar, but its catalog hasn’t been published yet — no HIP&apos;s
            to search until it drops.
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

      <div>
        <label className={LABEL}>Minimum Pedigree Grade</label>
        <select value={minGrade} onChange={(e) => setMinGrade(e.target.value)} className={FIELD}>
          <option value="">Any grade</option>
          <option value="80">A- &amp; up</option>
          <option value="75">B+ &amp; up</option>
          <option value="70">B &amp; up</option>
          <option value="65">B- &amp; up</option>
          <option value="60">C+ &amp; up</option>
        </select>
        <p className="mt-1.5 text-xs text-ink-500">Overall pedigree strength.</p>
      </div>

      <div className="flex items-center gap-3 border-t border-ink/10 pt-5">
        <button
          type="submit"
          disabled={loading || noSales}
          className="rounded-lg bg-racing-800 px-5 py-2.5 text-sm font-semibold tracking-wide text-paper-50 shadow-sm transition hover:bg-racing-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search Catalog'}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={loading || noSales}
          className="rounded-lg border border-ink/15 bg-paper-50 px-5 py-2.5 text-sm font-semibold text-ink-700 shadow-sm transition hover:border-brass-400 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    </form>
  );
}
