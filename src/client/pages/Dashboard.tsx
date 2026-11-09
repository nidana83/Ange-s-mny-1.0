import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { useStore } from '../store';
import { Badge, Card, chartTheme, Empty, eur, Gauge, Money, Progress, ScopeToggle } from '../components/ui';
import {
  accountsInScope, computeResteAVivre, goalStatus, historicalAverages, monthSummary, ownersInScope, txInScope, viewerOf, isRealExpense,
} from '../../shared/analytics';
import { computeAlerts } from '../../shared/alerts';
import { compareScenarios } from '../../shared/projections';
import { addMonths, dateLabel, daysInMonth, monthKey, monthLabel } from '../../shared/dates';
import { formatPct, sum } from '../../shared/money';

const LEVEL_ICON = { good: '✅', info: '💡', warn: '⚠️', danger: '🚨' } as const;

export function Onboarding() {
  const { state, call } = useStore();
  return (
    <div className="stack" style={{ maxWidth: 760, margin: '4vh auto' }}>
      <div className="card hero" style={{ padding: 32 }}>
        <h1>Bienvenue {state.viewer.name} 👋</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Commence par tes comptes : connecte Revolut via l'Open Banking (lecture seule, authentification chez Revolut),
          importe un relevé CSV/OFX, ou ajoute un compte manuellement.
        </p>
        <div className="row gap wrap" style={{ marginTop: 22 }}>
          <Link className="btn btn-primary" to="/parametres?tab=comptes">Ajouter mes comptes</Link>
          <Link className="btn" to="/parametres?tab=preferences">Renseigner mon revenu et ma date de paie</Link>
          {!state.demo && <button className="btn btn-ghost" onClick={async () => { await call('/auth/mode', { body: { demo: true } }); window.location.reload(); }}>Explorer la démo (données fictives)</button>}
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { state, today, scope } = useStore();
  const month = monthKey(today);
  const d = useMemo(() => {
    const rav = computeResteAVivre(state, today, scope);
    const cur = monthSummary(state, month, today, scope);
    const accounts = accountsInScope(state, scope);
    const owners = ownersInScope(scope, viewerOf(state));
    const goals = state.goals.filter((g) => owners.includes(g.owner) && g.saved < g.target).slice(0, 3);
    const avg = historicalAverages(state, today, 3, scope);
    const proj = compareScenarios({
      startAvailable: sum(accounts.filter((a) => a.includeInAvailable), (a) => a.balance),
      startSavings: sum(accounts.filter((a) => !a.includeInAvailable), (a) => a.balance),
      monthlyIncome: avg.income, monthlyFixed: avg.fixed, monthlyVariable: avg.variable, monthlySavings: avg.savings,
      savingsYield: 0.025, inflation: 0.02, incomeGrowth: 0, exceptional: [], horizonMonths: 6,
    }, month)[1].points;
    // Dépenses du mois précédent jusqu'au même jour, pour une comparaison honnête
    const cats = new Map(state.categories.map((c) => [c.id, c]));
    const day = today.slice(8, 10);
    const prev = addMonths(month, -1);
    const prevToDate = -sum(txInScope(state, scope).filter((t) => t.date.startsWith(prev) && t.date.slice(8, 10) <= day && isRealExpense(t, cats)), (t) => t.amount);
    return {
      rav, cur, goals, proj, prevToDate,
      alerts: computeAlerts(state, today, scope).filter((a) => a.level !== 'good').slice(0, 3),
      total: sum(accounts, (a) => a.balance),
    };
  }, [state, today, scope, month]);

  if (!state.accounts.length) return <Onboarding />;
  const { rav, cur, goals, proj, alerts, total, prevToDate } = d;
  const used = rav.budgetUsedRatio;
  const monthProgress = Number(today.slice(8, 10)) / daysInMonth(month);
  const status = rav.paceAlert.level === 'danger' ? { t: 'Hors budget', tone: 'danger' as const } : rav.paceAlert.level === 'warn' ? { t: 'À surveiller', tone: 'warn' as const } : { t: 'Dans le budget', tone: 'good' as const };
  const savingsRatio = rav.savingsPlanned ? Math.min(1, rav.savingsDone / rav.savingsPlanned) : 0;
  const in6 = proj[proj.length - 1];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Bonjour {state.viewer.name}</h1>
          <p className="muted">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · prochaine paie le {dateLabel(rav.nextPayday)} ({rav.daysToPayday} j)</p>
        </div>
        <ScopeToggle />
      </div>

      <div className="card hero">
        <div className="row between wrap gap">
          <div>
            <div className="muted small">Ce que tu peux dépenser jusqu'à la paie</div>
            <div className="hero-value"><Money cents={rav.spendable} /></div>
            <div className="row gap-s wrap" style={{ marginTop: 10 }}>
              <Badge tone={status.tone}>● {status.t}</Badge>
              <Badge tone="accent">{eur(rav.dailyBudget)} par jour</Badge>
              <Badge>{eur(rav.weeklyBudget)} par semaine</Badge>
            </div>
            <p className="small muted" style={{ marginTop: 10, maxWidth: 520 }}>{rav.paceAlert.message}</p>
          </div>
          <Gauge ratio={used} label={formatPct(used)} sub="du budget variable" />
        </div>
      </div>

      <div className="grid g3">
        <Link to="/parametres?tab=comptes" className="stat" style={{ color: 'inherit' }}>
          <div className="stat-label">Ce que je possède</div>
          <div className="stat-value"><Money cents={total} /></div>
          <div className="stat-hint">dont disponible <Money cents={rav.available} /></div>
        </Link>
        <Link to="/transactions" className="stat" style={{ color: 'inherit' }}>
          <div className="stat-label">Dépensé ce mois-ci</div>
          <div className="stat-value"><Money cents={cur.expenses} /></div>
          <div className="stat-hint">{prevToDate ? `${cur.expenses > prevToDate ? '▲' : '▼'} ${eur(Math.abs(cur.expenses - prevToDate), false)} vs le mois dernier à la même date` : `revenus du mois : ${eur(cur.income, false)}`}</div>
        </Link>
        <Link to="/budget?tab=fixes" className="stat" style={{ color: 'inherit' }}>
          <div className="stat-label">Reste à payer avant la paie</div>
          <div className="stat-value"><Money cents={rav.remainingFixed} /></div>
          <div className="stat-hint">{rav.remainingFixedItems.length ? `${rav.remainingFixedItems.length} charge(s) · prochaine : ${rav.remainingFixedItems[0].charge.name} le ${dateLabel(rav.remainingFixedItems[0].dueDate)}` : 'Toutes les charges sont réglées'}</div>
        </Link>
        <Link to="/budget" className={`stat ${rav.resteAVivre < 0 ? 'tone-danger' : ''}`} style={{ color: 'inherit' }}>
          <div className="stat-label">Reste à vivre (après budgets)</div>
          <div className="stat-value"><Money cents={rav.resteAVivre} /></div>
          <div className="stat-hint">marge non budgétée · {eur(rav.freeDaily)} / jour</div>
        </Link>
        <Link to="/epargne" className="stat" style={{ color: 'inherit' }}>
          <div className="stat-label">Épargne du cycle de paie</div>
          <div className="stat-value"><Money cents={rav.savingsDone} /> <span className="muted" style={{ fontSize: 14 }}>/ {eur(rav.savingsPlanned, false)}</span></div>
          <div style={{ marginTop: 8 }}><Progress ratio={savingsRatio} color="var(--accent)" height={6} /></div>
        </Link>
        <Link to="/projections" className="stat" style={{ color: 'inherit' }}>
          <div className="stat-label">Dans 6 mois (estimation)</div>
          <div className="stat-value"><Money cents={in6.total} /></div>
          <div className="stat-hint">{in6.total >= total ? '▲' : '▼'} {eur(Math.abs(in6.total - total), false)} · si ton rythme actuel se poursuit</div>
          <div style={{ height: 36, marginTop: 4 }}>
            <ResponsiveContainer>
              <AreaChart data={proj.map((p) => ({ m: monthLabel(p.month, true), v: p.total }))}>
                <defs><linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity={0.4} /><stop offset="1" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="m" hide /><Tooltip {...chartTheme.tooltip} formatter={(v) => eur(Number(v), false)} />
                <Area dataKey="v" stroke="var(--accent)" strokeWidth={2} fill="url(#gp)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Link>
      </div>

      <div className="grid g3">
        <Card title="Budgets du mois" actions={<Link to="/budget?tab=variables" className="btn btn-sm">Tout voir</Link>} className="span2">
          {cur.budgetLines.filter((l) => l.budget > 0 || l.spent > 0).length === 0 ? <Empty icon="🎯" title="Aucun budget défini">Définis tes enveloppes dans Budget → Dépenses variables.</Empty> : (
            <div className="grid g2" style={{ columnGap: 28 }}>
              {cur.budgetLines.filter((l) => l.budget > 0 || l.spent > 0).sort((a, b) => b.ratio - a.ratio).slice(0, 6).map((l) => (
                <div key={l.category.id} className="budget-line">
                  <div className="row between small" style={{ marginBottom: 6 }}>
                    <span>{l.category.icon} {l.category.name}</span>
                    <span><Money cents={l.spent} decimals={false} /> <span className="muted">/ {eur(l.budget, false)}</span></span>
                  </div>
                  <Progress ratio={l.ratio} color={l.category.color} marker={monthProgress} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="À surveiller">
          <div className="stack-s">
            {alerts.map((a) => (
              <div key={a.id} className={`insight ${a.level}`}><span className="insight-icon">{LEVEL_ICON[a.level]}</span><div><strong className="small">{a.title}</strong><p className="small muted">{a.detail}</p></div></div>
            ))}
            {!alerts.length && <p className="muted small">Rien à signaler aujourd'hui. 🌿</p>}
            <Link to="/analyses?tab=conseiller" className="small">Demander au conseiller →</Link>
          </div>
        </Card>
      </div>

      {goals.length > 0 && (
        <Card title="Objectifs en cours" actions={<Link to="/epargne" className="btn btn-sm">Gérer</Link>}>
          <div className="grid g3">
            {goals.map((g) => {
              const s = goalStatus(g, today);
              return (
                <div key={g.id} className="stack-s">
                  <div className="row between"><strong>{g.name}</strong><span className="muted small">{formatPct(s.progress)}</span></div>
                  <Progress ratio={s.progress} color="var(--accent)" />
                  <div className="row between small muted"><span><Money cents={g.saved} decimals={false} /> / {eur(g.target, false)}</span><span>{s.estimatedDate ? `≈ ${monthLabel(monthKey(s.estimatedDate), true)}` : '—'}</span></div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
