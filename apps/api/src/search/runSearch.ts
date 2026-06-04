import { normalizeEntityName, formatMoney, centsToNumber, type SearchQuery } from '@furlong/shared';
import { prisma } from '@furlong/db';

export interface SearchHipOut {
  id: string;
  hipNumber: number;
  sessionNumber: number | null;
  horse: {
    name: string | null;
    sex: string | null;
    color: string | null;
    sireName: string | null;
    damName: string | null;
    damsireName: string | null;
  };
  consignorName: string | null;
  valuation: {
    estValueLowCents: number;
    estValueHighCents: number;
    predPriceLowCents: number;
    predPriceHighCents: number;
    confidence: number;
    hiddenGemScore: number | null;
    limitedComparables: boolean;
  } | null;
  oneLiner: string;
}

export interface SearchResult {
  count: number;
  currency: string;
  hips: SearchHipOut[];
}

/**
 * Buyer-facing ranked search over a sale. Shared by POST /search and the
 * profile-driven shortlist suggestions. `limit` caps the returned list (e.g.
 * pre-filter a 3,000-hip catalog to a top 50).
 */
export async function runSearch(query: SearchQuery & { limit?: number }): Promise<SearchResult> {
  const { saleId, budgetLowCents, budgetHighCents, preferredSires, hiddenGemsOnly, limit } = query;

  const sale = await prisma.sale.findUnique({ where: { id: saleId }, select: { currency: true } });
  const currency = sale?.currency ?? 'USD';

  const hips = await prisma.hip.findMany({
    where: { saleId },
    include: {
      horse: { include: { sire: true, dam: { include: { sire: true } } } },
      consignor: true,
      result: true,
      valuations: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { hipNumber: 'asc' },
  });

  const preferredNormalized = (preferredSires ?? [])
    .map((s) => normalizeEntityName(s))
    .filter((s): s is string => s != null);

  const filtered = hips.filter((h) => {
    const v = h.valuations[0];
    if (budgetHighCents != null) {
      if (!v || Number(v.predPriceLowCents) > budgetHighCents) return false;
    }
    if (budgetLowCents != null) {
      if (!v || Number(v.predPriceHighCents) < budgetLowCents) return false;
    }
    if (preferredNormalized.length > 0) {
      const sireNorm = normalizeEntityName(h.horse.sire?.name ?? null);
      if (!sireNorm || !preferredNormalized.includes(sireNorm)) return false;
    }
    if (hiddenGemsOnly) {
      if (!v || v.hiddenGemScore == null || v.hiddenGemScore <= 0) return false;
    }
    return true;
  });

  const ranked = filtered.sort((a, b) => {
    const va = a.valuations[0];
    const vb = b.valuations[0];
    if (va && !vb) return -1;
    if (!va && vb) return 1;
    if (!va || !vb) return 0;
    const ga = va.hiddenGemScore ?? -Infinity;
    const gb = vb.hiddenGemScore ?? -Infinity;
    if (gb !== ga) return gb - ga;
    return Number(va.predPriceLowCents) - Number(vb.predPriceLowCents);
  });

  const sliced = typeof limit === 'number' ? ranked.slice(0, limit) : ranked;

  const out: SearchHipOut[] = sliced.map((h) => {
    const v = h.valuations[0];
    const sireName = h.horse.sire?.name ?? null;
    const damName = h.horse.dam?.name ?? null;
    const damsireName = h.horse.dam?.sire?.name ?? null;

    let valuation: SearchHipOut['valuation'] = null;
    let oneLiner: string;

    // Named animals (e.g. broodmares) read "<Name> (by <sire>)"; unnamed
    // yearlings read "By <sire>".
    const subject = h.horse.name
      ? `${h.horse.name} (by ${sireName ?? 'unknown sire'})`
      : `By ${sireName ?? 'unknown sire'}`;

    if (v) {
      const note = budgetHighCents != null ? 'within your budget' : 'based on historical comparables';
      const caveat = v.limitedComparables
        ? ' Limited comparable data — treat this estimate as directional.'
        : '';
      oneLiner =
        `${subject} — predicted ` +
        `${formatMoney(v.predPriceLowCents, currency)}–${formatMoney(v.predPriceHighCents, currency)}; ${note}.${caveat}`;
      valuation = {
        estValueLowCents: centsToNumber(v.estValueLowCents)!,
        estValueHighCents: centsToNumber(v.estValueHighCents)!,
        predPriceLowCents: centsToNumber(v.predPriceLowCents)!,
        predPriceHighCents: centsToNumber(v.predPriceHighCents)!,
        confidence: v.confidence,
        hiddenGemScore: v.hiddenGemScore,
        limitedComparables: v.limitedComparables,
      };
    } else {
      oneLiner = `${subject} — not yet valued.`;
    }

    return {
      id: h.id,
      hipNumber: h.hipNumber,
      sessionNumber: h.sessionNumber,
      horse: {
        name: h.horse.name,
        sex: h.horse.sex,
        color: h.horse.color,
        sireName,
        damName,
        damsireName,
      },
      consignorName: h.consignor?.name ?? null,
      valuation,
      oneLiner,
    };
  });

  return { count: out.length, currency, hips: out };
}
