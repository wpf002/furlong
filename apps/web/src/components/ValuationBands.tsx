import { formatMoney, formatMoneyRounded, scoreValuation } from '@furlong/shared';
import type { Valuation } from '../lib/api';
import { VALUATION_DISCLAIMER } from '../lib/format';

// --------------------------------------------------------------------------
// Valuation bands + realized-price overlay.
//
// Two bands on one shared axis so a buyer can compare them:
//   • Pedigree value  — what the bloodlines alone suggest (pedigree-only model)
//   • Market estimate — what it should fetch given full sale context (headline)
// Estimate figures are rounded to the nearest $1,000 (no false precision).
//
// When the hip has SOLD (soldCents), the actual price is overlaid as a marker on
// the market-estimate bar and read out as a result chip — this is where the
// prediction and the outcome meet on one picture.
// --------------------------------------------------------------------------

interface Band {
  label: string;
  low: number;
  high: number;
  className: string;
  markerCents?: number | null; // actual price overlay
}

function pct(value: number, min: number, span: number): number {
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((value - min) / span) * 100));
}

function RangeBar({
  band,
  min,
  span,
  currency,
}: {
  band: Band;
  min: number;
  span: number;
  currency: string;
}) {
  const left = pct(band.low, min, span);
  const right = pct(band.high, min, span);
  const width = Math.max(right - left, 1.5);
  const marker = band.markerCents != null ? pct(band.markerCents, min, span) : null;

  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{band.label}</dt>
      <dd className="tnum whitespace-nowrap text-sm font-semibold text-ink-900">
        {formatMoneyRounded(band.low, currency)}
        <span className="px-1 font-normal text-ink-500">–</span>
        {formatMoneyRounded(band.high, currency)}
      </dd>
      <div className="relative h-2 rounded-full bg-paper-300/70">
        <div
          className={`absolute inset-y-0 rounded-full ${band.className}`}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        {marker != null && (
          // Actual hammer price: a dark marker line across the estimate axis.
          <div
            className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-ink-900"
            style={{ left: `calc(${marker}% - 1px)` }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

/**
 * Renders the valuation bands, and — when the hip has sold — the realized price
 * overlaid on the market estimate with a within/over/under read. Null valuations
 * show "Not yet valued".
 */
export function ValuationBands({
  valuation,
  showDisclaimer = true,
  compact = false,
  currency = 'USD',
  soldCents = null,
}: {
  valuation: Valuation | null;
  showDisclaimer?: boolean;
  compact?: boolean;
  currency?: string;
  soldCents?: number | null;
}) {
  if (!valuation) {
    return (
      <div className="rounded-lg border border-dashed border-ink/15 bg-paper-50 px-3 py-2.5 text-center text-sm italic text-ink-500">
        Not yet valued
      </div>
    );
  }

  const bands: Band[] = [
    {
      label: 'Pedigree value',
      low: valuation.estValueLowCents,
      high: valuation.estValueHighCents,
      className: 'bg-racing-700',
    },
    {
      label: 'Market estimate',
      low: valuation.predPriceLowCents,
      high: valuation.predPriceHighCents,
      className: 'bg-brass-500',
      markerCents: soldCents,
    },
  ];

  // Shared axis across both bands (and the actual price, so its marker fits).
  const allValues = [...bands.flatMap((b) => [b.low, b.high]), ...(soldCents != null ? [soldCents] : [])];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const pad = (max - min) * 0.08 || max * 0.05 || 1;
  const axisMin = Math.max(0, min - pad);
  const span = max + pad - axisMin;

  const score = soldCents != null ? scoreValuation(soldCents, valuation) : null;

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3'}>
      <dl className="space-y-3">
        {bands.map((band) => (
          <RangeBar key={band.label} band={band} min={axisMin} span={span} currency={currency} />
        ))}
      </dl>

      {score && soldCents != null && (
        <ResultChip soldCents={soldCents} currency={currency} score={score} />
      )}

      {showDisclaimer && (
        <p className="text-xs italic leading-relaxed text-ink-500">{VALUATION_DISCLAIMER}</p>
      )}
    </div>
  );
}

function ResultChip({
  soldCents,
  currency,
  score,
}: {
  soldCents: number;
  currency: string;
  score: NonNullable<ReturnType<typeof scoreValuation>>;
}) {
  const within = score.withinPredBand;
  const deltaPct = Math.round(Math.abs(score.predDeltaPct) * 100);
  const dir = score.predDeltaPct >= 0 ? 'above' : 'below';
  const tone = within
    ? 'bg-racing-700/10 text-racing-800 ring-racing-700/20'
    : 'bg-amber-50 text-amber-800 ring-amber-300/50';

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-xs">
      <span className="text-ink-500">
        Sold <span className="tnum font-semibold text-ink-900">{formatMoney(soldCents, currency)}</span>
      </span>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ring-1 ${tone}`}>
        {within ? 'Within estimate' : `${deltaPct}% ${dir} estimate`}
      </span>
    </div>
  );
}
