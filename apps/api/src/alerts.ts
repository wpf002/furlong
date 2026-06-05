import { prisma } from '@furlong/db';
import { normalizeEntityName } from '@furlong/shared';
import { sendAlertNotifications } from './notify.js';

/**
 * Create catalog-drop alerts when a sale's catalog is ingested. A user is
 * alerted if their profile has no preferred sires (wants everything) or at least
 * one preferred sire appears in the sale. Idempotent: one alert per (user, sale).
 */
export async function createCatalogDropAlerts(saleId: string): Promise<number> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId } });
  if (!sale) return 0;

  const hips = await prisma.hip.findMany({
    where: { saleId },
    include: { horse: { include: { sire: true } } },
  });
  const saleSires = new Set<string>();
  for (const h of hips) {
    const n = normalizeEntityName(h.horse.sire?.name ?? null);
    if (n) saleSires.add(n);
  }

  const profiles = await prisma.buyerProfile.findMany();
  let created = 0;
  for (const p of profiles) {
    const prefs = (p.preferredSires ?? [])
      .map((s) => normalizeEntityName(s))
      .filter((s): s is string => s != null);
    const matched = prefs.filter((s) => saleSires.has(s));
    if (prefs.length > 0 && matched.length === 0) continue;

    const existing = await prisma.alert.findFirst({
      where: { userId: p.userId, saleId, type: 'CATALOG_DROP' },
    });
    if (existing) continue;

    const title = `New catalog: ${sale.name} (${sale.year})`;
    const body =
      prefs.length === 0
        ? `${hips.length} hips now available — open the sale to see your shortlist.`
        : `Includes ${matched.length} of your preferred sire(s). ${hips.length} hips available.`;
    await prisma.alert.create({
      data: { userId: p.userId, type: 'CATALOG_DROP', saleId, title, body },
    });
    // Deliver via the user's chosen channels (email/SMS); best-effort.
    const user = await prisma.user.findUnique({
      where: { id: p.userId },
      select: { email: true, phone: true, notifyEmail: true, notifySms: true },
    });
    if (user) {
      void sendAlertNotifications(user, { title, body });
    }
    created += 1;
  }
  return created;
}

/**
 * SALE_SOON — fire when a sale starts within `windowHours`. Same audience rule
 * as catalog-drop (no preferred sires = wants everything; otherwise at least one
 * preferred sire is in the sale). Idempotent per (user, sale, SALE_SOON), so the
 * hourly scheduler can run safely without spamming.
 */
export async function createSaleSoonAlerts(windowHours = 48): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() + windowHours * 3600_000);
  const sales = await prisma.sale.findMany({
    where: { startDate: { gte: now, lte: horizon } },
  });
  if (sales.length === 0) return 0;

  const profiles = await prisma.buyerProfile.findMany();
  let created = 0;

  for (const sale of sales) {
    const hips = await prisma.hip.findMany({
      where: { saleId: sale.id },
      include: { horse: { include: { sire: true } } },
    });
    const saleSires = new Set<string>();
    for (const h of hips) {
      const n = normalizeEntityName(h.horse.sire?.name ?? null);
      if (n) saleSires.add(n);
    }
    const hoursOut = Math.max(
      1,
      Math.round((sale.startDate!.getTime() - now.getTime()) / 3600_000),
    );

    for (const p of profiles) {
      const prefs = (p.preferredSires ?? [])
        .map((s) => normalizeEntityName(s))
        .filter((s): s is string => s != null);
      if (prefs.length > 0 && !prefs.some((s) => saleSires.has(s))) continue;

      const existing = await prisma.alert.findFirst({
        where: { userId: p.userId, saleId: sale.id, type: 'SALE_SOON' },
      });
      if (existing) continue;

      const title = `Starting soon: ${sale.name} (${sale.year})`;
      const body = `${sale.name} begins in about ${hoursOut} hour${hoursOut === 1 ? '' : 's'}. ${hips.length} hips catalogued — review your shortlist.`;
      await prisma.alert.create({
        data: { userId: p.userId, type: 'SALE_SOON', saleId: sale.id, title, body },
      });
      const user = await prisma.user.findUnique({
        where: { id: p.userId },
        select: { email: true, phone: true, notifyEmail: true, notifySms: true },
      });
      if (user) void sendAlertNotifications(user, { title, body });
      created += 1;
    }
  }
  return created;
}

/**
 * CRITERIA_MATCH — fire after a sale is valued, when hips match a buyer's full
 * criteria (preferred sire AND predicted price inside their budget). More
 * precise than CATALOG_DROP (which only says "a catalog exists"). Requires
 * valuations to exist, so callers run this AFTER revalueSale. Idempotent per
 * (user, sale, CRITERIA_MATCH).
 */
export async function createCriteriaMatchAlerts(saleId: string): Promise<number> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId } });
  if (!sale) return 0;

  // Latest valuation per hip + sire name, in one pass.
  const hips = await prisma.hip.findMany({
    where: { saleId },
    include: {
      horse: { include: { sire: true } },
      valuations: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const profiles = await prisma.buyerProfile.findMany();
  let created = 0;

  for (const p of profiles) {
    const prefs = (p.preferredSires ?? [])
      .map((s) => normalizeEntityName(s))
      .filter((s): s is string => s != null);
    const low = p.budgetLowCents;
    const high = p.budgetHighCents;
    // Need at least one real criterion to avoid alerting on an empty profile.
    if (prefs.length === 0 && low == null && high == null) continue;

    let matches = 0;
    for (const h of hips) {
      const sireN = normalizeEntityName(h.horse.sire?.name ?? null);
      if (prefs.length > 0 && (!sireN || !prefs.includes(sireN))) continue;
      const v = h.valuations[0];
      if (low != null || high != null) {
        if (!v) continue;
        const mid = (v.predPriceLowCents + v.predPriceHighCents) / 2n;
        if (low != null && mid < low) continue;
        if (high != null && mid > high) continue;
      }
      matches += 1;
    }
    if (matches === 0) continue;

    const existing = await prisma.alert.findFirst({
      where: { userId: p.userId, saleId, type: 'CRITERIA_MATCH' },
    });
    if (existing) continue;

    const title = `${matches} match${matches === 1 ? '' : 'es'} in ${sale.name} (${sale.year})`;
    const body = `${matches} hip${matches === 1 ? '' : 's'} fit your budget and sire preferences. Open the sale to see your ranked shortlist.`;
    await prisma.alert.create({
      data: { userId: p.userId, type: 'CRITERIA_MATCH', saleId, title, body },
    });
    const user = await prisma.user.findUnique({
      where: { id: p.userId },
      select: { email: true, phone: true, notifyEmail: true, notifySms: true },
    });
    if (user) void sendAlertNotifications(user, { title, body });
    created += 1;
  }
  return created;
}
