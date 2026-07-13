import type { FastifyInstance } from 'fastify';
import { request } from 'undici';
import { prisma } from '@furlong/db';
import { revalueSale } from '../valuation/revalueSale.js';
import { valuateBroodmareSale } from '../valuation/broodmare.js';
import { valuateRacingAgeSale } from '../valuation/racingAge.js';
import { valueSaleByCategory } from '../valuation/dispatch.js';
import { computePedigreeGrade, pedigreeGradeForHip } from '../pedigreeGrade.js';
import { expertPedigreeFor } from '../data/ftJuly2026Pedigree.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

export async function registerSaleRoutes(app: FastifyInstance) {
  // List sales. Includes hipCount so the UI can flag catalog-pending sales.
  // ?status=upcoming  → startDate in the future OR null (date not yet set)
  // ?status=past      → startDate in the past (confirmed concluded)
  // ?status=all / omitted → everything, sorted newest first
  app.get<{ Querystring: { status?: string } }>('/sales', async (req) => {
    const status = req.query.status ?? 'all';
    const thisYear = new Date().getUTCFullYear();

    // Upcoming = current year and later (whether dated or not).
    // Past = any year before the current year.
    // This is robust against historical sales that were ingested without dates.
    const where =
      status === 'upcoming'
        ? { year: { gte: thisYear } }
        : status === 'past'
          ? { year: { lt: thisYear } }
          : undefined;

    // Upcoming: ascending so the most imminent sale is first, undated future
    // sales (no date announced yet) fall to the bottom.
    // Past / all: descending so the most recent year leads.
    const orderBy =
      status === 'upcoming'
        ? [
            { year: 'asc' as const },
            { startDate: { sort: 'asc' as const, nulls: 'last' as const } },
          ]
        : [
            { year: 'desc' as const },
            { startDate: { sort: 'desc' as const, nulls: 'first' as const } },
          ];

    const sales = await prisma.sale.findMany({
      where,
      orderBy,
      include: { _count: { select: { hips: true } } },
    });
    return sales.map(({ _count, ...s }) => ({ ...s, hipCount: _count.hips }));
  });

  // Hips for a sale, with horse + latest valuation + pedigree grade.
  app.get<{ Params: { id: string } }>('/sales/:id/hips', async (req) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      select: { auctionHouse: true, name: true, year: true },
    });
    const hips = await prisma.hip.findMany({
      where: { saleId: req.params.id },
      include: {
        horse: { include: { sire: true, dam: { include: { sire: true } } } },
        consignor: true,
        breeder: true,
        result: true,
        valuations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { hipNumber: 'asc' },
    });
    return hips.map((h) => {
      const expert = sale
        ? expertPedigreeFor({
            auctionHouse: sale.auctionHouse,
            saleName: sale.name,
            year: sale.year,
            hipNumber: h.hipNumber,
            sireName: h.horse.sire?.name ?? null,
          })
        : null;
      return {
        ...h,
        // DB barn, falling back to the per-sale expert dataset.
        barn: h.barn ?? expert?.barn ?? null,
        pedigreeGrade: sale
          ? pedigreeGradeForHip({
              auctionHouse: sale.auctionHouse,
              saleName: sale.name,
              year: sale.year,
              hipNumber: h.hipNumber,
              sireName: h.horse.sire?.name ?? null,
              catalogPageText: h.catalogPageText,
            })
          : computePedigreeGrade(h.catalogPageText),
      };
    });
  });

  // Mark a hip as withdrawn (pulled from the sale before it rings).
  app.post<{ Params: { hipId: string } }>('/hips/:hipId/withdraw', async (req, reply) => {
    const hip = await prisma.hip.update({
      where: { id: req.params.hipId },
      data: { withdrawn: true },
      select: { id: true, hipNumber: true, withdrawn: true },
    });
    return hip;
  });

  // Reinstate a previously withdrawn hip.
  app.post<{ Params: { hipId: string } }>('/hips/:hipId/reinstate', async (req, reply) => {
    const hip = await prisma.hip.update({
      where: { id: req.params.hipId },
      data: { withdrawn: false },
      select: { id: true, hipNumber: true, withdrawn: true },
    });
    return hip;
  });

  // 1d — Re-value all hips in a sale via the ML service.
  app.post<{ Params: { id: string } }>('/sales/:id/revalue', async (req) => {
    return revalueSale(req.params.id);
  });

  // 4 — Value broodmares in a BREEDING_STOCK sale by produce record.
  app.post<{ Params: { id: string } }>('/sales/:id/value-broodmares', async (req) => {
    return valuateBroodmareSale(req.params.id);
  });

  // 4 — Value horses-in-training / 2YOs by sire comparables + racing record.
  app.post<{ Params: { id: string } }>('/sales/:id/value-racing-age', async (req) => {
    return valuateRacingAgeSale(req.params.id);
  });

  // 4 — Value a sale via the right path for its category (yearling model /
  // broodmare produce / racing-age). What the automated pipeline uses.
  app.post<{ Params: { id: string } }>('/sales/:id/value', async (req) => {
    return valueSaleByCategory(req.params.id);
  });

  // 1f — Post-sale retrain seed: tell the ML service to reload comparables
  // (newly imported results), then re-value the sale against the fresh model.
  app.post<{ Params: { id: string } }>('/sales/:id/retrain-seed', async (req, reply) => {
    const res = await request(`${ML_SERVICE_URL}/reload-comparables`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = await res.body.text();
      return reply
        .status(502)
        .send({ error: `ML /reload-comparables failed: ${res.statusCode} ${text}` });
    }
    // ML /reload-comparables returns { comparables: <count> }.
    const json = (await res.body.json()) as { comparables?: number };
    const reloaded = json.comparables ?? 0;

    const { valued } = await revalueSale(req.params.id);
    return { reloaded, valued };
  });
}
