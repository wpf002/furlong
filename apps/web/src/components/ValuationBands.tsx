import { formatMoneyRounded } from '@furlong/shared';
import type { Valuation } from '../lib/api';
import { VALUATION_DISCLAIMER } from '../lib/format';

// --------------------------------------------------------------------------
// Estimated-sale-price band.
//
// A single price band — the model's context-aware prediction of what the hip
// will sell for (predPrice). Drawn as a filled segment spanning low → high;
// the bar geometry is a visual aid, exact figures are printed alongside and
// rounded to the nearest $1,000 (no false precision).
// --------------------------------------------------------------------------

/**
 * Renders the estimated sale-price band. Null valuations show "Not yet valued".
 */
export function ValuationBands({
  valuation,
  showDisclaimer = true,
  compact = false,
  currency = 'USD',
}: {
  valuation: Valuation | null;
  showDisclaimer?: boolean;
  compact?: boolean;
  currency?: string;
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
          <div className="absolute inset-y-0 left-[8%] right-[8%] rounded-full bg-brass-500" />
        </div>
      </div>

      {showDisclaimer && (
        <p className="text-xs italic leading-relaxed text-ink-500">{VALUATION_DISCLAIMER}</p>
      )}
    </div>
  );
}
