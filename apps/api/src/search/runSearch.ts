import { normalizeEntityName, formatMoney, centsToNumber, type SearchQuery } from '@furlong/shared';
import { prisma } from '@furlong/db';

export interface SearchHipOut {
  id: string;
  hipNumber: number;
  sessionNumber: number | null;
  withdrawn: boolean;
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
  result: { priceCents: number | null; rna: boolean } | null;
  produce: { nFoals: number; medianFoalCents: number | null } | null;
  racing: {
    starts: number;
    wins: number;
    places: number | null;
    shows: number | null;
    earningsCents: number | null;
    bestSpeedFigure: number | null;
  } | null;
  breeze: string | null;
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
    where: { saleId, withdrawn: false },
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
    // Budget filters against the predicted band (upcoming sales) or the actual
    // sold price (sales that already happened); hips with neither are excluded.
    const soldForFilter =
      h.result && !h.result.rna && h.result.priceCents != null ? Number(h.result.priceCents) : null;
    if (budgetHighCents != null) {
      const lo = v ? Number(v.predPriceLowCents) : soldForFilter;
      if (lo == null || lo > budgetHighCents) return false;
    }
    if (budgetLowCents != null) {
      const hi = v ? Number(v.predPriceHighCents) : soldForFilter;
      if (hi == null || hi < budgetLowCents) return false;
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

    // Actual result, for sales that have already happened.
    const soldCents =
      h.result && !h.result.rna && h.result.priceCents != null
        ? centsToNumber(h.result.priceCents)
        : null;
    const result = h.result
      ? { priceCents: centsToNumber(h.result.priceCents), rna: h.result.rna }
      : null;

    // Broodmare produce record, if this valuation carries one.
    const feat = (v?.features ?? null) as { nFoals?: number; medianFoalCents?: number } | null;
    const produce =
      feat && typeof feat.nFoals === 'number' && feat.nFoals > 0
        ? { nFoals: feat.nFoals, medianFoalCents: feat.medianFoalCents ?? null }
        : null;

    // Racing record (horses-in-training), surfaced when a licensed feed has set
    // one. starts === null => no record held; show nothing rather than zeros.
    const racing =
      h.horse.starts != null
        ? {
            starts: h.horse.starts,
            wins: h.horse.wins ?? 0,
            places: h.horse.places ?? null,
            shows: h.horse.shows ?? null,
            earningsCents: centsToNumber(h.horse.earningsCents),
            bestSpeedFigure: h.horse.bestSpeedFigure ?? null,
          }
        : null;

    // Always expose the model estimate when one exists (shown alongside the
    // actual price for settled sales).
    if (v) {
      valuation = {
        estValueLowCents: centsToNumber(v.estValueLowCents)!,
        estValueHighCents: centsToNumber(v.estValueHighCents)!,
        predPriceLowCents: centsToNumber(v.predPriceLowCents)!,
        predPriceHighCents: centsToNumber(v.predPriceHighCents)!,
        confidence: v.confidence,
        hiddenGemScore: v.hiddenGemScore,
        limitedComparables: v.limitedComparables,
      };
    }

    if (soldCents != null) {
      oneLiner = `${subject} — sold for ${formatMoney(soldCents, currency)}.`;
    } else if (h.result?.rna) {
      oneLiner = `${subject} — RNA.`;
    } else if (v) {
      oneLiner =
        `${subject} — est. ` +
        `${formatMoney(v.predPriceLowCents, currency)}–${formatMoney(v.predPriceHighCents, currency)}.`;
    } else {
      oneLiner = `${subject} — not yet valued.`;
    }

    return {
      id: h.id,
      hipNumber: h.hipNumber,
      sessionNumber: h.sessionNumber,
      withdrawn: h.withdrawn,
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
      result,
      produce,
      racing,
      breeze: h.breezeTime ?? null,
      oneLiner,
    };
  });

  return { count: out.length, currency, hips: out };
}
