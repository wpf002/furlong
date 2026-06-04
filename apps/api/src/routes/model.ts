import type { FastifyInstance } from 'fastify';
import { request } from 'undici';
import { revalueSale } from '../valuation/revalueSale.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

export async function registerModelRoutes(app: FastifyInstance) {
  // 2e — Model accuracy/transparency for the UI (recursive loop made visible).
  app.get('/model/metrics', async (_req, reply) => {
    const res = await request(`${ML_SERVICE_URL}/metrics`, { method: 'GET' });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return reply.status(502).send({ error: `ML /metrics failed: ${res.statusCode}` });
    }
    return res.body.json();
  });

  // 2d — Retrain job: retrain on all current results (versions + registers the
  // model), then optionally re-value a sale against the fresh model.
  app.post<{ Body: { saleId?: string } }>('/model/retrain', async (req, reply) => {
    const res = await request(`${ML_SERVICE_URL}/train`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
      headersTimeout: 300_000,
      bodyTimeout: 300_000,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = await res.body.text();
      return reply.status(502).send({ error: `ML /train failed: ${res.statusCode} ${text}` });
    }
    const trained = (await res.body.json()) as { modelVersion?: string; metrics?: unknown };
    const saleId = req.body?.saleId;
    const valued = saleId ? (await revalueSale(saleId)).valued : 0;
    return { modelVersion: trained.modelVersion, metrics: trained.metrics, valued };
  });
}
