import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { Badge, Card, Empty, eur, Money, ScopeToggle, Stat, Tabs } from '../components/ui';
import { FixedCharges, VariableBudgets } from './PlanMonth';
import { ResteAVivrePage } from './ResteAVivre';
import { chargesForMonth, historicalAverages, isRealIncome, plannedMonthlySavings, txInScope, variableBudgetLines } from '../../shared/analytics';
import { detectRecurring } from '../../shared/recurring';
import { addMonths, dateLabel, monthKey, monthLabel } from '../../shared/dates';
import { sum } from '../../shared/money';

type Tab = 'reste' | 'revenus' | 'fixes' | 'variables' | 'recurrents';
const FREQ_LABEL = { weekly: 'Hebdomadaire', monthly: 'Mensuel', quarterly: 'Trimestriel', yearly: 'Annuel' } as const;

export function BudgetPage() {
  const { state, today, scope } = useStore();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'reste';
  const [month, setMonth] = useState(monthKey(today));

  const charges = useMemo(() => chargesForMonth(state, month, today, scope), [state, month, today, scope]);
  const lines = useMemo(() => variableBudgetLines(state, month, today, scope), [state, month, today, scope]);
  const avg = useMemo(() => historicalAverages(state, today, 3, scope), [state, today, scope]);
  const fixedTotal = sum(charges.filter((c) => c.status !== 'skipped'), (c) => c.amount);
  const variableTotal = sum(lines, (l) => l.budget);
  const savings = plannedMonthlySavings(state, scope);
  const income = state.settings.expectedIncome || avg.income;
  const balance = income - fixedTotal - variableTotal - savings;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Budget</h1>
          <p className="muted">Prépare ton mois, suis tes enveloppes et sache à tout moment ce que tu peux dépenser.</p>
        </div>
        <ScopeToggle />
      </div>

      <Tabs<Tab> value={tab} onChange={(t) => setParams({ tab: t })} items={[
        { value: 'reste', label: 'Reste à vivre' },
        { value: 'revenus', label: 'Revenus' },
        { value: 'fixes', label: 'Charges fixes' },
        { value: 'variables', label: 'Dépenses variables' },
        { value: 'recurrents', label: 'Paiements récurrents' },
      ]} />

      {tab !== 'reste' && tab !== 'recurrents' && (
        <>
          <div className="row gap-s">
            <button className="btn" aria-label="Mois précédent" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
            <strong style={{ minWidth: 140, textAlign: 'center', textTransform: 'capitalize' }}>{monthLabel(month)}</strong>
            <button className="btn" aria-label="Mois suivant" onClick={() => setMonth(addMonths(month, 1))}>›</button>
            {month !== monthKey(today) && <button className="btn btn-sm btn-ghost" onClick={() => setMonth(monthKey(today))}>Aujourd'hui</button>}
          </div>
          <div className="grid g4">
            <Stat label="Revenus prévus" value={<Money cents={income} />} hint={state.settings.expectedIncome ? 'Défini dans les paramètres' : avg.monthsUsed ? `Moyenne des ${avg.monthsUsed} derniers mois` : 'À définir dans les paramètres'} />
            <Stat label="Charges fixes" value={<Money cents={fixedTotal} />} hint={`${charges.length} échéance(s)`} />
            <Stat label="Enveloppes variables" value={<Money cents={variableTotal} />} hint={`${lines.filter((l) => l.budget).length} catégories budgétées`} />
            <Stat label="Épargne programmée" value={<Money cents={savings} />} hint={!income ? 'Renseigne ton revenu pour équilibrer le plan' : balance >= 0 ? `Marge non affectée : ${eur(balance)}` : `Plan déficitaire de ${eur(-balance)}`} tone={!income ? undefined : balance >= 0 ? 'good' : 'danger'} />
          </div>
          {balance < 0 && income > 0 && <div className="banner danger">Ton plan du mois dépasse tes revenus prévus de <strong>{eur(-balance)}</strong>. Réduis une enveloppe ou ton épargne.</div>}
        </>
      )}

      {tab === 'reste' && <ResteAVivrePage embedded />}
      {tab === 'revenus' && <Incomes month={month} />}
      {tab === 'fixes' && <FixedCharges month={month} charges={charges} />}
      {tab === 'variables' && <VariableBudgets month={month} lines={lines} />}
      {tab === 'recurrents' && <RecurringPayments />}
    </div>
  );
}

function Incomes({ month }: { month: string }) {
  const { state, scope } = useStore();
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const incomes = txInScope(state, scope).filter((t) => t.date.startsWith(month) && isRealIncome(t, cats));
  const total = sum(incomes, (t) => t.amount);
  const expected = state.settings.expectedIncome + (scope === 'couple' && state.partner.sharesWithMe ? state.partner.expectedIncome ?? 0 : 0);
  return (
    <Card title={`Revenus de ${monthLabel(month)}`} subtitle="Salaires, remboursements et autres entrées réelles (les virements internes sont exclus)">
      <div className="row gap wrap" style={{ marginBottom: 12 }}>
        <Badge tone="good">Reçu : {eur(total)}</Badge>
        {expected > 0 && <Badge>Attendu : {eur(expected)}</Badge>}
        {expected > 0 && total < expected && <Badge tone="warn">Reste à percevoir : {eur(expected - total)}</Badge>}
      </div>
      {incomes.length ? incomes.map((t) => (
        <div key={t.id} className="list-item">
          <div className="cat-dot" style={{ background: 'var(--panel-2)' }}>{cats.get(t.categoryId ?? '')?.icon ?? '⬇️'}</div>
          <div className="grow"><div>{t.merchant || t.description}</div><div className="small muted">{dateLabel(t.date)} · {acc.get(t.accountId)?.name}</div></div>
          <Money cents={t.amount} sign />
        </div>
      )) : <Empty icon="💼" title="Aucun revenu enregistré ce mois-ci">Ton revenu attendu se règle dans Paramètres → Préférences.</Empty>}
    </Card>
  );
}

function RecurringPayments() {
  const { state, today, call, toast } = useStore();
  const list = useMemo(() => detectRecurring(state), [state]);
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const add = async (r: (typeof list)[number]) => {
    const a = acc.get(r.accountId);
    await call('/charges', { body: {
      name: r.label, amount: r.amount, dayOfMonth: Number(r.nextDate.slice(8, 10)), frequency: r.frequency, accountId: a && (a.owner === state.viewer.person || a.owner === 'joint') ? a.id : null,
      categoryId: r.categoryId, startMonth: monthKey(today), matchKeyword: r.key.split('|')[1], active: true,
    } });
    toast(`« ${r.label} » ajouté aux charges fixes.`);
  };
  return (
    <Card title="Paiements récurrents détectés" subtitle="Identifiés automatiquement : montant stable et intervalle régulier sur au moins 3 occurrences">
      {list.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Paiement</th><th>Fréquence</th><th>Occurrences</th><th>Prochain (estimé)</th><th className="right">Montant</th><th /></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.key}>
                  <td><strong>{r.label}</strong><div className="small muted">{acc.get(r.accountId)?.name}</div></td>
                  <td>{FREQ_LABEL[r.frequency]}</td>
                  <td>{r.occurrences}</td>
                  <td>{dateLabel(r.nextDate)}</td>
                  <td className="right"><Money cents={r.amount} /></td>
                  <td className="right">{r.tracked ? <Badge tone="good">Suivi en charge fixe</Badge> : <button className="btn btn-sm" onClick={() => add(r)}>+ Charge fixe</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon="🔁" title="Aucun paiement récurrent détecté">Il faut au moins trois mois d'historique pour les repérer.</Empty>}
    </Card>
  );
}
