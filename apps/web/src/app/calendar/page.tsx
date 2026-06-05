'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CalendarSale } from '../../lib/api';
import { getCalendar } from '../../lib/api';
import { nonDefaultCategoryLabel, nonUsdCurrency } from '../../lib/format';
import { Badge } from '../../components/Badge';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function CalendarPage() {
  const [sales, setSales] = useState<CalendarSale[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCalendar()
      .then((res) => {
        if (!cancelled) setSales(Array.isArray(res) ? res : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load calendar.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Group by year (desc); within a year, upcoming first then by start date.
  const grouped = useMemo(() => {
    if (!sales) return [];
    const byYear = new Map<number, CalendarSale[]>();
    for (const s of sales) {
      const arr = byYear.get(s.year) ?? [];
      arr.push(s);
      byYear.set(s.year, arr);
    }
    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, list]) => ({
        year,
        sales: [...list].sort((a, b) => {
          if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
          const da = a.startDate ? Date.parse(a.startDate) : 0;
          const db = b.startDate ? Date.parse(b.startDate) : 0;
          return da - db;
        }),
      }));
  }, [sales]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass-600">
          Sales calendar
        </p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tightish text-racing-900">
          Calendar
        </h1>
        <div className="rule-brass my-5 max-w-xs" />
        <p className="text-sm leading-relaxed text-ink-600">
          Every sale across all houses, by year, with catalog sizes. Upcoming sales are flagged.
        </p>
      </header>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-paper-300/60" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the calendar: {error}
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-6 py-12 text-center">
          <p className="font-serif text-lg text-ink-700">No sales on the calendar yet</p>
        </div>
      ) : (
        <div className="space-y-10">
          {grouped.map(({ year, sales: yearSales }) => (
            <section key={year}>
              <h2 className="mb-3 flex items-baseline gap-3 border-b border-ink/10 pb-2">
                <span className="tnum font-serif text-2xl font-semibold text-racing-900">
                  {year}
                </span>
                <span className="text-xs text-ink-500">
                  {yearSales.length} {yearSales.length === 1 ? 'sale' : 'sales'}
                </span>
              </h2>
              <ul className="space-y-3">
                {yearSales.map((s) => {
                  const date = formatDate(s.startDate);
                  const catLabel = nonDefaultCategoryLabel(s.category);
                  const curLabel = nonUsdCurrency(s.currency);
                  return (
                    <li
                      key={s.id}
                      className="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-paper-50 px-5 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-serif text-lg text-ink-900">{s.name}</span>
                          {s.upcoming && <Badge tone="brass">Upcoming</Badge>}
                          {catLabel && <Badge tone="neutral">{catLabel}</Badge>}
                          {curLabel && <Badge tone="amber">{curLabel}</Badge>}
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                          <span>{s.auctionHouse}</span>
                          {date && <span>· {date}</span>}
                        </p>
                      </div>
                      <span className="tnum shrink-0 rounded-full bg-ink/5 px-3 py-1 text-xs font-medium text-ink-600">
                        {s.hipCount} {s.hipCount === 1 ? 'HIP' : "HIP's"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
