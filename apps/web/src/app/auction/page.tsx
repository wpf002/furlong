'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@furlong/shared';
import { getSales, getSaleHips, type Sale, type DetailHip } from '../../lib/api';
import { sexColorLabel } from '../../lib/format';
import { ValuationBands } from '../../components/ValuationBands';
import { SaleSelect } from '../../components/SaleSelect';
import { GradeBadge } from '../../components/GradeBadge';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons';

export default function AuctionPage() {
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [saleId, setSaleId] = useState('');
  const [hips, setHips] = useState<DetailHip[] | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState('');
  const [jumpMiss, setJumpMiss] = useState(false);

  // Load the list of sales once.
  useEffect(() => {
    let cancelled = false;
    getSales('upcoming')
      .then((all) => {
        if (cancelled) return;
        setSales(all);
        // Restore the sale from the URL (?sale=…) when returning from a hip page;
        // otherwise default to the most recent sale that has a catalog.
        const urlSale = new URLSearchParams(window.location.search).get('sale');
        const fromUrl = urlSale ? all.find((s) => s.id === urlSale) : undefined;
        const def = fromUrl ?? all.find((s) => (s.hipCount ?? 1) > 0) ?? all[0];
        if (def) setSaleId(def.id);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load sales.'));
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the catalog (in hip-number order) whenever the sale changes.
  useEffect(() => {
    if (!saleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHips(null);
    setIndex(0);
    setJump('');
    setJumpMiss(false);
    getSaleHips(saleId)
      .then((list) => {
        if (cancelled) return;
        // The API returns hips in catalog (hipNumber) order; keep it explicit.
        setHips([...list].sort((a, b) => a.hipNumber - b.hipNumber));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load catalog.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [saleId]);

  const sale = useMemo(() => sales?.find((s) => s.id === saleId) ?? null, [sales, saleId]);
  const currency = sale?.currency ?? 'USD';
  const total = hips?.length ?? 0;

  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(total - 1, 0))),
    [total],
  );

  // Jump straight to a HIP number (catalog is sorted by hipNumber).
  const jumpToHip = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const n = parseInt(jump.trim(), 10);
      if (!Number.isFinite(n) || !hips) return;
      const i = hips.findIndex((h) => h.hipNumber === n);
      if (i >= 0) {
        setIndex(i);
        setJumpMiss(false);
        setJump('');
      } else {
        setJumpMiss(true);
      }
    },
    [jump, hips],
  );

  // Left / right arrow keys flip cards.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const current = hips && hips.length > 0 ? hips[Math.min(index, hips.length - 1)] : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass-600">
          Catalog browser
        </p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tightish text-racing-900">
          Auction
        </h1>
        <div className="rule-brass my-5 max-w-xs" />
        <p className="text-sm leading-relaxed text-ink-600">
          Page through a sale&apos;s catalog one HIP at a time — use the arrows or ← → keys.
        </p>
      </header>

      {/* Sale picker */}
      <div className="mb-6">
        <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-brass-600">
          Sale
        </label>
        <div className="mt-1.5">
          <SaleSelect
            sales={sales ?? []}
            value={saleId}
            onChange={setSaleId}
            disabled={!sales || sales.length === 0}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="h-80 animate-pulse rounded-2xl border border-ink/10 bg-paper-300/50" />
      )}

      {!loading && hips !== null && total === 0 && (
        <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-6 py-16 text-center">
          <p className="font-serif text-lg text-ink-700">No catalog for this sale yet</p>
          <p className="mt-1.5 text-sm text-ink-500">
            Its HIP&apos;s will appear here once the catalog is published.
          </p>
        </div>
      )}

      {!loading && current && (
        <>
          {/* Position counter + jump-to-HIP search */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
            <span className="tnum">
              HIP <span className="font-semibold text-ink-700">{index + 1}</span> of {total}
            </span>
            <form onSubmit={jumpToHip} className="flex items-center gap-1.5">
              <label htmlFor="hip-jump" className="text-ink-500">
                Go to HIP
              </label>
              <input
                id="hip-jump"
                inputMode="numeric"
                value={jump}
                onChange={(e) => {
                  setJump(e.target.value.replace(/[^0-9]/g, ''));
                  setJumpMiss(false);
                }}
                placeholder="#"
                className={`tnum w-16 rounded-lg border bg-paper-50 px-2 py-1 text-center text-ink-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-racing-600/15 ${
                  jumpMiss ? 'border-red-400' : 'border-ink/15 focus:border-racing-600'
                }`}
              />
              <button
                type="submit"
                className="rounded-lg border border-ink/15 bg-paper-50 px-2.5 py-1 font-medium text-ink-700 transition hover:border-brass-400 hover:text-ink-900"
              >
                Go
              </button>
              {jumpMiss && <span className="text-red-600">not in this sale</span>}
            </form>
          </div>

          {/* Carousel: ◀ card ▶ */}
          <div className="flex items-stretch gap-2 sm:gap-4">
            <ArrowButton
              dir="left"
              onClick={() => go(-1)}
              disabled={index === 0}
              label="Previous HIP"
            />
            <AuctionCard hip={current} saleId={saleId} currency={currency} />
            <ArrowButton
              dir="right"
              onClick={() => go(1)}
              disabled={index >= total - 1}
              label="Next HIP"
            />
          </div>
        </>
      )}
    </main>
  );
}

function ArrowButton({
  dir,
  onClick,
  disabled,
  label,
}: {
  dir: 'left' | 'right';
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex shrink-0 items-center self-center rounded-full border border-ink/15 bg-paper-50 p-2.5 text-racing-800 shadow-sm transition hover:border-brass-400 hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-30 sm:p-3"
    >
      {dir === 'left' ? (
        <ChevronLeftIcon className="h-5 w-5 sm:h-6 sm:w-6" />
      ) : (
        <ChevronRightIcon className="h-5 w-5 sm:h-6 sm:w-6" />
      )}
    </button>
  );
}

function AuctionCard({
  hip,
  saleId,
  currency,
}: {
  hip: DetailHip;
  saleId: string;
  currency: string;
}) {
  const { horse } = hip;
  const sire = horse.sire?.name ?? 'Unknown sire';
  const dam = horse.dam?.name ?? 'Unknown dam';
  const damsire = horse.dam?.sire?.name ?? null;
  const meta = sexColorLabel(horse.sex, horse.color);
  const consignor = hip.consignor?.name ?? null;
  const valuation = hip.valuations?.[0] ?? null;
  const sold = hip.result && hip.result.priceCents != null ? hip.result.priceCents : null;

  return (
    <article className={`min-w-0 flex-1 rounded-2xl border border-ink/10 bg-paper-50 p-6 shadow-card sm:p-8 ${hip.withdrawn ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] font-medium uppercase tracking-widest text-ink-500">HIP</span>
          <span className="tnum font-serif text-5xl font-semibold leading-none text-racing-800">
            {hip.hipNumber}
          </span>
          {hip.sessionNumber != null && (
            <span className="mt-2 w-fit rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">
              Session {hip.sessionNumber}
            </span>
          )}
          {hip.withdrawn && (
            <span className="mt-2 w-fit rounded-full bg-ink/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500 ring-1 ring-ink/15">
              Withdrawn
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {hip.pedigreeGrade && <GradeBadge g={hip.pedigreeGrade} size="lg" />}
          <Link
            href={`/hips/${hip.id}?sale=${encodeURIComponent(saleId)}&from=auction`}
            className="rounded-lg border border-ink/15 bg-paper-50 px-3 py-1.5 text-xs font-semibold text-ink-700 shadow-sm transition hover:border-brass-400 hover:text-ink-900"
          >
            Full Details
          </Link>
        </div>
      </div>

      <h2
        title={`${sire} × ${dam}`}
        className="mt-5 truncate font-serif text-lg font-medium leading-snug text-ink-900 sm:text-2xl"
      >
        <span>{sire}</span>
        <span className="mx-2 text-brass-500" aria-label="out of">
          ×
        </span>
        <span className="italic">{dam}</span>
      </h2>
      {horse.name && (
        <p className="mt-1 truncate text-sm font-medium text-ink-600" title={horse.name}>
          {horse.name}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        {meta && (
          <Field label="Sex / Color">
            <span className="capitalize">{meta}</span>
          </Field>
        )}
        {horse.foalingYear != null && <Field label="Foaled">{horse.foalingYear}</Field>}
        {damsire && <Field label="Damsire">{damsire}</Field>}
        {consignor && <Field label="Consignor">{consignor}</Field>}
        {(hip.breeder?.name ?? horse.breederName) && (
          <Field label="Breeder">{hip.breeder?.name ?? horse.breederName}</Field>
        )}
      </dl>

      <div className="mt-6 border-t border-ink/10 pt-5">
        {sold != null ? (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Sold for</p>
            <p className="tnum font-serif text-2xl font-semibold leading-none text-racing-800">
              {formatMoney(sold, currency)}
              {hip.result?.status ? (
                <span className="ml-2 text-xs font-normal text-ink-500">({hip.result.status})</span>
              ) : null}
            </p>
          </div>
        ) : (
          <ValuationBands valuation={valuation} showDisclaimer={false} currency={currency} />
        )}
      </div>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="whitespace-nowrap text-ink/40">{label}</dt>
      <dd className="truncate text-ink-700">{children}</dd>
    </div>
  );
}
