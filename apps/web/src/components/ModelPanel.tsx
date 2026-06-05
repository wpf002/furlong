import type { ModelMetrics } from '../lib/api';

/**
 * Makes the recursive learning loop visible (Phase 2e): how much data the model
 * has seen and how much better it is than the comparables baseline.
 */
export function ModelPanel({ data }: { data: ModelMetrics | null }) {
  if (!data?.metrics) return null;
  const m = data.metrics;
  const isTrained = (data.modelVersion ?? '').startsWith('gbm');

  if (!isTrained) {
    return (
      <p className="mb-8 text-xs text-ink-500">
        Valuations use the Phase 1 comparables baseline (historical averages).
      </p>
    );
  }

  const stats: Array<{ label: string; value: string; sub?: string }> = [
    {
      label: 'Accuracy vs. baseline',
      value: m.improvement_pct != null ? `+${m.improvement_pct}%` : '—',
      sub: 'lower error than comparables',
    },
    {
      label: 'Trained on',
      value: m.n_results_seen != null ? m.n_results_seen.toLocaleString('en-US') : '—',
      sub: m.n_sales_seen != null ? `results across ${m.n_sales_seen} sales` : 'results',
    },
    {
      label: 'Interval coverage',
      value: m.p10_p90_coverage != null ? `${Math.round(m.p10_p90_coverage * 100)}%` : '—',
      sub: 'actual price within P10–P90',
    },
  ];

  return (
    <section className="mb-10">
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-ink/10 bg-ink/10 shadow-card sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-paper-50 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-500">
              {s.label}
            </p>
            <p className="mt-1 font-serif text-2xl font-semibold text-racing-900 tnum">
              {s.value}
            </p>
            {s.sub ? <p className="mt-0.5 text-xs text-ink-500">{s.sub}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
