import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { bigintToNumberDeep } from '@furlong/shared';
import { registerHealthRoutes } from './routes/health.js';
import { registerSaleRoutes } from './routes/sales.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerModelRoutes } from './routes/model.js';
import { registerAuthRoutes } from './auth.js';
import { registerBuyerRoutes } from './routes/buyer.js';
import { registerCompareRoutes } from './routes/compare.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerAssistantRoutes } from './routes/assistant.js';

// 25MB body limit: a full Keeneland September year is several thousand hips of
// catalog JSON in one /ingest/catalog-json call.
const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });

// Money invariant: Prisma returns BigInt for cents columns, which JSON.stringify
// cannot serialize. Run every payload through bigintToNumberDeep first.
app.setReplySerializer((payload) => JSON.stringify(bigintToNumberDeep(payload)));

await app.register(cors, { origin: true });
// Catalog PDFs run to several MB (full pedigree pages). Raise the default 1MB cap.
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
await registerHealthRoutes(app);
await registerSaleRoutes(app);
await registerSearchRoutes(app);
await registerIngestRoutes(app);
await registerModelRoutes(app);
await registerAuthRoutes(app);
await registerBuyerRoutes(app);
await registerCompareRoutes(app);
await registerJobRoutes(app);
await registerAssistantRoutes(app);

// Railway (and most PaaS) inject the bind port as PORT; fall back to API_PORT
// for local dev. Host 0.0.0.0 so the container is reachable.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
