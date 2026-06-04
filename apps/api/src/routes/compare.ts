import type { FastifyInstance } from 'fastify';
import { normalizeEntityName } from '@furlong/shared';
import { prisma } from '@furlong/db';

/**
 * Phase 4 — cross-auction comparison. For a given sire, break down sold-yearling
 * prices by auction house so a buyer can compare value across Keeneland vs
 * Fasig-Tipton in one view. Pure aggregation over real sold results.
 */
export async function registerCompareRoutes(app: FastifyInstance) {
  // Sire autocomplete (by sold-result volume).
  app.get<{ Querystring: { q?: string; limit?: string } }>('/sires', async (req) => {
    const q = normalizeEntityName(req.query.q ?? '') ?? '';
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; n: bigint }>>(
      `SELECT sire."name" AS name, count(*) AS n
       FROM "SaleResult" r
       JOIN "Hip" h ON h."id" = r."hipId"
       JOIN "Horse" yh ON yh."id" = h."horseId"
       JOIN "Horse" sire ON sire."id" = yh."sireId"
       WHERE r."rna" = false AND r."priceCents" > 0
         AND sire."normalizedName" LIKE $1
       GROUP BY sire."name"
       ORDER BY count(*) DESC
       LIMIT ${limit}`,
      `%${q}%`,
    );
    return rows.map((r) => ({ name: r.name, count: Number(r.n) }));
  });

  // Per-house price breakdown for a sire.
  app.get<{ Querystring: { sire?: string } }>('/compare', async (req, reply) => {
    const norm = normalizeEntityName(req.query.sire ?? '');
    if (!norm) return reply.status(400).send({ error: 'sire is required' });

    // Group by house AND currency — different houses sell in different money
    // (USD vs GBP/guineas), so figures are NOT FX-converted; each row is in its
    // own currency and the UI formats accordingly.
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        house: string;
        currency: string;
        n: bigint;
        median: number | null;
        avg: bigint | null;
        p25: number | null;
        p75: number | null;
        miny: number;
        maxy: number;
      }>
    >(
      `SELECT s."auctionHouse" AS house, s."currency" AS currency,
              count(*) AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r."priceCents") AS median,
              avg(r."priceCents")::bigint AS avg,
              percentile_cont(0.25) WITHIN GROUP (ORDER BY r."priceCents") AS p25,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY r."priceCents") AS p75,
              min(s."year") AS miny, max(s."year") AS maxy
       FROM "SaleResult" r
       JOIN "Hip" h ON h."id" = r."hipId"
       JOIN "Sale" s ON s."id" = h."saleId"
       JOIN "Horse" yh ON yh."id" = h."horseId"
       JOIN "Horse" sire ON sire."id" = yh."sireId"
       WHERE r."rna" = false AND r."priceCents" > 0 AND sire."normalizedName" = $1
       GROUP BY s."auctionHouse", s."currency"
       ORDER BY count(*) DESC`,
      norm,
    );

    const houses = rows.map((r) => ({
      auctionHouse: r.house,
      currency: r.currency,
      n: Number(r.n),
      medianCents: r.median != null ? Math.round(Number(r.median)) : null,
      avgCents: r.avg != null ? Number(r.avg) : null,
      p25Cents: r.p25 != null ? Math.round(Number(r.p25)) : null,
      p75Cents: r.p75 != null ? Math.round(Number(r.p75)) : null,
      years: r.n ? `${r.miny}–${r.maxy}` : null,
    }));

    // Resolve a display name for the sire.
    const sireRow = await prisma.horse.findFirst({
      where: { normalizedName: norm },
      select: { name: true },
    });

    return {
      sire: sireRow?.name ?? req.query.sire,
      totalSold: houses.reduce((a, h) => a + h.n, 0),
      houses,
    };
  });
}
