'use client';

import { useEffect, useState } from 'react';
import type { NotificationSettings as Settings } from '../lib/api';
import { isNotSignedIn, useUser } from '../lib/useUser';

const FIELD =
  'mt-1.5 w-full rounded-lg border border-ink/15 bg-paper-50 px-3 py-2.5 text-sm text-ink-900 shadow-sm transition placeholder:text-ink-500/60 focus:border-racing-600 focus:outline-none focus:ring-2 focus:ring-racing-600/15';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-ink-600';

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="text-sm font-medium text-ink-800">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
          checked ? 'bg-racing-700' : 'bg-ink/20'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-paper-50 shadow-sm transition ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

/**
 * Notification settings card. Loads from GET /me/notifications and saves via
 * PUT /me/notifications, both through userFetch (auth required). Renders the
 * signed-in email read-only; never blocks render on a failed fetch.
 */
export function NotificationSettings() {
  const { user, ready, userFetch } = useUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [notifySms, setNotifySms] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    userFetch<Settings>('/me/notifications')
      .then((s) => {
        if (cancelled || !s) return;
        setEmail(s.email ?? '');
        setPhone(s.phone ?? '');
        setNotifyEmail(Boolean(s.notifyEmail));
        setNotifySms(Boolean(s.notifySms));
      })
      .catch((err) => {
        if (cancelled) return;
        if (!isNotSignedIn(err)) {
          setError(err instanceof Error ? err.message : 'Could not load settings.');
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
    try {
      const next = await userFetch<Settings>('/me/notifications', {
        method: 'PUT',
        body: JSON.stringify({
          phone: phone.trim() || null,
          notifyEmail,
          notifySms,
        }),
      });
      if (next) {
        setEmail(next.email ?? email);
        setPhone(next.phone ?? '');
        setNotifyEmail(Boolean(next.notifyEmail));
        setNotifySms(Boolean(next.notifySms));
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  if (!ready || !user) return null;

  return (
    <section className="mt-8">
      <h2 className="font-serif text-2xl font-semibold tracking-tightish text-racing-900">
        Notifications
      </h2>
      <div className="rule-brass my-4 max-w-xs" />

      {loading ? (
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
          <div>
            <label className={LABEL}>Email</label>
            <input
              value={email}
              readOnly
              disabled
              className={`${FIELD} cursor-not-allowed bg-paper-200/60 text-ink-600`}
            />
          </div>

          <div>
            <label className={LABEL}>Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setSaved(false);
              }}
              placeholder="+15555550123"
              className={FIELD}
            />
            <p className="mt-1.5 text-xs text-ink-500">E.164 format, e.g. +15555550123.</p>
          </div>

          <div className="space-y-1 border-t border-ink/10 pt-4">
            <Toggle
              label="Email me alerts"
              checked={notifyEmail}
              onChange={(v) => {
                setNotifyEmail(v);
                setSaved(false);
              }}
            />
            <Toggle
              label="Text me alerts"
              checked={notifySms}
              onChange={(v) => {
                setNotifySms(v);
                setSaved(false);
              }}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-3 border-t border-ink/10 pt-5">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-racing-800 px-5 py-2.5 text-sm font-semibold tracking-wide text-paper-50 shadow-sm transition hover:bg-racing-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save notifications'}
            </button>
            {saved && <span className="text-sm font-medium text-racing-700">Saved ✓</span>}
          </div>

          <p className="text-xs italic leading-relaxed text-ink-500">
            SMS/email send when the server has provider credentials configured.
          </p>
        </form>
      )}
    </section>
  );
}
