'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMoney } from '@furlong/shared';
import {
  getCompare,
  getSires,
  type CompareHouse,
  type CompareResponse,
  type SireSuggestion,
} from '../../lib/api';
import { Badge } from '../../components/Badge';

const FIELD =
  'w-full rounded-lg border border-ink/15 bg-paper-50 px-3 py-2.5 text-sm text-ink-900 shadow-sm transition placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15';

// Stable, theme-aligned fills so the same house reads the same across rows.
const HOUSE_FILLS = [
  'bg-racing-700',
  'bg-brass-500',
  'bg-racing-500',
  'bg-brass-600',
] as const;

function houseFill(index: number): string {
  return HOUSE_FILLS[index % HOUSE_FILLS.length] ?? 'bg-racing-700';
}

export default function ComparePage() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SireSuggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [selectedSire, setSelectedSire] = useState<string | null>(null);

  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  // Guards against stale autocomplete responses arriving out of order.
  const reqIdRef = useRef(0);

  // Debounced sire autocomplete.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    // Don't re-query once a suggestion has been selected verbatim.
    if (q === selectedSire) return;
    const myReq = ++reqIdRef.current;
    const t = window.setTimeout(() => {
      getSires(q)
        .then((res) => {
          if (reqIdRef.current !== myReq) return;
          setSuggestions(Array.isArray(res) ? res : []);
          setShowSuggest(true);
        })
        .catch(() => {
          if (reqIdRef.current !== myReq) return;
          setSuggestions([]);
        });
    }, 180);
    return () => window.clearTimeout(t);
  }, [query, selectedSire]);

  // Close the suggestion dropdown on outside click.
  useEffect(() => {
    if (!showSuggest) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggest(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showSuggest]);

  const runCompare = useCallback(async (sire: string) => {
    setSelectedSire(sire);
    setQuery(sire);
    setShowSuggest(false);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await getCompare(sire);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load comparison.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Bars are normalized WITHIN each currency (different money isn't comparable
  // on one scale), so the longest bar per currency represents that currency's
  // top median.
  const maxByCurrency: Record<string, number> = {};
  for (const h of data?.houses ?? []) {
    maxByCurrency[h.currency] = Math.max(maxByCurrency[h.currency] ?? 1, h.medianCents);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass-600">
          Cross-auction value
        </p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tightish text-racing-900">
          Compare houses
        </h1>
        <div className="rule-brass my-5 max-w-xs" />
        <p className="text-sm leading-relaxed text-ink-600">
          Pick a sire to see how the major auction houses priced its stock — median,
          mid-range, and volume — side by side. Each house is shown in its own sale
          currency (not FX-converted).
        </p>
      </header>

      <div ref={wrapRef} className="relative mb-8">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-600">
          Sire
        </label>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedSire(null);
          }}
          onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
          placeholder="Start typing a sire, e.g. Tapit"
          autoComplete="off"
          className={`mt-1.5 ${FIELD}`}
        />
        {showSuggest && suggestions.length > 0 && (
          <ul className="absolute z-20 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-ink/10 bg-paper-50 py-1 shadow-card">
            {suggestions.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void runCompare(s.name)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm text-ink-800 transition hover:bg-ink/5"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="tnum text-xs text-ink-500">
                    {s.count.toLocaleString('en-US')} sold
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-4" aria-busy="true">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-2xl border border-ink/10 bg-paper-50 shadow-card"
            />
          ))}
        </div>
      )}

      {!loading && !error && !data && (
        <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-6 py-12 text-center">
          <p className="font-serif text-lg text-ink-700">Pick a sire to compare</p>
          <p className="mt-1.5 text-sm text-ink-500">
            We&apos;ll line up each auction house&apos;s pricing on a shared scale.
          </p>
        </div>
      )}

      {!loading && data && data.houses.length === 0 && (
        <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-6 py-12 text-center">
          <p className="font-serif text-lg text-ink-700">
            No sold records for {data.sire}
          </p>
          <p className="mt-1.5 text-sm text-ink-500">
            Try another sire — we only show houses with completed sales.
          </p>
        </div>
      )}

      {!loading && data && data.houses.length > 0 && (
        <section className="space-y-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/10 pb-3">
            <h2 className="font-serif text-2xl text-ink-900">{data.sire}</h2>
            <p className="text-sm text-ink-600">
              <span className="tnum font-semibold text-ink-900">
                {data.totalSold.toLocaleString('en-US')}
              </span>{' '}
              sold across{' '}
              <span className="tnum font-semibold text-ink-900">
                {data.houses.length}
              </span>{' '}
              {data.houses.length === 1 ? 'house' : 'houses'}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {data.houses.map((house, i) => (
              <HouseCard
                key={house.auctionHouse}
                house={house}
                fill={houseFill(i)}
                maxMedian={maxByCurrency[house.currency] ?? 1}
              />
            ))}
          </div>

          <p className="text-xs italic leading-relaxed text-ink-500">
            Bars are scaled within each currency (different money isn&apos;t comparable on
            one axis). Figures are in each house&apos;s own sale currency and are not
            FX-converted.
          </p>
        </section>
      )}
    </main>
  );
}

function HouseCard({
  house,
  fill,
  maxMedian,
}: {
  house: CompareHouse;
  fill: string;
  maxMedian: number;
}) {
  const barPct = Math.max(2, Math.round((house.medianCents / maxMedian) * 100));

  return (
    <div className="rounded-2xl border border-ink/10 bg-paper-50 p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-serif text-lg text-ink-900">{house.auctionHouse}</h3>
        <Badge tone="neutral">
          {house.n.toLocaleString('en-US')} sold
        </Badge>
      </div>

      <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-ink-500">
        Median
      </p>
      <p className="tnum font-serif text-3xl font-semibold leading-none text-racing-800">
        {formatMoney(house.medianCents, house.currency)}
      </p>

      <div className="mt-3 h-2.5 rounded-full bg-paper-300/70">
        <div
          className={`h-2.5 rounded-full ${fill}`}
          style={{ width: `${barPct}%` }}
        />
      </div>

      <dl className="mt-4 space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-ink-500">Mid-range (p25–p75)</dt>
          <dd className="tnum font-medium text-ink-800">
            {formatMoney(house.p25Cents, house.currency)}
            <span className="px-1 text-ink-400">–</span>
            {formatMoney(house.p75Cents, house.currency)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-ink-500">Average</dt>
          <dd className="tnum font-medium text-ink-800">
            {formatMoney(house.avgCents, house.currency)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-ink-500">Years covered</dt>
          <dd className="tnum font-medium text-ink-800">{house.years}</dd>
        </div>
      </dl>
    </div>
  );
}
