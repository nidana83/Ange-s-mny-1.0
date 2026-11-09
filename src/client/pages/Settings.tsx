import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { api } from '../api';
import { Badge, Card, eur, Field, MoneyInput, Switch, Tabs } from '../components/ui';
import { CategoryModal } from './PlanMonth';
import { Accounts } from './Accounts';
import { ALERT_LABELS, type AlertKind } from '../../shared/alerts';
import type { AlertSettings, Category, Settings } from '../../shared/types';

type Tab = 'profil' | 'comptes' | 'preferences' | 'categories' | 'notifications' | 'donnees';
const KIND_LABEL: Record<Category['kind'], string> = { variable: 'Dépenses variables', fixed: 'Charges fixes', income: 'Revenus', savings: 'Épargne', transfer: 'Transferts internes' };

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'profil';
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Paramètres</h1><p className="muted">Utilisateurs, comptes, budgets, catégories, notifications et données.</p></div></div>
      <Tabs<Tab> value={tab} onChange={(t) => setParams({ tab: t })} items={[
        { value: 'profil', label: 'Profil & sécurité' }, { value: 'comptes', label: 'Comptes & synchro' }, { value: 'preferences', label: 'Revenus & préférences' },
        { value: 'categories', label: 'Catégories & règles' }, { value: 'notifications', label: 'Notifications' }, { value: 'donnees', label: 'Données' },
      ]} />
      {tab === 'profil' && <Profile />}
      {tab === 'comptes' && <Accounts embedded />}
      {tab === 'preferences' && <Preferences />}
      {tab === 'categories' && <CategoriesRules />}
      {tab === 'notifications' && <Notifications />}
      {tab === 'donnees' && <DataTab />}
    </div>
  );
}

function Profile() {
  const { state, call, toast, refreshAuth } = useStore();
  const [name, setName] = useState(state.viewer.name);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [invite, setInvite] = useState<{ code: string } | null>(null);
  const [info, setInfo] = useState<{ partnerInvitationPending: boolean; lastLoginAt: string | null; createdAt: string } | null>(null);
  useEffect(() => { api<typeof info>('/auth/info').then(setInfo).catch(() => undefined); }, [invite]);
  const partner = state.partner.name;

  return (
    <div className="grid g2">
      <Card title="Mon profil">
        <div className="stack-s">
          <Field label="Prénom affiché"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <p className="small muted">Identifiant : <strong>{state.viewer.username}</strong>{info?.lastLoginAt && <> · dernière connexion le {new Date(info.lastLoginAt).toLocaleString('fr-FR')}</>}</p>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!name.trim() || name === state.viewer.name}
            onClick={async () => { await call('/auth/profile', { method: 'PUT', body: { displayName: name } }); await refreshAuth(); toast('Profil mis à jour.'); }}>Enregistrer</button>
        </div>
      </Card>

      <Card title={`Partage avec ${partner}`} subtitle="Ton consentement explicite, révocable à tout moment">
        <div className="stack-s">
          <label className="row between gap">
            <span>Partager mes comptes, opérations et objectifs personnels avec {partner} <span className="small muted">(en lecture seule)</span></span>
            <Switch checked={state.viewer.sharing} label="Partager mes données" onChange={async (v) => {
              if (v && !confirm(`${partner} pourra consulter (sans modifier) tes comptes personnels, opérations et objectifs. Confirmer ?`)) return;
              await call('/auth/sharing', { method: 'PUT', body: { share: v } });
              await refreshAuth();
              toast(v ? 'Partage activé.' : 'Partage retiré : tes données personnelles ne sont plus visibles.');
            }} />
          </label>
          <p className="small muted">Les comptes communs sont toujours visibles par vous deux. Tes comptes personnels ne le sont que si tu actives ce partage.</p>
          <div className="divider" />
          <div className="small">
            {state.partner.exists
              ? <>{partner} a un accès personnel. {state.partner.sharesWithMe ? <Badge tone="good">{partner} partage ses données avec toi</Badge> : <Badge>{partner} ne partage pas ses données</Badge>}</>
              : (
                <div className="stack-s">
                  <span>{partner} n'a pas encore d'accès. Génère un code d'invitation à usage unique (valable 7 jours) et transmets-le-lui de vive voix ou par message.</span>
                  {invite ? (
                    <div className="banner info"><span>🔑</span><div>Code pour {partner} : <strong className="kbd" style={{ fontSize: 16 }}>{invite.code}</strong><p className="small muted">Il ne sera plus affiché ensuite. {partner} choisit « J'ai reçu un code d'invitation » sur l'écran de connexion.</p></div></div>
                  ) : (
                    <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={state.demo} onClick={async () => setInvite(await call<{ code: string }>('/auth/invite', { body: {} }))}>
                      {info?.partnerInvitationPending ? 'Générer un nouveau code' : `Inviter ${partner}`}
                    </button>
                  )}
                </div>
              )}
          </div>
        </div>
      </Card>

      <Card title="Mot de passe">
        <div className="stack-s">
          <Field label="Mot de passe actuel"><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="Nouveau mot de passe" hint="10 caractères minimum, au moins une lettre et un chiffre."><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Confirmer"><input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!pw.current || !pw.next || pw.next !== pw.confirm}
            onClick={async () => { await call('/auth/password', { body: { current: pw.current, next: pw.next } }); setPw({ current: '', next: '', confirm: '' }); toast('Mot de passe modifié. Tes autres sessions ont été déconnectées.'); }}>Changer le mot de passe</button>
        </div>
      </Card>

      <Card title="Confidentialité (RGPD)">
        <div className="stack-s small">
          <p>Tes données sont stockées sur ton serveur, dans une base locale. Elles ne sont envoyées à aucun tiers, sauf l'agrégateur bancaire si tu actives la connexion Revolut.</p>
          <p>Tu peux à tout moment <strong>exporter</strong> tes données (onglet Données) et <strong>supprimer</strong> ton accès et tes données personnelles. Les comptes communs restent accessibles à {partner}.</p>
          <button className="btn btn-danger" style={{ alignSelf: 'flex-start' }} disabled={state.demo} onClick={async () => {
            const password = prompt('Suppression définitive de ton accès et de tes données personnelles. Saisis ton mot de passe pour confirmer :');
            if (!password) return;
            await call('/auth/delete-me', { body: { password } });
            await refreshAuth();
          }}>Supprimer mon accès et mes données</button>
        </div>
      </Card>
    </div>
  );
}

function Preferences() {
  const { state, call, toast, theme, setTheme } = useStore();
  const [s, setS] = useState<Settings>(state.settings);
  const [fx, setFx] = useState(Object.entries(state.settings.fxRates).map(([k, v]) => `${k}=${v}`).join(', '));
  const set = (p: Partial<Settings>) => setS((x) => ({ ...x, ...p }));
  const currencies = [...new Set(state.accounts.map((a) => a.currency).filter((c) => c !== s.currency))];
  return (
    <div className="grid g2">
      <Card title="Revenus, paie et épargne">
        <div className="form-grid">
          <Field label="Revenu mensuel net attendu" hint="Sert au reste à vivre et à la répartition au prorata"><MoneyInput value={s.expectedIncome} onChange={(expectedIncome) => set({ expectedIncome })} /></Field>
          <Field label="Jour de paie habituel"><input type="number" min={1} max={31} value={s.payday} onChange={(e) => set({ payday: Number(e.target.value) })} /></Field>
          <Field label="Épargne mensuelle programmée"><MoneyInput value={s.monthlySavings} onChange={(monthlySavings) => set({ monthlySavings })} /></Field>
          <Field label="Épargne supplémentaire ce mois"><MoneyInput value={s.extraSavings} onChange={(extraSavings) => set({ extraSavings })} /></Field>
          <Field label={`Seuil de vigilance budget : ${Math.round(s.alertThreshold * 100)} %`}><input type="range" min={0.5} max={1} step={0.05} value={s.alertThreshold} onChange={(e) => set({ alertThreshold: Number(e.target.value) })} /></Field>
        </div>
        <div className="form-actions"><button className="btn btn-primary" onClick={async () => { await call('/settings', { method: 'PUT', body: s }); toast('Préférences enregistrées.'); }}>Enregistrer</button></div>
      </Card>
      <Card title="Affichage et devises">
        <div className="stack-s">
          <Field label="Thème">
            <div className="segmented">{(['light', 'dark', 'system'] as const).map((t) => <button key={t} className={theme === t ? 'active' : ''} onClick={() => setTheme(t)}>{t === 'light' ? 'Clair' : t === 'dark' ? 'Sombre' : 'Automatique'}</button>)}</div>
          </Field>
          <Field label="Devise principale"><select value={s.currency} onChange={(e) => set({ currency: e.target.value })}>{['EUR', 'USD', 'GBP', 'CHF'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Taux de conversion vers la devise principale" hint={`Format : USD=0.92, GBP=1.17 — à mettre à jour toi-même (aucun service externe interrogé).${currencies.length ? ` Devises de tes comptes : ${currencies.join(', ')}.` : ''}`}>
            <input value={fx} onChange={(e) => setFx(e.target.value)} placeholder="USD=0.92, GBP=1.17" />
          </Field>
          {currencies.filter((c) => !s.fxRates[c]).length > 0 && <div className="banner warn small">Taux manquant pour {currencies.filter((c) => !s.fxRates[c]).join(', ')} : ces comptes sont comptés au taux 1.</div>}
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={async () => {
            const fxRates = Object.fromEntries(fx.split(',').map((x) => x.split('=').map((y) => y.trim())).filter(([k, v]) => /^[A-Z]{3}$/.test(k ?? '') && Number((v ?? '').replace(',', '.')) > 0).map(([k, v]) => [k, Number(v.replace(',', '.'))]));
            await call('/settings', { method: 'PUT', body: { currency: s.currency, fxRates } });
            toast('Devises enregistrées.');
          }}>Enregistrer</button>
        </div>
      </Card>
    </div>
  );
}

function CategoriesRules() {
  const { state, call, toast } = useStore();
  const [cat, setCat] = useState<Partial<Category> | null>(null);
  const [rule, setRule] = useState({ pattern: '', categoryId: '', markTransfer: false, applyToExisting: true });
  return (
    <div className="stack">
      <Card title="Règles de catégorisation" subtitle="Prioritaires sur les mots-clés. Créées automatiquement quand tu recatégorises une opération, ou manuellement ici.">
        <div className="grid ex-grid" style={{ gridTemplateColumns: '2fr 2fr auto auto' }}>
          <Field label="Si le libellé contient"><input value={rule.pattern} onChange={(e) => setRule({ ...rule, pattern: e.target.value })} placeholder="ex. mcdonald" /></Field>
          <Field label="Alors classer dans">
            <select value={rule.categoryId} onChange={(e) => setRule({ ...rule, categoryId: e.target.value })}>
              <option value="">Choisir…</option>{state.categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </Field>
          <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={rule.applyToExisting} onChange={(e) => setRule({ ...rule, applyToExisting: e.target.checked })} /> Appliquer à l'existant</label>
          <button className="btn btn-primary" style={{ alignSelf: 'end' }} disabled={rule.pattern.trim().length < 2 || !rule.categoryId} onClick={async () => {
            const r = await call<{ applied: number }>('/rules', { body: { ...rule, markTransfer: state.categories.find((c) => c.id === rule.categoryId)?.kind === 'transfer' } });
            toast(`Règle créée${rule.applyToExisting ? ` · ${r.applied} opération(s) reclassée(s)` : ''}.`);
            setRule({ pattern: '', categoryId: '', markTransfer: false, applyToExisting: true });
          }}>Ajouter</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {state.rules.length ? state.rules.map((r) => {
            const c = state.categories.find((x) => x.id === r.categoryId);
            return (
              <div key={r.id} className="list-item">
                <span className="kbd">{r.pattern}</span><span className="muted">→</span><span className="grow">{c?.icon} {c?.name}</span>
                <button className="btn-icon" aria-label="Supprimer la règle" onClick={() => call(`/rules/${r.id}`, { method: 'DELETE' })}>✕</button>
              </div>
            );
          }) : <p className="muted small">Aucune règle pour l'instant.</p>}
        </div>
      </Card>
      <Card title="Catégories" subtitle="Nom, icône, couleur, budget mensuel par défaut (personnel) et mots-clés de catégorisation automatique"
        actions={<button className="btn btn-primary" onClick={() => setCat({ kind: 'variable', color: '#c9a86a', icon: '📦', monthlyBudget: 0, keywords: [] })}>+ Catégorie</button>}>
        <div className="grid g2">
          {(Object.keys(KIND_LABEL) as Category['kind'][]).map((k) => (
            <div key={k}>
              <h4 className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', margin: '6px 0' }}>{KIND_LABEL[k]}</h4>
              {state.categories.filter((c) => c.kind === k).map((c) => (
                <div key={c.id} className="list-item" style={{ opacity: c.archived ? 0.5 : 1 }}>
                  <div className="cat-dot" style={{ background: `${c.color}22` }}>{c.icon}</div>
                  <div className="grow"><div>{c.name} {c.archived && <Badge>archivée</Badge>}</div><div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.keywords.join(', ') || 'aucun mot-clé'}</div></div>
                  {c.kind === 'variable' && <span className="small">{eur(c.monthlyBudget, false)}/mois</span>}
                  <button className="btn-icon" aria-label="Modifier" onClick={() => setCat(c)}>✏️</button>
                  <button className="btn-icon" title={c.archived ? 'Réactiver' : 'Archiver'} onClick={() => call('/categories', { body: { ...c, archived: !c.archived } })}>{c.archived ? '♻️' : '🗃️'}</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
      <CategoryModal value={cat} onClose={() => setCat(null)} onSave={async (c) => { await call('/categories', { body: c }); setCat(null); toast('Catégorie enregistrée.'); }} />
    </div>
  );
}

function Notifications() {
  const { state, call, toast } = useStore();
  const [a, setA] = useState<AlertSettings>(state.settings.alerts);
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  const set = (k: AlertKind, p: Partial<AlertSettings[AlertKind]>) => setA((x) => ({ ...x, [k]: { ...x[k], ...p } }));
  return (
    <div className="grid g2">
      <Card title="Alertes" subtitle="Active, désactive et règle le seuil de chaque alerte">
        {(Object.keys(ALERT_LABELS) as AlertKind[]).map((k) => {
          const l = ALERT_LABELS[k];
          return (
            <div key={k} className="list-item">
              <div className="grow"><div>{l.label}</div><div className="small muted">{l.help}</div></div>
              {l.unit === 'eur' && <div style={{ width: 120 }}><MoneyInput value={a[k].threshold} onChange={(threshold) => set(k, { threshold })} /></div>}
              {l.unit === 'factor' && <select style={{ width: 90 }} value={a[k].threshold} onChange={(e) => set(k, { threshold: Number(e.target.value) })}>{[2, 2.5, 3, 4, 5].map((f) => <option key={f} value={f}>× {f}</option>)}</select>}
              <Switch checked={a[k].enabled} onChange={(enabled) => set(k, { enabled })} label={l.label} />
            </div>
          );
        })}
        <div className="form-actions"><button className="btn btn-primary" onClick={async () => { await call('/settings', { method: 'PUT', body: { alerts: a } }); toast('Alertes enregistrées.'); }}>Enregistrer</button></div>
      </Card>
      <Card title="Notifications de l'appareil">
        <div className="stack-s small">
          <p>Les alertes s'affichent dans la cloche 🔔 en haut de l'écran. Tu peux aussi recevoir une notification de l'appareil pour les alertes importantes (dépassement, risque de découvert) et les échecs de synchronisation, tant que l'application est ouverte.</p>
          {perm === 'granted' ? <Badge tone="good">Notifications autorisées sur cet appareil</Badge>
            : perm === 'denied' ? <Badge tone="warn">Notifications bloquées dans les réglages du navigateur</Badge>
              : <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={async () => setPerm(await Notification.requestPermission())}>Autoriser les notifications</button>}
          <p className="muted">Sur iPhone, les notifications web nécessitent d'ajouter l'application à l'écran d'accueil (Partager → « Sur l'écran d'accueil »).</p>
        </div>
      </Card>
    </div>
  );
}

function DataTab() {
  const { state, call, toast } = useStore();
  return (
    <div className="grid g2">
      <Card title="Exports">
        <div className="stack-s small">
          <p>Exporte tes données : opérations au format CSV (compatible Excel), sauvegarde complète au format JSON. Les bilans s'exportent en PDF depuis Analyses (bouton « Exporter en PDF »).</p>
          <div className="row gap-s wrap">
            <a className="btn" href="/api/export/transactions.csv" download>Opérations (CSV)</a>
            <a className="btn" href="/api/export" download>Sauvegarde complète (JSON)</a>
          </div>
        </div>
      </Card>
      <Card title="Sauvegardes">
        <div className="stack-s small">
          <p>Le serveur sauvegarde automatiquement la base chaque jour (les 14 dernières sont conservées dans <span className="kbd">data/backups</span>).</p>
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={state.demo} onClick={async () => { const r = await call<{ file: string }>('/backup', { body: {} }); toast(`Sauvegarde créée : ${r.file}`); }}>Sauvegarder maintenant</button>
        </div>
      </Card>
      <Card title="Mode démo">
        <div className="stack-s small">
          <p>Le mode démo charge des données <strong>fictives</strong> dans une base séparée, en mémoire. Il ne mélange jamais tes données réelles et disparaît au redémarrage du serveur.</p>
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={async () => { await call('/auth/mode', { body: { demo: !state.demo } }); window.location.reload(); }}>{state.demo ? 'Quitter le mode démo' : 'Explorer le mode démo'}</button>
        </div>
      </Card>
      <Card title="Effacement">
        <div className="stack-s small">
          <p>{state.demo ? 'Régénère les données de démonstration.' : 'Efface tes comptes personnels, opérations, budgets et objectifs. Les comptes communs et les données de ton/ta partenaire ne sont pas touchés.'}</p>
          <button className="btn btn-danger" style={{ alignSelf: 'flex-start' }} onClick={async () => {
            const v = prompt('Pour confirmer, tape SUPPRIMER');
            if (v === 'SUPPRIMER') { await call('/reset', { body: { confirm: v } }); toast('Données effacées.'); }
          }}>{state.demo ? 'Réinitialiser la démo' : 'Effacer mes données personnelles'}</button>
        </div>
      </Card>
    </div>
  );
}
