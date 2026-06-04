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

  let valued = 0;

  for (const hip of hips) {
    const features = {
      sireName: hip.horse.sire?.name ?? null,
      damsireName: hip.horse.dam?.sire?.name ?? null,
      sessionNumber: hip.sessionNumber ?? null,
      consignorName: hip.consignor?.name ?? null,
      saleYear: hip.sale.year,
      sex: hip.horse.sex ?? null,
      color: hip.horse.color ?? null,
      auctionHouse: hip.sale.auctionHouse,
      saleName: hip.sale.name,
      hipNumber: hip.hipNumber,
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
