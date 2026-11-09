import { NavLink, Route, Routes, Navigate, Link, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './store';
import { AuthScreen } from './components/Auth';
import { Dashboard } from './pages/Dashboard';
import { BudgetPage } from './pages/Budget';
import { Transactions } from './pages/Transactions';
import { SavingsPage } from './pages/Savings';
import { Projections } from './pages/Projections';
import { CouplePage } from './pages/Couple';
import { Analyses } from './pages/Analyses';
import { SettingsPage } from './pages/Settings';
import { computeAlerts } from '../shared/alerts';
import { dateLabel } from '../shared/dates';

const NAV = [
  { to: '/', icon: '◉', label: 'Accueil' },
  { to: '/transactions', icon: '⇄', label: 'Transactions' },
  { to: '/budget', icon: '◫', label: 'Budget' },
  { to: '/epargne', icon: '◎', label: 'Épargne' },
  { to: '/projections', icon: '↗', label: 'Projections' },
  { to: '/couple', icon: '♡', label: 'Couple' },
  { to: '/analyses', icon: '▤', label: 'Analyses' },
  { to: '/parametres', icon: '⚙', label: 'Paramètres' },
];
const MOBILE_MAIN = ['/', '/transactions', '/budget', '/couple'];
const LEVEL_ICON = { good: '✅', info: '💡', warn: '⚠️', danger: '🚨' } as const;

function useDismissed() {
  const [ids, setIds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('mny-dismissed') ?? '[]'); } catch { return []; } });
  const dismiss = (id: string) => {
    const next = [...ids, id].slice(-300);
    setIds(next);
    try { localStorage.setItem('mny-dismissed', JSON.stringify(next)); } catch { /* stockage indisponible */ }
  };
  return { ids, dismiss };
}

function AlertsBell() {
  const { state, today, scope } = useStore();
  const [open, setOpen] = useState(false);
  const { ids, dismiss } = useDismissed();
  const alerts = useMemo(() => computeAlerts(state, today, scope).filter((a) => !ids.includes(a.id)), [state, today, scope, ids]);
  const notified = useRef(new Set<string>());
  // Notification système pour les nouvelles alertes importantes (si l'utilisateur l'a autorisé)
  useEffect(() => {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      for (const a of alerts.filter((x) => x.level === 'danger')) {
        const key = `mny-notified-${a.id}`;
        if (notified.current.has(a.id) || localStorage.getItem(key)) continue;
        notified.current.add(a.id);
        localStorage.setItem(key, '1');
        new Notification(`Ange's MNY — ${a.title}`, { body: a.detail });
      }
    } catch { /* notifications indisponibles */ }
  }, [alerts]);
  const urgent = alerts.filter((a) => a.level === 'danger' || a.level === 'warn').length;
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" aria-label={`Alertes (${alerts.length})`} onClick={() => setOpen(!open)}>
        🔔{urgent > 0 && <span className="dot-count">{urgent}</span>}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Alertes">
          <div className="row between" style={{ marginBottom: 8 }}><strong>Alertes</strong><Link to="/parametres?tab=notifications" className="small" onClick={() => setOpen(false)}>Réglages</Link></div>
          <div className="stack-s">
            {alerts.map((a) => (
              <div key={a.id} className={`insight ${a.level}`}>
                <span className="insight-icon">{LEVEL_ICON[a.level]}</span>
                <div className="grow"><strong className="small">{a.title}</strong><p className="small muted">{a.detail}</p><p className="small muted">{dateLabel(a.date)}</p></div>
                <button className="btn-icon" title="Masquer" onClick={() => dismiss(a.id)}>✕</button>
              </div>
            ))}
            {!alerts.length && <p className="muted small">Aucune alerte. Tout est sous contrôle. 🌿</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { state, call, refreshAuth, theme, setTheme } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button className="user-chip" onClick={() => setOpen(!open)} aria-label="Menu utilisateur">
        <span className="avatar">{state.viewer.name.slice(0, 1).toUpperCase()}</span><span className="hide-mobile">{state.viewer.name}</span>
      </button>
      {open && (
        <div className="popover stack-s" style={{ width: 260 }}>
          <div className="small muted">Connecté·e en tant que <strong>{state.viewer.username}</strong></div>
          <div className="field-label">Thème</div>
          <div className="segmented">
            {(['light', 'dark', 'system'] as const).map((t) => <button key={t} className={theme === t ? 'active' : ''} onClick={() => setTheme(t)}>{t === 'light' ? '☀︎ Clair' : t === 'dark' ? '☾ Sombre' : 'Auto'}</button>)}
          </div>
          <Link className="btn" to="/parametres?tab=profil" onClick={() => setOpen(false)}>Profil & sécurité</Link>
          <button className="btn" onClick={async () => { await call('/auth/mode', { body: { demo: !state.demo } }); window.location.reload(); }}>
            {state.demo ? '↩︎ Quitter le mode démo' : '🧪 Explorer le mode démo'}
          </button>
          <button className="btn btn-danger" onClick={async () => { await call('/auth/logout', { body: {} }); await refreshAuth(); }}>Se déconnecter</button>
        </div>
      )}
    </div>
  );
}

export function App() {
  const { state, auth, error, loading, toasts, call } = useStore();
  const [more, setMore] = useState(false);
  const location = useLocation();
  useEffect(() => { setMore(false); window.scrollTo(0, 0); }, [location.pathname]);

  if (loading) return <div className="auth-wrap"><div className="stack" style={{ alignItems: 'center' }}><div className="brand-mark">M</div><p className="muted">Chargement…</p></div></div>;
  if (error && !state) {
    return (
      <div className="auth-wrap"><div className="banner danger">
        <span>⚠️</span>
        <div><strong>Impossible de joindre le serveur d'Ange's MNY.</strong><p className="muted small">{error} — lance <span className="kbd">npm run dev</span> à la racine du projet.</p></div>
      </div></div>
    );
  }
  if (!auth?.authenticated || !state) return <AuthScreen />;
  const lastRun = state.syncRuns.find((r) => r.status !== 'running');

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo"><div className="brand-mark">M</div>ANGE'S MNY</div>
          <div className="brand-tag">Your money. Your control. Your future.</div>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">{n.icon}</span>{n.label}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          {lastRun?.status === 'error' && <div className="neg" style={{ marginBottom: 6 }}>⚠️ Dernière synchronisation en échec</div>}
          🔒 Lecture seule · aucune opération bancaire possible
        </div>
      </aside>
      <div className="app-col">
        {state.demo && (
          <div className="demo-banner">
            🧪 MODE DÉMO — données fictives, séparées de tes données réelles
            <button className="btn btn-sm" onClick={async () => { await call('/auth/mode', { body: { demo: false } }); window.location.reload(); }}>Revenir à mes données</button>
          </div>
        )}
        <header className="topbar">
          <div className="brand-mobile"><div className="brand-mark" style={{ width: 28, height: 28, borderRadius: 8 }}>M</div>ANGE'S MNY</div>
          <AlertsBell />
          <UserMenu />
        </header>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/budget" element={<BudgetPage />} />
            <Route path="/epargne" element={<SavingsPage />} />
            <Route path="/projections" element={<Projections />} />
            <Route path="/couple" element={<CouplePage />} />
            <Route path="/analyses" element={<Analyses />} />
            <Route path="/parametres" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Navigation principale">
        {NAV.filter((n) => MOBILE_MAIN.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span>{n.icon}</span>{n.label}
          </NavLink>
        ))}
        <button onClick={() => setMore(!more)} className={more ? 'active' : ''}><span>☰</span>Plus</button>
      </nav>
      {more && (
        <>
          <div className="sheet-backdrop" onClick={() => setMore(false)} />
          <div className="sheet">
            <div className="sheet-grid">
              {NAV.filter((n) => !MOBILE_MAIN.includes(n.to)).map((n) => <Link key={n.to} to={n.to}><span>{n.icon}</span>{n.label}</Link>)}
            </div>
          </div>
        </>
      )}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </div>
  );
}
