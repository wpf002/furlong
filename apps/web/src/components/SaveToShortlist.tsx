'use client';

import { useEffect, useRef, useState } from 'react';
import type { ShortlistSummary } from '../lib/api';
import { isNotSignedIn, useUser } from '../lib/useUser';
import { BookmarkIcon } from './icons';

/**
 * Save button + popover that lets a signed-in buyer add a hip to an existing
 * shortlist (or create a new one) with an optional note. Used on result cards
 * and the hip detail page. Gracefully prompts sign-in for anonymous users.
 */
export function SaveToShortlist({
  hipId,
  variant = 'pill',
}: {
  hipId: string;
  variant?: 'pill' | 'button';
}) {
  const { user, ready, userFetch } = useUser();
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<ShortlistSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
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

  async function loadLists() {
    setLoading(true);
    setError(null);
    try {
      const res = await userFetch<ShortlistSummary[]>('/me/shortlists');
      setLists(Array.isArray(res) ? res : []);
    } catch (err) {
      if (isNotSignedIn(err)) {
        setError('Sign in to save hips to a shortlist.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not load shortlists.');
      }
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && lists === null) void loadLists();
  }

  async function addTo(shortlistId: string, shortlistName: string) {
    setSaving(true);
    setError(null);
    try {
      await userFetch(`/me/shortlists/${encodeURIComponent(shortlistId)}/items`, {
        method: 'POST',
        body: JSON.stringify({ hipId, note: note.trim() || undefined }),
      });
      setSavedTo(shortlistName);
      setNote('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      const created = await userFetch<ShortlistSummary>('/me/shortlists', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setLists((prev) => (prev ? [created, ...prev] : [created]));
      setNewName('');
      await addTo(created.id, created.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create shortlist.');
      setSaving(false);
    }
  }

  const base =
    variant === 'button'
      ? 'inline-flex items-center gap-1.5 rounded-lg border border-brass-400/60 bg-brass-50 px-4 py-2 text-sm font-semibold text-brass-700 shadow-sm transition hover:bg-brass-100'
      : 'inline-flex items-center gap-1 rounded-full border border-ink/15 bg-paper-50 px-3 py-1 text-xs font-medium text-ink-700 shadow-sm transition hover:border-brass-400/60 hover:text-brass-700';

  // Don't render anything decisive until we know auth state.
  if (!ready) return null;

  return (
    // Stop clicks bubbling to a parent <Link> (this control is rendered inside
    // the result card's link).
    <div
      ref={wrapRef}
      className="relative inline-block"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          toggle();
        }}
        className={base}
      >
        <BookmarkIcon filled={!!savedTo} className="h-3.5 w-3.5" />
        {savedTo ? 'Saved' : 'Save'}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-ink/10 bg-paper-50 p-3 text-left shadow-card">
          {!user ? (
            <p className="px-1 py-2 text-sm text-ink-600">
              Sign in (top right) to save hips to a shortlist.
            </p>
          ) : (
            <>
              <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Save to shortlist
              </p>

              <label className="block">
                <span className="sr-only">Note</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note…"
                  className="mb-2 w-full rounded-lg border border-ink/15 bg-paper-50 px-2.5 py-1.5 text-xs text-ink-900 shadow-sm placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15"
                />
              </label>

              {loading ? (
                <p className="px-1 py-2 text-xs text-ink-500">Loading shortlists…</p>
              ) : (
                <div className="max-h-44 space-y-1 overflow-y-auto">
                  {lists && lists.length > 0 ? (
                    lists.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        disabled={saving}
                        onClick={() => void addTo(l.id, l.name)}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-ink-800 transition hover:bg-ink/5 disabled:opacity-50"
                      >
                        <span className="truncate">{l.name}</span>
                        <span className="tnum ml-2 shrink-0 text-xs text-ink-500">
                          {l.itemCount}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-1 py-1 text-xs text-ink-500">No shortlists yet.</p>
                  )}
                </div>
              )}

              <div className="mt-2 flex items-center gap-1.5 border-t border-ink/10 pt-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New shortlist…"
                  className="min-w-0 flex-1 rounded-lg border border-ink/15 bg-paper-50 px-2.5 py-1.5 text-xs text-ink-900 shadow-sm placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15"
                />
                <button
                  type="button"
                  disabled={saving || !newName.trim()}
                  onClick={() => void createAndAdd()}
                  className="shrink-0 rounded-lg bg-racing-800 px-3 py-1.5 text-xs font-semibold text-paper-50 shadow-sm transition hover:bg-racing-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </>
          )}

          {error && <p className="mt-2 px-1 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
