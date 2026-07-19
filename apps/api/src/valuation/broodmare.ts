import { request } from 'undici';
import { prisma } from '@furlong/db';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';
const TRAINED_VERSION = 'broodmare-gbm-1.1.0'; // 1.1: calibrated 50%-coverage band

interface TrainedPred {
  predLowCents: number;
  predHighCents: number;
  estLowCents: number;
  estHighCents: number;
  confidence: number;
  limitedComparables: boolean;
}

/**
 * Prefer the TRAINED broodmare model (quantile GBM keyed on produce record +
 * covering-sire/in-foal — ~2.1x held-out error vs the deterministic ~2.6x). The
 * ML service builds features from the DB and returns a band per mare hip; we
 * write the Valuations. Returns null when the model isn't trained or the call
 * fails, so the deterministic path below takes over — a valuation always lands.
 */
async function valuateBroodmareTrained(saleId: string): Promise<BroodmareValueResult | null> {
  let preds: Record<string, TrainedPred>;
  try {
    const res = await request(`${ML_SERVICE_URL}/value-broodmare-sale`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ saleId }),
      headersTimeout: 120_000,
      bodyTimeout: 120_000,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) return null;
    const json = (await res.body.json()) as { predictions?: Record<string, TrainedPred> };
    preds = json.predictions ?? {};
  } catch {
    return null;
  }
  const entries = Object.entries(preds);
  if (entries.length === 0) return null;

  let valued = 0;
  for (const [hipId, p] of entries) {
    await prisma.valuation.create({
      data: {
        hipId,
        estValueLowCents: BigInt(Math.round(p.estLowCents)),
        estValueHighCents: BigInt(Math.round(p.estHighCents)),
        predPriceLowCents: BigInt(Math.round(p.predLowCents)),
        predPriceHighCents: BigInt(Math.round(p.predHighCents)),
        confidence: p.confidence,
        hiddenGemScore: null,
        limitedComparables: p.limitedComparables,
        modelVersion: TRAINED_VERSION,
        features: {},
      },
    });
    valued += 1;
  }
  return { valued };
}

/**
 * Phase 4 — broodmare valuation (a working non-yearling path).
 *
 * A broodmare's value is driven by her PRODUCE RECORD: the sale prices her foals
 * fetched as yearlings. We derive that by name-matching her (normalizedName) to
 * the dams of yearlings in the existing data, then value her against comparable
 * sold broodmares in the same produce tier. Deterministic comparables — no LLM.
 */
const MODEL_VERSION = 'broodmare-comparables-1.1.0';
const MIN_TIER = 8;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

interface MareRacing {
  starts: number | null;
  wins: number | null;
  earningsCents: bigint | null;
  bestSpeedFigure: number | null;
}

/**
 * Premium from a mare's OWN race record. Produce record dominates a proven
 * producer's value, but black-type race ability is a real, separable signal —
 * and for a maiden mare (no produce yet) it's often the primary one. Deterministic
 * and bounded: a graded-stakes earner lifts the produce band by up to ~50%, a
 * minor winner barely moves it, an unraced/maiden mare returns 1.0 (unchanged).
 */
function mareRacingMultiplier(h: MareRacing): number {
  const starts = h.starts ?? 0;
  if (starts <= 0) return 1.0;
  const earnUsd = Number(h.earningsCents ?? 0n) / 100;
  // Log-scaled earnings premium: ~$10k -> 0, ~$1M -> +0.4.
  const earnBoost = earnUsd > 10_000
    ? clamp(Math.log10(earnUsd / 10_000) / 2, 0, 1) * 0.4
    : 0;
  const fig = h.bestSpeedFigure ?? 0;
  const figBoost = fig > 0 ? clamp((fig - 80) / 40, 0, 1) * 0.15 : 0;
  return 1 + earnBoost + figBoost;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (rank - lo);
}
const r100 = (n: number) => Math.round(n / 100) * 100;

interface Produce {
  nFoals: number;
  medianFoalCents: number;
}

/** Median yearling sale price of each dam's foals, keyed by dam normalizedName. */
async function produceByDam(): Promise<Map<string, Produce>> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ damnorm: string; n: bigint; median: number }>
  >(
    `SELECT dam."normalizedName" AS damnorm, count(*) AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY r."priceCents") AS median
     FROM "SaleResult" r
     JOIN "Hip" h ON h."id" = r."hipId"
     JOIN "Sale" s ON s."id" = h."saleId"
     JOIN "Horse" yh ON yh."id" = h."horseId"
     JOIN "Horse" dam ON dam."id" = yh."damId"
     WHERE r."rna" = false AND r."priceCents" > 0 AND s."category" = 'YEARLING'
       AND dam."normalizedName" IS NOT NULL
     GROUP BY dam."normalizedName"`,
  );
  const m = new Map<string, Produce>();
  for (const r of rows) m.set(r.damnorm, { nFoals: Number(r.n), medianFoalCents: Math.round(Number(r.median)) });
  return m;
}

/** Sold broodmares (BREEDING_STOCK sales) with mare normalizedName + sale price. */
async function soldMares(): Promise<Array<{ norm: string; priceCents: number }>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ norm: string; price: bigint }>>(
    `SELECT yh."normalizedName" AS norm, r."priceCents" AS price
     FROM "SaleResult" r
     JOIN "Hip" h ON h."id" = r."hipId"
     JOIN "Sale" s ON s."id" = h."saleId"
     JOIN "Horse" yh ON yh."id" = h."horseId"
     WHERE r."rna" = false AND r."priceCents" > 0 AND s."category" = 'BREEDING_STOCK'
       AND yh."sex" = 'MARE' AND yh."normalizedName" IS NOT NULL`,
  );
  return rows.map((r) => ({ norm: r.norm, priceCents: Number(r.price) }));
}

interface Tier {
  maxFoalCents: number; // upper bound of this produce tier
  prices: number[]; // sold-mare prices in this tier (sorted)
}

/** Build produce-tier comparable bands from sold mares with a produce record. */
async function buildTiers() {
  const produce = await produceByDam();
  const mares = await soldMares();
  const withProduce = mares
    .map((m) => ({ price: m.priceCents, prod: produce.get(m.norm) }))
    .filter((x): x is { price: number; prod: Produce } => !!x.prod);

  // Quartile cut points on produce median foal price.
  const foalMedians = withProduce.map((x) => x.prod.medianFoalCents).sort((a, b) => a - b);
  const cuts = [0.25, 0.5, 0.75].map((p) => percentile(foalMedians, p));
  const bounds = [...cuts, Infinity];

  const tiers: Tier[] = bounds.map((b) => ({ maxFoalCents: b, prices: [] }));
  for (const x of withProduce) {
    const ti = bounds.findIndex((b) => x.prod.medianFoalCents <= b);
    tiers[ti === -1 ? tiers.length - 1 : ti]!.prices.push(x.price);
  }
  tiers.forEach((t) => t.prices.sort((a, b) => a - b));

  // "No produce" comps (maiden mares): mares we couldn't match to any foal.
  const noProduce = mares
    .filter((m) => !produce.get(m.norm))
    .map((m) => m.priceCents)
    .sort((a, b) => a - b);

  return { produce, tiers, noProduce };
}

function band(prices: number[]) {
  return {
    low: r100(percentile(prices, 0.25)),
    mid: r100(percentile(prices, 0.5)),
    high: r100(percentile(prices, 0.75)),
    n: prices.length,
  };
}

export interface BroodmareValueResult {
  valued: number;
}

/** Value every broodmare in a BREEDING_STOCK sale — trained model first, with
 * the deterministic produce-tier model as a fallback. */
export async function valuateBroodmareSale(saleId: string): Promise<BroodmareValueResult> {
  const trained = await valuateBroodmareTrained(saleId);
  if (trained) return trained;

  const { produce, tiers, noProduce } = await buildTiers();
  const bounds = tiers.map((t) => t.maxFoalCents);

  const hips = await prisma.hip.findMany({
    where: { saleId },
    include: {
      horse: {
        select: {
          normalizedName: true,
          sex: true,
          starts: true,
          wins: true,
          earningsCents: true,
          bestSpeedFigure: true,
        },
      },
    },
  });

  let valued = 0;
  for (const hip of hips) {
    if (hip.horse.sex !== 'MARE' || !hip.horse.normalizedName) continue;
    const prod = produce.get(hip.horse.normalizedName);

    let prices: number[];
    let limited: boolean;
    if (prod) {
      const ti = bounds.findIndex((b) => prod.medianFoalCents <= b);
      const tier = tiers[ti === -1 ? tiers.length - 1 : ti]!;
      prices = tier.prices;
      limited = tier.prices.length < MIN_TIER;
    } else {
      prices = noProduce;
      limited = true; // no produce record — directional only
    }
    if (prices.length === 0) prices = noProduce.length ? noProduce : [0];

    // Apply the mare's own race-record premium to the produce-based band.
    const mult = mareRacingMultiplier(hip.horse);
    const hasRecord = (hip.horse.starts ?? 0) > 0;
    const b = band(prices);
    const low = r100(b.low * mult);
    const mid = r100(b.mid * mult);
    const high = r100(b.high * mult);

    // A real race record adds independent evidence -> a little more confidence,
    // and matters most for maiden mares whose produce signal is absent.
    const base = (prod ? 0.5 : 0.25) * Math.min(1, b.n / 30) + 0.15;
    const confidence = clamp(base + (hasRecord ? 0.1 : 0), 0.1, 1);

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
          nFoals: prod?.nFoals ?? 0,
          ...(prod ? { medianFoalCents: prod.medianFoalCents } : {}),
          ...(hasRecord
            ? {
                ownStarts: hip.horse.starts,
                ownWins: hip.horse.wins,
                ownEarningsCents: Number(hip.horse.earningsCents ?? 0n),
                ownBestSpeedFigure: hip.horse.bestSpeedFigure,
                racingMultiplier: Number(mult.toFixed(3)),
              }
            : {}),
        },
      },
    });
    valued += 1;
  }
  return { valued };
}
