import { useState } from 'react';
import { useStore } from '../store';
import { Badge, Card, eur, Field, MoneyInput } from '../components/ui';
import { CategoryModal } from './PlanMonth';
import type { Category, Settings } from '../../shared/types';

const KIND_LABEL: Record<Category['kind'], string> = { variable: 'Dépenses variables', fixed: 'Charges fixes', income: 'Revenus', savings: 'Épargne', transfer: 'Transferts internes' };

export function SettingsPage() {
  const { state, call, toast } = useStore();
  const [s, setS] = useState<Settings>(state.settings);
  const [cat, setCat] = useState<Partial<Category> | null>(null);
  const set = (p: Partial<Settings>) => setS((x) => ({ ...x, ...p }));

  return (
    <div className="stack">
      <div className="page-head"><div><h1>Paramètres</h1><p className="muted">Profil, paie, catégories, règles de catégorisation et données.</p></div></div>
      <div className="grid g2">
        <Card title="Profil & revenus">
          <div className="form-grid">
            <Field label="Ton prénom"><input value={s.userName} onChange={(e) => set({ userName: e.target.value })} /></Field>
            <Field label="Prénom de ta/ton partenaire"><input value={s.partnerName} onChange={(e) => set({ partnerName: e.target.value })} /></Field>
            <Field label="Jour de paie habituel" hint="Sert au calcul du budget journalier"><input type="number" min={1} max={31} value={s.payday} onChange={(e) => set({ payday: Number(e.target.value) })} /></Field>
            <Field label="Revenu mensuel net attendu"><MoneyInput value={s.expectedIncome} onChange={(expectedIncome) => set({ expectedIncome })} /></Field>
            <Field label={`Seuil d'alerte budget : ${Math.round(s.alertThreshold * 100)} %`}><input type="range" min={0.5} max={1} step={0.05} value={s.alertThreshold} onChange={(e) => set({ alertThreshold: Number(e.target.value) })} /></Field>
            <Field label="Devise"><select value={s.currency} onChange={(e) => set({ currency: e.target.value })}><option>EUR</option><option>GBP</option><option>USD</option><option>CHF</option></select></Field>
          </div>
          <div className="form-actions"><button className="btn btn-primary" onClick={async () => { await call('/settings', { method: 'PUT', body: s }); toast('Paramètres enregistrés.'); }}>Enregistrer</button></div>
        </Card>
        <Card title="Données & sécurité">
          <div className="stack-s small">
            <p>🔒 Les données sont stockées localement dans une base SQLite (<span className="kbd">data/anges-mny.db</span>). L'API n'écoute que sur <span className="kbd">127.0.0.1</span>.</p>
            <p>🔑 Les jetons de session bancaire sont chiffrés (AES-256-GCM). Aucun identifiant bancaire n'est jamais demandé.</p>
            <p>👁️ L'application est en <strong>lecture seule</strong> : aucun virement ni paiement ne peut être initié.</p>
          </div>
          <div className="divider" />
          <div className="row gap-s wrap">
            <a className="btn" href="/api/export" download>💾 Sauvegarde complète (JSON)</a>
            <a className="btn" href="/api/export/transactions.csv" download>📄 Exporter les opérations (CSV)</a>
          </div>
          <div className="divider" />
          <div className="row gap-s wrap">
            <button className="btn" onClick={async () => { if (confirm('Charger les données de démonstration ? Cela REMPLACE toutes les données actuelles.')) { await call('/demo', { method: 'POST' }); toast('Données de démo chargées.'); } }}>🧪 Charger la démo</button>
            <button className="btn btn-danger" onClick={async () => {
              const v = prompt('Pour tout effacer (comptes, opérations, budgets, objectifs), tape SUPPRIMER');
              if (v === 'SUPPRIMER') { await call('/reset', { body: { confirm: v } }); toast('Toutes les données ont été effacées.'); }
            }}>🗑️ Tout effacer</button>
          </div>
        </Card>
      </div>

      <Card title="Catégories" subtitle="Entièrement personnalisables : nom, icône, couleur, budget par défaut et mots-clés de catégorisation automatique"
        actions={<button className="btn btn-primary" onClick={() => setCat({ kind: 'variable', color: '#7c5cff', icon: '📦', monthlyBudget: 0, keywords: [] })}>+ Catégorie</button>}>
        <div className="grid g2">
          {(Object.keys(KIND_LABEL) as Category['kind'][]).map((k) => (
            <div key={k}>
              <h4 className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', margin: '6px 0' }}>{KIND_LABEL[k]}</h4>
              {state.categories.filter((c) => c.kind === k).map((c) => (
                <div key={c.id} className="list-item" style={{ opacity: c.archived ? 0.5 : 1 }}>
                  <div className="cat-dot" style={{ background: `${c.color}22` }}>{c.icon}</div>
                  <div className="grow"><div>{c.name} {c.archived && <Badge>archivée</Badge>}</div><div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.keywords.join(', ') || 'aucun mot-clé'}</div></div>
                  {c.kind === 'variable' && <span className="small">{eur(c.monthlyBudget, false)}/mois</span>}
                  <button className="btn-icon" onClick={() => setCat(c)}>✏️</button>
                  <button className="btn-icon" title={c.archived ? 'Réactiver' : 'Archiver'} onClick={() => call('/categories', { body: { ...c, archived: !c.archived } })}>{c.archived ? '♻️' : '🗃️'}</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Règles apprises" subtitle="Créées quand tu recatégorises une opération ; prioritaires sur les mots-clés">
        {state.rules.length ? state.rules.map((r) => {
          const c = state.categories.find((x) => x.id === r.categoryId);
          return (
            <div key={r.id} className="list-item">
              <span className="kbd">{r.pattern}</span><span className="muted">→</span><span className="grow">{c?.icon} {c?.name}</span>
              <button className="btn-icon" onClick={() => call(`/rules/${r.id}`, { method: 'DELETE' })}>✕</button>
            </div>
          );
        }) : <p className="muted small">Aucune règle pour l'instant.</p>}
      </Card>
      <CategoryModal value={cat} onClose={() => setCat(null)} onSave={async (c) => { await call('/categories', { body: c }); setCat(null); toast('Catégorie enregistrée.'); }} />
    </div>
  );
}
