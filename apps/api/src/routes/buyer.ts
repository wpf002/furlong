import type { FastifyInstance } from 'fastify';
import { prisma } from '@furlong/db';
import { numberToCents } from '@furlong/shared';
import { requireUser } from '../auth.js';
import { runSearch } from '../search/runSearch.js';

export async function registerBuyerRoutes(app: FastifyInstance) {
  // ---- Buyer profile ----
  app.get('/me/profile', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    return prisma.buyerProfile.findFirst({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
  });

  app.put('/me/profile', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const b = (req.body ?? {}) as {
      budgetLowCents?: number | null;
      budgetHighCents?: number | null;
      preferredSires?: string[];
      notes?: string | null;
    };
    const data = {
      budgetLowCents: b.budgetLowCents != null ? numberToCents(b.budgetLowCents) : null,
      budgetHighCents: b.budgetHighCents != null ? numberToCents(b.budgetHighCents) : null,
      preferredSires: (b.preferredSires ?? []).map((s) => s.trim()).filter(Boolean),
      notes: b.notes ?? null,
    };
    const existing = await prisma.buyerProfile.findFirst({ where: { userId: u.id } });
    return existing
      ? prisma.buyerProfile.update({ where: { id: existing.id }, data })
      : prisma.buyerProfile.create({ data: { ...data, userId: u.id } });
  });

  // ---- Auto-filtered shortlist suggestions (profile -> ranked top hips) ----
  app.get<{ Querystring: { saleId?: string; limit?: string } }>(
    '/me/suggestions',
    async (req, reply) => {
      const u = await requireUser(req, reply);
      if (!u) return;
      const saleId = req.query.saleId;
      if (!saleId) return reply.status(400).send({ error: 'saleId is required' });
      const profile = await prisma.buyerProfile.findFirst({ where: { userId: u.id } });
      const limit = req.query.limit ? Math.max(1, Math.min(200, parseInt(req.query.limit, 10))) : 50;
      const result = await runSearch({
        saleId,
        budgetLowCents: profile?.budgetLowCents != null ? Number(profile.budgetLowCents) : undefined,
        budgetHighCents: profile?.budgetHighCents != null ? Number(profile.budgetHighCents) : undefined,
        preferredSires: profile?.preferredSires?.length ? profile.preferredSires : undefined,
        limit,
      });
      return { ...result, hasProfile: !!profile };
    },
  );

  // ---- Shortlists + saved hips + notes ----
  app.get('/me/shortlists', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const lists = await prisma.shortlist.findMany({
      where: { userId: u.id },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return lists.map((l) => ({ id: l.id, name: l.name, itemCount: l._count.items, createdAt: l.createdAt }));
  });

  app.post('/me/shortlists', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const name = ((req.body as { name?: string })?.name ?? '').trim() || 'My shortlist';
    return prisma.shortlist.create({ data: { userId: u.id, name } });
  });

  async function ownedShortlist(userId: string, id: string) {
    return prisma.shortlist.findFirst({ where: { id, userId } });
  }

  app.get<{ Params: { id: string } }>('/me/shortlists/:id', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const list = await ownedShortlist(u.id, req.params.id);
    if (!list) return reply.status(404).send({ error: 'shortlist not found' });
    // ShortlistItem holds hipId (no relation) — fetch the hips and join in JS.
    const items = await prisma.shortlistItem.findMany({
      where: { shortlistId: list.id },
      orderBy: { createdAt: 'asc' },
    });
    const hips = await prisma.hip.findMany({
      where: { id: { in: items.map((i) => i.hipId) } },
      include: {
        sale: true,
        horse: { include: { sire: true, dam: { include: { sire: true } } } },
        consignor: true,
        valuations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const byId = new Map(hips.map((h) => [h.id, h]));
    return {
      id: list.id,
      name: list.name,
      items: items.map((it) => {
        const h = byId.get(it.hipId);
        return {
          hipId: it.hipId,
          note: it.note,
          hip: h
            ? {
                id: h.id,
                hipNumber: h.hipNumber,
                saleId: h.sale.id,
                saleName: h.sale.name,
                saleYear: h.sale.year,
                sireName: h.horse.sire?.name ?? null,
                damName: h.horse.dam?.name ?? null,
                sex: h.horse.sex,
                consignorName: h.consignor?.name ?? null,
                valuation: h.valuations[0] ?? null,
              }
            : null,
        };
      }),
    };
  });

  app.post<{ Params: { id: string } }>('/me/shortlists/:id/items', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const list = await ownedShortlist(u.id, req.params.id);
    if (!list) return reply.status(404).send({ error: 'shortlist not found' });
    const { hipId, note } = (req.body ?? {}) as { hipId?: string; note?: string };
    if (!hipId) return reply.status(400).send({ error: 'hipId is required' });
    return prisma.shortlistItem.upsert({
      where: { shortlistId_hipId: { shortlistId: list.id, hipId } },
      update: { note: note ?? null },
      create: { shortlistId: list.id, hipId, note: note ?? null },
    });
  });

  app.patch<{ Params: { id: string; hipId: string } }>(
    '/me/shortlists/:id/items/:hipId',
    async (req, reply) => {
      const u = await requireUser(req, reply);
      if (!u) return;
      const list = await ownedShortlist(u.id, req.params.id);
      if (!list) return reply.status(404).send({ error: 'shortlist not found' });
      const note = ((req.body as { note?: string })?.note ?? null) as string | null;
      await prisma.shortlistItem.updateMany({
        where: { shortlistId: list.id, hipId: req.params.hipId },
        data: { note },
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; hipId: string } }>(
    '/me/shortlists/:id/items/:hipId',
    async (req, reply) => {
      const u = await requireUser(req, reply);
      if (!u) return;
      const list = await ownedShortlist(u.id, req.params.id);
      if (!list) return reply.status(404).send({ error: 'shortlist not found' });
      await prisma.shortlistItem.deleteMany({ where: { shortlistId: list.id, hipId: req.params.hipId } });
      return { ok: true };
    },
  );

  // ---- Alerts ----
  app.get('/me/alerts', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    return prisma.alert.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  app.post<{ Params: { id: string } }>('/me/alerts/:id/read', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    await prisma.alert.updateMany({
      where: { id: req.params.id, userId: u.id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });

  // ---- Auction calendar ----
  app.get('/calendar', async () => {
    const sales = await prisma.sale.findMany({
      include: { _count: { select: { hips: true } } },
      orderBy: [{ year: 'desc' }, { auctionHouse: 'asc' }, { name: 'asc' }],
    });
    const currentYear = new Date().getFullYear();
    return sales.map((s) => ({
      id: s.id,
      auctionHouse: s.auctionHouse,
      name: s.name,
      year: s.year,
      startDate: s.startDate,
      hipCount: s._count.hips,
      upcoming: s.year >= currentYear,
    }));
  });
}
