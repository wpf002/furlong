'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ShortlistSummary } from '../../lib/api';
import { isNotSignedIn, useUser } from '../../lib/useUser';

export default function ShortlistsPage() {
  const { user, ready, userFetch } = useUser();
  const [lists, setLists] = useState<ShortlistSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await userFetch<ShortlistSummary[]>('/me/shortlists');
      setLists(Array.isArray(res) ? res : []);
    } catch (err) {
      if (isNotSignedIn(err)) {
        setLists(null);
      } else {
        setError(err instanceof Error ? err.message : 'Could not load shortlists.');
      }
    } finally {
      setLoading(false);
    }
  }, [userFetch]);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setLoading(false);
      setLists(null);
      return;
    }
    void load();
  }, [ready, user, load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const created = await userFetch<ShortlistSummary>('/me/shortlists', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setLists((prev) => [{ ...created, itemCount: created.itemCount ?? 0 }, ...(prev ?? [])]);
      setNewName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create shortlist.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass-600">
          Your shortlists
        </p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tightish text-racing-900">
          Shortlists
        </h1>
        <div className="rule-brass my-5 max-w-xs" />
        <p className="text-sm leading-relaxed text-ink-600">
          Curated sets of hips you’re tracking, with notes.
        </p>
      </header>

      {ready && !user ? (
        <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-6 py-12 text-center">
          <p className="font-serif text-lg text-ink-700">Sign in to build shortlists</p>
          <p className="mt-1.5 text-sm text-ink-500">
            Use the “Sign in” control at the top right — it’s passwordless.
          </p>
        </div>
      ) : (
        <>
          <form
            onSubmit={create}
            className="mb-6 flex items-center gap-2 rounded-2xl border border-ink/10 bg-paper-50 p-3 shadow-card"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New shortlist name…"
              className="min-w-0 flex-1 rounded-lg border border-ink/15 bg-paper-50 px-3 py-2 text-sm text-ink-900 shadow-sm placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="shrink-0 rounded-lg bg-racing-800 px-4 py-2 text-sm font-semibold text-paper-50 shadow-sm transition hover:bg-racing-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-paper-300/60" />
              ))}
            </div>
          ) : lists && lists.length > 0 ? (
            <ul className="space-y-3">
              {lists.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/shortlists/${l.id}`}
                    className="flex items-center justify-between rounded-2xl border border-ink/10 bg-paper-50 px-5 py-4 shadow-card transition hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-cardHover"
                  >
                    <span className="font-serif text-lg text-ink-900">{l.name}</span>
                    <span className="tnum rounded-full bg-ink/5 px-3 py-1 text-xs font-medium text-ink-600">
                      {l.itemCount} {l.itemCount === 1 ? 'hip' : 'hips'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-6 py-12 text-center">
              <p className="font-serif text-lg text-ink-700">No shortlists yet</p>
              <p className="mt-1.5 text-sm text-ink-500">
                Create one above, or hit “Save” on any hip in the catalog.
              </p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
