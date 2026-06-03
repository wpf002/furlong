import type { ReactNode } from 'react';

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'brass';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink/5 text-ink-600 ring-ink/10',
  green: 'bg-racing-50 text-racing-700 ring-racing-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-300/60',
  red: 'bg-red-50 text-red-700 ring-red-200',
  brass: 'bg-brass-50 text-brass-700 ring-brass-400/40',
};

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
