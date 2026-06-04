import Link from 'next/link';
import { getSaleHips, type DetailHip, type Valuation } from '../../../lib/api';
import { sexColorLabel, VALUATION_DISCLAIMER } from '../../../lib/format';
import { ValuationBands } from '../../../components/ValuationBands';
import { SaveToShortlist } from '../../../components/SaveToShortlist';
import { formatCents } from '@furlong/shared';

export const dynamic = 'force-dynamic';

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink-900">{value || '—'}</dd>
    </div>
  );
}

export default async function HipDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sale?: string }>;
}) {
  const { id } = await params;
  const { sale: saleId } = await searchParams;

  const backLink = (
    <Link
      href="/"
      className="text-sm font-medium text-ink-500 transition hover:text-racing-700"
    >
      ← Back to search
    </Link>
  );

  if (!saleId) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {backLink}
        <div className="mt-6 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Missing sale reference for this hip. Open it from the search results.
        </div>
      </main>
    );
  }

  let hip: DetailHip | undefined;
  let error: string | null = null;
  try {
    const hips = await getSaleHips(saleId);
    hip = hips.find((h) => h.id === id);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unknown error';
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {backLink}
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load this hip: {error}
        </div>
      </main>
    );
  }

  if (!hip) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {backLink}
        <div className="mt-6 rounded-xl border border-ink/10 bg-paper-50 px-4 py-3 text-sm text-ink-600">
          Hip not found in this sale.
        </div>
      </main>
    );
  }

  const { horse } = hip;
  // valuations is latest-first per the contract.
  const latest: Valuation | null = hip.valuations?.[0] ?? null;
  const sold =
    hip.result && hip.result.priceCents != null ? hip.result.priceCents : null;

  const sire = horse.sire?.name ?? 'Unknown sire';
  const dam = horse.dam?.name ?? 'Unknown dam';
  const meta = sexColorLabel(horse.sex, horse.color);
  const isGem =
    latest?.hiddenGemScore != null && latest.hiddenGemScore > 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        {backLink}
        <SaveToShortlist hipId={hip.id} variant="button" />
      </div>

      <header className="mt-5">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium uppercase tracking-widest text-ink-500">
            Hip
          </span>
          <span className="tnum font-serif text-3xl font-semibold leading-none text-racing-800">
            {hip.hipNumber}
          </span>
          {hip.sessionNumber != null && (
            <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">
              Session {hip.sessionNumber}
            </span>
          )}
          {isGem && (
            <span className="rounded-full bg-gradient-to-r from-brass-400 to-brass-600 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">
              ★ Hidden Gem
            </span>
          )}
        </div>

        <h1 className="mt-4 font-serif text-3xl font-medium leading-tight text-ink-900 sm:text-4xl">
          <span>{sire}</span>
          <span className="mx-2 text-brass-500">×</span>
          <span className="italic">{dam}</span>
        </h1>
        {horse.name && (
          <p className="mt-1 text-base font-medium text-ink-600">{horse.name}</p>
        )}
        {meta && <p className="mt-0.5 text-sm capitalize text-ink-500">{meta}</p>}
      </header>

      <div className="rule-brass my-7" />

      <section className="rounded-2xl border border-ink/10 bg-paper-50 p-6 shadow-card">
        <h2 className="font-serif text-lg text-ink-900">Pedigree &amp; connections</h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Field label="Sire" value={horse.sire?.name} />
          <Field label="Dam" value={horse.dam?.name} />
          <Field label="Damsire" value={horse.dam?.sire?.name} />
          <Field
            label="Foaling year"
            value={horse.foalingYear != null ? String(horse.foalingYear) : null}
          />
          <Field label="Consignor" value={hip.consignor?.name} />
          <Field label="Breeder" value={horse.breederName} />
        </dl>
        {sold != null && (
          <p className="mt-5 border-t border-ink/10 pt-4 text-sm text-ink-700">
            Sale result:{' '}
            <span className="tnum font-semibold text-ink-900">{formatCents(sold)}</span>
            {hip.result?.status ? (
              <span className="text-ink-500"> ({hip.result.status})</span>
            ) : null}
          </p>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-ink/10 bg-paper-50 p-6 shadow-card">
        <h2 className="mb-4 font-serif text-lg text-ink-900">Valuation</h2>
        <ValuationBands valuation={latest} showDisclaimer={false} />
        <p className="mt-4 border-t border-ink/10 pt-4 text-xs italic leading-relaxed text-ink-500">
          {VALUATION_DISCLAIMER} Bands reflect comparable historical sales; treat them as a
          guide, not a guarantee.
        </p>
      </section>
    </main>
  );
}
