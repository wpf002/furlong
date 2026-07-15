'use client';

import { useEffect, useState } from 'react';
import { getSaleScorecard, type SaleScorecardResponse } from '../lib/api';

/**
 * How the model's predictions for this sale scored against the realized results.
 * Renders nothing until a completed sale's results are loaded and at least one
 * sold hip has a valuation to score — so it stays invisible on upcoming sales
 * and lights up the moment the sale has run and results are in.
 */
export function SaleScorecard({ saleId }: { saleId: string }) {
  const [data, setData] = useState<SaleScorecardResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    getSaleScorecard(saleId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [saleId]);

  const card = data?.scorecard;
  if (!card || card.n === 0) return null;

  const bias = Math.round(card.medianDeltaPct * 100);
  const biasLabel =
    bias === 0 ? 'right on the mark' : bias > 0 ? `${bias}% above estimate` : `${-bias}% below estimate`;

  const stats = [
    {
      label: 'Landed in estimate',
      value: `${Math.round(card.pctWithinPredBand * 100)}%`,
      sub: `of ${card.n} sold hips scored`,
    },
    {
      label: 'Typical miss',
      value: `${Math.round(card.medianAbsPctError * 100)}%`,
      sub: 'median gap between estimate and hammer',
    },
    {
      label: 'Market vs. us',
      value: bias === 0 ? '—' : `${bias > 0 ? '+' : '−'}${Math.abs(bias)}%`,
      sub: `the sale ran ${biasLabel}`,
    },
  ];

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brass-600">
          Scored against results
        </h2>
        <span className="text-xs text-ink-500">{data?.nSold ?? 0} sold</span>
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-ink/10 bg-ink/10 shadow-card sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-paper-50 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-500">
              {s.label}
            </p>
            <p className="mt-1 font-serif text-2xl font-semibold text-racing-900 tnum">{s.value}</p>
            <p className="mt-0.5 text-xs text-ink-500">{s.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
