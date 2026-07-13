// A+ … F pedigree grade for a hip, derived from its catalog black-type page —
// the Secretariat Pedigree Intelligence System's grading model, adapted for a
// SALES yearling (no race assignment yet). The measurable signals on a catalog
// page are the sire's own racing class and the black type in the FEMALE FAMILY,
// weighted by proximity: the 1st/2nd dam count far more than distant relatives
// (every page has deep-family black type, so an unweighted count saturates).
// It's a pedigree-quality heuristic — not a valuation, not race-specific.

export interface PedigreeGrade {
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F';
  score: number; // 0–100
  g1: number;
  g2: number;
  g3: number;
  listed: number;
}

// Weighted black-type "points" in a slice of the page.
function btPoints(s: string, g1: number, g2: number, g3: number, l: number): number {
  const c = (re: RegExp) => (s.match(re) ?? []).length;
  return c(/\[G1\]/g) * g1 + c(/\[G2\]/g) * g2 + c(/\[G3\]/g) * g3 + (c(/\[L\]/g) + c(/\[LR\]/g)) * l;
}

const damAt = (text: string, n: number) => text.search(new RegExp(`\\n\\s*${n}(?:st|nd|rd|th)\\s+dam`, 'i'));

export function computePedigreeGrade(text: string | null | undefined): PedigreeGrade | null {
  if (!text || !text.trim()) return null;

  const i1 = damAt(text, 1);
  const i2 = damAt(text, 2);
  const i3 = damAt(text, 3);
  const end = text.length;
  const sireBlock = text.slice(0, i1 < 0 ? end : i1);
  const dam1 = i1 < 0 ? '' : text.slice(i1, i2 < 0 ? end : i2);
  const dam2 = i2 < 0 ? '' : text.slice(i2, i3 < 0 ? end : i3);
  const deep = i3 < 0 ? '' : text.slice(i3);

  // Sire's own top black type (from the "By SIRE …" summary), weighted highest.
  const sireTop = /\[G1\]/.test(sireBlock) ? 22 : /\[G2\]/.test(sireBlock) ? 15 : /\[G3\]/.test(sireBlock) ? 9 : 0;

  // Proximity-weighted female-family black type. 1st dam ≫ 2nd dam ≫ deep family.
  const p1 = btPoints(dam1, 9, 6, 3.5, 1.5);
  const p2 = btPoints(dam2, 3.5, 2.2, 1.2, 0.5);
  const pDeep = Math.min(9, btPoints(deep, 0.6, 0.4, 0.22, 0.08));

  const score = Math.max(20, Math.min(100, Math.round(30 + sireTop + p1 + p2 + pDeep)));
  const grade: PedigreeGrade['grade'] =
    score >= 90 ? 'A+' : score >= 83 ? 'A' : score >= 75 ? 'B+' : score >= 68 ? 'B' : score >= 60 ? 'C' : score >= 50 ? 'D' : 'F';

  const n = (re: RegExp) => (text.match(re) ?? []).length;
  return { grade, score, g1: n(/\[G1\]/g), g2: n(/\[G2\]/g), g3: n(/\[G3\]/g), listed: n(/\[L\]|\[LR\]/g) };
}
