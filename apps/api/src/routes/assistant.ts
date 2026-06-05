/**
 * POST /assistant — "Secretariat", Furlong's conversational assistant.
 *
 * Runs a Claude tool-use loop over the deterministic tools in ../assistant/tools.
 * The model routes natural language to those tools and phrases the result; it
 * never invents prices (ROADMAP invariant). Stateless: the client sends the full
 * short conversation each turn.
 */
import type { FastifyInstance } from 'fastify';
import { request } from 'undici';
import { TOOLS, executeTool } from '../assistant/tools.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TOOL_ROUNDS = 6;

const SYSTEM = `You are Secretariat, the assistant inside Furlong — a thoroughbred auction
intelligence app for yearling, breeding-stock, and 2YO-in-training buyers.

You do two things:
1. Answer questions about the user's catalogs/sales by calling the provided tools
   (list_sales, search_hips, compare_sire), then summarizing the results clearly.
2. Explain how the app works using app_help.

Hard rules:
- NEVER invent or estimate prices, valuations, counts, or records. Only state
  numbers that a tool returned. If a tool returns nothing, say so plainly.
- Money strings from tools are already formatted in the sale's currency (USD "$",
  guineas "gns") — quote them as-is, don't convert.
- Be concise and scannable. Use short lists for multiple hips. Mention the sale a
  hip is from. If a search was truncated (total > returned), say how many matched.
- If the user is vague, make a reasonable tool call rather than asking back.`;

interface ClientMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function registerAssistantRoutes(app: FastifyInstance) {
  app.post<{ Body: { messages?: ClientMessage[] } }>('/assistant', async (req, reply) => {
    const incoming = Array.isArray(req.body?.messages) ? req.body!.messages : [];
    const clean = incoming
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12);
    if (clean.length === 0 || clean[clean.length - 1]!.role !== 'user') {
      return reply.status(400).send({ error: 'messages must end with a user turn' });
    }

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return {
        reply:
          "I'm not switched on yet — set ANTHROPIC_API_KEY in the server's environment and I'll be ready to search your catalogs.",
        toolsUsed: [],
        configured: false,
      };
    }
    const model = process.env.ASSISTANT_MODEL ?? 'claude-sonnet-4-5';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = clean.map((m) => ({ role: m.role, content: m.content }));
    const toolsUsed: string[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await request(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model, max_tokens: 1024, system: SYSTEM, tools: TOOLS, messages }),
        headersTimeout: 60_000,
        bodyTimeout: 60_000,
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const text = await res.body.text();
        return reply
          .status(502)
          .send({ error: `assistant model call failed: ${res.statusCode} ${text.slice(0, 300)}` });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.body.json()) as any;

      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: data.content });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolResults: any[] = [];
        for (const block of data.content) {
          if (block.type === 'tool_use') {
            toolsUsed.push(block.name);
            let result: unknown;
            try {
              result = await executeTool(block.name, block.input ?? {});
            } catch (err) {
              result = { error: err instanceof Error ? err.message : 'tool failed' };
            }
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      const text = (data.content ?? [])
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('\n')
        .trim();
      return { reply: text || '…', toolsUsed: [...new Set(toolsUsed)], configured: true };
    }

    return {
      reply: 'That took more steps than I expected — try narrowing the question.',
      toolsUsed: [...new Set(toolsUsed)],
      configured: true,
    };
  });
}
