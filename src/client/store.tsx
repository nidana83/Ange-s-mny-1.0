import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppState } from '../shared/types';
import type { Scope } from '../shared/analytics';
import { todayISO } from '../shared/dates';
import { api, setUnauthorizedHandler } from './api';

export type Theme = 'system' | 'light' | 'dark';
export interface AuthStatus { needsSetup: boolean; authenticated: boolean; user: { name: string; person: string } | null }

interface Store {
  state: AppState | null;
  auth: AuthStatus | null;
  error: string | null;
  loading: boolean;
  today: string;
  scope: Scope;
  setScope: (s: Scope) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Appelle l'API ; si la réponse contient un état complet, il remplace l'état courant. */
  call: <T = AppState>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;
  reload: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'error') => void;
  toasts: { id: number; msg: string; kind: 'ok' | 'error' }[];
}

const Ctx = createContext<Store | null>(null);

const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScopeState] = useState<Scope>(() => (read('mny-scope', 'me') as Scope));
  const [theme, setThemeState] = useState<Theme>(() => (read('mny-theme', 'system') as Theme));
  const [toasts, setToasts] = useState<Store['toasts']>([]);
  const today = todayISO();

  useEffect(() => { applyTheme(theme); }, [theme]);

  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const reload = useCallback(async () => {
    try {
      setState(await api('/state'));
      setError(null);
    } catch (e) {
      if ((e as { status?: number }).status !== 401) setError((e as Error).message);
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const a = await api<AuthStatus>('/auth/status');
      setAuth(a);
      if (a.authenticated) await reload();
      else setState(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [reload]);

  useEffect(() => {
    setUnauthorizedHandler(() => { setState(null); setAuth((a) => (a ? { ...a, authenticated: false } : a)); });
    void refreshAuth();
  }, [refreshAuth]);

  const call = useCallback(async <T,>(path: string, opts?: { method?: string; body?: unknown }) => {
    try {
      const r = await api<T>(path, opts);
      if (r && typeof r === 'object' && 'accounts' in r && 'transactions' in r) setState(r as unknown as AppState);
      return r;
    } catch (e) {
      toast((e as Error).message, 'error');
      throw e;
    }
  }, [toast]);

  const setScope = (s: Scope) => { setScopeState(s); write('mny-scope', s); };
  const setTheme = (t: Theme) => { setThemeState(t); write('mny-theme', t); };

  const value = useMemo(() => ({ state, auth, error, loading, today, scope, setScope, theme, setTheme, call, reload, refreshAuth, toast, toasts }),
    [state, auth, error, loading, today, scope, theme, call, reload, refreshAuth, toast, toasts]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store & { state: AppState } {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider manquant');
  return s as Store & { state: AppState };
}
