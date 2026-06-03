import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 config. The migration engine reads the connection URL here;
// the runtime PrismaClient connects via @prisma/adapter-pg (see src/index.ts).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
