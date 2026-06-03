import type { FastifyInstance } from 'fastify';
import { SearchQuerySchema, normalizeEntityName, formatCents, centsToNumber } from '@furlong/shared';
import { prisma } from '@furlong/db';

export async function registerSearchRoutes(app: FastifyInstance) {
  // 1e — Buyer-facing ranked search. Single query + in-memory filter/sort.
  app.post('/search', async (req, reply) => {
    const parsed = SearchQuerySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { saleId, budgetLowCents, budgetHighCents, preferredSires, hiddenGemsOnly } = parsed.data;

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

    // Rank: best value first — hiddenGemScore desc, then predicted price asc.
    // Hips without a valuation sort last.
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

    const out = ranked.map((h) => {
      const v = h.valuations[0];
      const sireName = h.horse.sire?.name ?? null;
      const damName = h.horse.dam?.name ?? null;
      const damsireName = h.horse.dam?.sire?.name ?? null;

      let valuation = null;
      let oneLiner: string;

      if (v) {
        const note = budgetHighCents != null ? 'within your budget' : 'based on historical comparables';
        const caveat = v.limitedComparables
          ? ' Limited comparable data — treat this estimate as directional.'
          : '';

        oneLiner =
          `By ${sireName ?? 'unknown sire'} — predicted ` +
          `${formatCents(v.predPriceLowCents)}–${formatCents(v.predPriceHighCents)}; ${note}.${caveat}`;

        valuation = {
          estValueLowCents: centsToNumber(v.estValueLowCents),
          estValueHighCents: centsToNumber(v.estValueHighCents),
          predPriceLowCents: centsToNumber(v.predPriceLowCents),
          predPriceHighCents: centsToNumber(v.predPriceHighCents),
          confidence: v.confidence,
          hiddenGemScore: v.hiddenGemScore,
          limitedComparables: v.limitedComparables,
        };
      } else {
        oneLiner = `By ${sireName ?? 'unknown sire'} — not yet valued.`;
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

    return { count: out.length, hips: out };
  });
}
