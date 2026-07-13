// A+ … F pedigree grade for a hip. Two sources feed it, best-first:
//
//  1. EXPERT — a hand-analyzed pedigree read, where we hold one for the hip (see
//     data/ftJuly2026Pedigree.ts). This is authoritative: it scores signals a
//     catalog page can't expose (first-dam production, juvenile evidence,
//     sire-line reliability, sire-projection confidence).
//  2. HEURISTIC — the Secretariat Pedigree Intelligence System's grading model,
//     derived from the catalog black-type page. The measurable signals there are
//     the sire's own racing class and the black type in the FEMALE FAMILY,
//     weighted by proximity: the 1st/2nd dam count far more than distant
//     relatives (every page has deep-family black type, so an unweighted count
//     saturates).
//
// Either way it's a pedigree-quality read — not a valuation, not race-specific.

import { expertPedigreeFor } from './data/ftJuly2026Pedigree.js';

export type Grade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F';

export interface PedigreeGrade {
  grade: Grade;
  score: number; // 0–100
  source: 'expert' | 'heuristic';
  // Female-family black type behind a HEURISTIC grade (all 0 for expert grades,
  // which aren't derived from page black-type counts).
  g1: number;
  g2: number;
  g3: number;
  listed: number;
  // EXPERT enrichment — present only when source === 'expert'.
  confidence?: 'High' | 'Medium' | 'Low';
  note?: string; // the hip's most actionable lineage read ("hidden angle")
}

// Weighted black-type "points" in a slice of the page.
function btPoints(s: string, g1: number, g2: number, g3: number, l: number): number {
  const c = (re: RegExp) => (s.match(re) ?? []).length;
  return (
    c(/\[G1\]/g) * g1 + c(/\[G2\]/g) * g2 + c(/\[G3\]/g) * g3 + (c(/\[L\]/g) + c(/\[LR\]/g)) * l
  );
}

const damAt = (text: string, n: number) =>
  text.search(new RegExp(`\\n\\s*${n}(?:st|nd|rd|th)\\s+dam`, 'i'));

/**
 * Black-type heuristic grade from the catalog page text alone. Returns null when
 * there's no page to read. Prefer {@link pedigreeGradeForHip}, which layers an
 * expert read on top where we hold one.
 */
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
  const sireTop = /\[G1\]/.test(sireBlock)
    ? 22
    : /\[G2\]/.test(sireBlock)
      ? 15
      : /\[G3\]/.test(sireBlock)
        ? 9
        : 0;

  // Proximity-weighted female-family black type. 1st dam ≫ 2nd dam ≫ deep family.
  const p1 = btPoints(dam1, 9, 6, 3.5, 1.5);
  const p2 = btPoints(dam2, 3.5, 2.2, 1.2, 0.5);
  const pDeep = Math.min(9, btPoints(deep, 0.6, 0.4, 0.22, 0.08));

  const score = Math.max(20, Math.min(100, Math.round(30 + sireTop + p1 + p2 + pDeep)));
  const n = (re: RegExp) => (text.match(re) ?? []).length;

  // Confidence in the read from how much the page actually gives us: a proven
  // sire class plus close-up (1st/2nd-dam) black type reads high; a page with
  // neither is thin and speculative.
  const closeUpBlackType = p1 + p2 > 0;
  const confidence: PedigreeGrade['confidence'] =
    sireTop > 0 && closeUpBlackType
      ? 'High'
      : sireTop === 0 && !closeUpBlackType
        ? 'Low'
        : 'Medium';

  return {
    grade: gradeForScore(score),
    score,
    source: 'heuristic',
    g1: n(/\[G1\]/g),
    g2: n(/\[G2\]/g),
    g3: n(/\[G3\]/g),
    listed: n(/\[L\]|\[LR\]/g),
    confidence,
  };
}

// Score → letter band. Shared so heuristic and expert scores read on one scale.
// Thresholds mirror the expert dataset's own bands (A-/B+/B/B-/C+/C … at
// 80/75/70/65/60/55) extended upward for the rare elite page.
export function gradeForScore(score: number): Grade {
  if (score >= 90) return 'A+';
  if (score >= 84) return 'A';
  if (score >= 80) return 'A-';
  if (score >= 75) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 65) return 'B-';
  if (score >= 60) return 'C+';
  if (score >= 55) return 'C';
  if (score >= 50) return 'C-';
  if (score >= 45) return 'D';
  return 'F';
}

export interface HipForGrade {
  auctionHouse: string;
  saleName: string;
  year: number;
  hipNumber: number;
  sireName: string | null;
  catalogPageText: string | null | undefined;
}

/**
 * Best available pedigree grade for a hip: the expert read where we hold one for
 * this sale + hip, otherwise the black-type heuristic (or null when neither is
 * available). This is the entry point call sites should use.
 */
export function pedigreeGradeForHip(hip: HipForGrade): PedigreeGrade | null {
  const expert = expertPedigreeFor({
    auctionHouse: hip.auctionHouse,
    saleName: hip.saleName,
    year: hip.year,
    hipNumber: hip.hipNumber,
    sireName: hip.sireName,
  });
  if (expert) {
    return {
      grade: expert.grade,
      score: expert.score,
      source: 'expert',
      g1: 0,
      g2: 0,
      g3: 0,
      listed: 0,
      confidence: expert.confidence,
      note: expert.hiddenAngle,
    };
  }
  return computePedigreeGrade(hip.catalogPageText);
}
