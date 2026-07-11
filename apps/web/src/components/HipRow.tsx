import Link from 'next/link';
import { formatMoney } from '@furlong/shared';
import type { SearchHip } from '../lib/api';
import { sexColorLabel } from '../lib/format';
import { ValuationBands } from './ValuationBands';
import { SaveToShortlist } from './SaveToShortlist';
import { StarIcon } from './icons';

export function HipRow({
  hip,
  saleId,
  currency = 'USD',
  showSave = true,
}: {
  hip: SearchHip;
  saleId: string;
  currency?: string;
  showSave?: boolean;
}) {
  const { horse } = hip;
  const sire = horse.sireName ?? 'Unknown sire';
  const dam = horse.damName ?? 'Unknown dam';
  const meta = sexColorLabel(horse.sex, horse.color);
  const soldCents =
    hip.result && !hip.result.rna && hip.result.priceCents != null
      ? hip.result.priceCents
      : null;
  const isGem =
    hip.valuation?.hiddenGemScore != null && hip.valuation.hiddenGemScore > 0;
  const isWithdrawn = hip.withdrawn;

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border bg-paper-50 shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-cardHover ${
        isWithdrawn
          ? 'border-ink/10 opacity-60'
          : isGem
            ? 'border-brass-400/60 ring-1 ring-brass-400/30'
            : 'border-ink/10 hover:border-ink/20'
      }`}
    >
      {/* Stretched link covers the card for navigation; content sits above with
          pointer-events disabled so clicks fall through — except the Save
          control, which re-enables pointer events and never navigates. */}
      <Link
        href={`/hips/${hip.id}?sale=${encodeURIComponent(saleId)}`}
        aria-label={`View HIP ${hip.hipNumber}`}
        className="absolute inset-0 z-0 rounded-2xl"
      />
      <div className="pointer-events-none relative z-10">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-stretch">
        {/* Hip numeral block */}
        <div className="flex shrink-0 items-start gap-4 sm:flex-col sm:items-center sm:justify-start sm:border-r sm:border-ink/10 sm:pr-5">
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-medium uppercase tracking-widest text-ink-500">
              HIP
            </span>
            <span className="tnum font-serif text-4xl font-semibold leading-none text-racing-800">
              {hip.hipNumber}
            </span>
          </div>
          {hip.sessionNumber != null && (
            <span className="mt-1 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">
              Session {hip.sessionNumber}
            </span>
          )}
        </div>

        {/* Headline + metadata */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 break-words font-serif text-xl font-medium leading-snug text-ink-900">
              <span>{sire}</span>
              <span className="mx-1.5 text-brass-500" aria-label="out of">
                ×
              </span>
              <span className="italic">{dam}</span>
            </h3>
            {isWithdrawn ? (
              <span className="mt-1 inline-flex shrink-0 items-center rounded-full bg-ink/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500 ring-1 ring-ink/15">
                Withdrawn
              </span>
            ) : isGem ? (
              <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-brass-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brass-700 ring-1 ring-brass-400/40">
                <StarIcon className="h-2.5 w-2.5" />
                Hidden Gem
              </span>
            ) : null}
          </div>
          {horse.name && (
            <p className="mt-0.5 text-sm font-medium text-ink-600">{horse.name}</p>
          )}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
            {meta && <span className="capitalize">{meta}</span>}
            {meta && hip.consignorName ? (
              <span className="text-ink/20">·</span>
            ) : null}
            {hip.consignorName && (
              <span>
                <span className="text-ink/40">Consignor</span> {hip.consignorName}
              </span>
            )}
          </p>

          {hip.produce && (
            <p className="mt-1.5 text-xs text-ink-600">
              <span className="text-ink/40">Produce</span> {hip.produce.nFoals}{' '}
              {hip.produce.nFoals === 1 ? 'foal' : 'foals'} sold
              {hip.produce.medianFoalCents != null && (
                <> · median {formatMoney(hip.produce.medianFoalCents, currency)}</>
              )}
            </p>
          )}

          {hip.breeze && (
            <p className="mt-1.5 text-xs text-ink-600">
              <span className="text-ink/40">Breeze</span>{' '}
              <span className="tnum font-medium text-racing-800">{hip.breeze}</span>
            </p>
          )}

          {hip.racing && (
            <p className="mt-1.5 text-xs text-ink-600">
              <span className="text-ink/40">Race record</span> {hip.racing.starts}{' '}
              {hip.racing.starts === 1 ? 'start' : 'starts'}, {hip.racing.wins}{' '}
              {hip.racing.wins === 1 ? 'win' : 'wins'}
              {hip.racing.earningsCents != null && hip.racing.earningsCents > 0 && (
                <> · {formatMoney(hip.racing.earningsCents, currency)} earned</>
              )}
              {hip.racing.bestSpeedFigure != null && (
                <> · best fig {hip.racing.bestSpeedFigure}</>
              )}
            </p>
          )}
        </div>

          {/* Actual price (settled sales) and/or the model estimate. Save sits
              at the top of this column so it never overlays the figures. */}
          <div className="flex w-full shrink-0 flex-col gap-2.5 sm:w-72 sm:border-l sm:border-ink/10 sm:pl-5">
            {showSave && (
              <div className="pointer-events-auto flex justify-end">
                <SaveToShortlist hipId={hip.id} />
              </div>
            )}
            {soldCents != null ? (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
                  Sold for
                </p>
                <p className="tnum font-serif text-2xl font-semibold leading-none text-racing-800">
                  {formatMoney(soldCents, currency)}
                </p>
                {hip.valuation && (
                  <p className="mt-1.5 text-xs text-ink-500">
                    Est.{' '}
                    <span className="tnum whitespace-nowrap">
                      {formatMoney(hip.valuation.predPriceLowCents, currency)}–
                      {formatMoney(hip.valuation.predPriceHighCents, currency)}
                    </span>
                  </p>
                )}
              </div>
            ) : hip.result?.rna ? (
              <p className="text-sm text-ink-500">Not sold (RNA)</p>
            ) : (
              <ValuationBands
                valuation={hip.valuation}
                showDisclaimer={false}
                compact
                currency={currency}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
