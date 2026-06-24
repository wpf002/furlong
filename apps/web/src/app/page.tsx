import { getSales, getModelMetrics, type Sale, type ModelMetrics } from '../lib/api';
import { SearchExperience } from '../components/SearchExperience';
import { ModelPanel } from '../components/ModelPanel';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let sales: Sale[] = [];
  let salesError: string | null = null;

  try {
    sales = await getSales('upcoming');
  } catch (err) {
    salesError = err instanceof Error ? err.message : 'Unknown error';
  }

  let modelMetrics: ModelMetrics | null = null;
  try {
    modelMetrics = await getModelMetrics();
  } catch {
    /* model panel is optional — never block the page on it */
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass-600">
          For yearling buyers
        </p>
        <h1 className="mt-2 font-serif text-5xl font-semibold tracking-tightish text-racing-900 sm:text-6xl">
          Furlong
        </h1>
        <div className="rule-brass my-5 max-w-xs" />
        <p className="max-w-2xl text-base leading-relaxed text-ink-600">
          Pick a sale, tell us your budget and the sires you like, and we&apos;ll hand you a
          shortlist — each horse with a price range built from how comparable yearlings have
          actually sold. Do your homework before the ring, not in it.
        </p>
      </header>

      <ModelPanel data={modelMetrics} />

      <SearchExperience sales={sales} salesError={salesError} />
    </main>
  );
}
