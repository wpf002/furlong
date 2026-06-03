import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@furlong/db';
import { normalizeEntityName, type ParseCatalogResponse } from '@furlong/shared';
import { ingestCatalog } from './ingestCatalog.js';

// Unique per test run so we don't collide with anything in the dev DB.
const SALE_NAME = `Test Idempotency Sale ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SALE_YEAR = 2099;

const SHARED_SIRE = 'Into Mischief';
const SHARED_CONSIGNOR = 'Lane End Sales, Agent';

const fixture: ParseCatalogResponse = {
  auctionHouse: 'KEENELAND',
  saleName: SALE_NAME,
  year: SALE_YEAR,
  hips: [
    {
      hipNumber: 1,
      sessionNumber: 1,
      name: 'Bay Colt 1',
      sex: 'COLT',
      color: 'Bay',
      foalingYear: 2098,
      sireName: SHARED_SIRE,
      damName: 'Test Dam One',
      damsireName: 'Test Damsire One',
      consignorName: SHARED_CONSIGNOR,
      breederName: 'Test Breeder One',
    },
    {
      hipNumber: 2,
      sessionNumber: 1,
      name: 'Chestnut Filly 2',
      sex: 'FILLY',
      color: 'Chestnut',
      foalingYear: 2098,
      sireName: SHARED_SIRE, // shared sire across hips 1 & 2
      damName: 'Test Dam Two',
      damsireName: 'Test Damsire Two',
      consignorName: SHARED_CONSIGNOR, // shared consignor across hips 1 & 2
      breederName: 'Test Breeder Two',
    },
    {
      hipNumber: 3,
      sessionNumber: 2,
      name: 'Bay Filly 3',
      sex: 'FILLY',
      color: 'Bay',
      foalingYear: 2098,
      sireName: 'Curlin',
      damName: 'Test Dam Three',
      damsireName: 'Test Damsire Three',
      consignorName: 'Taylor Made Sales Agency',
      breederName: 'Test Breeder Three',
    },
    {
      hipNumber: 4,
      sessionNumber: 2,
      name: 'Gray Colt 4',
      sex: 'COLT',
      color: 'Gray/Roan',
      foalingYear: 2098,
      sireName: 'Tapit',
      damName: 'Test Dam Four',
      damsireName: 'Test Damsire Four',
      consignorName: 'Gainesway, Agent',
      breederName: 'Test Breeder Four',
    },
  ],
  report: {
    pagesScanned: 4,
    blocksDetected: 4,
    hipsParsed: 4,
    hipsSkipped: 0,
    parseRate: 1,
    skipped: [],
  },
};

// Names we create that need cleanup. Pedigree horses + yearlings (by normalized
// name) and the consignors/breeders below.
const horseNames = [
  SHARED_SIRE,
  'Curlin',
  'Tapit',
  'Bay Colt 1',
  'Chestnut Filly 2',
  'Bay Filly 3',
  'Gray Colt 4',
  'Test Dam One',
  'Test Dam Two',
  'Test Dam Three',
  'Test Dam Four',
  'Test Damsire One',
  'Test Damsire Two',
  'Test Damsire Three',
  'Test Damsire Four',
];
const consignorNames = [SHARED_CONSIGNOR, 'Taylor Made Sales Agency', 'Gainesway, Agent'];
const breederNames = [
  'Test Breeder One',
  'Test Breeder Two',
  'Test Breeder Three',
  'Test Breeder Four',
];

async function findSale() {
  return prisma.sale.findUnique({
    where: {
      auctionHouse_name_year: { auctionHouse: 'KEENELAND', name: SALE_NAME, year: SALE_YEAR },
    },
  });
}

describe('ingestCatalog', () => {
  afterAll(async () => {
    const sale = await findSale();
    if (sale) {
      const hips = await prisma.hip.findMany({
        where: { saleId: sale.id },
        select: { id: true, horseId: true },
      });
      const hipIds = hips.map((h) => h.id);
      const yearlingIds = hips.map((h) => h.horseId);

      await prisma.valuation.deleteMany({ where: { hipId: { in: hipIds } } });
      await prisma.saleResult.deleteMany({ where: { hipId: { in: hipIds } } });
      await prisma.hip.deleteMany({ where: { saleId: sale.id } });
      await prisma.horse.deleteMany({ where: { id: { in: yearlingIds } } });
      await prisma.sale.delete({ where: { id: sale.id } });
    }

    // Pedigree horses are keyed by normalized name. Detach pedigree links among
    // the candidate set first so deletion is order-independent (a damsire is
    // referenced by its dam via sireId), then delete those no longer used by any
    // remaining hip or referenced as a parent by an out-of-set horse.
    const normHorse = horseNames
      .map((n) => normalizeEntityName(n))
      .filter((n): n is string => n != null);
    const candidates = await prisma.horse.findMany({
      where: { normalizedName: { in: normHorse } },
      select: { id: true },
    });
    const candidateIds = candidates.map((c) => c.id);

    // Drop intra-set parent links so we can delete freely.
    await prisma.horse.updateMany({
      where: { id: { in: candidateIds } },
      data: { sireId: null, damId: null },
    });

    for (const c of candidates) {
      const stillUsed = await prisma.hip.count({ where: { horseId: c.id } });
      const refsAsParent = await prisma.horse.count({
        where: { OR: [{ sireId: c.id }, { damId: c.id }] },
      });
      if (stillUsed === 0 && refsAsParent === 0) {
        await prisma.horse.delete({ where: { id: c.id } }).catch(() => {});
      }
    }

    const normConsignor = consignorNames
      .map((n) => normalizeEntityName(n))
      .filter((n): n is string => n != null);
    await prisma.consignor.deleteMany({ where: { normalizedName: { in: normConsignor } } });

    const normBreeder = breederNames
      .map((n) => normalizeEntityName(n))
      .filter((n): n is string => n != null);
    await prisma.breeder.deleteMany({ where: { normalizedName: { in: normBreeder } } });

    await prisma.$disconnect();
  });

  it('ingests a catalog and is idempotent on re-ingest', async () => {
    // ---- First run ----
    const first = await ingestCatalog(fixture);
    expect(first.created).toBe(4);
    expect(first.updated).toBe(0);

    const saleId = first.saleId;

    const hipsAfterFirst = await prisma.hip.count({ where: { saleId } });
    expect(hipsAfterFirst).toBe(4);

    // The shared sire must be exactly ONE Horse row.
    const sireNorm = normalizeEntityName(SHARED_SIRE)!;
    const sireRows = await prisma.horse.findMany({ where: { normalizedName: sireNorm } });
    expect(sireRows.length).toBe(1);
    const sireId = sireRows[0]!.id;

    // Both hip 1 and hip 2 yearlings point at the same sire.
    const yearlings = await prisma.hip.findMany({
      where: { saleId, hipNumber: { in: [1, 2] } },
      include: { horse: true },
    });
    expect(yearlings.length).toBe(2);
    for (const y of yearlings) {
      expect(y.horse.sireId).toBe(sireId);
    }

    // Shared consignor is one row, attached to hips 1 & 2.
    const consignorNorm = normalizeEntityName(SHARED_CONSIGNOR)!;
    const consignorRows = await prisma.consignor.findMany({
      where: { normalizedName: consignorNorm },
    });
    expect(consignorRows.length).toBe(1);

    // Damsire wired onto the dam: hip 1's dam.sire should be Damsire One.
    const hip1 = await prisma.hip.findFirst({
      where: { saleId, hipNumber: 1 },
      include: { horse: { include: { dam: { include: { sire: true } } } } },
    });
    expect(hip1?.horse.dam?.sire?.normalizedName).toBe(
      normalizeEntityName('Test Damsire One'),
    );

    // Count distinct horses created by this sale's ingest (yearlings + dams +
    // damsires + sires). 4 yearlings + 4 dams + 4 damsires + 3 distinct sires.
    const horsesAfterFirst = await prisma.horse.count();

    // ---- Second run (idempotent) ----
    const second = await ingestCatalog(fixture);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(4);

    const hipsAfterSecond = await prisma.hip.count({ where: { saleId } });
    expect(hipsAfterSecond).toBe(4);

    const horsesAfterSecond = await prisma.horse.count();
    expect(horsesAfterSecond).toBe(horsesAfterFirst);

    // Still exactly one shared sire row.
    const sireRows2 = await prisma.horse.findMany({ where: { normalizedName: sireNorm } });
    expect(sireRows2.length).toBe(1);
    expect(sireRows2[0]!.id).toBe(sireId);
  });
});
