import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppState } from '../shared/types';
import type { Scope } from '../shared/analytics';
import { todayISO } from '../shared/dates';
import { api } from './api';

interface Store {
  state: AppState | null;
  error: string | null;
  loading: boolean;
  today: string;
  scope: Scope;
  setScope: (s: Scope) => void;
  /** Appelle l'API ; si la réponse contient un état complet, il remplace l'état courant. */
  call: <T = AppState>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;
  reload: () => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'error') => void;
  toasts: { id: number; msg: string; kind: 'ok' | 'error' }[];
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScopeState] = useState<Scope>(() => {
    try { return (localStorage.getItem('mny-scope') as Scope) || 'me'; } catch { return 'me'; }
  });
  const [toasts, setToasts] = useState<Store['toasts']>([]);
  const today = todayISO();

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
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

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

  const setScope = (s: Scope) => {
    setScopeState(s);
    try { localStorage.setItem('mny-scope', s); } catch { /* stockage indisponible */ }
  };

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo(() => ({ state, error, loading, today, scope, setScope, call, reload, toast, toasts }), [state, error, loading, today, scope, call, reload, toast, toasts]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store & { state: AppState } {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider manquant');
  return s as Store & { state: AppState };
}
