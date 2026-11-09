import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { Badge, Card, Empty, eur, Field, Modal, Money, MoneyInput, useOwnerLabel } from '../components/ui';
import { ImportModal } from './Transactions';
import type { Account, Owner } from '../../shared/types';
import { sum } from '../../shared/money';

const TYPES: Record<Account['type'], string> = { current: '💳 Compte courant', wallet: '👛 Portefeuille', savings: '🐷 Épargne', vault: '🔐 Coffre / espace', joint: '💞 Compte commun', investment: '📈 Investissement' };

export function Accounts({ embedded = false }: { embedded?: boolean }) {
  const { state, call, toast } = useStore();
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState<Partial<Account> & { consent?: boolean } | null>(null);
  const [importFor, setImportFor] = useState<string | null>(null);
  const [connect, setConnect] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const ownerLabel = useOwnerLabel();
  const partner = state.partner.name;

  useEffect(() => {
    if (params.get('bank_connected')) { toast('Connexion bancaire établie et synchronisée ✅'); setParams({}); }
    if (params.get('bank_error')) { toast(`Connexion bancaire refusée ou échouée : ${params.get('bank_error')}`, 'error'); setParams({}); }
  }, [params, setParams, toast]);

  const groups: { owner: Owner; label: string }[] = [{ owner: state.viewer.person, label: `Mes comptes (${state.viewer.name})` }, { owner: 'joint', label: 'Comptes communs' }, { owner: state.partner.person, label: `Comptes de ${partner}` }];
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await call<{ results: { ok: boolean; message: string }[] }>('/bank/sync', { body: {} });
      const failed = r.results.filter((x) => !x.ok);
      if (!r.results.length) toast('Aucune connexion bancaire active.');
      else if (failed.length) toast(`Synchronisation échouée : ${failed[0].message}`, 'error');
      else toast('Synchronisation terminée ✅');
    } finally { setSyncing(false); }
  };

  return (
    <div className="stack">
      <div className={embedded ? 'row between wrap gap' : 'page-head'}>
        {embedded ? <p className="muted">Comptes Revolut, coffres, portefeuilles et comptes communs. Accès en lecture seule.</p> : <div><h1>Comptes & synchronisation</h1><p className="muted">Comptes Revolut, coffres, portefeuilles et comptes du couple. Accès en lecture seule.</p></div>}
        <div className="row gap-s wrap">
          <button className="btn" onClick={() => setEdit({ type: 'current', owner: state.viewer.person, institution: 'Revolut' })}>+ Compte manuel</button>
          <button className="btn" disabled={syncing || !state.connections.length} onClick={sync}>{syncing ? '⏳ Synchronisation…' : '🔄 Synchroniser maintenant'}</button>
          <button className="btn btn-primary" disabled={state.demo} title={state.demo ? 'Indisponible en mode démo' : undefined} onClick={() => setConnect(true)}>Connecter Revolut</button>
        </div>
      </div>

      {!state.bankingConfigured && (
        <div className="banner info">
          <span>🏦</span>
          <div className="small">
            <strong>Connexion directe Revolut non encore configurée.</strong> Revolut ne propose pas d'API publique pour les comptes personnels ;
            l'accès passe par l'Open Banking (DSP2) via un agrégateur agréé. Configure-le une fois (voir <span className="kbd">docs/REVOLUT.md</span>) — en attendant, importe tes relevés CSV.
          </div>
        </div>
      )}

      {state.connections.length > 0 && (
        <Card title="Connexions bancaires">
          {state.connections.map((c) => (
            <div key={c.id} className="list-item">
              <div className="cat-dot" style={{ background: 'var(--panel-2)' }}>🏦</div>
              <div className="grow">
                <div>{c.institution} · {ownerLabel(c.owner)} <Badge tone={c.status === 'active' ? 'good' : c.status === 'pending' ? 'info' : 'danger'}>{{ active: 'Active', pending: 'En attente', expired: 'Expirée', error: 'Erreur' }[c.status]}</Badge></div>
                <div className="small muted">
                  Consentement par {c.consentBy} · valable jusqu'au {c.validUntil ? new Date(c.validUntil).toLocaleDateString('fr-FR') : '—'}
                  {c.lastSyncAt && ` · dernière synchro ${new Date(c.lastSyncAt).toLocaleString('fr-FR')}`}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => call('/bank/sync', { body: { connectionId: c.id } })}>Synchroniser</button>
              <button className="btn btn-sm btn-danger" onClick={() => confirm('Révoquer cette connexion ? Les comptes et opérations déjà importés sont conservés.') && call(`/bank/connections/${c.id}`, { method: 'DELETE' })}>Révoquer</button>
            </div>
          ))}
        </Card>
      )}

      {state.accounts.length === 0 && <Card><Empty icon="🏦" title="Aucun compte">Connecte Revolut, ou ajoute un compte manuel puis importe un relevé CSV.</Empty></Card>}

      {groups.map((g) => {
        const list = state.accounts.filter((a) => a.owner === g.owner);
        if (!list.length) return null;
        return (
          <Card key={g.owner} title={`${g.label} · ${eur(sum(list, (a) => a.balance))}`}
            subtitle={g.owner === state.partner.person ? `Partagés par ${partner} depuis le ${state.partner.sharedSince ? new Date(state.partner.sharedSince).toLocaleDateString('fr-FR') : '—'} · lecture seule` : undefined}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Compte</th><th>Type</th><th>Source</th><th>Disponible</th><th className="right">Solde</th><th /></tr></thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} style={{ opacity: a.archived ? 0.5 : 1 }}>
                      <td><strong>{a.name}</strong><div className="small muted">{a.institution} · {a.currency}</div></td>
                      <td>{TYPES[a.type]}</td>
                      <td>{a.provider === 'enablebanking' ? <Badge tone="good">Open Banking</Badge> : a.provider === 'file' ? <Badge>Import</Badge> : <Badge>Manuel</Badge>}
                        </td>
                      <td>{a.includeInAvailable ? '✅' : '—'}</td>
                      <td className="right"><Money cents={a.balance} />{a.currency !== state.settings.currency && <div className="small muted">{(a.originalBalance / 100).toFixed(2)} {a.currency}</div>}</td>
                      <td className="right" style={{ whiteSpace: 'nowrap' }}>
                        {g.owner !== state.partner.person && <><button className="btn btn-sm" onClick={() => setImportFor(a.id)}>Importer</button>{' '}
                        <button className="btn-icon" onClick={() => setEdit({ ...a, balance: a.originalBalance })} aria-label="Modifier">✏️</button></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}

      <Card title="Historique des synchronisations et imports">
        {state.syncRuns.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Source</th><th>Statut</th><th className="right">Nouvelles</th><th className="right">Doublons ignorés</th><th className="right">Transferts</th><th>Détail</th></tr></thead>
              <tbody>
                {state.syncRuns.slice(0, 20).map((r) => (
                  <tr key={r.id}>
                    <td className="small">{new Date(r.startedAt).toLocaleString('fr-FR')}</td>
                    <td>{r.provider === 'enablebanking' ? 'Open Banking' : r.provider === 'file' ? 'Fichier' : 'Manuel'}</td>
                    <td>{r.status === 'success' ? <Badge tone="good">Réussie</Badge> : r.status === 'error' ? <Badge tone="danger">Échec</Badge> : <Badge tone="info">En cours</Badge>}</td>
                    <td className="right">{r.imported}</td><td className="right">{r.duplicates}</td><td className="right">{r.transfers}</td>
                    <td className="small muted" style={{ maxWidth: 320 }}>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Aucune synchronisation pour l'instant.</p>}
        <NotificationOptIn />
      </Card>

      <AccountModal value={edit} onClose={() => setEdit(null)} />
      <ImportModal open={!!importFor} onClose={() => setImportFor(null)} defaultAccount={importFor ?? undefined} key={importFor ?? 'none'} />
      <ConnectModal open={connect} onClose={() => setConnect(false)} />
    </div>
  );
}

function NotificationOptIn() {
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  if (perm === 'granted' || !('Notification' in window)) return null;
  return (
    <div className="row gap-s small" style={{ marginTop: 12 }}>
      <span className="muted">Être prévenu par une notification du navigateur en cas d'échec de synchronisation :</span>
      <button className="btn btn-sm" onClick={async () => setPerm(await Notification.requestPermission())}>Activer</button>
    </div>
  );
}

function AccountModal({ value, onClose }: { value: (Partial<Account> & { consent?: boolean }) | null; onClose: () => void }) {
  const { state, call, toast } = useStore();
  const [a, setA] = useState<Partial<Account> & { consent?: boolean }>({});
  const [last, setLast] = useState<unknown>(null);
  if (value !== last) { setLast(value); setA({ ...(value ?? {}), consent: !!value?.consentAt }); }
  const set = (p: Partial<Account> & { consent?: boolean }) => setA((x) => ({ ...x, ...p }));
  return (
    <Modal open={!!value} onClose={onClose} title={a.id ? 'Modifier le compte' : 'Nouveau compte'}>
      <div className="form-grid">
        <Field label="Nom"><input value={a.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="Revolut — Compte principal" autoFocus /></Field>
        <Field label="Établissement"><input value={a.institution ?? ''} onChange={(e) => set({ institution: e.target.value })} /></Field>
        <Field label="Type">
          <select value={a.type} onChange={(e) => set({ type: e.target.value as Account['type'], includeInAvailable: ['current', 'wallet', 'joint'].includes(e.target.value) })}>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Titulaire">
          <select value={a.owner} onChange={(e) => set({ owner: e.target.value as Owner })}>
            <option value={state.viewer.person}>{state.viewer.name}</option><option value="joint">Commun</option>
          </select>
        </Field>
        <Field label="Devise"><select value={a.currency ?? 'EUR'} onChange={(e) => set({ currency: e.target.value })}>{['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'XOF', 'MAD'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Solde actuel" hint={a.provider === 'enablebanking' ? 'Mis à jour automatiquement à chaque synchronisation' : undefined}>
          <MoneyInput value={a.balance ?? 0} onChange={(balance) => set({ balance })} allowNegative />
        </Field>
        <Field label="Argent disponible">
          <label className="check"><input type="checkbox" checked={a.includeInAvailable ?? true} onChange={(e) => set({ includeInAvailable: e.target.checked })} /> Compter ce compte dans le « reste à vivre »</label>
        </Field>
      </div>
      <div className="form-actions">
        {a.id && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={async () => { if (confirm('Supprimer ce compte et toutes ses opérations ?')) { await call(`/accounts/${a.id}`, { method: 'DELETE' }); onClose(); } }}>Supprimer</button>}
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" disabled={!a.name} onClick={async () => {
          await call('/accounts', { body: a });
          toast('Compte enregistré.');
          onClose();
        }}>Enregistrer</button>
      </div>
    </Modal>
  );
}

function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, call } = useStore();
  const [owner, setOwner] = useState<Owner>(state.viewer.person);
  const [country, setCountry] = useState('FR');
  return (
    <Modal open={open} onClose={onClose} title="Connecter un compte Revolut">
      <div className="stack">
        <div className="small muted">
          <p>🔒 <strong>Tes identifiants Revolut ne sont jamais saisis ni stockés dans Ange's MNY.</strong></p>
          <p style={{ marginTop: 6 }}>Tu vas être redirigé vers Revolut (via l'agrégateur Open Banking agréé) pour autoriser un accès <strong>en lecture seule</strong> à tes soldes et opérations,
            pour 180 jours maximum (règle DSP2). Tu peux révoquer l'accès à tout moment, ici ou dans l'app Revolut.</p>
          <p style={{ marginTop: 6 }}>{state.partner.name} connecte ses propres comptes depuis son accès personnel : personne ne peut connecter la banque d'un autre.</p>
        </div>
        {!state.bankingConfigured ? (
          <div className="banner warn small"><span>⚙️</span><div>La connexion Open Banking n'est pas encore configurée sur ce serveur. Suis le guide <span className="kbd">docs/REVOLUT.md</span> (≈ 10 min), puis relance l'application.</div></div>
        ) : (
          <div className="form-grid">
            <Field label="Comptes">
              <select value={owner} onChange={(e) => setOwner(e.target.value as Owner)}>
                <option value={state.viewer.person}>Mes comptes ({state.viewer.name})</option><option value="joint">Compte commun</option>
              </select>
            </Field>
            <Field label="Pays du compte Revolut"><select value={country} onChange={(e) => setCountry(e.target.value)}>{['FR', 'BE', 'LU', 'IE', 'LT', 'ES', 'IT', 'DE', 'NL', 'PT'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
        )}
        <div className="form-actions">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!state.bankingConfigured} onClick={async () => {
            const r = await call<{ url: string }>('/bank/connect', { body: { owner, country, institution: 'Revolut' } });
            window.location.href = r.url;
          }}>Continuer vers Revolut →</button>
        </div>
      </div>
    </Modal>
  );
}
