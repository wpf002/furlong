import type { FastifyInstance } from 'fastify';
import { SearchQuerySchema } from '@furlong/shared';
import { runSearch } from '../search/runSearch.js';

export async function registerSearchRoutes(app: FastifyInstance) {
  // 1e — Buyer-facing ranked search. Single query + in-memory filter/sort.
  app.post('/search', async (req, reply) => {
    const parsed = SearchQuerySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return runSearch(parsed.data);
  });
}
