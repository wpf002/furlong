// Prediction scoring — compares a hip's model prediction against its realized
// auction price once a completed sale's results are loaded. Pure functions (no
// DB, no I/O) so they're trivially unit-testable and shared by API + web.
//
// "Within band" is measured against the MARKET ESTIMATE band (predPrice) — the
// full-context prediction a buyer bids against. The pedigree-value band is
// scored too, for the pedigree-vs-market comparison, but the headline accuracy
// number is the market estimate.

export interface ValuationBandsCents {
  estValueLowCents: number | bigint;
  estValueHighCents: number | bigint;
  predPriceLowCents: number | bigint;
  predPriceHighCents: number | bigint;
}

export interface HipScore {
  actualCents: number;
  // Market estimate (predPrice) — the headline prediction.
  predMidCents: number;
  withinPredBand: boolean;
  predDeltaPct: number; // signed: (actual - predMid) / predMid  (+ = sold above estimate)
  predAbsPctError: number; // |actual - predMid| / actual   (0..∞)
  predErrorFactor: number; // exp(|ln(actual) - ln(predMid)|) — "off by Nx"
  // Pedigree value (estValue).
  estMidCents: number;
  withinEstBand: boolean;
}

const num = (x: number | bigint): number => (typeof x === 'bigint' ? Number(x) : x);

/**
 * Score one realized price against one valuation. Returns null when the inputs
 * can't be scored (non-positive price or prediction).
 */
export function scoreValuation(
  actualCents: number | bigint,
  v: ValuationBandsCents,
): HipScore | null {
  const actual = num(actualCents);
  if (!(actual > 0)) return null;

  const predLow = num(v.predPriceLowCents);
  const predHigh = num(v.predPriceHighCents);
  const estLow = num(v.estValueLowCents);
  const estHigh = num(v.estValueHighCents);
  const predMid = (predLow + predHigh) / 2;
  const estMid = (estLow + estHigh) / 2;
  if (!(predMid > 0)) return null;

  return {
    actualCents: actual,
    predMidCents: predMid,
    withinPredBand: actual >= predLow && actual <= predHigh,
    predDeltaPct: (actual - predMid) / predMid,
    predAbsPctError: Math.abs(actual - predMid) / actual,
    predErrorFactor: Math.exp(Math.abs(Math.log(actual) - Math.log(predMid))),
    estMidCents: estMid,
    withinEstBand: estMid > 0 && actual >= estLow && actual <= estHigh,
  };
}

export interface Scorecard {
  n: number; // hips scored (sold, with a valuation)
  medianAbsPctError: number; // 0..1+  (0.2 = typically 20% off)
  meanAbsPctError: number;
  medianErrorFactor: number; // e.g. 1.6 = "typically off by 1.6×"
  pctWithinPredBand: number; // 0..1  — share whose actual landed inside the estimate band
  medianDeltaPct: number; // signed bias: + = the market paid above our estimate on the whole
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Aggregate per-hip scores into a sale-level accuracy scorecard. */
export function aggregateScores(scores: HipScore[]): Scorecard | null {
  if (scores.length === 0) return null;
  const absErr = scores.map((s) => s.predAbsPctError);
  return {
    n: scores.length,
    medianAbsPctError: median(absErr),
    meanAbsPctError: absErr.reduce((a, b) => a + b, 0) / absErr.length,
    medianErrorFactor: median(scores.map((s) => s.predErrorFactor)),
    pctWithinPredBand: scores.filter((s) => s.withinPredBand).length / scores.length,
    medianDeltaPct: median(scores.map((s) => s.predDeltaPct)),
  };
}
