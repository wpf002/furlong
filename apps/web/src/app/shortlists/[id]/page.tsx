'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ShortlistDetail, ShortlistItem } from '../../../lib/api';
import { sexColorLabel } from '../../../lib/format';
import { isNotSignedIn, useUser } from '../../../lib/useUser';
import { ValuationBands } from '../../../components/ValuationBands';

export default function ShortlistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, ready, userFetch } = useUser();
  const [data, setData] = useState<ShortlistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notSignedIn, setNotSignedIn] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await userFetch<ShortlistDetail>(
        `/me/shortlists/${encodeURIComponent(id)}`,
      );
      setData(res);
    } catch (err) {
      if (isNotSignedIn(err)) {
        setNotSignedIn(true);
      } else {
        setError(err instanceof Error ? err.message : 'Could not load shortlist.');
      }
    } finally {
      setLoading(false);
    }
  }, [id, userFetch]);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setLoading(false);
      setNotSignedIn(true);
      return;
    }
    void load();
  }, [ready, user, load]);

  async function saveNote(hipId: string, note: string) {
    try {
      await userFetch(
        `/me/shortlists/${encodeURIComponent(id)}/items/${encodeURIComponent(hipId)}`,
        { method: 'PATCH', body: JSON.stringify({ note }) },
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((it) =>
                it.hipId === hipId ? { ...it, note: note || null } : it,
              ),
            }
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note.');
    }
  }

  async function remove(hipId: string) {
    const prev = data;
    setData((d) =>
      d ? { ...d, items: d.items.filter((it) => it.hipId !== hipId) } : d,
    );
    try {
      await userFetch(
        `/me/shortlists/${encodeURIComponent(id)}/items/${encodeURIComponent(hipId)}`,
        { method: 'DELETE' },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove hip.');
      setData(prev); // roll back
    }
  }

  const backLink = (
    <Link
      href="/shortlists"
      className="text-sm font-medium text-ink-500 transition hover:text-racing-700"
    >
      ← All shortlists
    </Link>
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      {backLink}

      {ready && notSignedIn ? (
        <div className="mt-6 rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-6 py-12 text-center">
          <p className="font-serif text-lg text-ink-700">Sign in to view this shortlist</p>
        </div>
      ) : loading ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-paper-300/60" />
          ))}
        </div>
      ) : error && !data ? (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : data ? (
        <>
          <header className="mt-5">
            <h1 className="font-serif text-3xl font-semibold tracking-tightish text-racing-900 sm:text-4xl">
              {data.name}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              <span className="tnum">{data.items.length}</span>{' '}
              {data.items.length === 1 ? 'HIP' : "HIP's"}
            </p>
          </header>

          <div className="rule-brass my-6" />

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {data.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-50 px-6 py-12 text-center">
              <p className="font-serif text-lg text-ink-700">This shortlist is empty</p>
              <p className="mt-1.5 text-sm text-ink-500">
                Hit “Save” on any HIP in the catalog to add it here.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {data.items.map((item) => (
                <ShortlistRow
                  key={item.hipId}
                  item={item}
                  onSaveNote={saveNote}
                  onRemove={remove}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </main>
  );
}

function ShortlistRow({
  item,
  onSaveNote,
  onRemove,
}: {
  item: ShortlistItem;
  onSaveNote: (hipId: string, note: string) => Promise<void>;
  onRemove: (hipId: string) => Promise<void>;
}) {
  const { hip } = item;
  const [note, setNote] = useState(item.note ?? '');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  // The saved hip may no longer be in the catalog (e.g. a catalog refresh
  // replaced it). Render a graceful, removable placeholder instead of crashing.
  if (!hip) {
    return (
      <li className="flex items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-paper-50 px-5 py-4 shadow-card">
        <p className="text-sm text-ink-500">This HIP is no longer in the catalog.</p>
        <button
          type="button"
          onClick={() => void onRemove(item.hipId)}
          className="shrink-0 text-xs font-medium text-red-600 transition hover:text-red-700"
        >
          Remove
        </button>
      </li>
    );
  }

  const sire = hip.sireName ?? 'Unknown sire';
  const dam = hip.damName ?? 'Unknown dam';
  const meta = sexColorLabel(hip.sex, null);

  async function commit() {
    if (!dirty) return;
    setBusy(true);
    await onSaveNote(hip.id, note.trim());
    setDirty(false);
    setBusy(false);
  }

  return (
    <li className="rounded-2xl border border-ink/10 bg-paper-50 p-5 shadow-card">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-stretch">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-medium uppercase tracking-widest text-ink-500">
              HIP
            </span>
            <span className="tnum font-serif text-2xl font-semibold leading-none text-racing-800">
              {hip.hipNumber}
            </span>
          </div>
          <h3 className="mt-2 font-serif text-lg font-medium leading-snug text-ink-900">
            <Link
              href={hip.saleId ? `/hips/${hip.id}?sale=${hip.saleId}` : `/hips/${hip.id}`}
              className="transition hover:text-racing-700"
            >
              <span>{sire}</span>
              <span className="mx-1.5 text-brass-500">×</span>
              <span className="italic">{dam}</span>
            </Link>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
            {(hip.saleName || hip.saleYear) && (
              <span>
                {hip.saleName}
                {hip.saleYear ? ` (${hip.saleYear})` : ''}
              </span>
            )}
            {meta && <span className="capitalize">· {meta}</span>}
            {hip.consignorName && <span>· {hip.consignorName}</span>}
          </p>

          <div className="mt-3">
            <textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setDirty(true);
              }}
              onBlur={() => void commit()}
              rows={2}
              placeholder="Add a note…"
              className="w-full rounded-lg border border-ink/15 bg-paper-50 px-3 py-2 text-sm text-ink-900 shadow-sm placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15"
            />
            <div className="mt-1 flex items-center gap-3">
              {dirty ? (
                <button
                  type="button"
                  onClick={() => void commit()}
                  disabled={busy}
                  className="text-xs font-semibold text-racing-700 underline disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save note'}
                </button>
              ) : (
                item.note != null && note === item.note && (
                  <span className="text-xs text-ink-400">Note saved</span>
                )
              )}
              <button
                type="button"
                onClick={() => void onRemove(hip.id)}
                className="ml-auto text-xs font-medium text-red-600 transition hover:text-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        </div>

        <div className="w-full shrink-0 sm:w-72 sm:border-l sm:border-ink/10 sm:pl-5">
          <ValuationBands valuation={hip.valuation} showDisclaimer={false} compact />
        </div>
      </div>
    </li>
  );
}
