'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Sale, SearchHip } from '../lib/api';
import { search } from '../lib/api';
import { VALUATION_DISCLAIMER } from '../lib/format';
import { SearchForm, type SearchSubmit } from './SearchForm';
import { HipRow } from './HipRow';
import { StarIcon } from './icons';

const PAGE = 20;

export function SearchExperience({
  sales,
  salesError,
  storageKey = 'furlong:lastSearch',
  showBudget = true,
  showGems = true,
  showSave = true,
}: {
  sales: Sale[];
  salesError: string | null;
  storageKey?: string;
  showBudget?: boolean;
  showGems?: boolean;
  showSave?: boolean;
}) {
  const [hips, setHips] = useState<SearchHip[] | null>(null);
  const [count, setCount] = useState(0);
  const [currency, setCurrency] = useState('USD');
  const [activeSaleId, setActiveSaleId] = useState('');
  const [, setSelectedSaleId] = useState(sales[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Client-side filters over the returned list.
  const [text, setText] = useState('');
  const [gemsOnly, setGemsOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);

  // The full, UNCONSTRAINED catalog for the active sale. Typing in the filter
  // searches this whole set — overriding the constrained Search Catalog results.
  const [catalog, setCatalog] = useState<SearchHip[] | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);
  const justSearched = useRef(false);

  const runSearch = useCallback(async (saleId: string, query: Parameters<typeof search>[0]) => {
    justSearched.current = true;
    setLoading(true);
    setError(null);
    setActiveSaleId(saleId);
    setText('');
    setGemsOnly(false);
    setShown(PAGE);
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
  }, []);

  function handleSubmit({ query }: SearchSubmit) {
    void runSearch(query.saleId, query);
  }

  const handleSaleChange = useCallback((id: string) => setSelectedSaleId(id), []);

  // On first load: restore the last search (so returning from a hip shows the
  // same results) — otherwise auto-run the default sale, capped to 20.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.hips)) {
          setHips(s.hips);
          setCount(s.count ?? s.hips.length);
          setCurrency(s.currency ?? 'USD');
          setActiveSaleId(s.activeSaleId ?? '');
          setText(s.text ?? '');
          setGemsOnly(!!s.gemsOnly);
          setShown(s.shown ?? PAGE);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    // Default to the most recent sale that actually has a catalog, so the page
    // never opens on a catalog-pending shell (which would show no results).
    const defaultSale = sales.find((s) => (s.hipCount ?? 1) > 0) ?? sales[0];
    if (defaultSale) void runSearch(defaultSale.id, { saleId: defaultSale.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the current result set + filters for back-navigation.
  useEffect(() => {
    if (hips === null) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ hips, count, currency, activeSaleId, text, gemsOnly, shown }),
      );
    } catch {
      /* ignore */
    }
  }, [hips, count, currency, activeSaleId, text, gemsOnly, shown]);

  // Load the full catalog for the active sale (once per sale) so the free-text
  // filter can search everything, not just the constrained result set.
  useEffect(() => {
    if (!activeSaleId) return;
    let cancelled = false;
    setCatalog(null);
    search({ saleId: activeSaleId })
      .then((res) => {
        if (!cancelled) setCatalog(res.hips);
      })
      .catch(() => {
        if (!cancelled) setCatalog(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSaleId]);

  // Scroll to the results after a user-initiated search.
  useEffect(() => {
    if (!loading && hips !== null && justSearched.current) {
      justSearched.current = false;
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, hips]);

  const q = text.trim().toLowerCase();
  const filtering = q.length > 0;

  const visible = useMemo(() => {
    // When the user is typing a filter, it OVERRIDES the constrained Search
    // Catalog results and searches the whole catalog (name, sire, dam,
    // consignor, barn, hip #). Otherwise we show the constrained result set.
    const base = filtering ? (catalog ?? hips ?? []) : (hips ?? []);
    let list = base;
    if (gemsOnly) list = list.filter((h) => (h.valuation?.hiddenGemScore ?? 0) > 0);
    if (q) {
      list = list.filter((h) =>
        [
          h.horse.name,
          h.horse.sireName,
          h.horse.damName,
          h.consignorName,
          `hip ${h.hipNumber}`,
          h.barn ? `barn ${h.barn}` : null,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }
    // Always present results in catalog order (by hip number), regardless of
    // the search/filter options.
    return [...list].sort((a, b) => a.hipNumber - b.hipNumber);
  }, [hips, catalog, gemsOnly, q, filtering]);

  // With an active text filter the visible list IS the match set (drawn from the
  // whole catalog); otherwise the constrained search count leads.
  const displayCount = filtering ? visible.length : count;

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
        showBudget={showBudget}
      />

      <p className="text-xs italic text-ink-500">{VALUATION_DISCLAIMER}</p>

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
            </div>
          ))}
        </div>
      )}

      {!loading && hips !== null && (
        <section ref={resultsRef} className="space-y-4">
          <div className="flex flex-col gap-3 border-b border-ink/10 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-serif text-lg text-ink-900">
              <span className="tnum font-semibold">{displayCount}</span>{' '}
              <span className="text-ink-600">{displayCount === 1 ? 'match' : 'matches'}</span>
              {filtering ? (
                <span className="text-sm text-ink-500"> · across the catalog</span>
              ) : (
                visible.length !== count && (
                  <span className="text-sm text-ink-500"> · {visible.length} shown</span>
                )
              )}
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              {showGems && (
                <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ink-600">
                  <input
                    type="checkbox"
                    checked={gemsOnly}
                    onChange={(e) => setGemsOnly(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-ink/30 text-brass-500 focus:ring-brass-400/40"
                  />
                  Hidden Gems
                </label>
              )}
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Sire, consignor, barn, hip #…"
                title="Searches the whole catalog — name, sire, dam, consignor, barn, or hip number — overriding the filters above."
                className="w-60 rounded-lg border border-ink/15 bg-paper-50 px-3 py-1.5 text-xs text-ink-900 shadow-sm placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15"
              />
            </div>
          </div>

          {showGems && (
            <p className="-mt-1 flex items-start gap-1.5 text-xs text-ink-500">
              <StarIcon className="mt-0.5 h-3 w-3 shrink-0 text-brass-500" />
              <span>
                A <span className="font-medium text-brass-700">Hidden Gem</span> is a value signal,
                not a pedigree grade: the model thinks the horse is worth more than it&apos;s likely
                to sell for. A modest pedigree can still be underpriced — so a Gem and a lower
                pedigree grade often go together.
              </span>
            </p>
          )}

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-4 py-14 text-center">
              {filtering ? (
                <>
                  <p className="font-serif text-lg text-ink-700">
                    No catalog matches for “{text.trim()}”
                  </p>
                  <p className="mt-1.5 text-sm text-ink-500">
                    Try a sire, consignor, barn number, or hip number.
                  </p>
                </>
              ) : hips.length === 0 ? (
                <>
                  <p className="font-serif text-lg text-ink-700">
                    No HIP&apos;s matched your criteria
                  </p>
                  <p className="mt-1.5 text-sm text-ink-500">
                    Try widening your budget or removing filters.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-serif text-lg text-ink-700">Nothing left after filtering</p>
                  <p className="mt-1.5 text-sm text-ink-500">
                    No results match the current filters.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {visible.slice(0, shown).map((hip) => (
                  <HipRow
                    key={hip.id}
                    hip={hip}
                    saleId={activeSaleId}
                    currency={currency}
                    showSave={showSave}
                  />
                ))}
              </div>
              {visible.length > shown && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setShown((n) => n + PAGE)}
                    className="rounded-lg border border-ink/15 bg-paper-50 px-5 py-2.5 text-sm font-semibold text-ink-700 shadow-sm transition hover:border-brass-400 hover:text-ink-900"
                  >
                    Show more ({visible.length - shown} more)
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
