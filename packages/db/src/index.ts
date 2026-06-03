import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Load the monorepo root .env regardless of the consumer's cwd
// (apps/api, scripts, etc. all run from different directories).
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });
dotenv.config(); // also pick up a local .env if present (no override)

// Prisma 7: the connection URL is no longer in schema.prisma. The runtime
// client connects through the pg driver adapter.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set (expected in the monorepo root .env)');
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaPg(connectionString);

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter, log: ['error', 'warn'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '@prisma/client';
