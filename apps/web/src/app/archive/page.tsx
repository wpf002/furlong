import { getSales, getModelMetrics, type Sale, type ModelMetrics } from '../../lib/api';
import { SearchExperience } from '../../components/SearchExperience';

export const dynamic = 'force-dynamic';

export default async function ArchivePage() {
  let sales: Sale[] = [];
  let salesError: string | null = null;

  try {
    sales = await getSales('past');
  } catch (err) {
    salesError = err instanceof Error ? err.message : 'Unknown error';
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass-600">
          Past sales
        </p>
        <h1 className="mt-2 font-serif text-5xl font-semibold tracking-tightish text-racing-900 sm:text-6xl">
          Archive
        </h1>
        <div className="rule-brass my-5 max-w-xs" />
        <p className="max-w-2xl text-base leading-relaxed text-ink-600">
          Search catalogs and results from concluded sales. Filter by budget and sires to compare
          what horses actually sold for against what the model would have predicted.
        </p>
      </header>

      <SearchExperience
        sales={sales}
        salesError={salesError}
        storageKey="furlong:lastArchiveSearch"
        showBudget={false}
        showGems={false}
        showSave={false}
      />
    </main>
  );
}
