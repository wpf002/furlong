import { prisma } from '@furlong/db';
import { normalizeEntityName, cleanDisplayName } from '@furlong/shared';

/**
 * Find-or-create a Horse by its normalized name. Used for the shared pedigree
 * entities (sires, dams, damsires) which must collapse to a single row across
 * spelling variants and years. Returns the horse id, or null when the name is
 * null/empty.
 *
 * Because normalizedName is not a unique column on Horse (a yearling and its
 * sire can legitimately share neither — but pedigree entities are deduped on
 * it), we look up the first matching row and create only when absent.
 */
export async function resolveHorseByName(name: string | null): Promise<string | null> {
  const normalized = normalizeEntityName(name);
  if (!normalized) return null;

  const existing = await prisma.horse.findFirst({
    where: { normalizedName: normalized },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.horse.create({
    data: { name: cleanDisplayName(name), normalizedName: normalized },
    select: { id: true },
  });
  return created.id;
}

/**
 * Find-or-create a Consignor by normalized name (a unique column). First-seen
 * display name wins. Returns the id, or null for empty input.
 */
export async function resolveConsignor(name: string | null): Promise<string | null> {
  const normalized = normalizeEntityName(name);
  if (!normalized) return null;

  const row = await prisma.consignor.upsert({
    where: { normalizedName: normalized },
    update: {}, // keep first-seen display name
    create: { name: name!.trim(), normalizedName: normalized },
    select: { id: true },
  });
  return row.id;
}

/**
 * Find-or-create a Breeder by normalized name (a unique column). First-seen
 * display name wins. Returns the id, or null for empty input.
 */
export async function resolveBreeder(name: string | null): Promise<string | null> {
  const normalized = normalizeEntityName(name);
  if (!normalized) return null;

  const row = await prisma.breeder.upsert({
    where: { normalizedName: normalized },
    update: {},
    create: { name: name!.trim(), normalizedName: normalized },
    select: { id: true },
  });
  return row.id;
}
