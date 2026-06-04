'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { BuyerAlert } from '../lib/api';
import { useUser } from '../lib/useUser';

const NAV = [
  { href: '/', label: 'Search' },
  { href: '/shortlists', label: 'Shortlists' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/profile', label: 'Profile' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-30 border-b border-ink/10 bg-paper-100/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="font-serif text-lg font-semibold tracking-tightish text-racing-900"
        >
          Furlong
        </Link>

        <div className="ml-2 flex items-center gap-1 sm:gap-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-2.5 py-1.5 text-sm font-medium transition sm:px-3 ${
                isActive(pathname, item.href)
                  ? 'bg-racing-800 text-paper-50'
                  : 'text-ink-600 hover:bg-ink/5 hover:text-ink-900'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <AlertsBell />
          <AuthControl />
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------

function AlertsBell() {
  const { user, ready, userFetch } = useUser();
  const [alerts, setAlerts] = useState<BuyerAlert[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const unread = alerts.filter((a) => a.readAt == null).length;

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const list = await userFetch<BuyerAlert[]>('/me/alerts');
      setAlerts(Array.isArray(list) ? list : []);
    } catch {
      /* never let the bell break the nav */
    }
  }, [user, userFetch]);

  useEffect(() => {
    if (!ready || !user) {
      setAlerts([]);
      return;
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [ready, user, refresh]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function markRead(id: string) {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id && a.readAt == null ? { ...a, readAt: new Date().toISOString() } : a)),
    );
    try {
      await userFetch(`/me/alerts/${encodeURIComponent(id)}/read`, { method: 'POST' });
    } catch {
      /* optimistic; a later poll will reconcile */
    }
  }

  if (!user) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Alerts${unread ? `, ${unread} unread` : ''}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-600 transition hover:bg-ink/5 hover:text-ink-900"
      >
        <span aria-hidden className="text-lg leading-none">
          🔔
        </span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass-600 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-ink/10 bg-paper-50 shadow-card">
          <div className="flex items-center justify-between border-b border-ink/10 px-4 py-2.5">
            <span className="font-serif text-sm font-medium text-ink-900">Alerts</span>
            {unread > 0 && (
              <span className="text-[11px] font-medium uppercase tracking-wide text-brass-600">
                {unread} unread
              </span>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-500">No alerts yet.</p>
            ) : (
              <ul className="divide-y divide-ink/5">
                {alerts.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => a.readAt == null && void markRead(a.id)}
                      className={`block w-full px-4 py-3 text-left transition hover:bg-ink/5 ${
                        a.readAt == null ? 'bg-brass-50/50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {a.readAt == null && (
                          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brass-600" />
                        )}
                        <span className="text-sm font-medium text-ink-900">{a.title}</span>
                      </div>
                      {a.body && (
                        <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{a.body}</p>
                      )}
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-500">
                        {a.type.replace('_', ' ')}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AuthControl() {
  const { user, ready, login, logout } = useUser();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await login(email);
      setEmail('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  // Avoid hydration mismatch: render nothing decisive until localStorage read.
  if (!ready) {
    return <div className="h-9 w-20" />;
  }

  if (user) {
    return (
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full border border-ink/10 bg-paper-50 py-1 pl-1 pr-3 text-sm text-ink-700 shadow-sm transition hover:border-ink/20"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-racing-800 text-xs font-semibold uppercase text-paper-50">
            {user.email.slice(0, 1)}
          </span>
          <span className="hidden max-w-[10rem] truncate sm:inline">{user.email}</span>
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-ink/10 bg-paper-50 shadow-card">
            <div className="border-b border-ink/10 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-ink-500">Signed in as</p>
              <p className="truncate text-sm font-medium text-ink-900">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                logout();
                setOpen(false);
              }}
              className="block w-full px-4 py-2.5 text-left text-sm font-medium text-ink-700 transition hover:bg-ink/5"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg bg-racing-800 px-3.5 py-2 text-sm font-semibold text-paper-50 shadow-sm transition hover:bg-racing-700"
      >
        Sign in
      </button>
      {open && (
        <form
          onSubmit={submit}
          className="absolute right-0 mt-2 w-72 space-y-3 rounded-xl border border-ink/10 bg-paper-50 p-4 shadow-card"
        >
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-600">
              Email
            </label>
            <input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@stable.com"
              className="mt-1.5 w-full rounded-lg border border-ink/15 bg-paper-50 px-3 py-2 text-sm text-ink-900 shadow-sm placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="w-full rounded-lg bg-racing-800 px-3 py-2 text-sm font-semibold text-paper-50 shadow-sm transition hover:bg-racing-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Continue'}
          </button>
          <p className="text-[11px] leading-relaxed text-ink-500">
            Passwordless MVP — we just remember your email on this device.
          </p>
        </form>
      )}
    </div>
  );
}
