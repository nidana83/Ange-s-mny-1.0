import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { useStore } from '../store';
import { Badge, Card, chartTheme, Empty, eur, Gauge, Money, Progress, ScopeToggle, Stat } from '../components/ui';
import {
  accountsInScope, chargesForMonth, computeResteAVivre, goalStatus, monthSummary, ownersInScope, wealthSeries,
} from '../../shared/analytics';
import { generateInsights } from '../../shared/advisor';
import { addMonths, dateLabel, daysInMonth, monthKey, monthLabel } from '../../shared/dates';
import { formatPct, sum } from '../../shared/money';

const ICON = { good: '✅', info: '💡', warn: '⚠️', danger: '🚨' } as const;

export function Onboarding() {
  const { call, toast } = useStore();
  return (
    <div className="stack" style={{ maxWidth: 820, margin: '6vh auto' }}>
      <div className="card hero" style={{ padding: 32 }}>
        <div className="brand-logo" style={{ fontSize: 28 }}><div className="brand-mark">M</div>ANGE'S MNY</div>
        <p className="muted" style={{ marginTop: 8 }}>Your money. Your control. Your future.</p>
        <h1 style={{ marginTop: 26 }}>Bienvenue 👋 Commençons par tes comptes.</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Connecte Revolut via l'Open Banking (lecture seule, authentification chez Revolut), importe un relevé CSV/OFX,
          ou ajoute tes comptes manuellement. Tes données restent stockées sur ta machine.
        </p>
        <div className="row gap wrap" style={{ marginTop: 22 }}>
          <Link className="btn btn-primary" to="/comptes">🏦 Ajouter mes comptes</Link>
          <button className="btn" onClick={async () => { await call('/demo', { method: 'POST' }); toast('Données de démonstration chargées.'); }}>
            🧪 Explorer avec des données de démo
          </button>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { state, today, scope } = useStore();
  const month = monthKey(today);
  const data = useMemo(() => {
    const rav = computeResteAVivre(state, today, scope);
    const cur = monthSummary(state, month, today, scope);
    const prev = monthSummary(state, addMonths(month, -1), today, scope);
    const accounts = accountsInScope(state, scope);
    const wealth = wealthSeries(state, 12, today, scope);
    const charges = chargesForMonth(state, month, today, scope);
    const upcoming = charges.filter((c) => c.status === 'pending').slice(0, 6);
    const owners = ownersInScope(scope);
    const goals = state.goals.filter((g) => owners.includes(g.owner));
    const savingsTotal = sum(accounts.filter((a) => ['savings', 'vault', 'investment'].includes(a.type)), (a) => a.balance);
    const biggest = state.transactions
      .filter((t) => accounts.some((a) => a.id === t.accountId) && monthKey(t.date) === month && t.amount < 0 && !t.isTransfer)
      .sort((a, b) => a.amount - b.amount).slice(0, 5);
    // Comparaison à date équivalente du mois précédent
    const day = Number(today.slice(8, 10));
    const prevSameDay = state.transactions.filter((t) => accounts.some((a) => a.id === t.accountId) && monthKey(t.date) === addMonths(month, -1) && Number(t.date.slice(8, 10)) <= day && t.amount < 0 && !t.isTransfer);
    const prevToDate = -sum(prevSameDay, (t) => t.amount);
    return { rav, cur, prev, accounts, wealth, upcoming, goals, savingsTotal, biggest, prevToDate, insights: generateInsights(state, today, scope).slice(0, 4) };
  }, [state, today, scope, month]);

  if (!state.accounts.length) return <Onboarding />;
  const { rav, cur, prev, accounts, wealth, upcoming, goals, savingsTotal, biggest, prevToDate, insights } = data;
  const totalWealth = sum(accounts, (a) => a.balance);
  const monthProgress = Number(today.slice(8, 10)) / daysInMonth(month);
  const used = rav.variableBudget ? rav.variableSpent / rav.variableBudget : 0;
  const spendingDelta = prevToDate ? (cur.expenses - prevToDate) / prevToDate : 0;
  const remainingFixed = sum(upcoming, (c) => c.amount);
  const status = rav.paceAlert.level === 'danger' ? { t: 'Hors budget', tone: 'danger' as const } : rav.paceAlert.level === 'warn' ? { t: 'Vigilance', tone: 'warn' as const } : { t: 'Dans le budget', tone: 'good' as const };
  const pie = cur.topCategories.slice(0, 7).map((c) => ({ name: c.category.name, value: c.amount, color: c.category.color }));

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Bonjour {state.settings.userName} 👋</h1>
          <p className="muted">{monthLabel(month)} · {Math.round(monthProgress * 100)} % du mois écoulé · prochaine paie le {dateLabel(rav.nextPayday)}</p>
        </div>
        <ScopeToggle />
      </div>

      <div className="grid g3">
        <div className="card hero span2">
          <div className="row between wrap gap">
            <div>
              <div className="muted small">Argent réellement disponible jusqu'à la paie</div>
              <div className="hero-value"><Money cents={rav.spendable} /></div>
              <div className="row gap-s wrap" style={{ marginTop: 10 }}>
                <Badge tone={status.tone}>● {status.t}</Badge>
                <Badge tone="accent">{eur(rav.dailyBudget)} / jour</Badge>
                <Badge>{rav.daysToPayday} jours avant la paie</Badge>
              </div>
            </div>
            <Gauge ratio={used} label={formatPct(used)} sub="budget variable consommé" />
          </div>
          <div className="divider" />
          <div className="grid g4">
            <div><div className="muted small">Solde disponible</div><strong><Money cents={rav.available} /></strong></div>
            <div><div className="muted small">Charges fixes à venir</div><strong><Money cents={rav.remainingFixed} /></strong></div>
            <div><div className="muted small">Épargne programmée restante</div><strong><Money cents={rav.savingsRemaining} /></strong></div>
            <div><div className="muted small">Fin de mois (estimation)</div><strong className={rav.endOfMonthForecast < 0 ? 'neg' : ''}><Money cents={rav.endOfMonthForecast} /></strong></div>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>{rav.paceAlert.message}</p>
        </div>
        <Card title="Patrimoine financier" subtitle="Tous comptes du périmètre">
          <div className="hero-value" style={{ fontSize: 30 }}><Money cents={totalWealth} /></div>
          <div style={{ height: 120, marginTop: 8 }}>
            <ResponsiveContainer>
              <AreaChart data={wealth.map((w) => ({ m: monthLabel(w.month, true), v: w.total }))}>
                <defs><linearGradient id="gw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7c5cff" stopOpacity={0.6} /><stop offset="1" stopColor="#7c5cff" stopOpacity={0} /></linearGradient></defs>
                <Tooltip {...chartTheme.tooltip} formatter={(v) => eur(Number(v))} />
                <XAxis dataKey="m" hide />
                <Area type="monotone" dataKey="v" stroke="#7c5cff" strokeWidth={2} fill="url(#gw)" name="Patrimoine" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="row between small"><span className="muted">Épargne totale</span><Money cents={savingsTotal} /></div>
        </Card>
      </div>

      <div className="grid g4">
        <Stat icon="⬇️" label="Revenus du mois" value={<Money cents={cur.income} />} hint={prev.income ? `${eur(prev.income, false)} le mois dernier` : undefined} tone="good" />
        <Stat icon="⬆️" label="Dépenses du mois" value={<Money cents={cur.expenses} />} hint={prevToDate ? `${spendingDelta >= 0 ? '+' : ''}${formatPct(spendingDelta)} vs même date le mois dernier` : 'Pas de comparaison disponible'} tone={spendingDelta > 0.1 ? 'warn' : undefined} />
        <Stat icon="🧾" label="Charges fixes restantes" value={<Money cents={remainingFixed} />} hint={`${upcoming.length} prélèvement(s) à venir ce mois`} />
        <Stat icon="🎯" label="Budget variable restant" value={<Money cents={rav.variableBudget - rav.variableSpent} />} hint={`${formatPct(Math.max(0, 1 - used))} restant sur ${eur(rav.variableBudget, false)}`} tone={rav.variableBudget - rav.variableSpent < 0 ? 'danger' : 'accent'} />
        <Stat icon="🐷" label="Épargne réalisée ce mois" value={<Money cents={cur.savings} />} hint={`Objectif mensuel : ${eur(rav.savingsPlanned, false)}`} tone={cur.savings >= rav.savingsPlanned && rav.savingsPlanned > 0 ? 'good' : undefined} />
        <Stat icon="💶" label="Reste à vivre (après budgets)" value={<Money cents={rav.resteAVivre} />} hint={`soit ${eur(rav.freeDaily)} / jour non budgétés`} tone={rav.resteAVivre < 0 ? 'danger' : 'good'} />
        <Stat icon="📈" label="Taux d'épargne (mois dernier)" value={formatPct(prev.savingsRate)} hint={prev.income ? `${eur(prev.savings, false)} sur ${eur(prev.income, false)}` : 'Pas de revenus enregistrés'} />
        <Stat icon="🔮" label="Solde prévisionnel fin de mois" value={<Money cents={rav.endOfMonthForecast} />} hint="Estimation au rythme actuel" tone={rav.endOfMonthForecast < 0 ? 'danger' : undefined} />
      </div>

      <div className="grid g3">
        <Card title="Budgets du mois" actions={<Link to="/mois" className="btn btn-sm">Gérer</Link>} className="span2">
          {cur.budgetLines.filter((l) => l.budget > 0 || l.spent > 0).length === 0 ? <Empty icon="🎯" title="Aucun budget défini">Définis tes budgets dans « Préparer mon mois ».</Empty> : (
            <div className="grid g2" style={{ columnGap: 28 }}>
              {cur.budgetLines.filter((l) => l.budget > 0 || l.spent > 0).sort((a, b) => b.ratio - a.ratio).slice(0, 10).map((l) => (
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
        <Card title="Répartition des dépenses" subtitle={monthLabel(month)}>
          {pie.length ? (
            <>
              <div style={{ height: 180 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none" isAnimationActive={false}>
                      {pie.map((p) => <Cell key={p.name} fill={p.color} />)}
                    </Pie>
                    <Tooltip {...chartTheme.tooltip} formatter={(v) => eur(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="stack-s">
                {pie.slice(0, 5).map((p) => (
                  <div key={p.name} className="row between small"><span><span style={{ color: p.color }}>●</span> {p.name}</span><Money cents={p.value} decimals={false} /></div>
                ))}
              </div>
            </>
          ) : <Empty icon="📊" title="Aucune dépense ce mois-ci" />}
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Prochaines charges" actions={<Link to="/mois" className="btn btn-sm">Voir tout</Link>}>
          {upcoming.length ? upcoming.map((c) => (
            <div key={c.charge.id + c.dueDate} className="list-item">
              <div className="cat-dot" style={{ background: 'var(--panel-2)' }}>{state.categories.find((k) => k.id === c.charge.categoryId)?.icon ?? '🧾'}</div>
              <div className="grow"><div>{c.charge.name}</div><div className="muted small">{dateLabel(c.dueDate)} {c.overdue && <Badge tone="warn">non rapprochée</Badge>}</div></div>
              <Money cents={-c.amount} />
            </div>
          )) : <Empty icon="✅" title="Toutes les charges du mois sont réglées" />}
        </Card>
        <Card title="Plus grosses dépenses du mois">
          {biggest.length ? biggest.map((t) => {
            const c = state.categories.find((k) => k.id === t.categoryId);
            return (
              <div key={t.id} className="list-item">
                <div className="cat-dot" style={{ background: `${c?.color ?? '#475569'}22` }}>{c?.icon ?? '❔'}</div>
                <div className="grow"><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant || t.description}</div><div className="muted small">{dateLabel(t.date)} · {c?.name ?? 'Non catégorisé'}</div></div>
                <Money cents={t.amount} />
              </div>
            );
          }) : <Empty icon="🧾" title="Aucune dépense" />}
        </Card>
        <Card title="Conseils du moment" actions={<Link to="/conseiller" className="btn btn-sm">Conseiller</Link>}>
          <div className="stack-s">
            {insights.map((i) => (
              <div key={i.id} className={`insight ${i.level}`}><span className="insight-icon">{ICON[i.level]}</span><div><strong className="small">{i.title}</strong><p className="small muted">{i.detail}</p></div></div>
            ))}
            {!insights.length && <Empty icon="🌿" title="Rien à signaler" />}
          </div>
        </Card>
      </div>

      {goals.length > 0 && (
        <Card title="Objectifs d'épargne" actions={<Link to="/mois?tab=epargne" className="btn btn-sm">Gérer</Link>}>
          <div className="grid g3">
            {goals.map((g) => {
              const s = goalStatus(g, today);
              return (
                <div key={g.id} className="stack-s">
                  <div className="row between"><strong>{g.name}</strong><span className="muted small">{formatPct(s.progress)}</span></div>
                  <Progress ratio={s.progress} color="var(--accent-2)" />
                  <div className="row between small muted"><span><Money cents={g.saved} decimals={false} /> / {eur(g.target, false)}</span><span>{s.estimatedDate ? `≈ ${monthLabel(monthKey(s.estimatedDate), true)}` : '—'}</span></div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Mes comptes" actions={<Link to="/comptes" className="btn btn-sm">Gérer</Link>}>
        <div className="grid g4">
          {accounts.map((a) => (
            <div key={a.id} className="stat">
              <div className="stat-label">{a.type === 'vault' ? '🔐' : a.type === 'savings' ? '🐷' : a.type === 'joint' ? '💞' : '💳'} {a.name}</div>
              <div className="stat-value" style={{ fontSize: 18 }}><Money cents={a.balance} /></div>
              <div className="stat-hint">{a.institution}{a.provider === 'enablebanking' ? ' · synchronisé' : ''}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
