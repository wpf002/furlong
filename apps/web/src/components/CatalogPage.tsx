import { parseCatalogPage } from '../lib/catalogPage';

// Renders the parsed catalog "black-type page" in the app's theme. Black-type
// winners (printed in CAPS in the catalog) are emphasized; graded/listed stakes
// tags become small inline pills so quality reads at a glance.

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

const ORDINAL: Record<string, string> = { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '5': '5th', '6': '6th' };
const damLabel = (l: string) => `${ORDINAL[l] ?? `${l}th`} Dam`;

// Title-case a short tag while leaving all-caps acronyms (KTDF) intact.
const titleCase = (s: string) =>
  s.replace(/\b[\w'’]+\b/g, (w) =>
    w.length <= 4 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
  );

export function CatalogPage({ text }: { text: string }) {
  const page = parseCatalogPage(text);
  if (!page) return null;
  const { sire, dams, engagements } = page;

  return (
    <section className="mt-6 rounded-2xl border border-ink/10 bg-paper-50 p-6 shadow-card sm:p-8">
      <h2 className="font-serif text-2xl tracking-tightish text-racing-900">Catalog Page</h2>
      <div className="rule-brass mt-3 max-w-[3.5rem]" />

      {sire && (
        <div className="mt-7">
          <h3 className="font-serif text-lg text-ink-900">Sire</h3>
          <p className="mt-2 text-[15px] leading-7 text-ink-700">{rich(sire, 'sire')}</p>
        </div>
      )}

      {dams.length > 0 && (
        <div className="mt-8">
          <h3 className="font-serif text-lg text-ink-900">Dam</h3>
          <div className="mt-4 space-y-7">
            {dams.map((d) => (
              <div key={d.label} className="border-l-2 border-brass-400/50 pl-4">
                <p className="text-[15px] leading-7 text-ink-900">
                  <span className="mr-2 align-middle text-[10px] font-semibold uppercase tracking-[0.14em] text-brass-600">
                    {damLabel(d.label)}
                  </span>
                  {rich(d.name, `${d.label}-n`)}
                </p>
                {d.entries.length > 0 && (
                  <ul className="mt-2.5 space-y-2">
                    {d.entries.map((e, idx) => (
                      <li key={idx} className="flex gap-2.5 text-[14px] leading-6 text-ink-600">
                        <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-brass-400/70" />
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
        <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-5">
          {engagements.map((e) => (
            <span
              key={e}
              className="rounded-full bg-racing-700/10 px-2.5 py-1 text-xs font-medium text-racing-800"
            >
              {titleCase(e)}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
