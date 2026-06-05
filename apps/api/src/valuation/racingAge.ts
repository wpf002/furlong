import { prisma } from '@furlong/db';

/**
 * Phase 4 — horses-in-training / 2YO valuation (a second non-yearling path).
 *
 * A racing-age horse's value combines two signals:
 *   1. PEDIGREE — sire-level comparables, drawn from sold 2YO-in-training prices
 *      where available and backfilled with yearling sire comparables (the
 *      broadest deterministic base we hold).
 *   2. RACING RECORD — when a licensed feed has populated Horse.starts/wins/
 *      earnings/bestSpeedFigure, a deterministic multiplier nudges the pedigree
 *      band up for proven performers. With no record (dev default), the path
 *      degrades cleanly to pedigree comparables — honest, never invented.
 *
 * Deterministic comparables + a transparent multiplier. No LLM in the number.
 */
const MODEL_VERSION = 'racing-age-comparables-1.1.0';
const MIN_SIRE = 6;

/**
 * Breeze (under-tack) premium, relative to the sale's median work. A 2YO that
 * breezes faster than its peers commands a premium — for fresh juveniles with no
 * race record yet, the work IS the signal. `breezeSeconds` is normalized to
 * seconds-per-furlong (lower = faster), so a hip below the sale median lifts the
 * band and a slow work discounts it. Bounded; no breeze -> 1.0 (unchanged).
 */
function breezeMultiplier(breezeSeconds: number | null, saleMedian: number | null): number {
  if (!breezeSeconds || !saleMedian || saleMedian <= 0) return 1.0;
  const faster = (saleMedian - breezeSeconds) / saleMedian; // + when faster than median
  return Math.max(0.8, Math.min(1.3, 1 + faster * 3));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}
const r100 = (n: number) => Math.round(n / 100) * 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Sold-horse prices keyed by sire normalizedName, for the given sale categories. */
async function sirePricesByCategory(
  categories: string[],
): Promise<Map<string, number[]>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ sirenorm: string; price: bigint }>>(
    `SELECT sire."normalizedName" AS sirenorm, r."priceCents" AS price
     FROM "SaleResult" r
     JOIN "Hip" h   ON h."id" = r."hipId"
     JOIN "Sale" s  ON s."id" = h."saleId"
     JOIN "Horse" yh ON yh."id" = h."horseId"
     JOIN "Horse" sire ON sire."id" = yh."sireId"
     WHERE r."rna" = false AND r."priceCents" > 0
       AND s."category" = ANY($1::"SaleCategory"[])
       AND sire."normalizedName" IS NOT NULL`,
    categories,
  );
  const m = new Map<string, number[]>();
  for (const row of rows) {
    const arr = m.get(row.sirenorm) ?? [];
    arr.push(Number(row.price));
    m.set(row.sirenorm, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a - b);
  return m;
}

interface RacingRecord {
  starts: number | null;
  wins: number | null;
  earningsCents: bigint | null;
  bestSpeedFigure: number | null;
}

/**
 * Deterministic uplift from a racing record. A maiden / unraced horse returns
 * 1.0 (pedigree band unchanged). Proven horses scale up, bounded so a hot record
 * can't run away from the comparable base.
 */
function racingMultiplier(rec: RacingRecord): number {
  const starts = rec.starts ?? 0;
  if (starts <= 0) return 1.0;
  const wins = rec.wins ?? 0;
  const winRate = clamp(wins / starts, 0, 1);
  // Win rate contributes up to +40%; a strong speed figure up to +25%.
  const figure = rec.bestSpeedFigure ?? 0;
  const figBoost = figure > 0 ? clamp((figure - 80) / 40, 0, 1) * 0.25 : 0;
  return 1 + winRate * 0.4 + figBoost;
}

export interface RacingAgeValueResult {
  valued: number;
}

/**
 * Value every horse in a TWO_YEAR_OLD (in-training) sale by sire comparables,
 * adjusted by racing record where present. Appends a Valuation per hip.
 */
export async function valuateRacingAgeSale(saleId: string): Promise<RacingAgeValueResult> {
  // Prefer in-training comps; backfill with yearling comps for thin sires.
  const trainingComps = await sirePricesByCategory(['TWO_YEAR_OLD']);
  const yearlingComps = await sirePricesByCategory(['YEARLING']);
  // Global fallback band: all in-training prices, else all yearling prices.
  const allTraining = [...trainingComps.values()].flat().sort((a, b) => a - b);
  const allYearling = [...yearlingComps.values()].flat().sort((a, b) => a - b);
  const globalBase = allTraining.length >= 20 ? allTraining : allYearling;

  const hips = await prisma.hip.findMany({
    where: { saleId },
    include: {
      horse: {
        select: {
          sire: { select: { normalizedName: true } },
          starts: true,
          wins: true,
          earningsCents: true,
          bestSpeedFigure: true,
        },
      },
    },
  });

  // Sale-wide median breeze (seconds/furlong) — the reference for the premium.
  const breezes = hips
    .map((h) => h.breezeSeconds)
    .filter((b): b is number => b != null && b > 0)
    .sort((a, b) => a - b);
  const saleBreezeMedian = breezes.length ? percentile(breezes, 0.5) : null;

  let valued = 0;
  for (const hip of hips) {
    const sireNorm = hip.horse.sire?.normalizedName ?? null;
    let prices = sireNorm ? trainingComps.get(sireNorm) ?? [] : [];
    let limited = prices.length < MIN_SIRE;
    if (limited && sireNorm) {
      const yl = yearlingComps.get(sireNorm) ?? [];
      if (yl.length > prices.length) prices = yl;
    }
    if (prices.length === 0) prices = globalBase;
    limited = limited || prices.length < MIN_SIRE;
    if (prices.length === 0) prices = [0];

    const mult = racingMultiplier(hip.horse);
    const breezeMult = breezeMultiplier(hip.breezeSeconds, saleBreezeMedian);
    const hasRecord = (hip.horse.starts ?? 0) > 0;
    const hasBreeze = hip.breezeSeconds != null;
    const combined = mult * breezeMult;

    const low = r100(percentile(prices, 0.25) * combined);
    const mid = r100(percentile(prices, 0.5) * combined);
    const high = r100(percentile(prices, 0.75) * combined);

    // More comps + a real record or a timed work => more confidence; still
    // capped (these markets are wide). Maidens with thin sire data land low.
    const base = hasRecord || hasBreeze ? 0.45 : 0.3;
    const confidence = clamp(base * Math.min(1, prices.length / 30) + 0.15, 0.1, 0.95);

    await prisma.valuation.create({
      data: {
        hipId: hip.id,
        estValueLowCents: BigInt(low),
        estValueHighCents: BigInt(high),
        predPriceLowCents: BigInt(low),
        predPriceHighCents: BigInt(high),
        confidence,
        hiddenGemScore: null,
        limitedComparables: limited,
        modelVersion: MODEL_VERSION,
        features: {
          sireComps: prices.length,
          racingMultiplier: Number(mult.toFixed(3)),
          breezeMultiplier: Number(breezeMult.toFixed(3)),
          breezeSeconds: hip.breezeSeconds ?? null,
          starts: hip.horse.starts ?? 0,
          wins: hip.horse.wins ?? 0,
          bestSpeedFigure: hip.horse.bestSpeedFigure ?? null,
        },
      },
    });
    valued += 1;
  }
  return { valued };
}
