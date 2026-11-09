import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '../store';
import { Card, chartTheme, eur, kEur, Money, Stat, useOwnerLabel } from '../components/ui';
import { SavingsSection } from './PlanMonth';
import { accountsInScope, savingsBetween, wealthSeries } from '../../shared/analytics';
import { addMonths, monthKey, monthLabel } from '../../shared/dates';
import { sum } from '../../shared/money';

const SAVINGS_TYPES = ['savings', 'vault', 'investment'];

export function SavingsPage() {
  const { state, today } = useStore();
  const ownerLabel = useOwnerLabel();
  const data = useMemo(() => {
    const accounts = accountsInScope(state, 'couple').filter((a) => SAVINGS_TYPES.includes(a.type));
    const byOwner = (o: string) => sum(accounts.filter((a) => a.owner === o), (a) => a.balance);
    const series = wealthSeries(state, 12, today, 'couple').map((w) => ({ m: monthLabel(w.month, true), épargne: w.savings }));
    const month = monthKey(today);
    const last3 = [1, 2, 3].map((i) => savingsBetween(state, `${addMonths(month, -i)}-01`, `${addMonths(month, -i)}-31`, 'me'));
    return { accounts, mine: byOwner(state.viewer.person), joint: byOwner('joint'), partner: byOwner(state.partner.person), series, avg3: Math.round(sum(last3, (x) => x) / 3), thisMonth: savingsBetween(state, `${month}-01`, today, 'me') };
  }, [state, today]);

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Épargne</h1><p className="muted">Épargne individuelle et commune, objectifs et progression.</p></div>
      </div>
      <div className="grid g4">
        <Stat label={`Épargne de ${state.viewer.name}`} value={<Money cents={data.mine} />} />
        <Stat label="Épargne commune" value={<Money cents={data.joint} />} />
        <Stat label={`Épargne de ${state.partner.name}`} value={state.partner.sharesWithMe ? <Money cents={data.partner} /> : '—'} hint={state.partner.sharesWithMe ? undefined : 'Non partagée'} />
        <Stat label="Épargné ce mois (moi + commun)" value={<Money cents={data.thisMonth} />} hint={`Moyenne des 3 derniers mois : ${eur(data.avg3)}`} tone="accent" />
      </div>
      <div className="grid g3">
        <Card title="Évolution de l'épargne" subtitle="12 derniers mois — soldes des comptes d'épargne, coffres et investissements" className="span2">
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={data.series}>
                <defs><linearGradient id="gs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity={0.45} /><stop offset="1" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="m" tick={chartTheme.axis} /><YAxis tickFormatter={kEur} tick={chartTheme.axis} width={60} />
                <Tooltip {...chartTheme.tooltip} formatter={(v) => eur(Number(v))} />
                <Area dataKey="épargne" stroke="var(--accent)" strokeWidth={2} fill="url(#gs)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Comptes d'épargne">
          {data.accounts.map((a) => (
            <div key={a.id} className="list-item">
              <div className="grow"><div>{a.name}</div><div className="small muted">{ownerLabel(a.owner)}</div></div>
              <Money cents={a.balance} />
            </div>
          ))}
          {!data.accounts.length && <p className="muted small">Aucun compte d'épargne ou coffre. Ajoute-les dans Paramètres → Comptes.</p>}
        </Card>
      </div>
      <SavingsSection />
    </div>
  );
}
