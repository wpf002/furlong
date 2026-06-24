'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { askSecretariat, type AssistantMessage } from '../lib/api';
import { HorseIcon, CloseIcon, MicIcon } from './icons';

// Minimal, dependency-free renderer for the assistant's light markdown: '- '
// bullet lists, **bold**, and paragraph breaks. Keeps replies human-readable
// without dumping raw asterisks.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-ink-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`u${blocks.length}`} className="list-disc space-y-0.5 pl-4">
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = line.match(/^\s*[-•*]\s+(.*)$/);
    if (m) {
      bullets.push(m[1]!);
    } else if (line.trim() === '') {
      flush();
    } else {
      flush();
      blocks.push(
        <p key={`p${blocks.length}`} className="whitespace-pre-wrap">
          {inline(line)}
        </p>,
      );
    }
  }
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}

const GREETING =
  "Hey — I'm Secretariat. Ask me anything about your catalogs: \"show me the colts by " +
  'Into Mischief", "which sales do I have?", or "how have Frankel\'s yearlings been selling?" ' +
  'I can walk you through the app too.';

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
  const [listening, setListening] = useState(false);
  const [micOk, setMicOk] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    // Web Speech API is Chrome/Safari-only and needs a secure context (or
    // localhost). Feature-detect so the mic only shows where it works.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    setMicOk(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  function toggleMic() {
    if (loading) return;
    if (listening && recRef.current) {
      recRef.current.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      setInput((finalText + interim).trim());
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const t = finalText.trim();
      if (t) void send(t); // hands-free: speak, then auto-send
    };
    rec.onerror = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    setError(null);
    setListening(true);
    rec.start();
  }

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
          <HorseIcon className="h-5 w-5" />
          Ask Secretariat
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex h-[32rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-ink/10 bg-paper-50 shadow-cardHover">
          <header className="flex items-center justify-between bg-racing-800 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <HorseIcon className="h-5 w-5" />
              <span className="font-serif text-base font-medium">Secretariat</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded p-1 text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <CloseIcon className="h-4 w-4" />
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
                {m.role === 'assistant' ? <RichText text={m.content} /> : m.content}
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
              placeholder={listening ? 'Listening…' : 'Ask about your catalogs…'}
              className="min-w-0 flex-1 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-brass-400"
            />
            {micOk && (
              <button
                type="button"
                onClick={toggleMic}
                disabled={loading}
                aria-label={listening ? 'Stop listening' : 'Voice input'}
                title={listening ? 'Listening — click to stop' : 'Speak your question'}
                className={`rounded-lg px-2.5 py-2 text-sm transition disabled:opacity-40 ${
                  listening
                    ? 'animate-pulse bg-red-600 text-white'
                    : 'border border-ink/15 bg-white text-ink-600 hover:border-brass-400'
                }`}
              >
                <MicIcon className="h-4 w-4" />
              </button>
            )}
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
