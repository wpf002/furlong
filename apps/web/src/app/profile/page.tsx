'use client';

import { useEffect, useState } from 'react';
import { formatCents } from '@furlong/shared';
import type { BuyerProfile } from '../../lib/api';
import { dollarsToCents, parseSires } from '../../lib/format';
import { isNotSignedIn, useUser } from '../../lib/useUser';

const FIELD =
  'mt-1.5 w-full rounded-lg border border-ink/15 bg-paper-50 px-3 py-2.5 text-sm text-ink-900 shadow-sm transition placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-ink-600';

function centsToDollarString(cents: number | null): string {
  if (cents == null) return '';
  return String(Math.round(cents / 100));
}

export default function ProfilePage() {
  const { user, ready, userFetch } = useUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [budgetLow, setBudgetLow] = useState('');
  const [budgetHigh, setBudgetHigh] = useState('');
  const [sires, setSires] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    userFetch<BuyerProfile | null>('/me/profile')
      .then((profile) => {
        if (cancelled) return;
        if (profile) {
          setBudgetLow(centsToDollarString(profile.budgetLowCents));
          setBudgetHigh(centsToDollarString(profile.budgetHighCents));
          setSires((profile.preferredSires ?? []).join(', '));
          setNotes(profile.notes ?? '');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (!isNotSignedIn(err)) {
          setError(err instanceof Error ? err.message : 'Could not load profile.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, user, userFetch]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const low = dollarsToCents(budgetLow);
    const high = dollarsToCents(budgetHigh);
    try {
      await userFetch<BuyerProfile>('/me/profile', {
        method: 'PUT',
        body: JSON.stringify({
          budgetLowCents: low ?? null,
          budgetHighCents: high ?? null,
          preferredSires: parseSires(sires),
          notes: notes.trim() || null,
        }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  }

  const lowCents = dollarsToCents(budgetLow);
  const highCents = dollarsToCents(budgetHigh);

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass-600">
          Buyer profile
        </p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tightish text-racing-900">
          Your preferences
        </h1>
        <div className="rule-brass my-5 max-w-xs" />
        <p className="text-sm leading-relaxed text-ink-600">
          We use your budget and preferred sires to rank catalog matches for you.
        </p>
      </header>

      {ready && !user ? (
        <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-6 py-12 text-center">
          <p className="font-serif text-lg text-ink-700">Sign in to set your preferences</p>
          <p className="mt-1.5 text-sm text-ink-500">
            Use the “Sign in” control at the top right — it’s passwordless.
          </p>
        </div>
      ) : loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-paper-300/60" />
          ))}
        </div>
      ) : (
        <form
          onSubmit={save}
          className="space-y-5 rounded-2xl border border-ink/10 bg-paper-50 p-6 shadow-card"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Budget low ($)</label>
              <input
                inputMode="decimal"
                value={budgetLow}
                onChange={(e) => {
                  setBudgetLow(e.target.value);
                  setSaved(false);
                }}
                placeholder="e.g. 50,000"
                className={FIELD}
              />
            </div>
            <div>
              <label className={LABEL}>Budget high ($)</label>
              <input
                inputMode="decimal"
                value={budgetHigh}
                onChange={(e) => {
                  setBudgetHigh(e.target.value);
                  setSaved(false);
                }}
                placeholder="e.g. 250,000"
                className={FIELD}
              />
            </div>
          </div>

          {(lowCents != null || highCents != null) && (
            <p className="tnum text-xs text-ink-500">
              Budget:{' '}
              {lowCents != null ? formatCents(lowCents) : '—'}
              {' – '}
              {highCents != null ? formatCents(highCents) : '—'}
            </p>
          )}

          <div>
            <label className={LABEL}>Preferred sires</label>
            <input
              value={sires}
              onChange={(e) => {
                setSires(e.target.value);
                setSaved(false);
              }}
              placeholder="Tapit, Into Mischief, Curlin"
              className={FIELD}
            />
            <p className="mt-1.5 text-xs text-ink-500">Comma-separated.</p>
          </div>

          <div>
            <label className={LABEL}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setSaved(false);
              }}
              rows={4}
              placeholder="Anything our matching should keep in mind…"
              className={FIELD}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-3 border-t border-ink/10 pt-5">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-racing-800 px-5 py-2.5 text-sm font-semibold tracking-wide text-paper-50 shadow-sm transition hover:bg-racing-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save preferences'}
            </button>
            {saved && (
              <span className="text-sm font-medium text-racing-700">Saved ✓</span>
            )}
          </div>
        </form>
      )}
    </main>
  );
}
