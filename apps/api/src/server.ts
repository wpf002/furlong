import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerHealthRoutes } from './routes/health.js';
import { registerSaleRoutes } from './routes/sales.js';
import { registerSearchRoutes } from './routes/search.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await registerHealthRoutes(app);
await registerSaleRoutes(app);
await registerSearchRoutes(app);

const port = Number(process.env.API_PORT ?? 4000);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
