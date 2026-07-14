import type { PedigreeGrade } from '../lib/api';

// A+ … F pedigree grade badge. Two sources feed the grade (see api pedigreeGrade):
// an EXPERT hand-analyzed read where one is held for the hip, otherwise the
// black-type HEURISTIC (family black-type depth + sire class). Tiered colour;
// the tooltip explains the basis — the expert read's note, or the black type
// behind a heuristic grade.

// Colour by letter tier; +/- within a letter share the tier's palette.
const STYLE: Record<string, string> = {
  'A+': 'bg-brass-100 text-brass-800 ring-brass-400/60',
  A: 'bg-brass-50 text-brass-700 ring-brass-400/45',
  'A-': 'bg-brass-50 text-brass-700 ring-brass-400/45',
  'B+': 'bg-racing-700/12 text-racing-800 ring-racing-700/25',
  B: 'bg-racing-700/10 text-racing-800 ring-racing-700/20',
  'B-': 'bg-racing-700/8 text-racing-800 ring-racing-700/15',
  'C+': 'bg-ink/10 text-ink-600 ring-ink/18',
  C: 'bg-ink/8 text-ink-600 ring-ink/15',
  'C-': 'bg-ink/6 text-ink-500 ring-ink/12',
  D: 'bg-ink/5 text-ink-500 ring-ink/12',
  F: 'bg-red-50 text-red-600 ring-red-200',
};

export function GradeBadge({ g, size = 'sm' }: { g: PedigreeGrade; size?: 'sm' | 'lg' }) {
  let title: string;
  if (g.source === 'expert') {
    title =
      `Pedigree grade ${g.grade} (score ${g.score}) — expert pedigree read` +
      (g.note ? `. ${g.note}` : '.');
  } else {
    const basis = [
      g.g1 && `${g.g1}×G1`,
      g.g2 && `${g.g2}×G2`,
      g.g3 && `${g.g3}×G3`,
      g.listed && `${g.listed}×L`,
    ]
      .filter(Boolean)
      .join(', ');
    title =
      `Pedigree grade ${g.grade} (score ${g.score}) — black type in the family: ` +
      `${basis || 'none on the page'}`;
  }

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md font-bold ring-1 ${
        size === 'lg' ? 'px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-[11px]'
      } ${STYLE[g.grade] ?? STYLE.C}`}
    >
      <span
        className={`font-semibold uppercase tracking-wide opacity-60 ${
          size === 'lg' ? 'text-[9px]' : 'text-[8px]'
        }`}
      >
        Pedigree
      </span>
      {g.grade}
    </span>
  );
}
