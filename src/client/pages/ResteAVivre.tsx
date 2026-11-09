import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Badge, Card, eur, Money, MoneyInput, Progress, ScopeToggle, Stat } from '../components/ui';
import { computeResteAVivre } from '../../shared/analytics';
import { dateLabel } from '../../shared/dates';
import { formatPct } from '../../shared/money';

export function ResteAVivrePage({ embedded = false }: { embedded?: boolean }) {
  const { state, today, scope } = useStore();
  const r = useMemo(() => computeResteAVivre(state, today, scope), [state, today, scope]);
  const [purchase, setPurchase] = useState(0);
  const tone = r.paceAlert.level === 'danger' ? 'danger' : r.paceAlert.level === 'warn' ? 'warn' : 'good';

  return (
    <div className="stack">
      {!embedded && <div className="page-head">
        <div>
          <h1>Reste à vivre</h1>
          <p className="muted">Ce que tu peux réellement dépenser sans mettre ton budget en danger. Les transferts entre tes comptes et ceux du couple ne sont pas comptés comme des dépenses.</p>
        </div>
        <ScopeToggle />
      </div>}

      <div className="grid g3">
        <div className="card hero span2">
          <div className="muted small">Dépensable jusqu'à la prochaine paie ({dateLabel(r.nextPayday)})</div>
          <div className="hero-value"><Money cents={r.spendable} /></div>
          <div className="row gap-s wrap" style={{ marginTop: 10 }}>
            <Badge tone="accent">Budget journalier conseillé : {eur(r.dailyBudget)}</Badge>
            <Badge>{eur(r.weeklyBudget)} / semaine</Badge>
            <Badge>{r.daysToPayday} jours restants</Badge>
          </div>
          <div className="divider" />
          <h3 style={{ marginBottom: 8 }}>Comment ce montant est calculé</h3>
          <div className="wf">
            <div className="wf-row"><span>💳 Solde bancaire disponible (comptes courants & communs)</span><Money cents={r.available} /></div>
            <div className="wf-row"><span>🧾 Charges fixes restant à payer avant la paie ({r.remainingFixedItems.length})</span><Money cents={-r.remainingFixed} /></div>
            <div className="wf-row"><span>🐷 Épargne programmée restante ({eur(r.savingsDone, false)} déjà épargnés sur {eur(r.savingsPlanned, false)})</span><Money cents={-r.savingsRemaining} /></div>
            <div className="wf-row"><span>📌 Autres engagements (dépenses exceptionnelles prévues)</span><Money cents={-r.commitments} /></div>
            <div className="wf-row wf-total"><span>= Argent disponible pour vivre</span><Money cents={r.spendable} /></div>
            <div className="wf-row"><span>🎯 Dépenses variables restantes prévues (enveloppes du mois)</span><Money cents={-r.remainingVariablePlanned} /></div>
            <div className="wf-row wf-total"><span>= Reste à vivre (marge non budgétée)</span><Money cents={r.resteAVivre} className={r.resteAVivre < 0 ? 'neg' : 'pos'} /></div>
          </div>
        </div>
        <div className="stack">
          <div className={`banner ${tone === 'good' ? 'info' : tone}`}>
            <span style={{ fontSize: 22 }}>{tone === 'good' ? '🟢' : tone === 'warn' ? '🟠' : '🔴'}</span>
            <div><strong>{tone === 'good' ? 'Rythme maîtrisé' : tone === 'warn' ? 'Attention au rythme' : 'Risque de dépassement'}</strong><p className="small muted">{r.paceAlert.message}</p></div>
          </div>
          <Card title="Dépenses variables du mois">
            <div className="row between small"><span>Dépensé</span><strong><Money cents={r.variableSpent} /> / {eur(r.variableBudget)}</strong></div>
            <div style={{ margin: '8px 0' }}><Progress ratio={r.budgetUsedRatio} height={10} marker={Number(today.slice(8, 10)) / 30} /></div>
            <div className="row between small muted"><span>Projection fin de mois</span><span className={r.variablePaceProjection > r.variableBudget ? 'neg' : ''}>{eur(r.variablePaceProjection)} (estimation)</span></div>
            <div className="row between small muted"><span>Budget consommé</span><span>{formatPct(r.budgetUsedRatio)}</span></div>
          </Card>
          <Card title="Puis-je me le permettre ?">
            <MoneyInput value={purchase} onChange={setPurchase} placeholder="Montant de l'achat" />
            {purchase > 0 && (
              <div className="small" style={{ marginTop: 10 }}>
                {r.resteAVivre - purchase >= 0 ? <div className="pos">✅ Oui : il te resterait {eur(r.resteAVivre - purchase)} de marge non budgétée.</div>
                  : r.spendable - purchase >= 0 ? <div style={{ color: 'var(--warn)' }}>⚠️ Possible, mais cela entame tes enveloppes de {eur(purchase - r.resteAVivre)}. Nouveau budget journalier : {eur(Math.floor((r.spendable - purchase) / r.daysToPayday))}.</div>
                    : <div className="neg">⛔ Déconseillé : il manquerait {eur(purchase - r.spendable)} pour couvrir tes charges et ton épargne.</div>}
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="grid g4">
        <Stat icon="💳" label="Disponible aujourd'hui" value={<Money cents={r.available} />} />
        <Stat icon="📆" label="Disponible jusqu'à la paie" value={<Money cents={r.spendable} />} tone="accent" />
        <Stat icon="🗓️" label="Par semaine" value={<Money cents={r.weeklyBudget} />} />
        <Stat icon="☀️" label="Par jour" value={<Money cents={r.dailyBudget} />} hint={`dont ${eur(r.freeDaily)} hors enveloppes`} />
        <Stat icon="🔮" label="Solde prévisionnel fin de mois" value={<Money cents={r.endOfMonthForecast} />} hint={r.expectedIncomeRemaining ? `inclut la paie attendue (${eur(r.expectedIncomeRemaining, false)})` : 'au rythme actuel — estimation'} tone={r.endOfMonthForecast < 0 ? 'danger' : undefined} />
        <Stat icon="💼" label="Paie du mois" value={r.incomeReceived ? 'Reçue' : 'En attente'} tone={r.incomeReceived ? 'good' : 'warn'} hint={state.settings.expectedIncome ? `Attendue : ${eur(state.settings.expectedIncome, false)}` : 'Renseigne ton revenu dans les paramètres'} />
      </div>

      <Card title="Charges à payer avant la paie">
        {r.remainingFixedItems.length ? r.remainingFixedItems.map((c) => (
          <div key={c.charge.id + c.dueDate} className="list-item">
            <div className="grow"><div>{c.charge.name}</div><div className="small muted">{dateLabel(c.dueDate)}{c.overdue ? ' · échéance passée, prélèvement non encore rapproché' : ''}</div></div>
            <Money cents={-c.amount} />
          </div>
        )) : <p className="muted">Aucune charge restante avant la paie. 🎉</p>}
      </Card>
    </div>
  );
}
