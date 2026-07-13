/**
 * GET /hips/:id/pedigree-brief — a short, industry-style "pedigree read" for a
 * hip, generated from the model's native bloodstock knowledge (sire tendencies,
 * damsire influence, family notability). This is the qualitative context a
 * catalog page conveys that we don't hold as structured data (black-type family,
 * sire sex-bias, surface/distance profile).
 *
 * Honesty guardrails live in the system prompt: qualitative only, NEVER invent
 * numbers, and admit when a sire/dam isn't recognized rather than guess. It's
 * clearly labeled AI context in the UI — separate from the data-driven valuation.
 */
import type { FastifyInstance } from 'fastify';
import { request } from 'undici';
import { prisma } from '@furlong/db';
import { PEDIGREE_KNOWLEDGE } from '../assistant/pedigreeKnowledge.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const BRIEF_SYSTEM = `You are a bloodstock pedigree analyst writing a short note for a yearling buyer sizing up a horse. Given the sire, dam, damsire, and sex, write 3–5 sentences of industry context on what the pedigree suggests.

Draw ONLY on well-established, widely-known industry knowledge:
- The sire's reputation and tendencies: sex bias (does he get notably better colts or fillies?), surface (dirt/turf), distance (sprinter vs. classic/route), precocity (early 2yo type vs. late-maturing), and temperament if well known.
- The damsire's influence as a broodmare sire.
- The female family's notability, ONLY if you genuinely recognize the dam or her family.

HARD RULES:
- NEVER state specific numbers you can't verify — no earnings figures, no exact stakes-winner counts, no sale prices, no win totals. Speak qualitatively.
- If you do not reliably recognize a sire, dam, or damsire, SAY SO plainly (e.g. "a young/less-established sire without a clear track record yet") rather than guessing. Never fabricate race names, black-type wins, or accomplishments.
- This is qualitative context to COMPLEMENT — never override or restate — Furlong's data-driven valuation. Do not mention or invent prices or values.
- Be concise, concrete, and genuinely useful. No hedging filler, no "consult an expert" boilerplate, no disclaimers (the UI adds those).
- Output PLAIN PROSE ONLY. Do NOT use markdown, asterisks, bold, or any formatting. Do NOT begin with a title or heading (e.g. no "Pedigree Read: …") — the UI supplies the heading. Just write the sentences.

Register to aim for: "By Medaglia d'Oro — a proven source of high-class fillies, so this filly's sex fits his strongest pattern — with a dirt, two-turn profile that favors classic distances over speed. The damsire, Tapit, is among the premier broodmare sires in North America, reinforcing class and stamina. A page that reads better for staying than sprinting."

Apply the Secretariat Pedigree Intelligence System below — the sire signatures, broodmare-sire influence, sex tendencies, surface/distance heritability, maturity curves, and "hidden angle" logic — to make the read specific and professional rather than generic. Draw on it, but still obey the HARD RULES above (qualitative, no invented numbers, admit when a sire/dam isn't recognized).

═══════════════════════════════════════════════════════════════════════════════
${PEDIGREE_KNOWLEDGE}`;

// Briefs are stable per (sire, dam, damsire, sex) — cache in memory to avoid
// repeat model calls. Dev-grade; production would use Redis or a table.
const briefCache = new Map<string, string>();

export async function registerPedigreeRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/hips/:id/pedigree-brief', async (req, reply) => {
    const hip = await prisma.hip.findUnique({
      where: { id: req.params.id },
      include: { horse: { include: { sire: true, dam: { include: { sire: true } } } } },
    });
    if (!hip) return reply.status(404).send({ error: 'hip not found' });

    const sire = hip.horse.sire?.name ?? null;
    const dam = hip.horse.dam?.name ?? null;
    const damsire = hip.horse.dam?.sire?.name ?? null;
    const sex = hip.horse.sex ?? null;
    if (!sire && !dam) return { brief: null, configured: true };

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { brief: null, configured: false };

    const sig = `${sire}|${dam}|${damsire}|${sex}`.toLowerCase();
    const cached = briefCache.get(sig);
    if (cached) return { brief: cached, configured: true };

    const model = process.env.ASSISTANT_MODEL ?? 'claude-sonnet-4-5';
    const sexWord = sex ? sex.toLowerCase() : 'young horse';
    const foaled = hip.horse.foalingYear ? ` foaled ${hip.horse.foalingYear}` : '';
    const userMsg =
      `Sire: ${sire ?? 'unknown'}. Dam: ${dam ?? 'unknown'}. ` +
      `Damsire: ${damsire ?? 'unknown'}. This is a ${sexWord}${foaled}. Write the pedigree read.`;

    const res = await request(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system: BRIEF_SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
      headersTimeout: 30_000,
      bodyTimeout: 30_000,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      // Best-effort context — a model error (e.g. an invalid/absent API key) must
      // never break or error the hip page. Log and degrade to "nothing shown".
      const text = await res.body.text();
      req.log.warn(`pedigree-brief model call failed: ${res.statusCode} ${text.slice(0, 200)}`);
      return { brief: null, configured: false };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.body.json()) as any;
    const brief = (data.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n')
      .trim();
    if (brief) briefCache.set(sig, brief);
    return { brief: brief || null, configured: true };
  });
}
