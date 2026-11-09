import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { useStore } from '../store';
import { Badge, Card, chartTheme, eur, Field, kEur, Money, MoneyInput, ScopeToggle } from '../components/ui';
import { accountsInScope, goalStatus, historicalAverages, ownersInScope } from '../../shared/analytics';
import { compareScenarios, monthReaching, MILESTONES, type ExceptionalExpense, type ProjectionParams } from '../../shared/projections';
import { monthKey, monthLabel } from '../../shared/dates';
import { sum } from '../../shared/money';

const COLORS = { prudent: '#f59e0b', equilibre: '#7c5cff', optimiste: '#22c55e' };
const MILESTONE_LABEL: Record<number, string> = { 3: '3 mois', 6: '6 mois', 12: '1 an', 36: '3 ans', 60: '5 ans' };

export function Projections() {
  const { state, today, scope } = useStore();
  const base = useMemo(() => {
    const accounts = accountsInScope(state, scope);
    const avg = historicalAverages(state, today, 3, scope);
    return {
      avg,
      params: {
        startAvailable: sum(accounts.filter((a) => a.includeInAvailable), (a) => a.balance),
        startSavings: sum(accounts.filter((a) => !a.includeInAvailable), (a) => a.balance),
        monthlyIncome: avg.income,
        monthlyFixed: avg.fixed,
        monthlyVariable: avg.variable,
        monthlySavings: avg.savings,
        savingsYield: 0.025,
        inflation: 0.02,
        incomeGrowth: 0.015,
        exceptional: [] as ExceptionalExpense[],
        horizonMonths: 60,
      } satisfies ProjectionParams,
    };
  }, [state, today, scope]);
  const [p, setP] = useState<ProjectionParams>(base.params);
  const [lastBase, setLastBase] = useState(base);
  if (lastBase !== base) { setLastBase(base); setP({ ...base.params, exceptional: p.exceptional }); }
  const set = (patch: Partial<ProjectionParams>) => setP((x) => ({ ...x, ...patch }));

  const start = monthKey(today);
  const results = useMemo(() => compareScenarios(p, start), [p, start]);
  const chart = results[0].points.map((pt, i) => ({
    m: monthLabel(pt.month, true),
    Prudent: results[0].points[i].total,
    Équilibré: results[1].points[i].total,
    Optimiste: results[2].points[i].total,
  }));
  const owners = ownersInScope(scope);
  const goals = state.goals.filter((g) => owners.includes(g.owner) && g.saved < g.target);
  const [ex, setEx] = useState<{ label: string; amount: number; monthOffset: number }>({ label: '', amount: 0, monthOffset: 6 });

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Projections financières</h1><p className="muted">Simule ta situation à 3 mois, 6 mois, 1 an, 3 ans et 5 ans. Ce sont des estimations fondées sur des hypothèses, pas des certitudes.</p></div>
        <ScopeToggle />
      </div>

      <div className="grid g3">
        <Card title="Hypothèses (par mois)" subtitle={base.avg.monthsUsed ? `Pré-remplies avec ta moyenne des ${base.avg.monthsUsed} derniers mois` : 'Pré-remplies avec ton budget prévisionnel'}
          actions={<button className="btn btn-sm" onClick={() => setP(base.params)}>Réinitialiser</button>}>
          <div className="stack-s">
            <Field label="Revenus mensuels"><MoneyInput value={p.monthlyIncome} onChange={(v) => set({ monthlyIncome: v })} /></Field>
            <Field label="Charges fixes mensuelles"><MoneyInput value={p.monthlyFixed} onChange={(v) => set({ monthlyFixed: v })} /></Field>
            <Field label="Dépenses variables mensuelles"><MoneyInput value={p.monthlyVariable} onChange={(v) => set({ monthlyVariable: v })} /></Field>
            <Field label="Épargne mensuelle"><MoneyInput value={p.monthlySavings} onChange={(v) => set({ monthlySavings: v })} /></Field>
            <div className="form-grid">
              <Field label={`Rendement épargne : ${(p.savingsYield * 100).toFixed(1)} %/an`}><input type="range" min={0} max={0.08} step={0.0025} value={p.savingsYield} onChange={(e) => set({ savingsYield: Number(e.target.value) })} /></Field>
              <Field label={`Inflation : ${(p.inflation * 100).toFixed(1)} %/an`}><input type="range" min={0} max={0.06} step={0.0025} value={p.inflation} onChange={(e) => set({ inflation: Number(e.target.value) })} /></Field>
              <Field label={`Hausse revenus : ${(p.incomeGrowth * 100).toFixed(1)} %/an`}><input type="range" min={0} max={0.08} step={0.0025} value={p.incomeGrowth} onChange={(e) => set({ incomeGrowth: Number(e.target.value) })} /></Field>
            </div>
            <div className="small muted">Point de départ : <Money cents={p.startAvailable} /> disponibles + <Money cents={p.startSavings} /> d'épargne.</div>
          </div>
        </Card>
        <Card title="Évolution du patrimoine par scénario" className="span2">
          <div style={{ height: 340 }}>
            <ResponsiveContainer>
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="m" tick={chartTheme.axis} interval={5} />
                <YAxis tickFormatter={kEur} tick={chartTheme.axis} width={70} />
                <Tooltip {...chartTheme.tooltip} formatter={(v) => eur(Number(v), false)} />
                <Legend />
                <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="4 4" />
                {MILESTONES.map((m) => <ReferenceLine key={m} x={chart[m]?.m} stroke="var(--line)" />)}
                <Line dataKey="Prudent" stroke={COLORS.prudent} strokeWidth={2} dot={false} />
                <Line dataKey="Équilibré" stroke={COLORS.equilibre} strokeWidth={3} dot={false} />
                <Line dataKey="Optimiste" stroke={COLORS.optimiste} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="grid g3 small" style={{ marginTop: 8 }}>
            {results.map((r) => <div key={r.scenario.key}><strong style={{ color: COLORS[r.scenario.key] }}>● {r.scenario.label}</strong><p className="muted">{r.scenario.description}</p></div>)}
          </div>
        </Card>
      </div>

      <Card title="Tableau comparatif" subtitle="Patrimoine total estimé (disponible + épargne)">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Scénario</th>{MILESTONES.map((m) => <th key={m} className="right">{MILESTONE_LABEL[m]}</th>)}<th>Alerte</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.scenario.key}>
                  <td><strong style={{ color: COLORS[r.scenario.key] }}>{r.scenario.label}</strong></td>
                  {r.milestones.map((pt) => <td key={pt.offset} className="right"><Money cents={pt.total} decimals={false} /><div className="small muted">dont épargne {eur(pt.savings, false)}</div></td>)}
                  <td>{r.firstNegative ? <Badge tone="danger">Négatif dès {monthLabel(r.firstNegative, true)}</Badge> : <Badge tone="good">Toujours positif</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid g2">
        <Card title="Dépenses exceptionnelles prévues" subtitle="Voiture, déménagement, mariage, voyage…">
          <div className="form-grid ex-grid">
            <Field label="Libellé"><input value={ex.label} onChange={(e) => setEx({ ...ex, label: e.target.value })} /></Field>
            <Field label="Montant"><MoneyInput value={ex.amount} onChange={(amount) => setEx({ ...ex, amount })} /></Field>
            <Field label="Dans (mois)"><input type="number" min={1} max={60} value={ex.monthOffset} onChange={(e) => setEx({ ...ex, monthOffset: Number(e.target.value) })} /></Field>
            <button className="btn btn-primary" disabled={!ex.label || !ex.amount} onClick={() => { set({ exceptional: [...p.exceptional, { ...ex, id: crypto.randomUUID() }] }); setEx({ label: '', amount: 0, monthOffset: 6 }); }}>Ajouter</button>
          </div>
          <div style={{ marginTop: 12 }}>
            {p.exceptional.map((e) => (
              <div key={e.id} className="list-item">
                <div className="grow">{e.label}<div className="small muted">dans {e.monthOffset} mois</div></div>
                <Money cents={-e.amount} />
                <button className="btn-icon" onClick={() => set({ exceptional: p.exceptional.filter((x) => x.id !== e.id) })}>✕</button>
              </div>
            ))}
            {!p.exceptional.length && <p className="muted small">Aucune dépense exceptionnelle simulée.</p>}
          </div>
        </Card>
        <Card title="Quand mes objectifs seront-ils financés ?" subtitle="Selon l'épargne simulée cumulée (tous objectifs confondus)">
          {goals.length ? goals.map((g) => {
            const s = goalStatus(g, today);
            return (
              <div key={g.id} className="list-item">
                <div className="grow"><strong>{g.name}</strong><div className="small muted">reste {eur(s.remaining, false)} · rythme actuel : {s.estimatedDate ? monthLabel(monthKey(s.estimatedDate), true) : '—'}</div></div>
                {results.map((r) => {
                  const hit = monthReaching(r.points, p.startSavings + s.remaining);
                  return <Badge key={r.scenario.key} tone={hit ? 'neutral' : 'danger'}><span style={{ color: COLORS[r.scenario.key] }}>●</span> {hit ? monthLabel(hit.month, true) : '> 5 ans'}</Badge>;
                })}
              </div>
            );
          }) : <p className="muted">Aucun objectif en cours. Ajoute-en dans « Préparer mon mois ».</p>}
        </Card>
      </div>
    </div>
  );
}
