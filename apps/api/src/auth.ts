import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { prisma } from '@furlong/db';

/**
 * Phase 4 hardened auth. Login is still email-based (passwordless MVP) but now
 * issues a signed session token (HS256 JWT). Clients send it as
 * `Authorization: Bearer <token>`; the server verifies the signature, so a user
 * id can no longer be spoofed via a plain header. Tokens expire in 30 days.
 *
 * (A magic-link/OTP step would add proof of email ownership; deferred. The
 * secret MUST be set via AUTH_SECRET in production.)
 */
const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  (() => {
    console.warn('AUTH_SECRET not set — using an insecure dev default. Set AUTH_SECRET.');
    return 'furlong-dev-insecure-secret';
  })();
const TOKEN_TTL = '30d';

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, AUTH_SECRET, { expiresIn: TOKEN_TTL });
}

export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string; email: string } | null> {
  const header = req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : '';
  if (!token) {
    reply.status(401).send({ error: 'authentication required (Bearer token)' });
    return null;
  }
  let userId: string;
  try {
    const payload = jwt.verify(token, AUTH_SECRET) as { sub?: string };
    if (!payload.sub) throw new Error('no subject');
    userId = payload.sub;
  } catch {
    reply.status(401).send({ error: 'invalid or expired session' });
    return null;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) {
    reply.status(401).send({ error: 'unknown user' });
    return null;
  }
  return user;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  // Passwordless login: upsert a user by email and return a signed session token.
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
    return { ...user, token: signToken(user.id) };
  });
}
