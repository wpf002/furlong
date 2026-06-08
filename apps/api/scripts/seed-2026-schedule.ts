/**
 * Seeds the published 2026 North American + Tattersalls sale schedule as
 * catalog-pending shells (real house, real name, real dates — no HIPs yet).
 *
 * These are genuine, publicly-announced sales whose catalogs haven't dropped;
 * they let buyers see what's coming on the Calendar and in search. Once a real
 * catalog is published it can be ingested against the same (house, name, year)
 * key and the shell fills in.
 *
 * Idempotent: re-running upserts by the @@unique([auctionHouse, name, year]).
 * Sources: fasigtipton.com/calendar/2026, keeneland.com/sales, tattersalls.com.
 *
 * Run: pnpm --filter @furlong/api exec tsx scripts/seed-2026-schedule.ts
 */
import { prisma, AuctionHouse, SaleCategory } from '@furlong/db';

// Dates stored at noon UTC so US-local formatting never rolls back a day.
function d(month: number, day: number): Date {
  return new Date(Date.UTC(2026, month - 1, day, 12, 0, 0));
}

type Seed = {
  auctionHouse: AuctionHouse;
  name: string;
  startDate: Date;
  endDate: Date | null;
  currency: string;
  category: SaleCategory;
};

const SALES: Seed[] = [
  // Fasig-Tipton (USD). The July Sale already has a 2026 catalog but was missing
  // a startDate — set it so it sorts correctly (upsert leaves its hips intact).
  { auctionHouse: 'FASIG_TIPTON', name: 'The July Sale', startDate: d(7, 14), endDate: null, currency: 'USD', category: 'YEARLING' },
  { auctionHouse: 'FASIG_TIPTON', name: 'The Saratoga Sale', startDate: d(8, 10), endDate: d(8, 11), currency: 'USD', category: 'YEARLING' },
  { auctionHouse: 'FASIG_TIPTON', name: 'New York Bred Yearlings', startDate: d(8, 16), endDate: d(8, 17), currency: 'USD', category: 'YEARLING' },
  { auctionHouse: 'FASIG_TIPTON', name: 'California Fall Yearlings', startDate: d(9, 30), endDate: null, currency: 'USD', category: 'YEARLING' },
  { auctionHouse: 'FASIG_TIPTON', name: 'Kentucky October Yearlings', startDate: d(10, 19), endDate: d(10, 22), currency: 'USD', category: 'YEARLING' },
  { auctionHouse: 'FASIG_TIPTON', name: 'Midlantic Fall Yearlings', startDate: d(10, 27), endDate: null, currency: 'USD', category: 'YEARLING' },
  { auctionHouse: 'FASIG_TIPTON', name: 'The November Sale', startDate: d(11, 2), endDate: null, currency: 'USD', category: 'MIXED' },

  // Keeneland (USD)
  { auctionHouse: 'KEENELAND', name: 'September Yearling Sale', startDate: d(9, 14), endDate: d(9, 26), currency: 'USD', category: 'YEARLING' },
  { auctionHouse: 'KEENELAND', name: 'November Breeding Stock Sale', startDate: d(11, 3), endDate: d(11, 10), currency: 'USD', category: 'BREEDING_STOCK' },

  // Tattersalls (guineas)
  { auctionHouse: 'TATTERSALLS', name: 'October Yearling Sale Book 1', startDate: d(10, 6), endDate: d(10, 8), currency: 'GNS', category: 'YEARLING' },
  { auctionHouse: 'TATTERSALLS', name: 'October Yearling Sale Book 2', startDate: d(10, 12), endDate: d(10, 14), currency: 'GNS', category: 'YEARLING' },
  { auctionHouse: 'TATTERSALLS', name: 'October Yearling Sale Book 3', startDate: d(10, 15), endDate: d(10, 16), currency: 'GNS', category: 'YEARLING' },
];

async function main() {
  let created = 0;
  let updated = 0;
  for (const s of SALES) {
    const existing = await prisma.sale.findUnique({
      where: { auctionHouse_name_year: { auctionHouse: s.auctionHouse, name: s.name, year: 2026 } },
    });
    await prisma.sale.upsert({
      where: { auctionHouse_name_year: { auctionHouse: s.auctionHouse, name: s.name, year: 2026 } },
      create: { ...s, year: 2026 },
      update: { startDate: s.startDate, endDate: s.endDate, currency: s.currency, category: s.category },
    });
    if (existing) updated++;
    else created++;
    console.log(`${existing ? 'updated' : 'created'}  ${s.auctionHouse} — ${s.name} (2026)`);
  }
  console.log(`\nDone. ${created} created, ${updated} updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
