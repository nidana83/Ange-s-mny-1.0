import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart, Area } from 'recharts';
import { useStore } from '../store';
import { Badge, Card, chartTheme, Empty, eur, kEur, Money, Progress, ScopeToggle, Stat, Tabs } from '../components/ui';
import { monthSummary, wealthSeries, weekSummaries } from '../../shared/analytics';
import { addMonths, dateLabel, isoWeekNumber, monthKey, monthLabel } from '../../shared/dates';
import { formatPct } from '../../shared/money';

export function Tracking() {
  const [view, setView] = useState<'week' | 'month' | 'trends'>('week');
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Suivi & bilans</h1><p className="muted">Analyse semaine par semaine, bilans mensuels automatiques et tendances.</p></div>
        <ScopeToggle />
      </div>
      <Tabs value={view} onChange={setView} items={[{ value: 'week', label: '📅 Hebdomadaire' }, { value: 'month', label: '🗓️ Bilan mensuel' }, { value: 'trends', label: '📈 Tendances 3 / 6 / 12 mois' }]} />
      {view === 'week' && <Weekly />}
      {view === 'month' && <Monthly />}
      {view === 'trends' && <Trends />}
    </div>
  );
}

function Weekly() {
  const { state, today, scope } = useStore();
  const weeks = useMemo(() => weekSummaries(state, 12, today, scope), [state, today, scope]);
  const [sel, setSel] = useState(weeks.length - 1);
  const w = weeks[sel];
  const prev = weeks[sel - 1];
  const avg = weeks.slice(0, -1).reduce((s, x) => s + x.variable, 0) / Math.max(1, weeks.length - 1);
  const chart = weeks.map((x, i) => ({ i, label: `S${isoWeekNumber(x.start)}`, dépenses: x.variable, budget: x.weeklyBudget, revenus: x.income, over: x.overspent }));
  if (!w) return <Empty title="Pas de données" />;
  return (
    <>
      <div className="grid g4">
        <Stat label="Revenus de la semaine" value={<Money cents={w.income} />} tone="good" icon="⬇️" />
        <Stat label="Dépenses de la semaine" value={<Money cents={w.expenses} />} icon="⬆️" hint={prev ? `${w.expenses >= prev.expenses ? '+' : ''}${eur(w.expenses - prev.expenses)} vs semaine précédente` : undefined} />
        <Stat label="Dépenses variables" value={<Money cents={w.variable} />} icon="🎯" hint={`Budget hebdo indicatif : ${eur(w.weeklyBudget)}`} tone={w.overspent ? 'danger' : 'good'} />
        <Stat label="Épargne réalisée" value={<Money cents={w.savings} />} icon="🐷" />
      </div>
      <Card title="Dépenses variables par semaine" subtitle="Clique sur une barre pour voir le détail · les barres rouges dépassent le budget hebdomadaire">
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={chart} onClick={(e) => { const i = (e as { activeTooltipIndex?: number })?.activeTooltipIndex; if (typeof i === 'number') setSel(i); }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={chartTheme.axis} />
              <YAxis tickFormatter={kEur} tick={chartTheme.axis} width={60} />
              <Tooltip {...chartTheme.tooltip} formatter={(v) => eur(Number(v))} />
              <ReferenceLine y={avg} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: 'moyenne', fill: 'var(--muted)', fontSize: 11, position: 'insideTopRight' }} />
              <Bar dataKey="dépenses" radius={[6, 6, 0, 0]} cursor="pointer" shape={(p: any) => <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={6} fill={p.payload.over ? '#ef4444' : p.index === sel ? '#7c5cff' : '#4c3fa0'} />} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid g2">
        <Card title={`Semaine du ${dateLabel(w.start)} au ${dateLabel(w.end)}`} actions={w.overspent ? <Badge tone="danger">Semaine trop dépensière</Badge> : <Badge tone="good">Dans le budget</Badge>}>
          {w.byCategory.length ? w.byCategory.map((c) => (
            <div key={c.category.id} className="budget-line">
              <div className="row between small" style={{ marginBottom: 6 }}><span>{c.category.icon} {c.category.name}</span><Money cents={c.amount} /></div>
              <Progress ratio={w.expenses ? c.amount / w.expenses : 0} color={c.category.color} height={6} />
            </div>
          )) : <Empty icon="🌿" title="Aucune dépense cette semaine" />}
        </Card>
        <Card title="Semaines les plus dépensières" subtitle="Sur les 12 dernières semaines">
          {[...weeks].map((x, i) => ({ ...x, i })).sort((a, b) => b.variable - a.variable).slice(0, 6).map((x) => (
            <div key={x.start} className="list-item" style={{ cursor: 'pointer' }} onClick={() => setSel(x.i)}>
              <div className="grow"><div>Semaine {isoWeekNumber(x.start)} · {dateLabel(x.start)} → {dateLabel(x.end)}</div><div className="small muted">budget {eur(x.weeklyBudget)}</div></div>
              {x.overspent && <Badge tone="danger">+{eur(x.variable - x.weeklyBudget, false)}</Badge>}
              <Money cents={x.variable} />
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function Monthly() {
  const { state, today, scope } = useStore();
  const [month, setMonth] = useState(addMonths(monthKey(today), Number(today.slice(8, 10)) < 5 ? -1 : 0));
  const s = useMemo(() => monthSummary(state, month, today, scope), [state, month, today, scope]);
  const p = useMemo(() => monthSummary(state, addMonths(month, -1), today, scope), [state, month, today, scope]);
  const delta = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${formatPct((a - b) / b)} vs mois précédent` : 'pas de comparaison');
  const isCurrent = month === monthKey(today);
  return (
    <>
      <div className="row gap-s">
        <button className="btn" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
        <strong style={{ minWidth: 150, textAlign: 'center', textTransform: 'capitalize' }}>{monthLabel(month)}</strong>
        <button className="btn" disabled={month >= monthKey(today)} onClick={() => setMonth(addMonths(month, 1))}>›</button>
        {isCurrent && <Badge tone="info">Mois en cours — bilan provisoire</Badge>}
      </div>
      <div className="grid g4">
        <Stat icon="⬇️" label="Revenus totaux" value={<Money cents={s.income} />} hint={delta(s.income, p.income)} tone="good" />
        <Stat icon="🧾" label="Charges fixes" value={<Money cents={s.fixed} />} hint={`Prévu : ${eur(s.fixedPlanned)}`} />
        <Stat icon="🎯" label="Dépenses variables" value={<Money cents={s.variable} />} hint={delta(s.variable, p.variable)} tone={s.variableBudget && s.variable > s.variableBudget ? 'danger' : undefined} />
        <Stat icon="🐷" label="Épargne réalisée" value={<Money cents={s.savings} />} hint={`Taux d'épargne : ${formatPct(s.savingsRate, 1)}`} tone="accent" />
        <Stat icon="⚖️" label="Solde du mois (revenus − dépenses)" value={<Money cents={s.net} sign />} hint={delta(s.net, p.net)} />
        <Stat icon="🏁" label="Solde disponible en fin de mois" value={<Money cents={s.endBalance} />} hint={isCurrent ? 'à ce jour' : undefined} />
        <Stat icon="✅" label="Budgets respectés" value={`${s.budgetsRespected} / ${s.budgetsTotal}`} tone={s.budgetsRespected === s.budgetsTotal ? 'good' : 'warn'} />
        <Stat icon="📊" label="Dépenses vs budget variable" value={s.variableBudget ? formatPct(s.variable / s.variableBudget) : '—'} hint={`Budget : ${eur(s.variableBudget)}`} />
      </div>
      <div className="grid g2">
        <Card title="Catégories les plus coûteuses">
          {s.topCategories.slice(0, 8).map((c) => {
            const prev = p.topCategories.find((x) => x.category.id === c.category.id)?.amount ?? 0;
            return (
              <div key={c.category.id} className="list-item">
                <div className="cat-dot" style={{ background: `${c.category.color}22` }}>{c.category.icon}</div>
                <div className="grow"><div>{c.category.name}</div><div className="small muted">{prev ? `${c.amount >= prev ? '▲' : '▼'} ${eur(Math.abs(c.amount - prev))} vs mois précédent` : 'nouveau'}</div></div>
                <Money cents={c.amount} />
              </div>
            );
          })}
          {!s.topCategories.length && <Empty title="Aucune dépense" />}
        </Card>
        <Card title="Respect des budgets prévisionnels">
          {s.budgetLines.filter((l) => l.budget || l.spent).map((l) => (
            <div key={l.category.id} className="budget-line">
              <div className="row between small" style={{ marginBottom: 6 }}>
                <span>{l.category.icon} {l.category.name}</span>
                <span>{eur(l.spent, false)} / {eur(l.budget, false)} {l.budget > 0 && (l.spent <= l.budget ? <Badge tone="good">respecté</Badge> : <Badge tone="danger">+{eur(l.spent - l.budget, false)}</Badge>)}</span>
              </div>
              <Progress ratio={l.ratio} color={l.category.color} height={6} />
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function Trends() {
  const { state, today, scope } = useStore();
  const [n, setN] = useState<3 | 6 | 12>(6);
  const data = useMemo(() => {
    const cur = monthKey(today);
    const rows = [];
    for (let i = n - 1; i >= 0; i--) {
      const m = addMonths(cur, -i);
      const s = monthSummary(state, m, today, scope);
      rows.push({ m: monthLabel(m, true), revenus: s.income, fixes: s.fixed, variables: s.variable, épargne: s.savings, solde: s.net, taux: Math.round(s.savingsRate * 1000) / 10 });
    }
    const wealth = wealthSeries(state, n, today, scope).map((w) => ({ m: monthLabel(w.month, true), total: w.total, disponible: w.available, épargne: w.savings }));
    return { rows, wealth };
  }, [state, today, scope, n]);
  return (
    <>
      <Tabs value={String(n) as '3' | '6' | '12'} onChange={(v) => setN(Number(v) as 3 | 6 | 12)} items={[{ value: '3', label: '3 mois' }, { value: '6', label: '6 mois' }, { value: '12', label: '12 mois' }]} />
      <div className="grid g2">
        <Card title="Revenus et dépenses">
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={data.rows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="m" tick={chartTheme.axis} /><YAxis tickFormatter={kEur} tick={chartTheme.axis} width={60} />
                <Tooltip {...chartTheme.tooltip} formatter={(v) => eur(Number(v))} /><Legend />
                <Bar dataKey="revenus" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="fixes" stackId="d" fill="#6366f1" />
                <Bar dataKey="variables" stackId="d" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Évolution du patrimoine">
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={data.wealth}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="m" tick={chartTheme.axis} /><YAxis tickFormatter={kEur} tick={chartTheme.axis} width={60} />
                <Tooltip {...chartTheme.tooltip} formatter={(v) => eur(Number(v))} /><Legend />
                <Area dataKey="épargne" stackId="w" fill="#22d3ee55" stroke="#22d3ee" />
                <Area dataKey="disponible" stackId="w" fill="#7c5cff55" stroke="#7c5cff" />
                <Line dataKey="total" stroke="#eef2ff" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Épargne réalisée et taux d'épargne">
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <ComposedChart data={data.rows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="m" tick={chartTheme.axis} />
                <YAxis yAxisId="l" tickFormatter={kEur} tick={chartTheme.axis} width={60} />
                <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${v} %`} tick={chartTheme.axis} width={50} />
                <Tooltip {...chartTheme.tooltip} formatter={(v, name) => (name === 'taux' ? `${v} %` : eur(Number(v)))} /><Legend />
                <Bar yAxisId="l" dataKey="épargne" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                <Line yAxisId="r" dataKey="taux" stroke="#f59e0b" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Solde mensuel (revenus − dépenses)">
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={data.rows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="m" tick={chartTheme.axis} /><YAxis tickFormatter={kEur} tick={chartTheme.axis} width={60} />
                <Tooltip {...chartTheme.tooltip} formatter={(v) => eur(Number(v))} />
                <ReferenceLine y={0} stroke="var(--muted)" />
                <Line dataKey="solde" stroke="#7c5cff" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </>
  );
}
