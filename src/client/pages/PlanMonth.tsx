import { useState } from 'react';
import { useStore } from '../store';
import { Badge, Card, Empty, eur, Field, Modal, Money, MoneyInput, Progress, useOwnerLabel } from '../components/ui';
import {
  budgetFor, goalStatus, variableBudgetLines, type ChargeInstance,
} from '../../shared/analytics';
import { dateLabel, daysInMonth, monthKey, monthLabel } from '../../shared/dates';
import { formatPct, sum } from '../../shared/money';
import type { Category, FixedCharge, Frequency, Goal } from '../../shared/types';

const FREQ: Record<Frequency, string> = { weekly: 'Hebdomadaire', monthly: 'Mensuelle', quarterly: 'Trimestrielle', yearly: 'Annuelle' };

/* --------------------------------- A. Charges --------------------------------- */

export function FixedCharges({ month, charges }: { month: string; charges: ChargeInstance[] }) {
  const { state, call, toast } = useStore();
  const [edit, setEdit] = useState<Partial<FixedCharge> | null>(null);
  const setStatus = (c: ChargeInstance, status: string) => call(`/charges/${c.charge.id}/month`, { method: 'PUT', body: { month, status } });
  const paid = charges.filter((c) => c.status === 'paid');

  return (
    <Card
      title="Charges fixes et incompressibles"
      subtitle="Reportées automatiquement chaque mois · rapprochées automatiquement des prélèvements importés"
      actions={<button className="btn btn-primary" onClick={() => setEdit({ frequency: 'monthly', dayOfMonth: 5, startMonth: month, active: true })}>+ Ajouter une charge</button>}
    >
      <div className="row gap wrap small" style={{ marginBottom: 12 }}>
        <Badge tone="good">{paid.length} payée(s) · {eur(sum(paid, (c) => c.amount))}</Badge>
        <Badge tone="warn">{charges.filter((c) => c.status === 'pending').length} à venir · {eur(sum(charges.filter((c) => c.status === 'pending'), (c) => c.amount))}</Badge>
      </div>
      {charges.length === 0 ? <Empty icon="🧾" title="Aucune charge fixe">Ajoute ton loyer, tes abonnements, tes assurances…</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Charge</th><th>Échéance</th><th>Fréquence</th><th>Compte</th><th className="right">Montant</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {charges.map((c) => {
                const cat = state.categories.find((k) => k.id === c.charge.categoryId);
                const acc = state.accounts.find((a) => a.id === c.charge.accountId);
                return (
                  <tr key={c.charge.id + c.dueDate}>
                    <td><div className="row gap-s"><span>{cat?.icon ?? '🧾'}</span><div><div>{c.charge.name}</div><div className="muted small">{cat?.name}</div></div></div></td>
                    <td>{dateLabel(c.dueDate)}</td>
                    <td className="muted">{FREQ[c.charge.frequency]}</td>
                    <td className="muted small">{acc?.name ?? '—'}</td>
                    <td className="right"><Money cents={c.amount} /></td>
                    <td>
                      <select value={c.status} disabled={c.charge.owner !== state.viewer.person && c.charge.owner !== 'joint'} onChange={(e) => setStatus(c, e.target.value)} style={{ width: 130, padding: '4px 8px' }}>
                        <option value="paid">✅ Payée</option>
                        <option value="pending">⏳ À venir</option>
                        <option value="skipped">⏭️ Pas ce mois</option>
                      </select>
                      {c.auto && <div className="small muted">auto-rapprochée</div>}
                      {c.overdue && <div className="small" style={{ color: 'var(--warn)' }}>échéance passée</div>}
                    </td>
                    <td className="right">{(c.charge.owner === state.viewer.person || c.charge.owner === 'joint') && <button className="btn-icon" onClick={() => setEdit(c.charge)} aria-label="Modifier">✏️</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ChargeModal value={edit} onClose={() => setEdit(null)} onSave={async (c) => { await call('/charges', { body: c }); toast('Charge enregistrée.'); setEdit(null); }}
        onDelete={async (id) => { if (confirm('Supprimer cette charge pour tous les mois ?')) { await call(`/charges/${id}`, { method: 'DELETE' }); setEdit(null); } }} categories={state.categories} />
    </Card>
  );
}

function ChargeModal({ value, onClose, onSave, onDelete, categories }: { value: Partial<FixedCharge> | null; onClose: () => void; onSave: (c: Partial<FixedCharge>) => void; onDelete: (id: string) => void; categories: Category[] }) {
  const { state } = useStore();
  const [c, setC] = useState<Partial<FixedCharge>>({});
  const [lastId, setLastId] = useState<unknown>(null);
  if (value !== lastId) { setLastId(value); setC(value ?? {}); }
  const set = (p: Partial<FixedCharge>) => setC((x) => ({ ...x, ...p }));
  return (
    <Modal open={!!value} onClose={onClose} title={c.id ? 'Modifier la charge' : 'Nouvelle charge fixe'}>
      <div className="form-grid">
        <Field label="Nom"><input value={c.name ?? ''} onChange={(e) => set({ name: e.target.value, matchKeyword: c.matchKeyword || '' })} placeholder="Loyer, Électricité…" autoFocus /></Field>
        <Field label="Montant"><MoneyInput value={c.amount ?? 0} onChange={(amount) => set({ amount })} /></Field>
        <Field label="Fréquence">
          <select value={c.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
            {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label={c.frequency === 'weekly' ? 'Jour de la semaine (1 = lundi)' : 'Jour de prélèvement'}>
          <input type="number" min={1} max={c.frequency === 'weekly' ? 7 : 31} value={c.dayOfMonth ?? 1} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })} />
        </Field>
        <Field label="Catégorie">
          <select value={c.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || null })}>
            <option value="">—</option>
            {categories.filter((k) => k.kind === 'fixed' || k.kind === 'variable').map((k) => <option key={k.id} value={k.id}>{k.icon} {k.name}</option>)}
          </select>
        </Field>
        <Field label="Compte utilisé">
          <select value={c.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value || null })}>
            <option value="">—</option>
            {state.accounts.filter((a) => a.owner === state.viewer.person || a.owner === 'joint').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        {!c.accountId && (
          <Field label="Charge de">
            <select value={c.owner ?? state.viewer.person} onChange={(e) => set({ owner: e.target.value as FixedCharge['owner'] })}>
              <option value={state.viewer.person}>{state.viewer.name}</option><option value="joint">Commun</option>
            </select>
          </Field>
        )}
        <Field label="Premier mois"><input type="month" value={c.startMonth ?? ''} onChange={(e) => set({ startMonth: e.target.value })} /></Field>
        <Field label="Dernier mois (optionnel)" hint="Laisse vide pour reporter indéfiniment"><input type="month" value={c.endMonth ?? ''} onChange={(e) => set({ endMonth: e.target.value || null })} /></Field>
        <Field label="Mot-clé du prélèvement" hint="Ex. « edf » : sert à cocher la charge automatiquement quand le prélèvement arrive.">
          <input value={c.matchKeyword ?? ''} onChange={(e) => set({ matchKeyword: e.target.value })} placeholder={c.name?.toLowerCase()} />
        </Field>
        <Field label="Statut"><label className="check"><input type="checkbox" checked={c.active !== false} onChange={(e) => set({ active: e.target.checked })} /> Charge active</label></Field>
      </div>
      <div className="form-actions">
        {c.id && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={() => onDelete(c.id!)}>Supprimer</button>}
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" disabled={!c.name || !c.amount} onClick={() => onSave(c)}>Enregistrer</button>
      </div>
    </Modal>
  );
}

/* ----------------------------- B. Dépenses variables ----------------------------- */

export function VariableBudgets({ month, lines }: { month: string; lines: ReturnType<typeof variableBudgetLines> }) {
  const { state, today, call, toast } = useStore();
  const [newCat, setNewCat] = useState<Partial<Category> | null>(null);
  const progress = month === monthKey(today) ? Number(today.slice(8, 10)) / daysInMonth(month) : month < monthKey(today) ? 1 : 0;
  const saveBudget = async (categoryId: string, amount: number, forAll: boolean) => {
    if (forAll) {
      const c = state.categories.find((k) => k.id === categoryId)!;
      await call('/categories', { body: { ...c, monthlyBudget: amount } });
      await call('/month-budgets', { method: 'PUT', body: { categoryId, month, amount: null } });
    } else await call('/month-budgets', { method: 'PUT', body: { categoryId, month, amount } });
    toast('Budget mis à jour.');
  };

  return (
    <Card
      title="Dépenses variables"
      subtitle="Chaque opération catégorisée est automatiquement déduite de son enveloppe"
      actions={<button className="btn btn-primary" onClick={() => setNewCat({ kind: 'variable', color: 'var(--accent)', icon: '📦', monthlyBudget: 0, keywords: [] })}>+ Nouvelle catégorie</button>}
    >
      {lines.map((l) => (
        <BudgetRow key={l.category.id} line={l} progress={progress} hasOverride={state.monthBudgets.some((b) => b.categoryId === l.category.id && b.month === month)}
          defaultBudget={budgetFor({ ...state, monthBudgets: [] }, l.category.id, month)} onSave={saveBudget} />
      ))}
      <CategoryModal value={newCat} onClose={() => setNewCat(null)} onSave={async (c) => { await call('/categories', { body: c }); setNewCat(null); toast('Catégorie créée.'); }} />
    </Card>
  );
}

function BudgetRow({ line: l, progress, onSave, hasOverride, defaultBudget }: { line: ReturnType<typeof variableBudgetLines>[number]; progress: number; hasOverride: boolean; defaultBudget: number; onSave: (id: string, amount: number, all: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(l.budget);
  const editable = l.category.id !== '__none__';
  return (
    <div className="budget-line">
      <div className="row gap">
        <div className="cat-dot" style={{ background: `${l.category.color}22` }}>{l.category.icon}</div>
        <div className="grow">
          <div className="row between wrap gap-s">
            <strong>{l.category.name} {hasOverride && <Badge tone="info">budget spécifique à ce mois</Badge>}</strong>
            <span>
              <Money cents={l.spent} /> <span className="muted">/ {eur(l.budget)}</span>
              {' · '}
              <span className={l.remaining < 0 ? 'neg' : 'pos'}>{l.remaining < 0 ? `dépassé de ${eur(-l.remaining)}` : `reste ${eur(l.remaining)}`}</span>
            </span>
          </div>
          <div style={{ marginTop: 6 }}><Progress ratio={l.ratio} color={l.category.color} marker={progress} /></div>
          {l.willExceedBy > 0 && l.remaining >= 0 && <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>⚠️ À ce rythme : ≈ {eur(l.projected, false)} en fin de mois (+{eur(l.willExceedBy, false)})</div>}
        </div>
        {editable && <button className="btn btn-sm" onClick={() => { setAmount(l.budget); setEditing(!editing); }}>{editing ? 'Fermer' : 'Budget'}</button>}
      </div>
      {editing && (
        <div className="row gap wrap" style={{ marginTop: 10, paddingLeft: 46 }}>
          <div style={{ width: 160 }}><MoneyInput value={amount} onChange={setAmount} /></div>
          <button className="btn btn-sm btn-primary" onClick={() => { onSave(l.category.id, amount, true); setEditing(false); }}>Pour tous les mois</button>
          <button className="btn btn-sm" onClick={() => { onSave(l.category.id, amount, false); setEditing(false); }}>Ce mois uniquement</button>
          {hasOverride && <span className="small muted">Budget habituel : {eur(defaultBudget)}</span>}
        </div>
      )}
    </div>
  );
}

export function CategoryModal({ value, onClose, onSave }: { value: Partial<Category> | null; onClose: () => void; onSave: (c: Partial<Category>) => void }) {
  const [c, setC] = useState<Partial<Category>>({});
  const [last, setLast] = useState<unknown>(null);
  if (value !== last) { setLast(value); setC(value ?? {}); }
  const set = (p: Partial<Category>) => setC((x) => ({ ...x, ...p }));
  return (
    <Modal open={!!value} onClose={onClose} title={c.id ? 'Modifier la catégorie' : 'Nouvelle catégorie'}>
      <div className="form-grid">
        <Field label="Nom"><input value={c.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
        <Field label="Type">
          <select value={c.kind} onChange={(e) => set({ kind: e.target.value as Category['kind'] })}>
            <option value="variable">Dépense variable</option><option value="fixed">Charge fixe</option><option value="income">Revenu</option>
            <option value="savings">Épargne</option><option value="transfer">Transfert interne</option>
          </select>
        </Field>
        <Field label="Icône (emoji)"><input value={c.icon ?? ''} onChange={(e) => set({ icon: e.target.value })} maxLength={4} /></Field>
        <Field label="Couleur"><input type="color" value={c.color ?? 'var(--accent)'} onChange={(e) => set({ color: e.target.value })} style={{ height: 40 }} /></Field>
        <Field label="Budget mensuel par défaut"><MoneyInput value={c.monthlyBudget ?? 0} onChange={(monthlyBudget) => set({ monthlyBudget })} /></Field>
        <Field label="Mots-clés (séparés par des virgules)" hint="Servent à la catégorisation automatique">
          <input value={(c.keywords ?? []).join(', ')} onChange={(e) => set({ keywords: e.target.value.split(',').map((s) => s.trim()) })} />
        </Field>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" disabled={!c.name} onClick={() => onSave({ ...c, keywords: (c.keywords ?? []).filter(Boolean) })}>Enregistrer</button>
      </div>
    </Modal>
  );
}

/* --------------------------------- C. Épargne --------------------------------- */

const HORIZON = { short: 'Court terme', medium: 'Moyen terme', long: 'Long terme' };
const KIND = { security: '🛟 Fonds de sécurité', project: '🎯 Projet', investment: '📈 Investissement', other: '📦 Autre' };

export function SavingsSection() {
  const { state, today, call, toast } = useStore();
  const ownerLabel = useOwnerLabel();
  const writable = (o: string) => o === state.viewer.person || o === 'joint';
  const [edit, setEdit] = useState<Partial<Goal> | null>(null);
  const [fixed, setFixed] = useState(state.settings.monthlySavings);
  const [extra, setExtra] = useState(state.settings.extraSavings);
  const contributions = sum(state.goals.filter((g) => g.saved < g.target), (g) => g.monthlyContribution);

  return (
    <div className="stack">
      <Card title="Plan d'épargne mensuel" subtitle="Montant mis de côté chaque mois, déduit de ton reste à vivre">
        <div className="form-grid" style={{ maxWidth: 640 }}>
          <Field label="Épargne mensuelle fixe"><MoneyInput value={fixed} onChange={setFixed} /></Field>
          <Field label="Épargne supplémentaire ce mois"><MoneyInput value={extra} onChange={setExtra} /></Field>
        </div>
        <div className="row gap wrap" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={async () => { await call('/settings', { method: 'PUT', body: { monthlySavings: fixed, extraSavings: extra } }); toast('Plan d\'épargne enregistré.'); }}>Enregistrer</button>
          <span className="muted small">Total des contributions prévues sur tes objectifs : <strong>{eur(contributions)}</strong>{contributions !== fixed + extra && fixed + extra > 0 ? ' — différent de ton plan mensuel' : ''}</span>
        </div>
      </Card>
      <Card title="Objectifs" actions={<button className="btn btn-primary" onClick={() => setEdit({ owner: state.viewer.person, horizon: 'medium', kind: 'project' })}>+ Nouvel objectif</button>}>
        {state.goals.length === 0 ? <Empty icon="🎯" title="Aucun objectif">Fonds de sécurité, voyage, voiture, mobilier, investissement…</Empty> : (
          <div className="grid g2">
            {state.goals.map((g) => {
              const s = goalStatus(g, today);
              return (
                <div key={g.id} className="stat stack-s">
                  <div className="row between">
                    <div><strong>{g.name}</strong><div className="muted small">{KIND[g.kind]} · {HORIZON[g.horizon]} · {ownerLabel(g.owner)}</div></div>
                    {writable(g.owner) ? <button className="btn-icon" onClick={() => setEdit(g)} aria-label="Modifier">✏️</button> : <Badge>lecture seule</Badge>}
                  </div>
                  <div className="row between"><span className="stat-value" style={{ fontSize: 20 }}><Money cents={g.saved} /></span><span className="muted">sur {eur(g.target)}</span></div>
                  <Progress ratio={s.progress} color="var(--accent-2)" height={10} />
                  <div className="row between small wrap gap-s">
                    <span>{formatPct(s.progress)} · reste {eur(s.remaining)}</span>
                    <span className="muted">{eur(g.monthlyContribution)} / mois</span>
                  </div>
                  <div className="small">
                    {s.remaining === 0 ? <Badge tone="good">🎉 Objectif atteint</Badge>
                      : s.estimatedDate ? <>📅 Atteint vers <strong>{monthLabel(monthKey(s.estimatedDate))}</strong> <span className="muted">(estimation, {s.monthsToGo} mois)</span></>
                      : <span className="muted">Définis une contribution mensuelle pour estimer la date.</span>}
                  </div>
                  {g.targetDate && s.remaining > 0 && (
                    <div className="small">
                      {s.onTrack ? <Badge tone="good">Dans les temps pour le {dateLabel(g.targetDate)} {g.targetDate.slice(0, 4)}</Badge>
                        : <Badge tone="warn">Il faudrait {eur(s.requiredMonthly ?? 0)} / mois pour le {dateLabel(g.targetDate)} {g.targetDate.slice(0, 4)}</Badge>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <GoalModal value={edit} onClose={() => setEdit(null)} onSave={async (g) => { await call('/goals', { body: g }); setEdit(null); toast('Objectif enregistré.'); }}
        onDelete={async (id) => { if (confirm('Supprimer cet objectif ?')) { await call(`/goals/${id}`, { method: 'DELETE' }); setEdit(null); } }} />
    </div>
  );
}

function GoalModal({ value, onClose, onSave, onDelete }: { value: Partial<Goal> | null; onClose: () => void; onSave: (g: Partial<Goal>) => void; onDelete: (id: string) => void }) {
  const { state } = useStore();
  const [g, setG] = useState<Partial<Goal>>({});
  const [last, setLast] = useState<unknown>(null);
  if (value !== last) { setLast(value); setG(value ?? {}); }
  const set = (p: Partial<Goal>) => setG((x) => ({ ...x, ...p }));
  const linked = state.accounts.find((a) => a.id === g.accountId);
  return (
    <Modal open={!!value} onClose={onClose} title={g.id ? 'Modifier l\'objectif' : 'Nouvel objectif d\'épargne'}>
      <div className="form-grid">
        <Field label="Nom"><input value={g.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="Voyage, voiture…" autoFocus /></Field>
        <Field label="Type">
          <select value={g.kind} onChange={(e) => set({ kind: e.target.value as Goal['kind'] })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Montant cible"><MoneyInput value={g.target ?? 0} onChange={(target) => set({ target })} /></Field>
        <Field label="Déjà épargné" hint={linked ? `Solde du compte lié : ${eur(linked.balance)}` : undefined}><MoneyInput value={g.saved ?? 0} onChange={(saved) => set({ saved })} /></Field>
        <Field label="Contribution mensuelle prévue"><MoneyInput value={g.monthlyContribution ?? 0} onChange={(monthlyContribution) => set({ monthlyContribution })} /></Field>
        <Field label="Date objectif (optionnelle)"><input type="date" value={g.targetDate ?? ''} onChange={(e) => set({ targetDate: e.target.value || null })} /></Field>
        <Field label="Pour qui ?">
          <select value={g.owner} onChange={(e) => set({ owner: e.target.value as Goal['owner'] })}>
            <option value={state.viewer.person}>{state.viewer.name} (individuel)</option><option value="joint">Commun avec {state.partner.name}</option>
          </select>
        </Field>
        <Field label="Horizon">
          <select value={g.horizon} onChange={(e) => set({ horizon: e.target.value as Goal['horizon'] })}>{Object.entries(HORIZON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Compte / coffre lié (optionnel)">
          <select value={g.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value || null })}>
            <option value="">—</option>
            {state.accounts.filter((a) => a.type !== 'current' && (a.owner === state.viewer.person || a.owner === 'joint')).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        {linked && <Field label=" "><button className="btn btn-sm" onClick={() => set({ saved: linked.balance })}>Utiliser le solde du coffre</button></Field>}
      </div>
      <div className="form-actions">
        {g.id && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={() => onDelete(g.id!)}>Supprimer</button>}
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" disabled={!g.name || !g.target} onClick={() => onSave(g)}>Enregistrer</button>
      </div>
    </Modal>
  );
}
