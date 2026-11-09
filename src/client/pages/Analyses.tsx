import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '../store';
import { api } from '../api';
import { Badge, Card, chartTheme, Empty, eur, kEur, Money, ScopeToggle, Stat, Tabs, useOwnerLabel } from '../components/ui';
import { Monthly, Trends, Weekly } from './Tracking';
import { Advisor } from './Advisor';
import { accountBalanceAt, accountsInScope, chargesForMonth, counts, yearSummary } from '../../shared/analytics';
import { addMonths, dateInMonth, dateLabel, monthKey, monthLabel } from '../../shared/dates';
import { formatPct } from '../../shared/money';
import type { AuditEntry, Transaction } from '../../shared/types';

type Tab = 'hebdo' | 'mensuel' | 'annuel' | 'tendances' | 'compta' | 'conseiller';

export function Analyses() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'mensuel';
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Analyses</h1><p className="muted">Bilans, tendances, comptabilité personnelle et conseils.</p></div>
        <ScopeToggle />
      </div>
      <Tabs<Tab> value={tab} onChange={(t) => setParams({ tab: t })} items={[
        { value: 'hebdo', label: 'Hebdomadaire' }, { value: 'mensuel', label: 'Bilan mensuel' }, { value: 'annuel', label: 'Bilan annuel' },
        { value: 'tendances', label: 'Tendances' }, { value: 'compta', label: 'Comptabilité' }, { value: 'conseiller', label: 'Conseiller' },
      ]} />
      {tab === 'hebdo' && <Weekly />}
      {tab === 'mensuel' && <Monthly />}
      {tab === 'annuel' && <Annual />}
      {tab === 'tendances' && <Trends />}
      {tab === 'compta' && <Accounting />}
      {tab === 'conseiller' && <Advisor embedded />}
    </div>
  );
}

function Annual() {
  const { state, today, scope } = useStore();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const y = useMemo(() => yearSummary(state, year, today, scope), [state, year, today, scope]);
  const firstYear = Number((state.transactions[state.transactions.length - 1]?.date ?? today).slice(0, 4));
  return (
    <>
      <div className="row gap-s">
        <button className="btn" disabled={year <= firstYear} onClick={() => setYear(year - 1)} aria-label="Année précédente">‹</button>
        <strong style={{ minWidth: 80, textAlign: 'center' }}>{year}</strong>
        <button className="btn" disabled={year >= Number(today.slice(0, 4))} onClick={() => setYear(year + 1)} aria-label="Année suivante">›</button>
        <span className="grow" />
        <button className="btn btn-sm no-print" onClick={() => window.print()}>⬇︎ Exporter en PDF</button>
      </div>
      <div className="print-only"><h2>Ange's MNY — Bilan annuel {year}</h2><p>{state.viewer.name} · édité le {new Date().toLocaleDateString('fr-FR')}</p></div>
      <div className="grid g4">
        <Stat label="Revenus de l'année" value={<Money cents={y.income} />} tone="good" />
        <Stat label="Dépenses de l'année" value={<Money cents={y.expenses} />} hint={`dont charges fixes ${eur(y.fixed, false)}`} />
        <Stat label="Épargne réalisée" value={<Money cents={y.savings} />} hint={`Taux d'épargne : ${formatPct(y.savingsRate, 1)}`} tone="accent" />
        <Stat label="Évolution du patrimoine" value={<Money cents={y.wealthEnd - y.wealthStart} sign />} hint={`${eur(y.wealthStart, false)} → ${eur(y.wealthEnd, false)}`} />
      </div>
      <div className="grid g3">
        <Card title="Mois par mois" className="span2">
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={y.months.map((m) => ({ m: monthLabel(m.month, true), revenus: m.income, dépenses: m.expenses, épargne: m.savings }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="m" tick={chartTheme.axis} /><YAxis tickFormatter={kEur} tick={chartTheme.axis} width={60} />
                <Tooltip {...chartTheme.tooltip} formatter={(v) => eur(Number(v))} /><Legend />
                <Bar dataKey="revenus" fill="var(--good)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="dépenses" fill="var(--muted)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="épargne" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Postes de dépenses de l'année">
          {y.topCategories.slice(0, 10).map((c) => (
            <div key={c.category.id} className="row between small" style={{ padding: '6px 0' }}><span>{c.category.icon} {c.category.name}</span><Money cents={c.amount} decimals={false} /></div>
          ))}
          {!y.topCategories.length && <p className="muted small">Aucune dépense.</p>}
        </Card>
      </div>
      <Card title="Tableau récapitulatif">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Mois</th><th className="right">Revenus</th><th className="right">Charges fixes</th><th className="right">Variables</th><th className="right">Épargne</th><th className="right">Solde</th><th className="right">Taux d'épargne</th></tr></thead>
            <tbody>
              {y.months.map((m) => (
                <tr key={m.month}><td style={{ textTransform: 'capitalize' }}>{monthLabel(m.month)}</td><td className="right"><Money cents={m.income} /></td><td className="right"><Money cents={m.fixed} /></td><td className="right"><Money cents={m.variable} /></td><td className="right"><Money cents={m.savings} /></td><td className="right"><Money cents={m.net} sign /></td><td className="right">{formatPct(m.savingsRate)}</td></tr>
              ))}
              <tr><td><strong>Total</strong></td><td className="right"><strong><Money cents={y.income} /></strong></td><td className="right"><strong><Money cents={y.fixed} /></strong></td><td className="right"><strong><Money cents={y.variable} /></strong></td><td className="right"><strong><Money cents={y.savings} /></strong></td><td className="right"><strong><Money cents={y.net} sign /></strong></td><td className="right"><strong>{formatPct(y.savingsRate)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

type Sub = 'journal' | 'registre' | 'soldes' | 'archives' | 'modifs';

function statusOf(t: Transaction): { label: string; tone: 'good' | 'warn' | 'neutral' | 'danger' } {
  if (t.cancelled) return { label: 'Annulée', tone: 'danger' };
  if (t.excluded) return { label: 'Exclue', tone: 'neutral' };
  if (t.pending) return { label: 'En attente', tone: 'warn' };
  return { label: 'Réalisée', tone: 'good' };
}

function Accounting() {
  const { state, today, scope, call } = useStore();
  const ownerLabel = useOwnerLabel();
  const [sub, setSub] = useState<Sub>('journal');
  const [month, setMonth] = useState(monthKey(today));
  const [accountId, setAccountId] = useState('');
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const accounts = accountsInScope(state, scope);
  const accMap = new Map(state.accounts.map((a) => [a.id, a]));
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  useEffect(() => { if (sub === 'modifs' && !audit) api<AuditEntry[]>('/audit').then(setAudit).catch(() => setAudit([])); }, [sub, audit]);

  const journal = useMemo(() => {
    const ids = new Set(accounts.map((a) => a.id));
    const realised = state.transactions.filter((t) => ids.has(t.accountId) && t.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
    const planned = chargesForMonth(state, month, today, scope).filter((c) => c.status === 'pending');
    return { realised, planned };
  }, [state, accounts, month, today, scope]);
  const registre = useMemo(() => {
    const a = accMap.get(accountId) ?? accounts[0];
    if (!a) return null;
    const list = state.transactions.filter((t) => t.accountId === a.id && t.date.startsWith(month) && !t.cancelled && !t.pending).sort((x, y) => x.date.localeCompare(y.date));
    let bal = accountBalanceAt(state, a, dateInMonth(addMonths(month, -1), 31));
    const opening = bal;
    const rows = list.map((t) => { bal += t.amount; return { t, bal }; });
    return { account: a, opening, rows, closing: bal };
  }, [state, accountId, accounts, accMap, month]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(monthKey(today), -11 + i)), [today]);
  const totalIn = journal.realised.filter((t) => counts(t) && t.amount > 0 && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
  const totalOut = -journal.realised.filter((t) => counts(t) && t.amount < 0 && !t.isTransfer).reduce((s, t) => s + t.amount, 0);

  const monthNav = (
    <div className="row gap-s">
      <button className="btn btn-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mois précédent">‹</button>
      <strong style={{ minWidth: 130, textAlign: 'center', textTransform: 'capitalize' }}>{monthLabel(month)}</strong>
      <button className="btn btn-sm" disabled={month >= monthKey(today)} onClick={() => setMonth(addMonths(month, 1))} aria-label="Mois suivant">›</button>
    </div>
  );

  return (
    <>
      <Tabs<Sub> value={sub} onChange={setSub} items={[
        { value: 'journal', label: 'Journal recettes / dépenses' }, { value: 'registre', label: 'Registre des mouvements' },
        { value: 'soldes', label: 'Historique des soldes' }, { value: 'archives', label: 'Archives' }, { value: 'modifs', label: 'Corrections & sécurité' },
      ]} />

      {sub === 'journal' && (
        <Card title="Journal des recettes et dépenses" actions={<>{monthNav}<button className="btn btn-sm no-print" onClick={() => window.print()}>PDF</button><a className="btn btn-sm no-print" href="/api/export/transactions.csv">CSV</a></>}>
          <div className="row gap wrap small" style={{ marginBottom: 10 }}>
            <Badge tone="good">Recettes : {eur(totalIn)}</Badge><Badge tone="danger">Dépenses : {eur(totalOut)}</Badge><Badge>Solde : {eur(totalIn - totalOut)}</Badge>
            <Badge tone="warn">Prévues non réglées : {eur(journal.planned.reduce((s, c) => s + c.amount, 0))}</Badge>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Libellé</th><th>Personne</th><th>Catégorie</th><th>Statut</th><th className="right">Recette</th><th className="right">Dépense</th></tr></thead>
              <tbody>
                {journal.realised.map((t) => {
                  const st = statusOf(t);
                  const a = accMap.get(t.accountId);
                  return (
                    <tr key={t.id} style={{ opacity: counts(t) && !t.isTransfer ? 1 : 0.55 }}>
                      <td>{dateLabel(t.date)}</td><td>{t.merchant || t.description}{t.isTransfer && <span className="small muted"> · transfert interne</span>}</td>
                      <td className="small">{a ? ownerLabel(a.owner) : ''}</td><td className="small">{cats.get(t.categoryId ?? '')?.name ?? '—'}</td>
                      <td><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td className="right">{t.amount > 0 ? <Money cents={t.amount} /> : ''}</td><td className="right">{t.amount < 0 ? <Money cents={-t.amount} /> : ''}</td>
                    </tr>
                  );
                })}
                {journal.planned.map((c) => (
                  <tr key={c.charge.id + c.dueDate} style={{ opacity: 0.75 }}>
                    <td>{dateLabel(c.dueDate)}</td><td>{c.charge.name}</td><td className="small">{ownerLabel(c.charge.owner)}</td><td className="small">{cats.get(c.charge.categoryId ?? '')?.name ?? '—'}</td>
                    <td><Badge tone="info">Prévue</Badge></td><td /><td className="right"><Money cents={c.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!journal.realised.length && !journal.planned.length && <Empty icon="📒" title="Aucune écriture ce mois-ci" />}
          </div>
        </Card>
      )}

      {sub === 'registre' && registre && (
        <Card title="Registre des mouvements bancaires" subtitle="Opérations réalisées, avec solde après chaque mouvement"
          actions={<>{monthNav}<select value={registre.account.id} onChange={(e) => setAccountId(e.target.value)} style={{ width: 220 }}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></>}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Libellé</th><th className="right">Débit</th><th className="right">Crédit</th><th className="right">Solde</th></tr></thead>
              <tbody>
                <tr><td colSpan={4} className="muted">Solde d'ouverture</td><td className="right"><Money cents={registre.opening} /></td></tr>
                {registre.rows.map(({ t, bal }) => (
                  <tr key={t.id}><td>{dateLabel(t.date)}</td><td>{t.description}</td><td className="right">{t.amount < 0 ? <Money cents={-t.amount} /> : ''}</td><td className="right">{t.amount > 0 ? <Money cents={t.amount} /> : ''}</td><td className="right"><Money cents={bal} /></td></tr>
                ))}
                <tr><td colSpan={4}><strong>Solde de clôture</strong></td><td className="right"><strong><Money cents={registre.closing} /></strong></td></tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {sub === 'soldes' && (
        <Card title="Historique des soldes" subtitle="Solde de fin de mois de chaque compte (reconstitué à partir des opérations et des relevés)">
          <div className="table-wrap">
            <table className="table small">
              <thead><tr><th>Compte</th>{months.map((m) => <th key={m} className="right">{monthLabel(m, true)}</th>)}</tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}><td><strong>{a.name}</strong><div className="muted">{ownerLabel(a.owner)}</div></td>{months.map((m) => <td key={m} className="right"><Money cents={accountBalanceAt(state, a, m === monthKey(today) ? today : dateInMonth(m, 31))} decimals={false} /></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {sub === 'archives' && (
        <Card title="Mois archivés" subtitle="Bilans figés au moment de la clôture. Les opérations restent toujours conservées et consultables.">
          {state.archives.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Mois</th><th className="right">Revenus</th><th className="right">Dépenses</th><th className="right">Épargne</th><th className="right">Solde</th><th>Clôturé le</th><th /></tr></thead>
                <tbody>
                  {state.archives.map((a) => {
                    const s = a.summary as Record<string, number>;
                    return (
                      <tr key={a.month}>
                        <td style={{ textTransform: 'capitalize' }}>{monthLabel(a.month)}</td><td className="right"><Money cents={s.income ?? 0} /></td><td className="right"><Money cents={(s.fixed ?? 0) + (s.variable ?? 0)} /></td>
                        <td className="right"><Money cents={s.savings ?? 0} /></td><td className="right"><Money cents={s.net ?? 0} sign /></td><td className="small muted">{new Date(a.closedAt).toLocaleDateString('fr-FR')}</td>
                        <td className="right"><button className="btn btn-sm btn-ghost" onClick={() => confirm('Rouvrir ce mois ? Le bilan figé sera supprimé (les opérations ne sont pas touchées).') && call(`/archives/${a.month}`, { method: 'DELETE' })}>Rouvrir</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty icon="🗄" title="Aucun mois archivé">Archive un mois terminé depuis l'onglet « Bilan mensuel ».</Empty>}
        </Card>
      )}

      {sub === 'modifs' && (
        <Card title="Journal des corrections et événements sensibles" subtitle="Connexions, modifications d'opérations, partage, exports… (les 200 derniers événements de ton compte)">
          {state.demo ? <p className="muted">Le journal n'est pas tenu en mode démo.</p> : !audit ? <p className="muted">Chargement…</p> : audit.length ? (
            <div className="table-wrap">
              <table className="table small">
                <thead><tr><th>Date</th><th>Événement</th><th>Détails</th></tr></thead>
                <tbody>{audit.map((e) => <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{new Date(e.at).toLocaleString('fr-FR')}</td><td>{e.action.replace(/_/g, ' ')}</td><td className="muted" style={{ maxWidth: 520, wordBreak: 'break-word' }}>{e.details}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="muted">Aucun événement.</p>}
        </Card>
      )}
    </>
  );
}
