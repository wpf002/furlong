import { formatCents } from '@furlong/shared';
import type { Valuation } from '../lib/api';
import { VALUATION_DISCLAIMER, confidenceLabel } from '../lib/format';
import { Badge } from './Badge';

// --------------------------------------------------------------------------
// Range-bar visualization.
//
// Both bands (estimated value + predicted sale price) are plotted on one
// shared axis so a buyer can compare them at a glance. Each band is drawn as
// a filled segment spanning low → high; the percentage geometry is purely a
// visual aid — exact figures are always printed via formatCents alongside.
// --------------------------------------------------------------------------

interface Band {
  label: string;
  low: number;
  high: number;
  className: string; // fill style
}

function pct(value: number, min: number, span: number): number {
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((value - min) / span) * 100));
}

function RangeBar({
  band,
  min,
  span,
}: {
  band: Band;
  min: number;
  span: number;
}) {
  const left = pct(band.low, min, span);
  const right = pct(band.high, min, span);
  const width = Math.max(right - left, 1.5);

  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[7.5rem_1fr]">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
        {band.label}
      </dt>
      <dd className="tnum text-sm font-semibold text-ink-900">
        {formatCents(band.low)}{' '}
        <span className="font-normal text-ink-500">–</span> {formatCents(band.high)}
      </dd>
      <div className="col-start-2 row-start-2">
        <div className="relative h-2 rounded-full bg-paper-300/70">
          <div
            className={`absolute inset-y-0 rounded-full ${band.className}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the valuation bands with an honest confidence indicator. Respects
 * limitedComparables (loud warning) and null valuations ("Not yet valued").
 * Never fakes precision when data is thin.
 */
export function ValuationBands({
  valuation,
  showDisclaimer = true,
  compact = false,
}: {
  valuation: Valuation | null;
  showDisclaimer?: boolean;
  compact?: boolean;
}) {
  if (!valuation) {
    return (
      <div className="rounded-lg border border-dashed border-ink/15 bg-paper-50 px-3 py-2.5 text-center text-sm italic text-ink-500">
        Not yet valued
      </div>
    );
  }

  const conf = confidenceLabel(valuation.confidence);
  const confTone = conf === 'High' ? 'green' : conf === 'Medium' ? 'amber' : 'red';
  const isGem =
    valuation.hiddenGemScore != null && valuation.hiddenGemScore > 0;

  const bands: Band[] = [
    {
      label: 'Est. value',
      low: valuation.estValueLowCents,
      high: valuation.estValueHighCents,
      className: 'bg-racing-700',
    },
    {
      label: 'Pred. price',
      low: valuation.predPriceLowCents,
      high: valuation.predPriceHighCents,
      className: isGem
        ? 'bg-gradient-to-r from-brass-400 to-brass-600'
        : 'bg-brass-500',
    },
  ];

  // Shared axis across both bands so the segments are visually comparable.
  const allValues = bands.flatMap((b) => [b.low, b.high]);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const pad = (max - min) * 0.08 || max * 0.05 || 1;
  const axisMin = Math.max(0, min - pad);
  const span = max + pad - axisMin;

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3'}>
      {valuation.limitedComparables && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          <span aria-hidden className="mt-px text-amber-600">
            ⚠
          </span>
          <span>Limited comparables — treat this estimate as low confidence.</span>
        </div>
      )}

      <dl className="space-y-3">
        {bands.map((band) => (
          <RangeBar key={band.label} band={band} min={axisMin} span={span} />
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-500">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              conf === 'High'
                ? 'bg-racing-700'
                : conf === 'Medium'
                  ? 'bg-amber-500'
                  : 'bg-red-500'
            }`}
          />
          {conf} confidence
        </span>
        <Badge tone={confTone === 'green' ? 'green' : confTone === 'amber' ? 'amber' : 'red'}>
          {conf}
        </Badge>
        {isGem && <Badge tone="brass">★ Hidden gem</Badge>}
      </div>

      {showDisclaimer && (
        <p className="text-xs italic leading-relaxed text-ink-500">
          {VALUATION_DISCLAIMER}
        </p>
      )}
    </div>
  );
}
