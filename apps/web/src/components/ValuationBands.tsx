import { formatMoney, formatMoneyRounded, scoreValuation } from '@furlong/shared';
import type { Valuation } from '../lib/api';
import { VALUATION_DISCLAIMER } from '../lib/format';

// --------------------------------------------------------------------------
// Estimated-sale-price band + realized-price overlay.
//
// One band — the model's context-aware prediction of what the hip will fetch
// (predPrice). Figures rounded to the nearest $1,000 (no false precision).
//
// When the hip has SOLD (soldCents), the actual price is overlaid as a marker
// on the band and read out as a result chip — prediction and outcome on one
// picture.
// --------------------------------------------------------------------------

function pct(value: number, min: number, span: number): number {
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((value - min) / span) * 100));
}

/**
 * Renders the estimated sale-price band, and — when the hip has sold — the
 * realized price overlaid with a within/above/below read. Null valuations show
 * "Not yet valued".
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

  const low = valuation.predPriceLowCents;
  const high = valuation.predPriceHighCents;

  // Axis spans the band (and the actual price, so its marker fits).
  const values = [low, high, ...(soldCents != null ? [soldCents] : [])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || max * 0.05 || 1;
  const axisMin = Math.max(0, min - pad);
  const span = max + pad - axisMin;

  const left = pct(low, axisMin, span);
  const right = pct(high, axisMin, span);
  const width = Math.max(right - left, 1.5);
  const marker = soldCents != null ? pct(soldCents, axisMin, span) : null;
  const score = soldCents != null ? scoreValuation(soldCents, valuation) : null;

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3'}>
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
          Estimated sale price
        </p>
        <p className="tnum whitespace-nowrap text-sm font-semibold text-ink-900">
          {formatMoneyRounded(low, currency)}
          <span className="px-1 font-normal text-ink-500">–</span>
          {formatMoneyRounded(high, currency)}
        </p>
        <div className="relative h-2 rounded-full bg-paper-300/70">
          <div
            className="absolute inset-y-0 rounded-full bg-brass-500"
            style={{ left: `${left}%`, width: `${width}%` }}
          />
          {marker != null && (
            <div
              className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-ink-900"
              style={{ left: `calc(${marker}% - 1px)` }}
              aria-hidden
            />
          )}
        </div>
      </div>

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
        Sold{' '}
        <span className="tnum font-semibold text-ink-900">{formatMoney(soldCents, currency)}</span>
      </span>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ring-1 ${tone}`}>
        {within ? 'Within estimate' : `${deltaPct}% ${dir} estimate`}
      </span>
    </div>
  );
}
