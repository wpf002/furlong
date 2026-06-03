import { getSales, type Sale } from '../lib/api';
import { SearchExperience } from '../components/SearchExperience';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let sales: Sale[] = [];
  let salesError: string | null = null;

  try {
    sales = await getSales();
  } catch (err) {
    salesError = err instanceof Error ? err.message : 'Unknown error';
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass-600">
          Bloodstock Intelligence
        </p>
        <h1 className="mt-2 font-serif text-5xl font-semibold tracking-tightish text-racing-900 sm:text-6xl">
          Furlong
        </h1>
        <div className="rule-brass my-5 max-w-xs" />
        <p className="max-w-2xl text-base leading-relaxed text-ink-600">
          Catalog-to-shortlist intelligence for thoroughbred yearling buyers. Pick a sale,
          set your budget and preferences, and get a ranked shortlist with comparable
          valuation bands.
        </p>
      </header>

      <SearchExperience sales={sales} salesError={salesError} />
    </main>
  );
}
