import { prisma } from '@furlong/db';
import { normalizeEntityName, type ParseCatalogResponse } from '@furlong/shared';
import { resolveBreeder, resolveConsignor, resolveHorseByName } from './entityResolution.js';

export interface IngestResult {
  saleId: string;
  created: number;
  updated: number;
}

/**
 * Pure DB ingestion of a parsed catalog (no HTTP). Idempotent: re-ingesting the
 * same catalog creates zero new hips or horses.
 *
 * Entity resolution order per hip: damsire -> dam (with sireId = damsire) ->
 * sire -> consignor -> breeder, then upsert the Hip on [saleId, hipNumber].
 */
export async function ingestCatalog(parsed: ParseCatalogResponse): Promise<IngestResult> {
  const sale = await prisma.sale.upsert({
    where: {
      auctionHouse_name_year: {
        auctionHouse: parsed.auctionHouse,
        name: parsed.saleName,
        year: parsed.year,
      },
    },
    update: {},
    create: {
      auctionHouse: parsed.auctionHouse,
      name: parsed.saleName,
      year: parsed.year,
    },
    select: { id: true },
  });

  let created = 0;
  let updated = 0;

  for (const hip of parsed.hips) {
    // Pedigree resolution: damsire first so we can hang it off the dam.
    const damsireId = await resolveHorseByName(hip.damsireName);

    let damId = await resolveHorseByName(hip.damName);
    if (damId && damsireId) {
      await prisma.horse.update({
        where: { id: damId },
        data: { sireId: damsireId },
      });
    }

    const sireId = await resolveHorseByName(hip.sireName);
    const consignorId = await resolveConsignor(hip.consignorName);
    const breederId = await resolveBreeder(hip.breederName);

    const normalizedName = normalizeEntityName(hip.name);

    const yearlingData = {
      name: hip.name?.trim() || null,
      normalizedName,
      sex: hip.sex,
      color: hip.color,
      foalingYear: hip.foalingYear,
      sireId,
      damId,
    };

    const existing = await prisma.hip.findUnique({
      where: { saleId_hipNumber: { saleId: sale.id, hipNumber: hip.hipNumber } },
      select: { id: true, horseId: true },
    });

    if (existing) {
      // Update the existing yearling Horse in place (do not create a new one).
      await prisma.horse.update({
        where: { id: existing.horseId },
        data: yearlingData,
      });
      await prisma.hip.update({
        where: { id: existing.id },
        data: {
          sessionNumber: hip.sessionNumber,
          consignorId,
          breederId,
        },
      });
      updated += 1;
    } else {
      const yearling = await prisma.horse.create({
        data: yearlingData,
        select: { id: true },
      });
      await prisma.hip.create({
        data: {
          saleId: sale.id,
          hipNumber: hip.hipNumber,
          sessionNumber: hip.sessionNumber,
          horseId: yearling.id,
          consignorId,
          breederId,
        },
      });
      created += 1;
    }
  }

  return { saleId: sale.id, created, updated };
}
