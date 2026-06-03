import type { FastifyInstance } from 'fastify';
import { SearchQuerySchema } from '@furlong/shared';
import { prisma } from '@furlong/db';

export async function registerSearchRoutes(app: FastifyInstance) {
  // Buyer-facing ranked search. Phase 2 wires in valuation scoring + ranking.
  app.post('/search', async (req, reply) => {
    const parsed = SearchQuerySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { saleId, budgetHighCents, preferredSires } = parsed.data;

    const hips = await prisma.hip.findMany({
      where: {
        saleId,
        ...(preferredSires?.length
          ? { horse: { sire: { name: { in: preferredSires } } } }
          : {}),
      },
      include: {
        horse: { include: { sire: true, dam: { include: { sire: true } } } },
        valuations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { hipNumber: 'asc' },
    });

    // Placeholder ranking: budget filter on predicted price.
    const filtered = hips.filter((h) => {
      const v = h.valuations[0];
      if (!v || budgetHighCents == null) return true;
      return Number(v.predPriceLowCents) <= budgetHighCents;
    });

    return { count: filtered.length, hips: filtered };
  });
}
