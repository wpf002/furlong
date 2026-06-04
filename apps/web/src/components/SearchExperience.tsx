'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Sale, SearchHip } from '../lib/api';
import { search } from '../lib/api';
import { VALUATION_DISCLAIMER } from '../lib/format';
import { SearchForm, type SearchSubmit, type SortMode } from './SearchForm';
import { HipRow } from './HipRow';
import { MyMatches } from './MyMatches';

// Sort by the midpoint of the predicted price band (cheapest first) for the
// "best value" quick action. Unvalued hips sink to the bottom.
function valueKey(hip: SearchHip): number {
  const v = hip.valuation;
  if (!v) return Number.POSITIVE_INFINITY;
  return (v.predPriceLowCents + v.predPriceHighCents) / 2;
}

export function SearchExperience({
  sales,
  salesError,
}: {
  sales: Sale[];
  salesError: string | null;
}) {
  const [hips, setHips] = useState<SearchHip[] | null>(null);
  const [count, setCount] = useState(0);
  const [currency, setCurrency] = useState('USD');
  const [activeSaleId, setActiveSaleId] = useState('');
  const [selectedSaleId, setSelectedSaleId] = useState(sales[0]?.id ?? '');
  const [sort, setSort] = useState<SortMode>('rank');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Client-side filters over the returned list.
  const [text, setText] = useState('');
  const [gemsOnly, setGemsOnly] = useState(false);

  async function handleSubmit({ query, sort: nextSort }: SearchSubmit) {
    setLoading(true);
    setError(null);
    setSort(nextSort);
    setActiveSaleId(query.saleId);
    try {
      const res = await search(query);
      setHips(res.hips);
      setCount(res.count);
      setCurrency(res.currency ?? 'USD');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
      setHips(null);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }

  const handleSaleChange = useCallback((id: string) => setSelectedSaleId(id), []);

  const visible = useMemo(() => {
    if (!hips) return [];
    let list = hips;

    if (gemsOnly) {
      list = list.filter(
        (h) => (h.valuation?.hiddenGemScore ?? 0) > 0,
      );
    }

    const q = text.trim().toLowerCase();
    if (q) {
      list = list.filter((h) => {
        const hay = [
          h.horse.name,
          h.horse.sireName,
          h.horse.damName,
          h.consignorName,
          `hip ${h.hipNumber}`,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (sort === 'value') {
      list = [...list].sort((a, b) => valueKey(a) - valueKey(b));
    }
    return list;
  }, [hips, gemsOnly, text, sort]);

  return (
    <div className="space-y-6">
      {salesError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load sales: {salesError}
        </div>
      )}

      {!salesError && sales.length === 0 && (
        <div className="rounded-xl border border-ink/10 bg-paper-50 px-4 py-3 text-sm text-ink-600">
          No sales loaded yet — ingest a catalog first.
        </div>
      )}

      <SearchForm
        sales={sales}
        onSubmit={handleSubmit}
        loading={loading}
        onSaleChange={handleSaleChange}
      />

      <p className="text-xs italic text-ink-500">{VALUATION_DISCLAIMER}</p>

      {sales.length > 0 && <MyMatches saleId={selectedSaleId} sales={sales} />}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-3" aria-busy="true" aria-label="Searching the catalog">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex animate-pulse gap-5 rounded-2xl border border-ink/10 bg-paper-50 p-5 shadow-card"
            >
              <div className="h-12 w-12 shrink-0 rounded-lg bg-paper-300/70" />
              <div className="flex-1 space-y-2.5">
                <div className="h-5 w-2/3 rounded bg-paper-300/70" />
                <div className="h-3 w-1/3 rounded bg-paper-300/50" />
                <div className="h-2 w-full rounded bg-paper-300/40" />
              </div>
              <div className="hidden w-64 space-y-2 sm:block">
                <div className="h-3 w-1/2 rounded bg-paper-300/60" />
                <div className="h-2 w-full rounded bg-paper-300/40" />
                <div className="h-2 w-full rounded bg-paper-300/40" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && hips !== null && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 border-b border-ink/10 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-serif text-lg text-ink-900">
              <span className="tnum font-semibold">{count}</span>{' '}
              <span className="text-ink-600">{count === 1 ? 'match' : 'matches'}</span>
              {sort === 'value' && (
                <span className="text-sm text-brass-600"> · best value</span>
              )}
              {visible.length !== count && (
                <span className="text-sm text-ink-500"> · {visible.length} shown</span>
              )}
            </h2>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ink-600">
                <input
                  type="checkbox"
                  checked={gemsOnly}
                  onChange={(e) => setGemsOnly(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-ink/30 text-brass-500 focus:ring-brass-400/40"
                />
                Hidden gems
              </label>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Filter results…"
                className="w-44 rounded-lg border border-ink/15 bg-paper-50 px-3 py-1.5 text-xs text-ink-900 shadow-sm placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15"
              />
            </div>
          </div>

          {hips.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-4 py-14 text-center">
              <p className="font-serif text-lg text-ink-700">No hips matched your criteria</p>
              <p className="mt-1.5 text-sm text-ink-500">
                Try widening your budget or removing filters.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-4 py-14 text-center">
              <p className="font-serif text-lg text-ink-700">Nothing left after filtering</p>
              <p className="mt-1.5 text-sm text-ink-500">
                No results match the current filters.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {visible.map((hip) => (
                <HipRow
                  key={hip.id}
                  hip={hip}
                  saleId={activeSaleId}
                  currency={currency}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
