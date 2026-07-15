import { describe, it, expect } from 'vitest';
import { scoreValuation, aggregateScores, type HipScore } from '@furlong/shared';

// A valuation with a market-estimate band of $40k–$80k (mid $60k) and a
// pedigree-value band of $50k–$90k (mid $70k), in cents.
const V = {
  predPriceLowCents: 40_000_00,
  predPriceHighCents: 80_000_00,
  estValueLowCents: 50_000_00,
  estValueHighCents: 90_000_00,
};

describe('scoreValuation', () => {
  it('scores an actual inside the market band as within-band with the right error', () => {
    const s = scoreValuation(60_000_00, V)!; // sold exactly at the mid
    expect(s.withinPredBand).toBe(true);
    expect(s.predAbsPctError).toBeCloseTo(0, 6);
    expect(s.predDeltaPct).toBeCloseTo(0, 6);
    expect(s.predErrorFactor).toBeCloseTo(1, 6);
  });

  it('flags an actual above the band and reports signed delta + error factor', () => {
    const s = scoreValuation(120_000_00, V)!; // 2× the $60k mid
    expect(s.withinPredBand).toBe(false);
    expect(s.predDeltaPct).toBeCloseTo(1, 6); // +100% above mid
    expect(s.predAbsPctError).toBeCloseTo(0.5, 6); // |120-60|/120
    expect(s.predErrorFactor).toBeCloseTo(2, 6); // off by 2×
  });

  it('scores the pedigree-value band independently', () => {
    const s = scoreValuation(55_000_00, V)!; // inside est ($50k–$90k), inside pred ($40k–$80k)
    expect(s.withinEstBand).toBe(true);
    expect(s.estMidCents).toBe(70_000_00);
  });

  it('returns null for a non-positive price', () => {
    expect(scoreValuation(0, V)).toBeNull();
    expect(scoreValuation(-1, V)).toBeNull();
  });

  it('accepts bigint cents (as Prisma emits)', () => {
    const s = scoreValuation(60_000_00, {
      predPriceLowCents: 40_000_00n,
      predPriceHighCents: 80_000_00n,
      estValueLowCents: 50_000_00n,
      estValueHighCents: 90_000_00n,
    })!;
    expect(s.withinPredBand).toBe(true);
  });
});

describe('aggregateScores', () => {
  it('returns null for an empty set', () => {
    expect(aggregateScores([])).toBeNull();
  });

  it('aggregates coverage, median error and signed bias', () => {
    const scores = [60_000_00, 70_000_00, 120_000_00, 30_000_00]
      .map((a) => scoreValuation(a, V))
      .filter((x): x is HipScore => x !== null);
    const card = aggregateScores(scores)!;
    expect(card.n).toBe(4);
    // $60k and $70k land inside $40k–$80k; $120k and $30k do not → 2/4.
    expect(card.pctWithinPredBand).toBeCloseTo(0.5, 6);
    expect(card.medianAbsPctError).toBeGreaterThan(0);
    expect(card.medianErrorFactor).toBeGreaterThanOrEqual(1);
  });
});
