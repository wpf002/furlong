'use client';

import { useEffect, useState } from 'react';
import { getTrackRecord, type TrackRecord, type Scorecard } from '../../lib/api';

const HOUSE: Record<string, string> = {
  FASIG_TIPTON: 'Fasig-Tipton',
  KEENELAND: 'Keeneland',
  TATTERSALLS: 'Tattersalls',
  OBS: 'OBS',
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const bias = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%`;

export default function TrackRecordPage() {
  const [data, setData] = useState<TrackRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTrackRecord()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass-600">
          How the model has done
        </p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tightish text-racing-900">
          Track Record
        </h1>
        <div className="rule-brass my-5 max-w-xs" />
        <p className="text-sm leading-relaxed text-ink-600">
          Every completed sale scored against its realized results — the model&apos;s pre-sale
          estimate versus the price each hip actually made. Sales from 2024 on, the years held out
          of training, so these are genuine out-of-sample calls.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!error && !data && (
        <div className="h-40 animate-pulse rounded-2xl border border-ink/10 bg-paper-300/40" />
      )}

      {data && data.overall && <Overall card={data.overall} nSales={data.sales.length} />}

      {data && data.sales.length > 0 && (
        <div className="mt-8 overflow-x-auto rounded-2xl border border-ink/10 shadow-card">
          <table className="w-full min-w-[40rem] border-collapse bg-paper-50 text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-[11px] uppercase tracking-wide text-ink-500">
                <th className="px-4 py-3 text-left font-semibold">Sale</th>
                <th className="px-4 py-3 text-right font-semibold">Sold</th>
                <th className="px-4 py-3 text-right font-semibold">In estimate</th>
                <th className="px-4 py-3 text-right font-semibold">Median miss</th>
                <th className="px-4 py-3 text-right font-semibold">Error factor</th>
                <th className="px-4 py-3 text-right font-semibold">Market vs. us</th>
              </tr>
            </thead>
            <tbody>
              {data.sales.map((s) => (
                <tr key={s.saleId} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink-900">
                      {HOUSE[s.auctionHouse] ?? s.auctionHouse} {s.year}
                    </div>
                    <div className="text-xs text-ink-500">{s.name}</div>
                  </td>
                  <td className="tnum px-4 py-3 text-right text-ink-700">
                    {s.nScored.toLocaleString('en-US')}
                  </td>
                  <td className="tnum px-4 py-3 text-right font-semibold text-racing-800">
                    {pct(s.scorecard.pctWithinPredBand)}
                  </td>
                  <td className="tnum px-4 py-3 text-right text-ink-700">
                    {pct(s.scorecard.medianAbsPctError)}
                  </td>
                  <td className="tnum px-4 py-3 text-right text-ink-700">
                    {s.scorecard.medianErrorFactor.toFixed(2)}×
                  </td>
                  <td className="tnum px-4 py-3 text-right text-ink-700">
                    {bias(s.scorecard.medianDeltaPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.sales.length === 0 && (
        <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-6 py-14 text-center">
          <p className="font-serif text-lg text-ink-700">No sales scored yet</p>
          <p className="mt-1.5 text-sm text-ink-500">
            Scorecards appear once a completed sale&apos;s results are loaded.
          </p>
        </div>
      )}

      <p className="mt-6 text-xs italic leading-relaxed text-ink-500">
        &ldquo;In estimate&rdquo; is the share of sold hips whose hammer price landed inside the
        estimate band. &ldquo;Error factor&rdquo; is the median ratio between estimate and price
        (1.00× = exact). &ldquo;Market vs. us&rdquo; is the median signed gap — positive means the
        market paid above our estimate.
      </p>
    </main>
  );
}

function Overall({ card, nSales }: { card: Scorecard; nSales: number }) {
  const stats = [
    { label: 'Landed in estimate', value: pct(card.pctWithinPredBand), sub: `across ${card.n.toLocaleString('en-US')} sold hips` },
    { label: 'Typical error', value: `${card.medianErrorFactor.toFixed(2)}×`, sub: 'median estimate-to-price ratio' },
    { label: 'Median miss', value: pct(card.medianAbsPctError), sub: `over ${nSales} completed sales` },
    { label: 'Market vs. us', value: bias(card.medianDeltaPct), sub: 'median signed bias' },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink/10 bg-ink/10 shadow-card sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-paper-50 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            {s.label}
          </p>
          <p className="mt-1 font-serif text-2xl font-semibold text-racing-900 tnum">{s.value}</p>
          <p className="mt-0.5 text-xs text-ink-500">{s.sub}</p>
        </div>
      ))}
    </div>
  );
}
