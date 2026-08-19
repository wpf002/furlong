import { prisma } from '@furlong/db';

/**
 * Remove shortlist items whose sale has CONCLUDED — the same real-state rule
 * the rest of the app uses (any realized result on the sale, OR its start date
 * has passed; undated sales fall back to the year). Once an auction has run,
 * a watchlist for it is stale: buyers keep their shortlists, only entries for
 * finished sales are cleared.
 *
 * Called when results load for a sale (ingest) and whenever a buyer's
 * shortlists are listed (so date-passed sales clear even before results post).
 * Optionally scoped to one user. Returns the number of items removed.
 */
export async function pruneConcludedShortlistItems(userId?: string): Promise<number> {
  const items = await prisma.shortlistItem.findMany({
    where: userId ? { shortlist: { userId } } : {},
    select: { id: true, hipId: true },
  });
  if (items.length === 0) return 0;

  const hipIds = [...new Set(items.map((i) => i.hipId))];
  const hips = await prisma.hip.findMany({
    where: { id: { in: hipIds } },
    select: {
      id: true,
      sale: {
        select: {
          startDate: true,
          year: true,
          hips: { where: { result: { isNot: null } }, take: 1, select: { id: true } },
        },
      },
    },
  });

  const now = Date.now();
  const thisYear = new Date().getUTCFullYear();
  const concludedHip = new Set(
    hips
      .filter((h) => {
        const s = h.sale;
        return (
          s.hips.length > 0 || (s.startDate ? s.startDate.getTime() < now : s.year < thisYear)
        );
      })
      .map((h) => h.id),
  );
  // A saved hip whose Hip row no longer exists is stale too.
  const existing = new Set(hips.map((h) => h.id));
  const doomed = items
    .filter((i) => concludedHip.has(i.hipId) || !existing.has(i.hipId))
    .map((i) => i.id);
  if (doomed.length === 0) return 0;

  const res = await prisma.shortlistItem.deleteMany({ where: { id: { in: doomed } } });
  return res.count;
}
