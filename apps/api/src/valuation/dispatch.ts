import { prisma } from '@furlong/db';
import { revalueSale } from './revalueSale.js';
import { valuateBroodmareSale } from './broodmare.js';
import { valuateRacingAgeSale } from './racingAge.js';

export interface CategoryValueResult {
  valued: number;
  path: 'yearling-model' | 'broodmare' | 'racing-age';
}

/**
 * Route a sale to the right valuation path by its category. The automated
 * pipeline (and any "value this sale" trigger) calls this so a 2YO-in-training
 * or breeding-stock sale never gets valued as a yearling.
 *   YEARLING / WEANLING / default -> trained model (revalueSale)
 *   BREEDING_STOCK                 -> produce-record comparables
 *   TWO_YEAR_OLD                   -> racing-age sire comparables + record
 */
export async function valueSaleByCategory(saleId: string): Promise<CategoryValueResult> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: { category: true },
  });
  switch (sale?.category) {
    case 'BREEDING_STOCK':
      return { ...(await valuateBroodmareSale(saleId)), path: 'broodmare' };
    case 'TWO_YEAR_OLD':
      return { ...(await valuateRacingAgeSale(saleId)), path: 'racing-age' };
    default:
      return { ...(await revalueSale(saleId)), path: 'yearling-model' };
  }
}
