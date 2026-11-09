import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '../store';
import { Card, chartTheme, Empty, eur, kEur, Money, Progress } from '../components/ui';
import { coupleMonth, declaredIncomes } from '../../shared/couple';
import { goalStatus } from '../../shared/analytics';
import { addMonths, monthKey, monthLabel } from '../../shared/dates';
import { formatPct, sum } from '../../shared/money';
import type { CoupleSettings, SplitMode } from '../../shared/types';

const MODES: { value: SplitMode; label: string; help: string }[] = [
  { value: 'equal', label: '50 / 50', help: 'Chacun paie la moitié des dépenses communes.' },
  { value: 'income', label: 'Au prorata', help: 'Chacun contribue en proportion de son revenu déclaré.' },
  { value: 'manual', label: 'Manuelle', help: 'Vous fixez ensemble un pourcentage.' },
  { value: 'category', label: 'Par catégorie', help: 'Un pourcentage différent par type de dépense.' },
];

export function CouplePage() {
  const { state, today, call, toast } = useStore();
  const [month, setMonth] = useState(monthKey(today));
  const c = useMemo(() => coupleMonth(state, month), [state, month]);
  const history = useMemo(() => [5, 4, 3, 2, 1, 0].map((i) => coupleMonth(state, addMonths(monthKey(today), -i))), [state, today]);
  const me = state.viewer.person as 'ange' | 'kelly';
  const other = (me === 'ange' ? 'kelly' : 'ange') as 'ange' | 'kelly';
  const name = (p: string) => (p === me ? state.viewer.name : state.partner.name);
  const shareOf = (p: 'ange' | 'kelly', shareAnge: number) => (p === 'ange' ? shareAnge : 1 - shareAnge);
  const [draft, setDraft] = useState<CoupleSettings>(state.couple);
  const [lastCouple, setLastCouple] = useState(state.couple);
  if (lastCouple !== state.couple) { setLastCouple(state.couple); setDraft(state.couple); }
  const incomes = declaredIncomes(state);
  const commonCats = state.categories.filter((k) => (k.kind === 'variable' || k.kind === 'fixed') && !k.archived);
  const jointGoals = state.goals.filter((g) => g.owner === 'joint');
  const settlementAbs = Math.abs(c.settlement);
  // settlement > 0 : Kelly doit à Ange
  const debtor = c.settlement > 0 ? 'kelly' : 'ange';
  const creditor = c.settlement > 0 ? 'ange' : 'kelly';

  const save = async (next: CoupleSettings) => {
    setDraft(next);
    await call('/couple', { method: 'PUT', body: next });
    toast('Répartition enregistrée — elle s\'applique à vous deux.');
  };

  const person = (p: 'ange' | 'kelly') => {
    const d = c.people[p];
    return (
      <Card title={name(p)} subtitle={p === me ? 'Mes finances personnelles' : d.visible ? `Partagé par ${name(p)}` : 'Non partagé'}>
        {d.visible ? (
          <div className="stack-s">
            <div className="row between"><span className="muted">Revenus</span><Money cents={d.income} /></div>
            <div className="row between"><span className="muted">Dépenses personnelles</span><Money cents={d.personalExpenses} /></div>
            <div className="row between"><span className="muted">Dépenses communes payées</span><Money cents={d.sharedPaid} /></div>
            <div className="row between"><span className="muted">Virements vers le commun</span><Money cents={d.contributions} /></div>
            <div className="row between"><span className="muted">Épargne individuelle</span><Money cents={d.savings} /></div>
          </div>
        ) : (
          <Empty icon="🔒" title={`${name(p)} n'a pas partagé ses comptes`}>
            {state.partner.exists ? `Seul(e) ${name(p)} peut activer le partage, depuis son propre accès.` : <>Invite {name(p)} depuis <Link to="/parametres?tab=profil">Paramètres → Profil</Link>.</>}
          </Empty>
        )}
      </Card>
    );
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Couple</h1><p className="muted">Qui dépense quoi, sur quel compte, et comment vous partagez les dépenses communes.</p></div>
        <div className="row gap-s">
          <button className="btn" aria-label="Mois précédent" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
          <strong style={{ minWidth: 140, textAlign: 'center', textTransform: 'capitalize' }}>{monthLabel(month)}</strong>
          <button className="btn" aria-label="Mois suivant" disabled={month >= monthKey(today)} onClick={() => setMonth(addMonths(month, 1))}>›</button>
        </div>
      </div>

      {!state.partner.sharesWithMe && (
        <div className="banner info small">
          <span>🔒</span>
          <div>
            Les comptes personnels de {state.partner.name} ne sont visibles qu'avec son accord explicite.
            Les calculs ci-dessous utilisent les comptes communs, tes comptes et les virements visibles de ton côté.
            {!state.partner.exists && <> <Link to="/parametres?tab=profil">Inviter {state.partner.name}</Link>.</>}
          </div>
        </div>
      )}

      <div className="grid g3">
        {person(me)}
        {person(other)}
        <Card title="Commun" subtitle="Comptes et projets communs">
          <div className="stack-s">
            <div className="row between"><span className="muted">Solde des comptes communs</span><Money cents={c.joint.balance} /></div>
            <div className="row between"><span className="muted">Dépenses communes du mois</span><strong><Money cents={c.commonExpenses} /></strong></div>
            <div className="row between"><span className="muted">dont payées depuis le commun</span><Money cents={c.joint.expenses} /></div>
            <div className="row between"><span className="muted">Épargne commune du mois</span><Money cents={c.joint.savings} /></div>
            {c.unattributedContributions > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{eur(c.unattributedContributions)} de virements entrants non attribués à l'un de vous.</div>}
          </div>
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Qui doit combien ?" subtitle="Ce que chacun a payé par rapport à sa part, remboursements déduits">
          <div className="center" style={{ padding: '8px 0 16px' }}>
            {settlementAbs < 100 ? (
              <><div className="hero-value" style={{ fontSize: 28 }}>Vous êtes à l'équilibre ✓</div><p className="muted small">Écart inférieur à 1 €.</p></>
            ) : (
              <><div className="muted small">{name(debtor)} doit à {name(creditor)}</div><div className="hero-value" style={{ fontSize: 34 }}><Money cents={settlementAbs} /></div></>
            )}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th /><th className="right">{name('ange')}</th><th className="right">{name('kelly')}</th></tr></thead>
              <tbody>
                <tr><td>Part des dépenses communes</td><td className="right">{formatPct(shareOf('ange', c.shareAnge))}</td><td className="right">{formatPct(shareOf('kelly', c.shareAnge))}</td></tr>
                <tr><td>Montant dû</td><td className="right"><Money cents={c.due.ange} /></td><td className="right"><Money cents={c.due.kelly} /></td></tr>
                <tr><td>Contributions au commun</td><td className="right"><Money cents={c.people.ange.contributions} /></td><td className="right"><Money cents={c.people.kelly.contributions} /></td></tr>
                <tr><td>Dépenses communes payées perso</td><td className="right"><Money cents={c.people.ange.sharedPaid} /></td><td className="right"><Money cents={c.people.kelly.sharedPaid} /></td></tr>
                <tr><td><strong>Total payé</strong></td><td className="right"><strong><Money cents={c.paid.ange} /></strong></td><td className="right"><strong><Money cents={c.paid.kelly} /></strong></td></tr>
                <tr><td>Remboursements versés</td><td className="right"><Money cents={c.reimbursements.angeToKelly} /></td><td className="right"><Money cents={c.reimbursements.kellyToAnge} /></td></tr>
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Pour enregistrer un remboursement, classe le virement entre vous dans la catégorie « Remboursement entre nous ».
            Pour une dépense commune payée avec une carte perso, coche « Dépense commune » dans Transactions.
            Ces virements ne sont jamais comptés comme dépenses ou revenus.
          </p>
        </Card>

        <Card title="Répartition des dépenses communes" subtitle="Paramètre partagé : il s'applique à vous deux">
          <div className="segmented" role="radiogroup">
            {MODES.map((m) => <button key={m.value} role="radio" aria-checked={draft.splitMode === m.value} className={draft.splitMode === m.value ? 'active' : ''} onClick={() => save({ ...draft, splitMode: m.value })}>{m.label}</button>)}
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>{MODES.find((m) => m.value === draft.splitMode)?.help}</p>
          {draft.splitMode === 'income' && (
            incomes ? (
              <div className="small" style={{ marginTop: 10 }}>
                Revenus déclarés : {name('ange')} {eur(incomes.ange)} · {name('kelly')} {eur(incomes.kelly)} → <strong>{formatPct(incomes.ange / (incomes.ange + incomes.kelly))} / {formatPct(incomes.kelly / (incomes.ange + incomes.kelly))}</strong>
              </div>
            ) : <div className="banner warn small" style={{ marginTop: 10 }}>Il faut que vous ayez tous les deux renseigné votre revenu (Paramètres → Préférences) et que {state.partner.name} partage ses données. En attendant, 50/50 s'applique.</div>
          )}
          {draft.splitMode === 'manual' && (
            <div className="stack-s" style={{ marginTop: 12 }}>
              <div className="row between small"><span>{name('ange')} : <strong>{Math.round(draft.manualShare * 100)} %</strong></span><span>{name('kelly')} : <strong>{100 - Math.round(draft.manualShare * 100)} %</strong></span></div>
              <input type="range" min={0} max={100} value={Math.round(draft.manualShare * 100)} onChange={(e) => setDraft({ ...draft, manualShare: Number(e.target.value) / 100 })} onMouseUp={() => save(draft)} onTouchEnd={() => save(draft)} onKeyUp={() => save(draft)} aria-label={`Part de ${name('ange')}`} />
            </div>
          )}
          {draft.splitMode === 'category' && (
            <div style={{ marginTop: 12, maxHeight: 340, overflowY: 'auto' }}>
              {commonCats.map((k) => {
                const v = Math.round((draft.categoryShares[k.id] ?? 0.5) * 100);
                return (
                  <div key={k.id} className="budget-line">
                    <div className="row between small"><span>{k.icon} {k.name}</span><span>{name('ange')} {v} % · {name('kelly')} {100 - v} %</span></div>
                    <input type="range" min={0} max={100} step={5} value={v} aria-label={`Part de ${name('ange')} pour ${k.name}`}
                      onChange={(e) => setDraft({ ...draft, categoryShares: { ...draft.categoryShares, [k.id]: Number(e.target.value) / 100 } })}
                      onMouseUp={() => save(draft)} onTouchEnd={() => save(draft)} onKeyUp={() => save(draft)} />
                  </div>
                );
              })}
            </div>
          )}
          {c.splitNote && <div className="banner warn small" style={{ marginTop: 10 }}>{c.splitNote}</div>}
          <div className="divider" />
          <h3 style={{ marginBottom: 8 }}>Dépenses communes par catégorie</h3>
          {c.commonByCategory.length ? c.commonByCategory.map((x) => (
            <div key={x.category?.id ?? 'none'} className="budget-line">
              <div className="row between small" style={{ marginBottom: 6 }}><span>{x.category?.icon ?? '❔'} {x.category?.name ?? 'Non catégorisé'}</span><Money cents={x.amount} /></div>
              <div className="split-bar" title={`${name('ange')} ${Math.round(x.shareAnge * 100)} %`}>
                <div style={{ width: `${x.shareAnge * 100}%`, background: 'var(--accent)' }} />
                <div style={{ width: `${(1 - x.shareAnge) * 100}%`, background: 'var(--muted)' }} />
              </div>
            </div>
          )) : <p className="muted small">Aucune dépense commune ce mois-ci.</p>}
          <div className="row gap small" style={{ marginTop: 8 }}><span><span className="status-dot" style={{ background: 'var(--accent)' }} />{name('ange')}</span><span><span className="status-dot" style={{ background: 'var(--muted)' }} />{name('kelly')}</span></div>
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Contributions sur 6 mois" subtitle="Payé par chacun (virements au commun + dépenses communes payées perso)">
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={history.map((h) => ({ m: monthLabel(h.month, true), [name('ange')]: h.paid.ange, [name('kelly')]: h.paid.kelly, 'Dépenses communes': h.commonExpenses }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="m" tick={chartTheme.axis} /><YAxis tickFormatter={kEur} tick={chartTheme.axis} width={60} />
                <Tooltip {...chartTheme.tooltip} formatter={(v) => eur(Number(v))} /><Legend />
                <Bar dataKey={name('ange')} fill="var(--accent)" radius={[4, 4, 0, 0]} />
                <Bar dataKey={name('kelly')} fill="var(--muted)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Dépenses communes" fill="color-mix(in srgb, var(--text) 25%, transparent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Projets communs" actions={<Link className="btn btn-sm" to="/epargne">Gérer</Link>}>
          {jointGoals.length ? jointGoals.map((g) => {
            const s = goalStatus(g, today);
            return (
              <div key={g.id} className="budget-line">
                <div className="row between small" style={{ marginBottom: 6 }}><strong>{g.name}</strong><span><Money cents={g.saved} decimals={false} /> / {eur(g.target, false)}</span></div>
                <Progress ratio={s.progress} color="var(--accent)" />
                <div className="small muted" style={{ marginTop: 4 }}>{s.estimatedDate ? `Atteint vers ${monthLabel(monthKey(s.estimatedDate))} (estimation)` : 'Définis une contribution mensuelle'}</div>
              </div>
            );
          }) : <Empty icon="🎯" title="Aucun objectif commun">Voyage, mobilier, fonds de sécurité commun…</Empty>}
          <div className="divider" />
          <div className="row between small"><span className="muted">Total épargné pour vos projets communs</span><strong><Money cents={sum(jointGoals, (g) => g.saved)} /></strong></div>
        </Card>
      </div>
    </div>
  );
}
