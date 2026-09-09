import { request } from 'undici';
import { z } from 'zod';
import { prisma, Prisma } from '@furlong/db';
import { ValuationResponseSchema, numberToCents } from '@furlong/shared';
import { pedigreeGradeForHip } from '../pedigreeGrade.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

// Hips per ML request and per DB write. Keeps the JSON body near a megabyte and
// the createMany parameter count well inside Postgres' 65535 bind limit, while
// still being large enough that per-call overhead is irrelevant.
const CHUNK = 500;

const SaleValuationResponseSchema = z.object({
  valuations: z.record(z.string(), ValuationResponseSchema),
});

export interface RevalueResult {
  valued: number;
}

/**
 * Re-value every hip in a sale via the ML /value-sale endpoint. The API never
 * invents prices — all money comes from the ML response.
 *
 * Scored in batches, not hip-by-hip. The nightly retrain re-values every
 * upcoming sale, and doing that one hip at a time (an HTTP round trip plus two
 * Prisma writes each) held the ML service at ~7 vCPU for 4h45m on 2026-09-09 —
 * the largest single line on the Railway bill. Almost none of it was real work:
 * a one-row sklearn predict is nearly all per-call overhead, so a 4,000-hip
 * sale costs ~25ms batched against ~57s hip-by-hip.
 */
export async function revalueSale(saleId: string): Promise<RevalueResult> {
  const hips = await prisma.hip.findMany({
    where: { saleId },
    include: {
      horse: { include: { sire: true, dam: { include: { sire: true } } } },
      consignor: true,
      sale: true,
    },
    orderBy: { hipNumber: 'asc' },
  });

  // Licensed-data on-ramp: pull each sire's stats from years STRICTLY before this
  // sale (leakage-safe — mirrors the training features) and feed them to the
  // model. One batched query; each stat is resolved to its own most-recent-prior
  // non-null value (sparse feeds don't blank out siblings). Empty until a feed
  // populates SireStats (POST /ingest/sire-stats), in which case every lookup is
  // null and the model sees NaN, exactly as in training.
  const saleYear = hips[0]?.sale.year ?? new Date().getUTCFullYear();
  const sireIds = [...new Set(hips.map((h) => h.horse.sireId).filter((id): id is string => !!id))];
  const studFeeBySire = new Map<string, number>();
  const epsBySire = new Map<string, number>();
  const swpctBySire = new Map<string, number>();
  if (sireIds.length > 0) {
    const stats = await prisma.sireStats.findMany({
      where: { sireId: { in: sireIds }, year: { lt: saleYear } },
      orderBy: { year: 'desc' },
      select: { sireId: true, studFeeCents: true, earningsPerStarter: true, stakesWinnerPct: true },
    });
    // orderBy year desc → first non-null per (sire, stat) is the most recent prior.
    for (const s of stats) {
      if (s.studFeeCents != null && !studFeeBySire.has(s.sireId))
        studFeeBySire.set(s.sireId, Number(s.studFeeCents));
      if (s.earningsPerStarter != null && !epsBySire.has(s.sireId))
        epsBySire.set(s.sireId, Number(s.earningsPerStarter));
      if (s.stakesWinnerPct != null && !swpctBySire.has(s.sireId))
        swpctBySire.set(s.sireId, s.stakesWinnerPct);
    }
  }

  // Phase 1: build every hip's feature vector. Pure in-memory work — no
  // network, no DB — so the whole catalogue is ready before a single call.
  const built = hips.map((hip) => {
    // Catalog-pedigree score (0–100): expert read where held, else the black-type
    // heuristic. The model trains on the same score (services/ml/app/pedigree.py),
    // so it's a real pricing feature, not just a badge.
    const pedigreeScore =
      pedigreeGradeForHip({
        auctionHouse: hip.sale.auctionHouse,
        saleName: hip.sale.name,
        year: hip.sale.year,
        hipNumber: hip.hipNumber,
        sireName: hip.horse.sire?.name ?? null,
        catalogPageText: hip.catalogPageText,
      })?.score ?? null;

    const features = {
      sireName: hip.horse.sire?.name ?? null,
      damName: hip.horse.dam?.name ?? null,
      damsireName: hip.horse.dam?.sire?.name ?? null,
      sessionNumber: hip.sessionNumber ?? null,
      consignorName: hip.consignor?.name ?? null,
      saleYear: hip.sale.year,
      sex: hip.horse.sex ?? null,
      color: hip.horse.color ?? null,
      auctionHouse: hip.sale.auctionHouse,
      saleName: hip.sale.name,
      hipNumber: hip.hipNumber,
      currency: hip.sale.currency,
      sireStudFeeCents: hip.horse.sireId ? (studFeeBySire.get(hip.horse.sireId) ?? null) : null,
      sireEpsCents: hip.horse.sireId ? (epsBySire.get(hip.horse.sireId) ?? null) : null,
      sireStakesPct: hip.horse.sireId ? (swpctBySire.get(hip.horse.sireId) ?? null) : null,
      pedigreeScore,
    };

    return { hip_id: hip.id, features };
  });

  let valued = 0;

  for (let i = 0; i < built.length; i += CHUNK) {
    const chunk = built.slice(i, i + CHUNK);

    const res = await request(`${ML_SERVICE_URL}/value-sale`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hips: chunk }),
      // One call now carries up to CHUNK hips, so it needs materially longer
      // than a single-hip request — but the whole sale is far quicker than the
      // per-hip loop it replaces.
      headersTimeout: 300_000,
      bodyTimeout: 300_000,
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = await res.body.text();
      throw new Error(
        `ML /value-sale failed for sale ${saleId} (hips ${i}-${i + chunk.length}): ` +
          `${res.statusCode} ${text.slice(0, 200)}`,
      );
    }

    const { valuations } = SaleValuationResponseSchema.parse(await res.body.json());

    const rows = chunk.map(({ hip_id, features }) => {
      const v = valuations[hip_id];
      if (!v) throw new Error(`ML /value-sale returned no valuation for hip ${hip_id}`);

      // Phase 2: est-value comes from a pedigree-only model and predicted-price
      // from the full-context model, so the gap is a real per-hip signal — a hip
      // whose pedigree is worth more than its predicted sale price is a hidden gem.
      const estMid = (v.estValueLowCents + v.estValueHighCents) / 2;
      const predMid = (v.predPriceLowCents + v.predPriceHighCents) / 2;
      return {
        hipId: hip_id,
        estValueLowCents: numberToCents(v.estValueLowCents),
        estValueHighCents: numberToCents(v.estValueHighCents),
        predPriceLowCents: numberToCents(v.predPriceLowCents),
        predPriceHighCents: numberToCents(v.predPriceHighCents),
        confidence: v.confidence,
        hiddenGemScore: (estMid - predMid) / Math.max(predMid, 1),
        limitedComparables: v.limitedComparables,
        modelVersion: v.modelVersion,
        features: features as Prisma.InputJsonValue,
      };
    });

    // Supersede, don't accumulate: the nightly retrain re-values every sale, so
    // keeping history grew Valuation to 6.9 GB / 10.5M rows (97% of the database)
    // before it was pruned. Only the latest row per hip is ever read.
    //
    // Delete + insert run in one transaction so a reader never observes a hip
    // with no valuation at all; the old per-hip version left exactly that gap
    // between its deleteMany and its create.
    await prisma.$transaction([
      prisma.valuation.deleteMany({ where: { hipId: { in: chunk.map((c) => c.hip_id) } } }),
      prisma.valuation.createMany({ data: rows }),
    ]);
    valued += rows.length;
  }

  return { valued };
}
