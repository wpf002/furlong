'use client';

import { useEffect, useRef, useState } from 'react';
import type { Sale } from '../lib/api';
import { nonDefaultCategoryLabel, nonUsdCurrency } from '../lib/format';
import { ChevronDownIcon } from './icons';

function saleLabel(s: Sale): string {
  const cat = nonDefaultCategoryLabel(s.category);
  const cur = nonUsdCurrency(s.currency);
  const pending = (s.hipCount ?? 1) === 0 ? 'Catalog pending' : null;
  const tags = [cat, cur, pending].filter(Boolean);
  return `${s.name} (${s.year}) — ${s.auctionHouse}${tags.length ? ` · ${tags.join(' · ')}` : ''}`;
}

export function SaleSelect({
  sales,
  value,
  onChange,
  disabled,
}: {
  sales: Sale[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = sales.find((s) => s.id === value);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Scroll the selected item into view when the list opens.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
    active?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="w-full cursor-pointer rounded-xl border border-ink/15 bg-paper-50 py-3 pl-4 pr-11 text-left font-serif text-base text-ink-900 shadow-card transition hover:border-brass-400/70 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15 disabled:cursor-not-allowed disabled:bg-paper-200/60"
      >
        {selected ? saleLabel(selected) : sales.length === 0 ? 'No sales available' : 'Select a sale…'}
      </button>
      <ChevronDownIcon
        className={`pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-brass-600 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
      />

      {open && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-ink/15 bg-paper-50 shadow-card"
        >
          {sales.map((s) => {
            const active = s.id === value;
            return (
              <button
                key={s.id}
                type="button"
                data-active={active}
                onClick={() => {
                  onChange(s.id);
                  setOpen(false);
                }}
                className={`block w-full px-4 py-2.5 text-left font-serif text-base transition hover:bg-ink/5 ${
                  active ? 'font-semibold text-racing-800' : 'text-ink-900'
                }`}
              >
                {saleLabel(s)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
