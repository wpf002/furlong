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
