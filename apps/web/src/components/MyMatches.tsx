'use client';

import { useState } from 'react';
import type { SearchHip, Sale, SuggestionsResponse } from '../lib/api';
import { isNotSignedIn, useUser } from '../lib/useUser';
import { HipRow } from './HipRow';

/**
 * "Show my matches" — calls /me/suggestions for the selected sale and renders
 * the profile-ranked hips with the same result card. Only meaningful when
 * signed in; otherwise it prompts the buyer to sign in / set a profile.
 */
export function MyMatches({ saleId, sales }: { saleId: string; sales: Sale[] }) {
  const { user, ready, userFetch } = useUser();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hips, setHips] = useState<SearchHip[] | null>(null);
  const [hasProfile, setHasProfile] = useState(true);
  const [currency, setCurrency] = useState('USD');

  const sale = sales.find((s) => s.id === saleId);

  async function run() {
    if (!saleId) return;
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await userFetch<SuggestionsResponse>(
        `/me/suggestions?saleId=${encodeURIComponent(saleId)}&limit=50`,
      );
      setHips(res.hips ?? []);
      setHasProfile(res.hasProfile);
      setCurrency(res.currency ?? 'USD');
    } catch (err) {
      if (isNotSignedIn(err)) {
        setError('Sign in to see matches tailored to your profile.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not load matches.');
      }
      setHips(null);
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return null;

  return (
    <section className="rounded-2xl border border-brass-400/40 bg-brass-50/40 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif text-lg text-ink-900">My Matches</h2>
          <p className="mt-0.5 text-sm text-ink-600">
            {user
              ? 'Hips ranked for your saved budget and preferred sires.'
              : 'Sign in and set a profile to get a ranked shortlist tailored to you.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!user || !saleId || loading}
          className="shrink-0 whitespace-nowrap rounded-lg border border-brass-400/60 bg-brass-50 px-4 py-2.5 text-sm font-semibold text-brass-700 shadow-sm transition hover:bg-brass-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Finding matches…' : 'Show My Matches'}
        </button>
      </div>

      {open && (
        <div className="mt-4 border-t border-brass-400/20 pt-4">
          {error ? (
            <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {error}
            </div>
          ) : loading ? (
            <div className="space-y-3" aria-busy="true">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-2xl border border-ink/10 bg-paper-50"
                />
              ))}
            </div>
          ) : hips !== null ? (
            <div className="space-y-4">
              {!hasProfile && (
                <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  You haven’t set a buyer profile yet, so these aren’t filtered by your
                  budget or sires.{' '}
                  <a href="/profile" className="font-semibold underline">
                    Set preferences
                  </a>
                  .
                </div>
              )}
              <p className="text-sm text-ink-600">
                <span className="tnum font-semibold text-ink-900">{hips.length}</span>{' '}
                {hips.length === 1 ? 'match' : 'matches'}
                {sale ? (
                  <>
                    {' '}
                    in <span className="font-medium">{sale.name}</span> ({sale.year})
                  </>
                ) : null}
                {hasProfile ? ' · filtered by your profile' : ''}
              </p>
              {hips.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-4 py-12 text-center">
                  <p className="font-serif text-lg text-ink-700">No matches in this sale</p>
                  <p className="mt-1.5 text-sm text-ink-500">
                    Try widening your budget on your{' '}
                    <a href="/profile" className="underline">
                      profile
                    </a>
                    .
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {hips.map((hip) => (
                    <HipRow
                      key={hip.id}
                      hip={hip}
                      saleId={saleId}
                      currency={currency}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
