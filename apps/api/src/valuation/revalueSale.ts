import { request } from 'undici';
import { prisma, Prisma } from '@furlong/db';
import { ValuationResponseSchema, numberToCents } from '@furlong/shared';

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

  // Licensed-data on-ramp: pull each sire's most recent stud fee STRICTLY before
  // this sale's year (leakage-safe — mirrors the training feature) and feed it to
  // the model. One batched query, resolved into an as-of map. Empty until a feed
  // populates SireStats (POST /ingest/sire-stats), in which case every lookup is
  // null and the model sees NaN, exactly as in training.
  const saleYear = hips[0]?.sale.year ?? new Date().getUTCFullYear();
  const sireIds = [...new Set(hips.map((h) => h.horse.sireId).filter((id): id is string => !!id))];
  const studFeeBySire = new Map<string, number>();
  if (sireIds.length > 0) {
    const stats = await prisma.sireStats.findMany({
      where: { sireId: { in: sireIds }, year: { lt: saleYear }, studFeeCents: { not: null } },
      orderBy: { year: 'desc' },
      select: { sireId: true, studFeeCents: true },
    });
    // orderBy year desc → first row per sire is the most recent prior year.
    for (const s of stats) {
      if (!studFeeBySire.has(s.sireId) && s.studFeeCents != null) {
        studFeeBySire.set(s.sireId, Number(s.studFeeCents));
      }
    }
  }

  let valued = 0;

  for (const hip of hips) {
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
      sireStudFeeCents: hip.horse.sireId ? studFeeBySire.get(hip.horse.sireId) ?? null : null,
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
