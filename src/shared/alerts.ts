/** Alertes personnalisables : chaque règle a un interrupteur et un seuil (paramètres de l'utilisateur). */
import type { AlertSettings, AppState } from './types';
import { DEFAULT_ALERTS } from './types';
import { addDays, dateLabel, monthKey } from './dates';
import { formatMoney } from './money';
import {
  accountsInScope, chargesForMonth, computeResteAVivre, goalStatus, isRealExpense, ownersInScope, txInScope, upcomingCharges,
  variableBudgetLines, viewerOf, type Scope,
} from './analytics';

export type AlertKind = keyof AlertSettings;

export interface Alert {
  id: string;
  kind: AlertKind;
  level: 'good' | 'info' | 'warn' | 'danger';
  title: string;
  detail: string;
  date: string;
}

export const ALERT_LABELS: Record<AlertKind, { label: string; unit: 'eur' | 'factor' | null; help: string }> = {
  budgetOverrun: { label: 'Dépassement d\'un budget', unit: null, help: 'Une enveloppe du mois est dépassée.' },
  largeExpense: { label: 'Dépense élevée', unit: 'eur', help: 'Une dépense dépasse ce montant.' },
  unusualExpense: { label: 'Dépense inhabituelle', unit: 'factor', help: 'Une dépense vaut X fois la dépense habituelle de sa catégorie.' },
  lowBalance: { label: 'Solde faible', unit: 'eur', help: 'Le solde disponible passe sous ce montant.' },
  upcomingCharge: { label: 'Charge importante à venir', unit: 'eur', help: 'Une charge de plus de ce montant arrive dans les 7 jours.' },
  savingsMissed: { label: 'Épargne mensuelle non atteinte', unit: null, help: 'L\'épargne programmée n\'est pas réalisée à l\'approche de la paie.' },
  overdraftRisk: { label: 'Risque de découvert', unit: null, help: 'Les charges à venir dépassent le solde d\'un compte.' },
  goalReached: { label: 'Objectif d\'épargne atteint', unit: null, help: 'Félicitations quand un objectif est atteint.' },
};

const eur = (c: number) => formatMoney(c, 'EUR', { decimals: c % 100 !== 0 });

export function computeAlerts(state: AppState, today: string, scope: Scope = 'me'): Alert[] {
  const cfg: AlertSettings = { ...DEFAULT_ALERTS, ...(state.settings.alerts ?? {}) };
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  const out: Alert[] = [];
  const month = monthKey(today);
  const txs = txInScope(state, scope);
  // Les charges fixes prévues (loyer, assurance…) ne sont ni « élevées » ni « inhabituelles »
  const planned = new Set([month, monthKey(addDays(today, -7))].flatMap((m) => chargesForMonth(state, m, today, scope).map((c) => c.matchedTransactionId).filter(Boolean) as string[]));
  const recent = txs.filter((t) => t.date >= addDays(today, -7) && t.date <= today && isRealExpense(t, cats) && !planned.has(t.id) && cats.get(t.categoryId ?? '')?.kind !== 'fixed');

  if (cfg.budgetOverrun.enabled) {
    for (const l of variableBudgetLines(state, month, today, scope)) {
      if (l.budget > 0 && l.spent > l.budget) out.push({ id: `budget-${l.category.id}-${month}`, kind: 'budgetOverrun', level: 'danger', title: `Budget ${l.category.name} dépassé`, detail: `${eur(l.spent)} dépensés pour ${eur(l.budget)} prévus (+${eur(l.spent - l.budget)}).`, date: today });
    }
  }
  if (cfg.largeExpense.enabled && cfg.largeExpense.threshold > 0) {
    for (const t of recent) if (-t.amount >= cfg.largeExpense.threshold) out.push({ id: `large-${t.id}`, kind: 'largeExpense', level: 'warn', title: 'Dépense élevée', detail: `${t.merchant || t.description} : ${eur(-t.amount)} le ${dateLabel(t.date)}.`, date: t.date });
  }
  if (cfg.unusualExpense.enabled && cfg.unusualExpense.threshold > 1) {
    const history = txs.filter((t) => t.date < addDays(today, -7) && t.date >= addDays(today, -120) && isRealExpense(t, cats));
    for (const t of recent) {
      if (!t.categoryId) continue;
      const same = history.filter((h) => h.categoryId === t.categoryId).map((h) => -h.amount).sort((a, b) => a - b);
      if (same.length < 5) continue;
      const med = same[Math.floor(same.length / 2)];
      if (-t.amount >= med * cfg.unusualExpense.threshold && -t.amount >= 2000 && !out.some((a) => a.id === `large-${t.id}`)) {
        out.push({ id: `unusual-${t.id}`, kind: 'unusualExpense', level: 'warn', title: 'Dépense inhabituelle', detail: `${t.merchant || t.description} : ${eur(-t.amount)}, soit ${Math.round(-t.amount / med)}× ta dépense habituelle en ${cats.get(t.categoryId)?.name.toLowerCase()}.`, date: t.date });
      }
    }
  }
  const rav = computeResteAVivre(state, today, scope);
  const hasAvailableAccount = accountsInScope(state, scope).some((a) => a.includeInAvailable);
  if (cfg.lowBalance.enabled && cfg.lowBalance.threshold > 0 && hasAvailableAccount && rav.available < cfg.lowBalance.threshold) {
    out.push({ id: `low-${today}`, kind: 'lowBalance', level: 'warn', title: 'Solde faible', detail: `Ton solde disponible est de ${eur(rav.available)} (seuil : ${eur(cfg.lowBalance.threshold)}).`, date: today });
  }
  if (cfg.upcomingCharge.enabled) {
    for (const c of upcomingCharges(state, today, addDays(today, 8), scope)) {
      if (c.amount >= cfg.upcomingCharge.threshold && !c.overdue) out.push({ id: `charge-${c.charge.id}-${c.dueDate}`, kind: 'upcomingCharge', level: 'info', title: 'Charge importante à venir', detail: `${c.charge.name} : ${eur(c.amount)} le ${dateLabel(c.dueDate)}.`, date: today });
    }
  }
  if (cfg.overdraftRisk.enabled) {
    const accounts = accountsInScope(state, scope).filter((a) => a.includeInAvailable);
    const pending = upcomingCharges(state, today, rav.nextPayday, scope);
    for (const a of accounts) {
      const due = pending.filter((c) => c.charge.accountId === a.id).reduce((s, c) => s + c.amount, 0);
      if (a.balance < 0) out.push({ id: `overdraft-${a.id}-${today}`, kind: 'overdraftRisk', level: 'danger', title: 'Compte à découvert', detail: `${a.name} : ${eur(a.balance)}.`, date: today });
      else if (due > 0 && a.balance - due < 0) out.push({ id: `overdraft-${a.id}-${today}`, kind: 'overdraftRisk', level: 'danger', title: 'Risque de découvert', detail: `${a.name} : ${eur(a.balance)} disponibles pour ${eur(due)} de prélèvements avant la paie. Pense à alimenter ce compte.`, date: today });
    }
    if (rav.endOfMonthForecast < 0) out.push({ id: `forecast-${month}`, kind: 'overdraftRisk', level: 'danger', title: 'Fin de mois dans le rouge', detail: `Au rythme actuel, ton solde estimé en fin de mois serait de ${eur(rav.endOfMonthForecast)} (estimation).`, date: today });
  }
  if (cfg.savingsMissed.enabled && rav.savingsPlanned > 0 && rav.daysToPayday <= 5 && rav.savingsDone < rav.savingsPlanned) {
    out.push({ id: `savings-${rav.nextPayday}`, kind: 'savingsMissed', level: 'warn', title: 'Épargne du mois non atteinte', detail: `${eur(rav.savingsDone)} épargnés sur ${eur(rav.savingsPlanned)} prévus, ${rav.daysToPayday} jour(s) avant la paie.`, date: today });
  }
  if (cfg.goalReached.enabled) {
    const owners = ownersInScope(scope, viewerOf(state));
    for (const g of state.goals.filter((x) => owners.includes(x.owner))) {
      if (goalStatus(g, today).remaining === 0) out.push({ id: `goal-${g.id}`, kind: 'goalReached', level: 'good', title: `Objectif « ${g.name} » atteint 🎉`, detail: `${eur(g.saved)} épargnés sur ${eur(g.target)}.`, date: today });
    }
  }
  const order = { danger: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level] || b.date.localeCompare(a.date));
}
