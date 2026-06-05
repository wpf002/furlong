'use client';

import { useEffect, useRef, useState } from 'react';
import { askSecretariat, type AssistantMessage } from '../lib/api';

const GREETING =
  "Hi, I'm Secretariat. Ask me about your catalogs — \"find all colts by Into Mischief\", " +
  '"which sales do I have?", or "how do Frankel\'s yearlings sell?". I can also explain how the app works.';

const SUGGESTIONS = [
  'Which sales do I have?',
  'Find all colts by Into Mischief',
  'How do Frankel’s yearlings sell across houses?',
  'How do shortlists work?',
];

export function Secretariat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setError(null);
    const next = [...messages, { role: 'user' as const, content: q }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await askSecretariat(next);
      setMessages([...next, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setMessages(next);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Secretariat assistant"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-racing-800 px-4 py-3 text-sm font-medium text-white shadow-cardHover transition hover:bg-racing-700"
        >
          <span aria-hidden className="text-lg">
            🐎
          </span>
          Ask Secretariat
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex h-[32rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-ink/10 bg-paper-50 shadow-cardHover">
          <header className="flex items-center justify-between bg-racing-800 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span aria-hidden className="text-lg">
                🐎
              </span>
              <span className="font-serif text-base font-medium">Secretariat</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded p-1 text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.length === 0 && (
              <>
                <Bubble role="assistant">{GREETING}</Bubble>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-ink/15 bg-paper-100 px-2.5 py-1 text-[11px] text-ink-600 transition hover:border-brass-400 hover:text-ink-900"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
            {messages.map((m, i) => (
              <Bubble key={i} role={m.role}>
                {m.content}
              </Bubble>
            ))}
            {loading && (
              <Bubble role="assistant">
                <span className="inline-flex gap-1">
                  <Dot /> <Dot /> <Dot />
                </span>
              </Bubble>
            )}
            {error && <p className="px-1 text-xs text-red-600">{error}</p>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-ink/10 bg-paper-50 px-3 py-2.5"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Secretariat about your catalogs…"
              className="min-w-0 flex-1 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-brass-400"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-lg bg-racing-800 px-3 py-2 text-sm font-medium text-white transition hover:bg-racing-700 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isUser ? 'bg-racing-800 text-white' : 'border border-ink/10 bg-white text-ink-800'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function Dot() {
  return <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink/40" />;
}
