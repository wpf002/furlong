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
    <section className="mt-6 rounded-2xl border border-brass-400/40 bg-brass-50/40 p-6 shadow-card sm:p-8">
      <h2 className="font-serif text-xl text-ink-900">Pedigree Read</h2>
      <div className="rule-brass mt-3 max-w-[3.5rem]" />

      {state.loading ? (
        <div className="mt-5 space-y-2.5">
          <div className="h-3.5 w-full animate-pulse rounded bg-ink/10" />
          <div className="h-3.5 w-11/12 animate-pulse rounded bg-ink/10" />
          <div className="h-3.5 w-4/5 animate-pulse rounded bg-ink/10" />
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-3">{renderBrief(state.brief ?? '')}</div>
          <p className="mt-5 border-t border-brass-400/30 pt-4 text-xs italic leading-relaxed text-ink-500">
            Qualitative pedigree context from industry knowledge — not verified
            sales data, and separate from the valuation above. Weigh it, don&apos;t
            bank on it.
          </p>
        </>
      )}
    </section>
  );
}

// Render the brief as clean prose: drop a leading redundant "**Pedigree Read: …**"
// title, split into paragraphs, and turn **bold** into real emphasis instead of
// showing literal asterisks.
function renderInline(s: string, key: string) {
  return s.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={`${key}-${i}`} className="font-semibold text-ink-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

function renderBrief(raw: string) {
  const text = raw.trim().replace(/^\*\*[^*]*\*\*\s*/, ''); // strip leading title
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => (
      <p key={i} className="text-[15px] leading-7 text-ink-800">
        {renderInline(p, String(i))}
      </p>
    ));
}
