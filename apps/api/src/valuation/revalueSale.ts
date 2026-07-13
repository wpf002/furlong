import { request } from 'undici';
import { prisma, Prisma } from '@furlong/db';
import { ValuationResponseSchema, numberToCents } from '@furlong/shared';
import { pedigreeGradeForHip } from '../pedigreeGrade.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

export interface RevalueResult {
  valued: number;
}

/**
 * Re-value every hip in a sale by calling the ML /value endpoint. The API never
 * invents prices — all money comes from the ML response. A new Valuation row is
 * created per hip (history is append-only).
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

  let valued = 0;

  for (const hip of hips) {
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

    const res = await request(`${ML_SERVICE_URL}/value`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hip_id: hip.id, features }),
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = await res.body.text();
      throw new Error(`ML /value failed for hip ${hip.id}: ${res.statusCode} ${text}`);
    }

    const json = await res.body.json();
    const v = ValuationResponseSchema.parse(json);

    // Phase 2: est-value comes from a pedigree-only model and predicted-price
    // from the full-context model, so the gap is a real per-hip signal — a hip
    // whose pedigree is worth more than its predicted sale price is a hidden gem.
    const estMid = (v.estValueLowCents + v.estValueHighCents) / 2;
    const predMid = (v.predPriceLowCents + v.predPriceHighCents) / 2;
    const hiddenGemScore = (estMid - predMid) / Math.max(predMid, 1);

    await prisma.valuation.create({
      data: {
        hipId: hip.id,
        estValueLowCents: numberToCents(v.estValueLowCents),
        estValueHighCents: numberToCents(v.estValueHighCents),
        predPriceLowCents: numberToCents(v.predPriceLowCents),
        predPriceHighCents: numberToCents(v.predPriceHighCents),
        confidence: v.confidence,
        hiddenGemScore,
        limitedComparables: v.limitedComparables,
        modelVersion: v.modelVersion,
        features: features as Prisma.InputJsonValue,
      },
    });
    valued += 1;
  }

  return { valued };
}
