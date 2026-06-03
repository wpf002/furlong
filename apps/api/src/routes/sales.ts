import type { FastifyInstance } from 'fastify';
import { request } from 'undici';
import { prisma } from '@furlong/db';
import { revalueSale } from '../valuation/revalueSale.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

export async function registerSaleRoutes(app: FastifyInstance) {
  // List sales on the calendar.
  app.get('/sales', async () => {
    return prisma.sale.findMany({ orderBy: [{ year: 'desc' }, { startDate: 'asc' }] });
  });

  // Hips for a sale, with horse + latest valuation.
  app.get<{ Params: { id: string } }>('/sales/:id/hips', async (req) => {
    return prisma.hip.findMany({
      where: { saleId: req.params.id },
      include: {
        horse: { include: { sire: true, dam: { include: { sire: true } } } },
        consignor: true,
        result: true,
        valuations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { hipNumber: 'asc' },
    });
  });

  // 1d — Re-value all hips in a sale via the ML service.
  app.post<{ Params: { id: string } }>('/sales/:id/revalue', async (req) => {
    return revalueSale(req.params.id);
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
