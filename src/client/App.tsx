import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { Dashboard } from './pages/Dashboard';
import { PlanMonth } from './pages/PlanMonth';
import { Transactions } from './pages/Transactions';
import { Tracking } from './pages/Tracking';
import { ResteAVivrePage } from './pages/ResteAVivre';
import { Advisor } from './pages/Advisor';
import { Projections } from './pages/Projections';
import { Accounts } from './pages/Accounts';
import { SettingsPage } from './pages/Settings';

const NAV = [
  { to: '/', icon: '🏠', label: 'Tableau de bord', short: 'Accueil' },
  { to: '/reste-a-vivre', icon: '💶', label: 'Reste à vivre', short: 'Reste' },
  { to: '/mois', icon: '🗓️', label: 'Préparer mon mois', short: 'Mois' },
  { to: '/operations', icon: '🧾', label: 'Opérations', short: 'Opérations' },
  { to: '/suivi', icon: '📊', label: 'Suivi & bilans', short: 'Suivi' },
  { to: '/conseiller', icon: '🧠', label: 'Conseiller', short: 'Conseils' },
  { to: '/projections', icon: '🔭', label: 'Projections', short: 'Futur' },
  { to: '/comptes', icon: '🏦', label: 'Comptes & synchro', short: 'Comptes' },
  { to: '/parametres', icon: '⚙️', label: 'Paramètres', short: 'Réglages' },
];

function SyncWatcher() {
  const { state, toast } = useStore();
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const last = state?.syncRuns.find((r) => r.status !== 'running');
    if (!last) return;
    if (seen.current && seen.current !== last.id && last.status === 'error') {
      toast(`Échec de synchronisation : ${last.message}`, 'error');
      try {
        if ('Notification' in window && Notification.permission === 'granted') new Notification("Ange's MNY — synchronisation échouée", { body: last.message });
      } catch { /* notifications indisponibles */ }
    }
    seen.current = last.id;
  }, [state?.syncRuns, toast]);
  return null;
}

export function App() {
  const { state, error, loading, toasts } = useStore();

  if (loading) return <div className="empty" style={{ marginTop: '20vh' }}><div className="brand-mark">M</div><p className="muted">Chargement…</p></div>;
  if (error || !state) {
    return (
      <div className="main"><div className="banner danger">
        <span>⚠️</span>
        <div><strong>Impossible de joindre l'API locale.</strong><p className="muted small">{error} — lance <span className="kbd">npm run dev</span> à la racine du projet.</p></div>
      </div></div>
    );
  }
  const lastError = state.syncRuns.find((r) => r.status !== 'running');

  return (
    <div className="layout">
      <SyncWatcher />
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo"><div className="brand-mark">M</div>ANGE'S MNY</div>
          <div className="brand-tag">Your money. Your control. Your future.</div>
        </div>
        {NAV.map((n, i) => (
          <div key={n.to}>
            {i === 3 && <div className="nav-section">Analyse</div>}
            {i === 7 && <div className="nav-section">Configuration</div>}
            <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">{n.icon}</span>{n.label}
            </NavLink>
          </div>
        ))}
        <div className="sidebar-foot">
          {lastError?.status === 'error' && <div className="neg" style={{ marginBottom: 6 }}>⚠️ Dernière synchro en échec</div>}
          🔒 Lecture seule · données stockées localement
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/reste-a-vivre" element={<ResteAVivrePage />} />
          <Route path="/mois" element={<PlanMonth />} />
          <Route path="/operations" element={<Transactions />} />
          <Route path="/suivi" element={<Tracking />} />
          <Route path="/conseiller" element={<Advisor />} />
          <Route path="/projections" element={<Projections />} />
          <Route path="/comptes" element={<Accounts />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="mobile-nav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span>{n.icon}</span>{n.short}
          </NavLink>
        ))}
      </nav>
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </div>
  );
}
