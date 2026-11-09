import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { api, fileToBase64 } from '../api';
import { Badge, Card, Empty, eur, Field, Modal, Money, MoneyInput, ScopeToggle, Switch, useOwnerLabel } from '../components/ui';
import { accountsInScope, counts } from '../../shared/analytics';
import { detectRecurring, merchantKey } from '../../shared/recurring';
import { dateLabel, todayISO } from '../../shared/dates';
import { sum } from '../../shared/money';
import type { AuditEntry, Transaction } from '../../shared/types';

const PAGE = 100;

export function Transactions() {
  const { state, scope, call, toast } = useStore();
  const ownerLabel = useOwnerLabel();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [account, setAccount] = useState('');
  const [person, setPerson] = useState('');
  const [cat, setCat] = useState('');
  const [kind, setKind] = useState<'all' | 'out' | 'in' | 'transfer' | 'uncat' | 'shared' | 'recurring'>('all');
  const [status, setStatus] = useState<'all' | 'done' | 'pending' | 'cancelled' | 'excluded'>('all');
  const [limit, setLimit] = useState(PAGE);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  const accounts = accountsInScope(state, scope);
  const accMap = new Map(state.accounts.map((a) => [a.id, a]));
  const recurringIds = useMemo(() => new Set(detectRecurring(state).flatMap((r) => r.transactionIds)), [state]);

  const filtered = useMemo(() => {
    const ids = new Set(accounts.map((a) => a.id));
    const needle = q.trim().toLowerCase();
    // Recherche par montant : « 12,50 », « 12.5 » ou « 150 »
    const asAmount = /^[\d\s]+([.,]\d{1,2})?$/.test(needle) ? Math.round(Number(needle.replace(/\s/g, '').replace(',', '.')) * 100) : null;
    return state.transactions.filter((t) => ids.has(t.accountId)
      && (!from || t.date >= from) && (!to || t.date <= to)
      && (!account || t.accountId === account)
      && (!person || accMap.get(t.accountId)?.owner === person)
      && (!cat || (cat === '__none__' ? !t.categoryId : t.categoryId === cat))
      && (kind === 'all' || (kind === 'out' && t.amount < 0 && !t.isTransfer) || (kind === 'in' && t.amount > 0 && !t.isTransfer) || (kind === 'transfer' && t.isTransfer)
        || (kind === 'uncat' && !t.categoryId && !t.isTransfer) || (kind === 'shared' && t.shared) || (kind === 'recurring' && recurringIds.has(t.id)))
      && (status === 'all' || (status === 'cancelled' && t.cancelled) || (status === 'excluded' && t.excluded) || (status === 'pending' && t.pending && !t.cancelled) || (status === 'done' && !t.pending && !t.cancelled && !t.excluded))
      && (!needle || (asAmount !== null ? Math.abs(Math.abs(t.amount) - asAmount) < 100 || Math.abs(t.amount) === asAmount : `${t.description} ${t.merchant} ${t.note}`.toLowerCase().includes(needle))));
  }, [state.transactions, accounts, accMap, q, from, to, account, person, cat, kind, status, recurringIds]);

  const update = async (t: Transaction, patch: Partial<Transaction> & { learn?: boolean; applyToSimilar?: boolean }) => {
    await call(`/transactions/${t.id}`, { method: 'PATCH', body: patch });
  };
  const counted = filtered.filter((t) => counts(t));
  const reset = () => { setQ(''); setFrom(''); setTo(''); setAccount(''); setPerson(''); setCat(''); setKind('all'); setStatus('all'); };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Transactions</h1>
          <p className="muted">Toutes vos opérations, catégorisées automatiquement. Corrige une catégorie : l'application s'en souviendra.</p>
        </div>
        <div className="row gap-s wrap">
          <ScopeToggle />
          <button className="btn" onClick={() => setAddOpen(true)}>+ Opération manuelle</button>
          <button className="btn btn-primary" onClick={() => setImportOpen(true)}>Importer CSV / OFX</button>
        </div>
      </div>

      <Card>
        <div className="grid filters">
          <input placeholder="Rechercher un commerçant, un libellé ou un montant…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Recherche" />
          <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Personne"><option value="">Toutes les personnes</option>{[state.viewer.person, state.partner.person, 'joint'].filter((o) => accounts.some((a) => a.owner === o)).map((o) => <option key={o} value={o}>{ownerLabel(o)}</option>)}</select>
          <select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Compte"><option value="">Tous les comptes</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Catégorie"><option value="">Toutes catégories</option><option value="__none__">Non catégorisé</option>{state.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Type">
            <option value="all">Tous types</option><option value="out">Dépenses</option><option value="in">Revenus</option><option value="transfer">Transferts internes</option>
            <option value="shared">Dépenses communes (payées perso)</option><option value="recurring">Paiements récurrents</option><option value="uncat">À catégoriser</option>
          </select>
        </div>
        <div className="row gap wrap" style={{ marginTop: 10 }}>
          <label className="row gap-s small">Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} /></label>
          <label className="row gap-s small">au <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} /></label>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={{ width: 190 }} aria-label="Statut">
            <option value="all">Tous statuts</option><option value="done">Réalisées</option><option value="pending">En attente</option><option value="cancelled">Annulées</option><option value="excluded">Exclues des calculs</option>
          </select>
          <button className="btn btn-sm btn-ghost" onClick={reset}>Réinitialiser</button>
        </div>
        <div className="row gap wrap small" style={{ marginTop: 12 }}>
          <span className="muted">{filtered.length} opération(s)</span>
          <Badge tone="danger">Sorties : {eur(-sum(counted.filter((t) => t.amount < 0 && !t.isTransfer), (t) => t.amount))}</Badge>
          <Badge tone="good">Entrées : {eur(sum(counted.filter((t) => t.amount > 0 && !t.isTransfer), (t) => t.amount))}</Badge>
          <Badge>Transferts internes exclus : {filtered.filter((t) => t.isTransfer).length}</Badge>
        </div>
      </Card>

      <Card>
        {filtered.length === 0 ? <Empty icon="🧾" title="Aucune opération">Importe un relevé Revolut (CSV) ou connecte ton compte.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Opération</th><th>Catégorie</th><th>Compte</th><th className="right">Montant</th><th /></tr></thead>
              <tbody>
                {filtered.slice(0, limit).map((t) => {
                  const a = accMap.get(t.accountId);
                  return <TxRow key={t.id} t={t} accountName={a?.name ?? ''} who={a ? ownerLabel(a.owner) : ''} recurring={recurringIds.has(t.id)}
                    readOnly={!a || (a.owner !== state.viewer.person && a.owner !== 'joint')} onUpdate={update} onOpen={() => setDetail(t.id)} />;
                })}
              </tbody>
            </table>
            {filtered.length > limit && <div className="center" style={{ marginTop: 12 }}><button className="btn" onClick={() => setLimit(limit + PAGE)}>Afficher plus</button></div>}
          </div>
        )}
      </Card>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <AddModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); toast('Opération ajoutée.'); }} />
      <TxDetail id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function TxRow({ t, accountName, who, recurring, readOnly, onUpdate, onOpen }: { t: Transaction; accountName: string; who: string; recurring: boolean; readOnly: boolean; onUpdate: (t: Transaction, p: Partial<Transaction> & { learn?: boolean; applyToSimilar?: boolean }) => void; onOpen: () => void }) {
  const { state } = useStore();
  const c = state.categories.find((k) => k.id === t.categoryId);
  const off = t.isTransfer || t.excluded || t.cancelled;
  return (
    <tr style={{ opacity: off ? 0.55 : 1 }}>
      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateLabel(t.date)} {t.date.slice(0, 4)}</td>
      <td>
        <button className="row gap-s" onClick={onOpen} style={{ background: 'none', border: 'none', color: 'inherit', textAlign: 'left', padding: 0 }}>
          <div className="cat-dot" style={{ background: `${c?.color ?? '#475569'}22`, width: 30, height: 30 }}>{t.isTransfer ? '⇄' : c?.icon ?? '❔'}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: t.cancelled ? 'line-through' : undefined }} title={t.description}>{t.merchant || t.description}</div>
            <div className="row gap-s small wrap">
              {t.pending && <Badge tone="warn">En attente</Badge>}
              {t.cancelled && <Badge tone="danger">Annulée</Badge>}
              {t.excluded && <Badge>Exclue</Badge>}
              {t.isTransfer && <Badge>Transfert interne</Badge>}
              {t.shared && <Badge tone="accent">Commune</Badge>}
              {recurring && <Badge tone="info">Récurrent</Badge>}
              {t.note && <span className="muted" title={t.note}>💬</span>}
              {t.attachmentCount > 0 && <span className="muted">📎 {t.attachmentCount}</span>}
              <span className="muted">{who}</span>
            </div>
          </div>
        </button>
      </td>
      <td>
        <select value={t.categoryId ?? ''} disabled={readOnly} style={{ padding: '4px 8px', minWidth: 170 }} aria-label="Catégorie" onChange={(e) => {
          const categoryId = e.target.value || null;
          const kind = state.categories.find((k) => k.id === categoryId)?.kind;
          const key = merchantKey(t);
          const similar = state.transactions.filter((o) => o.id !== t.id && merchantKey(o) === key && o.categoryId !== categoryId).length;
          const applyToSimilar = similar > 0 && categoryId ? confirm(`Appliquer « ${state.categories.find((k) => k.id === categoryId)?.name} » aux ${similar} opération(s) similaire(s) et retenir ce choix pour les prochaines ?`) : false;
          onUpdate(t, { categoryId, isTransfer: kind === 'transfer' ? true : kind ? false : t.isTransfer, learn: !!categoryId, applyToSimilar });
        }}>
          <option value="">❔ Non catégorisé</option>
          {['variable', 'fixed', 'income', 'savings', 'transfer'].map((k) => (
            <optgroup key={k} label={{ variable: 'Dépenses variables', fixed: 'Charges fixes', income: 'Revenus', savings: 'Épargne', transfer: 'Transferts' }[k]}>
              {state.categories.filter((x) => x.kind === k && !x.archived).map((x) => <option key={x.id} value={x.id}>{x.icon} {x.name}</option>)}
            </optgroup>
          ))}
        </select>
      </td>
      <td className="muted small">{accountName}</td>
      <td className="right"><Money cents={t.amount} sign />{t.originalAmount !== null && <div className="small muted">{(t.originalAmount / 100).toFixed(2)} {state.accounts.find((a) => a.id === t.accountId)?.currency}</div>}</td>
      <td className="right" style={{ whiteSpace: 'nowrap' }}>
        <button className="btn btn-sm btn-ghost" onClick={onOpen}>Détails</button>
      </td>
    </tr>
  );
}

interface Details { attachments: { id: string; filename: string; mime: string; size: number; createdAt: string }[]; history: AuditEntry[] }

function TxDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { state, call, toast } = useStore();
  const t = state.transactions.find((x) => x.id === id) ?? null;
  const a = t ? state.accounts.find((x) => x.id === t.accountId) : null;
  const readOnly = !a || (a.owner !== state.viewer.person && a.owner !== 'joint');
  const [details, setDetails] = useState<Details | null>(null);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!id) return;
    setDetails(null);
    setNote(state.transactions.find((x) => x.id === id)?.note ?? '');
    api<Details>(`/transactions/${id}/details`).then(setDetails).catch(() => setDetails({ attachments: [], history: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, t?.attachmentCount]);
  if (!t) return null;
  const patch = (p: Partial<Transaction>) => call(`/transactions/${t.id}`, { method: 'PATCH', body: p });
  const upload = async (f: File) => {
    if (f.size > 5 * 1024 * 1024) return toast('Fichier trop volumineux (5 Mo max).', 'error');
    await call(`/transactions/${t.id}/attachments`, { body: { filename: f.name, mime: f.type, data: await fileToBase64(f) } });
    toast('Justificatif ajouté.');
  };
  return (
    <Modal open={!!id} onClose={onClose} title="Détails de l'opération" wide>
      <div className="stack">
        <div className="row between wrap gap">
          <div><h3>{t.merchant || t.description}</h3><p className="muted small">{t.description} · {dateLabel(t.date)} {t.date.slice(0, 4)} · {a?.name}</p></div>
          <div className="hero-value" style={{ fontSize: 28 }}><Money cents={t.amount} sign /></div>
        </div>
        {readOnly && <div className="banner info small">Opération de {state.partner.name}, partagée en lecture seule.</div>}
        <div className="grid g2">
          <div className="stack-s">
            <label className="row between"><span>Transfert interne (exclu des dépenses et revenus)</span><Switch checked={t.isTransfer} onChange={(v) => !readOnly && patch({ isTransfer: v })} label="Transfert interne" /></label>
            <label className="row between"><span>Dépense commune payée avec ce compte</span><Switch checked={t.shared} onChange={(v) => !readOnly && patch({ shared: v })} label="Dépense commune" /></label>
            <label className="row between"><span>Exclure des calculs</span><Switch checked={t.excluded} onChange={(v) => !readOnly && patch({ excluded: v })} label="Exclure" /></label>
            <label className="row between"><span>Opération annulée (remboursée, rejetée)</span><Switch checked={t.cancelled} onChange={(v) => !readOnly && patch({ cancelled: v })} label="Annulée" /></label>
            <p className="small muted">Statut : {t.cancelled ? 'annulée' : t.pending ? 'en attente' : 'réalisée'}{t.source === 'enablebanking' ? ' · synchronisée' : t.source === 'file' ? ' · importée' : ' · saisie manuelle'}</p>
          </div>
          <Field label="Commentaire">
            <textarea rows={4} value={note} disabled={readOnly} onChange={(e) => setNote(e.target.value)} placeholder="Ajoute un commentaire…" />
            {!readOnly && note !== t.note && <button className="btn btn-sm" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={async () => { await patch({ note }); toast('Commentaire enregistré.'); }}>Enregistrer le commentaire</button>}
          </Field>
        </div>
        <div>
          <div className="row between" style={{ marginBottom: 6 }}>
            <h3>Justificatifs</h3>
            {!readOnly && <><button className="btn btn-sm" onClick={() => fileRef.current?.click()}>📎 Ajouter</button>
              <input ref={fileRef} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} /></>}
          </div>
          {details?.attachments.length ? details.attachments.map((x) => (
            <div key={x.id} className="list-item">
              <span>{x.mime === 'application/pdf' ? '📄' : '🖼️'}</span>
              <a className="grow" href={`/api/attachments/${x.id}`} target="_blank" rel="noreferrer">{x.filename}</a>
              <span className="small muted">{Math.ceil(x.size / 1024)} Ko</span>
              {!readOnly && <button className="btn-icon" aria-label="Supprimer" onClick={() => confirm('Supprimer ce justificatif ?') && call(`/attachments/${x.id}`, { method: 'DELETE' })}>✕</button>}
            </div>
          )) : <p className="small muted">Aucun justificatif (ticket, facture… PDF ou photo, 5 Mo max).</p>}
        </div>
        <div>
          <h3 style={{ marginBottom: 6 }}>Historique des modifications</h3>
          {details?.history.length ? details.history.map((h) => (
            <div key={h.id} className="small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
              <span className="muted">{new Date(h.at).toLocaleString('fr-FR')}</span> — {h.action.replace(/_/g, ' ')} <span className="muted">{h.details}</span>
            </div>
          )) : <p className="small muted">Aucune modification enregistrée.</p>}
        </div>
        <div className="form-actions">
          {t.source === 'manual' && !readOnly && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={async () => { if (confirm('Supprimer définitivement cette opération saisie à la main ?')) { await call(`/transactions/${t.id}`, { method: 'DELETE' }); onClose(); } }}>Supprimer</button>}
          <button className="btn" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </Modal>
  );
}

function AddModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { state, call } = useStore();
  const [f, setF] = useState({ accountId: '', date: todayISO(), amount: 0, description: '', out: true, adjustBalance: true });
  return (
    <Modal open={open} onClose={onClose} title="Saisie manuelle d'une opération">
      <div className="form-grid">
        <Field label="Compte">
          <select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            <option value="">Choisir…</option>{state.accounts.filter((a) => a.owner === state.viewer.person || a.owner === 'joint').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Libellé / commerçant"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Montant"><MoneyInput value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
        <Field label="Sens">
          <select value={f.out ? 'out' : 'in'} onChange={(e) => setF({ ...f, out: e.target.value === 'out' })}><option value="out">Dépense</option><option value="in">Revenu</option></select>
        </Field>
        <Field label="Solde"><label className="check"><input type="checkbox" checked={f.adjustBalance} onChange={(e) => setF({ ...f, adjustBalance: e.target.checked })} /> Mettre à jour le solde du compte</label></Field>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" disabled={!f.accountId || !f.amount || !f.description} onClick={async () => {
          await call('/transactions', { body: { accountId: f.accountId, date: f.date, description: f.description, amount: f.out ? -Math.abs(f.amount) : Math.abs(f.amount), adjustBalance: f.adjustBalance } });
          setF({ ...f, amount: 0, description: '' });
          onSaved();
        }}>Ajouter</button>
      </div>
    </Modal>
  );
}

interface Preview { format: string; count: number; errors: string[]; products: string[]; sample: { date: string; amount: number; description: string; pending: boolean }[]; closingBalance: number | null }

export function ImportModal({ open, onClose, defaultAccount }: { open: boolean; onClose: () => void; defaultAccount?: string }) {
  const { state, call, toast } = useStore();
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accountId, setAccountId] = useState(defaultAccount ?? '');
  const [product, setProduct] = useState('');
  const [updateBalance, setUpdateBalance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = async (f: File) => {
    const content = await f.text();
    setFile({ name: f.name, content });
    const p = await call<Preview>('/import/preview', { body: { filename: f.name, content } });
    setPreview(p);
    setProduct(p.products.includes('Current') ? 'Current' : p.products[0] ?? '');
  };
  const reset = () => { setFile(null); setPreview(null); setProduct(''); };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Importer un relevé" wide>
      <div className="stack">
        <div className="banner info small">
          <span>💡</span>
          <div>
            Dans l'app Revolut : <strong>Compte → ⋯ → Relevé → Excel/CSV</strong>, choisis la période puis exporte. Les formats CSV d'autres banques et OFX/QFX sont aussi acceptés.
            Les opérations déjà présentes sont ignorées automatiquement (dédoublonnage).
          </div>
        </div>
        {!file ? (
          <div className={`dropzone ${drag ? 'drag' : ''}`} onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void load(f); }}>
            <div style={{ fontSize: 30 }}>📄</div>
            <div>Glisse ton fichier ici ou clique pour le choisir</div>
            <div className="small">.csv · .ofx · .qfx</div>
            <input ref={input} type="file" accept=".csv,.ofx,.qfx,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); }} />
          </div>
        ) : preview && (
          <>
            <div className="row between wrap gap">
              <div><strong>{file.name}</strong> <Badge tone="accent">{preview.format === 'revolut-csv' ? 'Relevé Revolut' : preview.format === 'ofx' ? 'OFX' : 'CSV'}</Badge> <span className="muted small">{preview.count} opération(s)</span></div>
              <button className="btn btn-sm btn-ghost" onClick={reset}>Changer de fichier</button>
            </div>
            {preview.errors.length > 0 && <div className="banner warn small"><span>⚠️</span><div>{preview.errors.slice(0, 4).map((e) => <div key={e}>{e}</div>)}</div></div>}
            <div className="form-grid">
              <Field label="Compte de destination">
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Choisir…</option>{state.accounts.filter((a) => a.owner === state.viewer.person || a.owner === 'joint').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              {preview.products.length > 1 && (
                <Field label="Sous-compte du fichier" hint="Le relevé Revolut mélange compte courant et épargne : importe-les séparément.">
                  <select value={product} onChange={(e) => setProduct(e.target.value)}>{preview.products.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                </Field>
              )}
              <Field label="Solde">
                <label className="check"><input type="checkbox" checked={updateBalance} onChange={(e) => setUpdateBalance(e.target.checked)} /> Mettre à jour le solde depuis le relevé {preview.closingBalance !== null ? `(${eur(preview.closingBalance)})` : '(si disponible)'}</label>
              </Field>
            </div>
            <table className="table small">
              <thead><tr><th>Date</th><th>Libellé</th><th className="right">Montant</th></tr></thead>
              <tbody>{preview.sample.map((s, i) => <tr key={i}><td>{s.date}</td><td>{s.description} {s.pending && <Badge tone="warn">en attente</Badge>}</td><td className="right"><Money cents={s.amount} sign /></td></tr>)}</tbody>
            </table>
            <div className="form-actions">
              <button className="btn" onClick={() => { reset(); onClose(); }}>Annuler</button>
              <button className="btn btn-primary" disabled={!accountId || busy} onClick={async () => {
                setBusy(true);
                try {
                  const r = await call<{ result: { imported: number; duplicates: number; transfers: number } }>('/import', { body: { filename: file.name, content: file.content, accountId, product: product || undefined, updateBalance } });
                  toast(`${r.result.imported} opération(s) importée(s) · ${r.result.duplicates} doublon(s) ignoré(s) · ${r.result.transfers} transfert(s) interne(s) détecté(s).`);
                  reset(); onClose();
                } finally { setBusy(false); }
              }}>{busy ? 'Import…' : 'Importer'}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
