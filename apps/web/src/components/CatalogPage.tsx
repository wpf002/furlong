import { Fragment } from 'react';
import { parseCatalogPage } from '../lib/catalogPage';

// Renders the parsed catalog "black-type page" in the app's theme. Black-type
// winners (printed in CAPS in the catalog) are emphasized; graded/listed stakes
// tags become small pills so quality reads at a glance.

const GRADE_STYLE: Record<string, string> = {
  G1: 'bg-brass-100 text-brass-800 ring-1 ring-brass-400/50',
  G2: 'bg-racing-700/12 text-racing-800 ring-1 ring-racing-700/20',
  G3: 'bg-ink/8 text-ink-700 ring-1 ring-ink/15',
  L: 'bg-paper-200 text-ink-600 ring-1 ring-ink/15',
  LR: 'bg-paper-200 text-ink-600 ring-1 ring-ink/15',
};

// Tokenize a line into graded-stakes pills, emphasized black-type names, and
// plain text. Names are runs of ≥4 caps (skips 2–3-letter track codes).
const TOKEN = /(\[(?:G[123]|LR|L)\])|(\b[A-Z][A-Z'’]{3,}(?:\s+[A-Z][A-Z'’]+)*\b)/g;

function rich(text: string, k: string) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  let n = 0;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      const g = m[1].slice(1, -1);
      nodes.push(
        <span
          key={`${k}-${n++}`}
          className={`mx-0.5 inline-block rounded px-1 text-[9px] font-bold uppercase tracking-wide align-middle ${GRADE_STYLE[g] ?? GRADE_STYLE.L}`}
        >
          {g}
        </span>,
      );
    } else {
      nodes.push(
        <span key={`${k}-${n++}`} className="font-semibold text-racing-900">
          {m[2]}
        </span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Pill({ label, n }: { label: string; n: number }) {
  if (!n) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${GRADE_STYLE[label] ?? GRADE_STYLE.L}`}>
      {label} <span className="tnum opacity-70">×{n}</span>
    </span>
  );
}

export function CatalogPage({ text }: { text: string }) {
  const page = parseCatalogPage(text);
  if (!page) return null;
  const { sire, dams, engagements, counts } = page;
  const hasBlackType = counts.g1 + counts.g2 + counts.g3 + counts.listed > 0;

  return (
    <section className="mt-6 rounded-2xl border border-ink/10 bg-paper-50 p-6 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg text-ink-900">Catalog page</h2>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-500">
            Black-type pedigree
          </p>
        </div>
        {hasBlackType && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill label="G1" n={counts.g1} />
            <Pill label="G2" n={counts.g2} />
            <Pill label="G3" n={counts.g3} />
            <Pill label="L" n={counts.listed} />
          </div>
        )}
      </div>

      {sire && (
        <div className="mt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brass-600">
            Sire
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-700">{rich(sire, 'sire')}</p>
        </div>
      )}

      {dams.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brass-600">
            Female family
          </h3>
          <div className="mt-2 max-h-[28rem] space-y-4 overflow-y-auto pr-1">
            {dams.map((d) => (
              <div key={d.label} className="border-l-2 border-brass-400/40 pl-3">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 rounded bg-ink/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-500">
                    {d.label} dam
                  </span>
                  <p className="font-serif text-sm leading-snug text-ink-900">{rich(d.name, `${d.label}-n`)}</p>
                </div>
                {d.entries.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {d.entries.map((e, idx) => (
                      <li key={idx} className="flex gap-1.5 text-[13px] leading-relaxed text-ink-600">
                        <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brass-400/60" />
                        <span>{rich(e, `${d.label}-${idx}`)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {engagements.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-ink/10 pt-4">
          {engagements.map((e) => (
            <span key={e} className="rounded-full bg-racing-700/10 px-2 py-0.5 text-[10px] font-medium text-racing-800">
              {e}
            </span>
          ))}
        </div>
      )}

      <details className="mt-4 border-t border-ink/10 pt-3">
        <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-ink-500 hover:text-ink-700">
          View original catalog page
        </summary>
        <div className="mt-3 max-h-[32rem] overflow-auto">
          <pre className="whitespace-pre font-mono text-[11px] leading-relaxed text-ink-700">{text}</pre>
        </div>
      </details>
    </section>
  );
}
