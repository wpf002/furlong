import Link from 'next/link';
import type { SearchHip } from '../lib/api';
import { sexColorLabel } from '../lib/format';
import { ValuationBands } from './ValuationBands';

export function HipRow({ hip, saleId }: { hip: SearchHip; saleId: string }) {
  const { horse } = hip;
  const sire = horse.sireName ?? 'Unknown sire';
  const dam = horse.damName ?? 'Unknown dam';
  const meta = sexColorLabel(horse.sex, horse.color);
  const isGem =
    hip.valuation?.hiddenGemScore != null && hip.valuation.hiddenGemScore > 0;

  return (
    <Link
      href={`/hips/${hip.id}?sale=${encodeURIComponent(saleId)}`}
      className={`group relative block overflow-hidden rounded-2xl border bg-paper-50 shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-cardHover ${
        isGem
          ? 'border-brass-400/60 ring-1 ring-brass-400/30'
          : 'border-ink/10 hover:border-ink/20'
      }`}
    >
      {isGem && (
        <span className="absolute right-0 top-0 rounded-bl-xl bg-gradient-to-r from-brass-400 to-brass-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-white shadow-sm">
          ★ Hidden Gem
        </span>
      )}

      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-stretch">
        {/* Hip numeral block */}
        <div className="flex shrink-0 items-start gap-4 sm:flex-col sm:items-center sm:justify-start sm:border-r sm:border-ink/10 sm:pr-5">
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-medium uppercase tracking-widest text-ink-500">
              Hip
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
          <h3 className="font-serif text-xl font-medium leading-snug text-ink-900">
            <span>{sire}</span>
            <span className="mx-1.5 text-brass-500" aria-label="out of">
              ×
            </span>
            <span className="italic">{dam}</span>
          </h3>
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

          {hip.oneLiner && (
            <p className="mt-3 border-t border-ink/5 pt-3 text-sm leading-relaxed text-ink-700">
              {hip.oneLiner}
            </p>
          )}
        </div>

        {/* Valuation */}
        <div className="w-full shrink-0 sm:w-72 sm:border-l sm:border-ink/10 sm:pl-5">
          <ValuationBands valuation={hip.valuation} showDisclaimer={false} compact />
        </div>
      </div>
    </Link>
  );
}
