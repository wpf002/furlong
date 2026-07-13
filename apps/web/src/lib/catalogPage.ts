// Parse a sales-catalog "black-type page" (as captured verbatim into
// Hip.catalogPageText) into structured sections: the sire summary, the female
// family (1st–Nth dam, each with its produce entries), engagements, and a
// black-type tally. Tuned to the Fasig-Tipton / Jockey Club catalog format
// (indent 0 = dam name, ~3 = a produce entry, ~5+ = a wrapped continuation).

export interface DamBlock {
  label: string; // "1st", "2nd", …
  name: string; // the dam (e.g. "PLACERITA, by Gilded Time")
  entries: string[]; // her produce, one per horse
}

export interface CatalogPage {
  sire: string | null; // the "By SIRE …" summary paragraph
  dams: DamBlock[];
  engagements: string[]; // "Breeders' Cup nominated", "KTDF", …
  counts: { g1: number; g2: number; g3: number; listed: number };
}

const DAM_RE = /^\s*(\d)(?:st|nd|rd|th)\s+dam\s*$/;
const CONT_INDENT = 5; // lines indented ≥ this join the previous entry
const ENGAGE_RE = /(breeders'?\s*cup|ktdf|eligible|engagement|nominated|registered|sold with)/i;

const indentOf = (l: string) => (l.match(/^ */)?.[0].length ?? 0);

/** Join wrapped lines within one section into logical entries. A line indented
 *  ≥ CONT_INDENT (or the first line) continues the current entry; a shallower
 *  line starts a new one. De-hyphenates across the break. */
function toEntries(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (out.length === 0 || indentOf(raw) < CONT_INDENT) {
      out.push(raw.trim());
    } else {
      const prev = out[out.length - 1] as string;
      out[out.length - 1] = /[A-Za-z]-$/.test(prev)
        ? prev.slice(0, -1) + raw.trim()
        : prev + ' ' + raw.trim();
    }
  }
  return out;
}

export function parseCatalogPage(raw: string | null | undefined): CatalogPage | null {
  if (!raw || !raw.trim()) return null;
  const lines = raw.split('\n');

  // Skip the header/pedigree-tree block: start at the "By SIRE …" line.
  let i = lines.findIndex((l) => /^\s*By\s+[A-Z]/.test(l));
  if (i < 0) return null;

  const sections: { label: string; lines: string[] }[] = [{ label: 'By', lines: [] }];
  for (; i < lines.length; i++) {
    const line = lines[i] as string;
    const m = line.match(DAM_RE);
    if (m) sections.push({ label: m[1] as string, lines: [] });
    else (sections[sections.length - 1] as { lines: string[] }).lines.push(line);
  }

  let sire: string | null = null;
  const dams: DamBlock[] = [];
  const engagements: string[] = [];

  for (const sec of sections) {
    const entries = toEntries(sec.lines);
    if (sec.label === 'By') {
      sire = entries.join(' ').replace(/^By\s+/, '').trim() || null;
    } else {
      // Peel trailing eligibility lines (short, indent-0) off the last block.
      while (
        entries.length &&
        ENGAGE_RE.test(entries[entries.length - 1] as string) &&
        (entries[entries.length - 1] as string).length < 60
      ) {
        engagements.unshift((entries.pop() as string).replace(/\.$/, ''));
      }
      const [name, ...produce] = entries;
      if (name) dams.push({ label: sec.label, name, entries: produce });
    }
  }

  const count = (re: RegExp) => (raw.match(re) ?? []).length;
  return {
    sire,
    dams,
    engagements,
    counts: {
      g1: count(/\[G1\]/g),
      g2: count(/\[G2\]/g),
      g3: count(/\[G3\]/g),
      listed: count(/\[L\]|\[LR\]/g),
    },
  };
}
