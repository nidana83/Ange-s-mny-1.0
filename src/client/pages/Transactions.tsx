import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Badge, Card, Empty, eur, Field, Modal, Money, MoneyInput } from '../components/ui';
import { accountsInScope } from '../../shared/analytics';
import { dateLabel, monthKey, monthLabel, todayISO } from '../../shared/dates';
import { sum } from '../../shared/money';
import type { Transaction } from '../../shared/types';

const PAGE = 100;

export function Transactions() {
  const { state, scope, call, toast } = useStore();
  const [q, setQ] = useState('');
  const [month, setMonth] = useState('');
  const [account, setAccount] = useState('');
  const [cat, setCat] = useState('');
  const [kind, setKind] = useState<'all' | 'out' | 'in' | 'transfer' | 'uncat'>('all');
  const [limit, setLimit] = useState(PAGE);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const accounts = accountsInScope(state, scope);
  const accMap = new Map(state.accounts.map((a) => [a.id, a]));
  const months = [...new Set(state.transactions.map((t) => monthKey(t.date)))].sort().reverse();

  const filtered = useMemo(() => {
    const ids = new Set(accounts.map((a) => a.id));
    const needle = q.toLowerCase();
    return state.transactions.filter((t) => ids.has(t.accountId)
      && (!month || monthKey(t.date) === month)
      && (!account || t.accountId === account)
      && (!cat || (cat === '__none__' ? !t.categoryId : t.categoryId === cat))
      && (kind === 'all' || (kind === 'out' && t.amount < 0 && !t.isTransfer) || (kind === 'in' && t.amount > 0 && !t.isTransfer) || (kind === 'transfer' && t.isTransfer) || (kind === 'uncat' && !t.categoryId && !t.isTransfer))
      && (!needle || `${t.description} ${t.merchant} ${t.note}`.toLowerCase().includes(needle)));
  }, [state.transactions, accounts, q, month, account, cat, kind]);

  const update = async (t: Transaction, patch: Partial<Transaction> & { learn?: boolean; applyToSimilar?: boolean }) => {
    await call(`/transactions/${t.id}`, { method: 'PATCH', body: patch });
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Opérations</h1>
          <p className="muted">Toutes tes opérations, catégorisées automatiquement. Corrige une catégorie : l'application s'en souviendra.</p>
        </div>
        <div className="row gap-s">
          <button className="btn" onClick={() => setAddOpen(true)}>+ Saisie manuelle</button>
          <button className="btn btn-primary" onClick={() => setImportOpen(true)}>⬆️ Importer CSV / OFX</button>
        </div>
      </div>

      <Card>
        <div className="grid filters">
          <input placeholder="🔎 Rechercher (commerçant, libellé, note)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={month} onChange={(e) => setMonth(e.target.value)}><option value="">Tous les mois</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
          <select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Tous les comptes</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Toutes catégories</option><option value="__none__">❔ Non catégorisé</option>{state.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">Tous types</option><option value="out">Dépenses</option><option value="in">Revenus</option><option value="transfer">Transferts internes</option><option value="uncat">À catégoriser</option>
          </select>
        </div>
        <div className="row gap wrap small" style={{ marginTop: 12 }}>
          <span className="muted">{filtered.length} opération(s)</span>
          <Badge tone="danger">Sorties : {eur(-sum(filtered.filter((t) => t.amount < 0 && !t.isTransfer), (t) => t.amount))}</Badge>
          <Badge tone="good">Entrées : {eur(sum(filtered.filter((t) => t.amount > 0 && !t.isTransfer), (t) => t.amount))}</Badge>
          <Badge>Transferts exclus : {filtered.filter((t) => t.isTransfer).length}</Badge>
        </div>
      </Card>

      <Card>
        {filtered.length === 0 ? <Empty icon="🧾" title="Aucune opération">Importe un relevé Revolut (CSV) ou connecte ton compte.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Opération</th><th>Catégorie</th><th>Compte</th><th className="right">Montant</th><th /></tr></thead>
              <tbody>
                {filtered.slice(0, limit).map((t) => <TxRow key={t.id} t={t} accountName={accMap.get(t.accountId)?.name ?? ''} onUpdate={update} />)}
              </tbody>
            </table>
            {filtered.length > limit && <div className="center" style={{ marginTop: 12 }}><button className="btn" onClick={() => setLimit(limit + PAGE)}>Afficher plus</button></div>}
          </div>
        )}
      </Card>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <AddModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); toast('Opération ajoutée.'); }} />
    </div>
  );
}

function TxRow({ t, accountName, onUpdate }: { t: Transaction; accountName: string; onUpdate: (t: Transaction, p: Partial<Transaction> & { learn?: boolean; applyToSimilar?: boolean }) => void }) {
  const { state, call } = useStore();
  const c = state.categories.find((k) => k.id === t.categoryId);
  return (
    <tr style={{ opacity: t.isTransfer ? 0.6 : 1 }}>
      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateLabel(t.date)} {t.date.slice(0, 4)}</td>
      <td>
        <div className="row gap-s">
          <div className="cat-dot" style={{ background: `${c?.color ?? '#475569'}22`, width: 30, height: 30 }}>{t.isTransfer ? '🔄' : c?.icon ?? '❔'}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.description}>{t.merchant || t.description}</div>
            <div className="row gap-s small">
              {t.pending && <Badge tone="warn">En attente</Badge>}
              {t.isTransfer && <Badge>Transfert interne · exclu</Badge>}
              {t.source === 'enablebanking' && <span className="muted">synchro</span>}
              {t.source === 'file' && <span className="muted">import</span>}
            </div>
          </div>
        </div>
      </td>
      <td>
        <select value={t.categoryId ?? ''} style={{ padding: '4px 8px', minWidth: 170 }} onChange={(e) => {
          const categoryId = e.target.value || null;
          const kind = state.categories.find((k) => k.id === categoryId)?.kind;
          const similar = state.transactions.filter((o) => o.id !== t.id && (o.merchant || o.description).toLowerCase().split(' ')[0] === (t.merchant || t.description).toLowerCase().split(' ')[0]).length;
          const applyToSimilar = similar > 0 && categoryId ? confirm(`Appliquer « ${state.categories.find((k) => k.id === categoryId)?.name} » aux ${similar} opération(s) similaire(s) et aux suivantes ?`) : false;
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
      <td className="right"><Money cents={t.amount} sign /></td>
      <td className="right" style={{ whiteSpace: 'nowrap' }}>
        <button className="btn-icon" title={t.isTransfer ? 'Compter comme opération réelle' : 'Marquer comme transfert interne'} onClick={() => onUpdate(t, { isTransfer: !t.isTransfer })}>🔄</button>
        {t.source === 'manual' && <button className="btn-icon" title="Supprimer" onClick={() => confirm('Supprimer cette opération ?') && call(`/transactions/${t.id}`, { method: 'DELETE' })}>🗑️</button>}
      </td>
    </tr>
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
            <option value="">Choisir…</option>{state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
                  <option value="">Choisir…</option>{state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
