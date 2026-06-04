import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@furlong/db';

/**
 * MVP identity (Phase 3): passwordless, email-based accounts. The client logs in
 * with an email, gets a user id, and sends it back as the `x-user-id` header.
 * This is NOT secure auth (anyone could spoof the header) — it's enough to
 * associate profiles/shortlists/alerts with a user for the prototype. Harden
 * with real sessions/magic-links before any non-local deployment.
 */
export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string; email: string } | null> {
  const raw = req.headers['x-user-id'];
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) {
    reply.status(401).send({ error: 'authentication required (x-user-id header)' });
    return null;
  }
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!user) {
    reply.status(401).send({ error: 'unknown user' });
    return null;
  }
  return user;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  // Passwordless login: upsert a user by email and return it.
  app.post('/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string };
    const email = (body.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return reply.status(400).send({ error: 'a valid email is required' });
    }
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
      select: { id: true, email: true },
    });
    return user;
  });
}
