import { describe, expect, it } from 'vitest';
import { computePedigreeGrade, gradeForScore, pedigreeGradeForHip } from './pedigreeGrade.js';
import { expertPedigreeFor } from './data/ftJuly2026Pedigree.js';

const FT_JULY = { auctionHouse: 'FASIG_TIPTON', saleName: 'The July Sale', year: 2026 } as const;

describe('gradeForScore', () => {
  it('bands scores onto the fine scale used by the expert dataset', () => {
    expect(gradeForScore(92)).toBe('A+');
    expect(gradeForScore(83)).toBe('A-');
    expect(gradeForScore(80)).toBe('A-');
    expect(gradeForScore(77)).toBe('B+');
    expect(gradeForScore(71)).toBe('B');
    expect(gradeForScore(66)).toBe('B-');
    expect(gradeForScore(62)).toBe('C+');
    expect(gradeForScore(56)).toBe('C');
    expect(gradeForScore(40)).toBe('F');
  });
});

describe('pedigreeGradeForHip — expert dataset (FT July 2026)', () => {
  it('uses the authoritative expert grade for a covered hip', () => {
    // Hip 73 (Cyberknife) is the top-ranked A- at score 83 in the source sheet.
    const g = pedigreeGradeForHip({
      ...FT_JULY,
      hipNumber: 73,
      sireName: 'Cyberknife',
      catalogPageText: null,
    });
    expect(g).not.toBeNull();
    expect(g!.source).toBe('expert');
    expect(g!.grade).toBe('A-');
    expect(g!.score).toBe(83);
    expect(g!.confidence).toBeDefined();
    expect(g!.note).toBeTruthy();
  });

  it('matches the sire case-/punctuation-insensitively', () => {
    const g = pedigreeGradeForHip({
      ...FT_JULY,
      hipNumber: 73,
      sireName: 'CYBERKNIFE',
      catalogPageText: null,
    });
    expect(g?.source).toBe('expert');
    expect(g?.grade).toBe('A-');
  });

  it('does NOT override when the sire disagrees (guards a renumbered catalog)', () => {
    // Wrong sire for hip 73 → no expert record, falls back to the heuristic
    // (null here, since there is no catalog page text to read).
    const g = pedigreeGradeForHip({
      ...FT_JULY,
      hipNumber: 73,
      sireName: 'Some Other Sire',
      catalogPageText: null,
    });
    expect(g).toBeNull();
  });

  it('does not apply the dataset to a different sale', () => {
    const g = pedigreeGradeForHip({
      auctionHouse: 'KEENELAND',
      saleName: 'September Yearlings',
      year: 2026,
      hipNumber: 73,
      sireName: 'Cyberknife',
      catalogPageText: null,
    });
    expect(g).toBeNull();
  });

  it('falls back to the heuristic for a hip the dataset does not cover', () => {
    const page =
      'By TAPIT (G1). \n1st dam\nSOME MARE, by X. Winner. Dam of GRADED ONE [G1], STAKES TWO [G2].';
    const g = pedigreeGradeForHip({
      ...FT_JULY,
      hipNumber: 99999,
      sireName: 'Tapit',
      catalogPageText: page,
    });
    expect(g?.source).toBe('heuristic');
  });
});

describe('computePedigreeGrade — heuristic', () => {
  it('returns null with no page text', () => {
    expect(computePedigreeGrade(null)).toBeNull();
    expect(computePedigreeGrade('   ')).toBeNull();
  });

  it('scores first-dam black type above deep-family black type', () => {
    const strong = computePedigreeGrade(
      'By SIRE [G1].\n1st dam\nDAM, by X. Dam of BIG [G1], BIG2 [G1].',
    );
    const deep = computePedigreeGrade(
      'By SIRE.\n1st dam\nDAM, by X.\n3rd dam\nOLD, by Y. Dam of FAR [G1], FAR2 [G1].',
    );
    expect(strong).not.toBeNull();
    expect(deep).not.toBeNull();
    expect(strong!.score).toBeGreaterThan(deep!.score);
    expect(strong!.source).toBe('heuristic');
  });

  it('emits a confidence for every heuristic read (platform runs on any catalog)', () => {
    const high = computePedigreeGrade('By SIRE [G1].\n1st dam\nDAM, by X. Dam of BIG [G1].');
    const low = computePedigreeGrade('By SIRE.\n1st dam\nDAM, by X. Unraced.');
    expect(high!.confidence).toBe('High');
    expect(low!.confidence).toBe('Low');
  });
});

describe('FT July 2026 dataset integrity', () => {
  it('carries a barn for covered hips (searchable on the grounds)', () => {
    const rec = expertPedigreeFor({
      auctionHouse: 'FASIG_TIPTON',
      saleName: 'The July Sale',
      year: 2026,
      hipNumber: 1,
      sireName: 'Olympiad',
    });
    expect(rec?.barn).toBe('6');
  });
});
