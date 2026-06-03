import type { FastifyInstance } from 'fastify';
import { prisma } from '@furlong/db';

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
}
