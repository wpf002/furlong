'use client';

import { useEffect, useState } from 'react';
import { getPedigreeBrief } from '../lib/api';

/**
 * "Pedigree read" — a short, industry-style note generated from the model's
 * native bloodstock knowledge (sire tendencies, damsire influence, family
 * notability). Clearly labeled AI context, deliberately separate from the
 * data-driven valuation. Fetched client-side so the model latency never blocks
 * the page render; renders nothing if the assistant isn't configured or the
 * model returns nothing.
 */
export function PedigreeBrief({ hipId }: { hipId: string }) {
  const [state, setState] = useState<{
    loading: boolean;
    brief: string | null;
    configured: boolean;
  }>({ loading: true, brief: null, configured: true });

  useEffect(() => {
    let cancelled = false;
    getPedigreeBrief(hipId)
      .then((r) => !cancelled && setState({ loading: false, brief: r.brief, configured: r.configured }))
      .catch(() => !cancelled && setState({ loading: false, brief: null, configured: true }));
    return () => {
      cancelled = true;
    };
  }, [hipId]);

  // Stay quiet when there's nothing useful to show (unconfigured / no brief).
  if (!state.loading && (!state.configured || !state.brief)) return null;

  return (
    <section className="mt-6 rounded-2xl border border-brass-400/40 bg-brass-50/40 p-6 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-lg text-ink-900">Pedigree read</h2>
        <span className="shrink-0 rounded-full bg-brass-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brass-700 ring-1 ring-brass-400/40">
          Industry context · AI
        </span>
      </div>

      {state.loading ? (
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-ink/10" />
          <div className="h-3 w-11/12 animate-pulse rounded bg-ink/10" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-ink/10" />
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-ink-800">{state.brief}</p>
          <p className="mt-4 border-t border-brass-400/30 pt-3 text-[11px] italic leading-relaxed text-ink-500">
            Qualitative pedigree context from industry knowledge — not verified
            sales data, and separate from the valuation above. Weigh it, don&apos;t
            bank on it.
          </p>
        </>
      )}
    </section>
  );
}
