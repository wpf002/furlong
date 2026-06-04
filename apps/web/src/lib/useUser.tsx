'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser } from './api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const STORAGE_KEY = 'furlong_user';

interface UserContextValue {
  user: AuthUser | null;
  ready: boolean; // false until localStorage has been read (avoids hydration flicker)
  login: (email: string) => Promise<AuthUser>;
  logout: () => void;
  /**
   * Fetch a /me/* (or any) endpoint with the x-user-id header injected.
   * Throws if no user is signed in, so callers can prompt sign-in.
   */
  userFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
}

const UserContext = createContext<UserContextValue | null>(null);

function readStored(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (parsed && typeof parsed.id === 'string' && typeof parsed.email === 'string') {
      return parsed;
    }
  } catch {
    /* corrupt value — ignore */
  }
  return null;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(readStored());
    setReady(true);
  }, []);

  const login = useCallback(async (email: string): Promise<AuthUser> => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });
    if (!res.ok) {
      throw new Error(`Sign-in failed (${res.status}). Check the email and try again.`);
    }
    const next = (await res.json()) as AuthUser;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — keep in-memory only */
    }
    setUser(next);
    return next;
  }, []);

  const logout = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  const userFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const current = user ?? readStored();
      if (!current) {
        throw new Error('NOT_SIGNED_IN');
      }
      let res: Response;
      try {
        res = await fetch(`${API_BASE}${path}`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': current.id,
            ...(init?.headers ?? {}),
          },
          cache: 'no-store',
        });
      } catch (err) {
        throw new Error(
          `Could not reach the Furlong API at ${API_BASE}. Is it running? (${
            err instanceof Error ? err.message : String(err)
          })`,
        );
      }
      if (res.status === 401) {
        // Stored id was rejected — clear it so the UI prompts sign-in again.
        logout();
        throw new Error('NOT_SIGNED_IN');
      }
      if (!res.ok) {
        let detail = '';
        try {
          detail = await res.text();
        } catch {
          /* ignore */
        }
        throw new Error(
          `API ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${res.statusText}${
            detail ? ` — ${detail.slice(0, 300)}` : ''
          }`,
        );
      }
      // Some endpoints (e.g. DELETE) may return an empty body.
      const text = await res.text();
      return (text ? JSON.parse(text) : null) as T;
    },
    [user, logout],
  );

  const value = useMemo<UserContextValue>(
    () => ({ user, ready, login, logout, userFetch }),
    [user, ready, login, logout, userFetch],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error('useUser must be used within a <UserProvider>.');
  }
  return ctx;
}

/** Convenience guard for "is this error just the no-session sentinel?" */
export function isNotSignedIn(err: unknown): boolean {
  return err instanceof Error && err.message === 'NOT_SIGNED_IN';
}
