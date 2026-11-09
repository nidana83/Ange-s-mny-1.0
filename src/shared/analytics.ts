/**
 * Moteur de calcul d'Ange's MNY : budgets, reste à vivre, bilans, tendances.
 * Fonctions pures — aucune donnée n'est inventée : tout est dérivé de l'état fourni.
 */
import type { Account, AppState, Category, FixedCharge, Goal, Owner, Transaction } from './types';
import { partnerOf } from './types';
import {
  addDays, addMonths, dateInMonth, daysInMonth, diffDays, monthKey, monthsBetween, nextPayday,
  parseISODate, previousPayday, toISODate, weekStart,
} from './dates';
import { normalize } from './categorize';
import { sum } from './money';

/** Périmètre d'analyse : moi (comptes perso + communs) ou le couple (tous les comptes autorisés). */
export type Scope = 'me' | 'couple';

const SAVINGS_TYPES = new Set(['savings', 'vault', 'investment']);

/** Personne qui consulte l'application (« moi »). */
export function viewerOf(state: AppState): Owner {
  return state.viewer?.person ?? 'ange';
}

export function partnerPerson(state: AppState): Owner {
  return partnerOf(viewerOf(state));
}

export function accountAllowed(a: Account, viewer: Owner = 'ange'): boolean {
  // Les comptes du/de la partenaire ne sont utilisés qu'avec son consentement explicite
  return !a.archived && (a.owner === viewer || a.owner === 'joint' || !!a.consentAt);
}

export function accountsInScope(state: AppState, scope: Scope): Account[] {
  const me = viewerOf(state);
  return state.accounts.filter((a) => accountAllowed(a, me) && (scope === 'couple' || a.owner === me || a.owner === 'joint'));
}

export function ownersInScope(scope: Scope, viewer: Owner = 'ange'): Owner[] {
  return scope === 'couple' ? ['ange', 'kelly', 'joint'] : [viewer, 'joint'];
}

/** L'opération entre-t-elle dans les calculs ? (exclue ou annulée → non) */
export function counts(t: Transaction): boolean {
  return !t.excluded && !t.cancelled;
}

export function txInScope(state: AppState, scope: Scope): Transaction[] {
  const ids = new Set(accountsInScope(state, scope).map((a) => a.id));
  return state.transactions.filter((t) => ids.has(t.accountId) && counts(t));
}

function catMap(state: AppState): Map<string, Category> {
  return new Map(state.categories.map((c) => [c.id, c]));
}

/** Une dépense « réelle » : sortie, hors transfert interne, hors épargne. */
export function isRealExpense(t: Transaction, cats: Map<string, Category>): boolean {
  if (t.isTransfer || t.amount >= 0) return false;
  const k = t.categoryId ? cats.get(t.categoryId)?.kind : undefined;
  return k !== 'transfer' && k !== 'savings' && k !== 'income';
}

/** Un revenu « réel » : entrée hors transfert interne (remboursements inclus). */
export function isRealIncome(t: Transaction, cats: Map<string, Category>): boolean {
  if (t.isTransfer || t.amount <= 0) return false;
  const k = t.categoryId ? cats.get(t.categoryId)?.kind : undefined;
  return k !== 'transfer' && k !== 'savings';
}

/* --------------------------- Charges fixes --------------------------- */

/** Dates d'échéance d'une charge pour un mois donné. */
export function chargeDueDates(c: FixedCharge, month: string): string[] {
  if (!c.active || month < c.startMonth || (c.endMonth && month > c.endMonth)) return [];
  const offset = monthsBetween(c.startMonth, month);
  switch (c.frequency) {
    case 'monthly':
      return [dateInMonth(month, c.dayOfMonth)];
    case 'quarterly':
      return offset % 3 === 0 ? [dateInMonth(month, c.dayOfMonth)] : [];
    case 'yearly':
      return offset % 12 === 0 ? [dateInMonth(month, c.dayOfMonth)] : [];
    case 'weekly': {
      // dayOfMonth = jour de la semaine (1 = lundi … 7 = dimanche)
      const out: string[] = [];
      const dim = daysInMonth(month);
      for (let d = 1; d <= dim; d++) {
        const iso = dateInMonth(month, d);
        const dow = ((parseISODate(iso).getDay() + 6) % 7) + 1;
        if (dow === Math.min(7, Math.max(1, c.dayOfMonth))) out.push(iso);
      }
      return out;
    }
    default:
      return [];
  }
}

export interface ChargeInstance {
  charge: FixedCharge;
  month: string;
  dueDate: string;
  amount: number;
  status: 'paid' | 'pending' | 'skipped';
  overdue: boolean;
  matchedTransactionId: string | null;
  auto: boolean;
}

/** Rapproche une charge d'une transaction réelle (mot-clé + montant ±10 % + date ±6 j). */
function matchCharge(c: FixedCharge, due: string, amount: number, txs: Transaction[], used: Set<string>): Transaction | null {
  const key = normalize(c.matchKeyword || c.name);
  if (!key) return null;
  const tol = Math.max(500, Math.round(amount * 0.1));
  let best: Transaction | null = null;
  for (const t of txs) {
    if (used.has(t.id) || t.amount >= 0 || t.isTransfer) continue;
    if (Math.abs(diffDays(due, t.date)) > 6) continue;
    if (Math.abs(-t.amount - amount) > tol) continue;
    if (!normalize(`${t.merchant} ${t.description}`).includes(key)) continue;
    if (!best || Math.abs(diffDays(due, t.date)) < Math.abs(diffDays(due, best.date))) best = t;
  }
  return best;
}

export function chargesForMonth(state: AppState, month: string, today: string, scope: Scope = 'me'): ChargeInstance[] {
  const accountIds = new Set(accountsInScope(state, scope).map((a) => a.id));
  const txs = txInScope(state, scope).filter((t) => Math.abs(monthsBetween(monthKey(t.date), month)) <= 1);
  const used = new Set<string>();
  const out: ChargeInstance[] = [];
  const owners = ownersInScope(scope, viewerOf(state));
  const charges = state.charges.filter((c) => (c.accountId && state.accounts.some((a) => a.id === c.accountId)) ? accountIds.has(c.accountId) : owners.includes(c.owner ?? 'ange'));
  for (const c of charges) {
    const override = state.chargeMonths.find((m) => m.chargeId === c.id && m.month === month);
    const dates = c.frequency === 'weekly' ? chargeDueDates(c, month) : chargeDueDates(c, month).slice(0, 1);
    for (const due of dates) {
      const amount = override?.amount ?? c.amount;
      let status: ChargeInstance['status'] = override?.status ?? 'pending';
      let matched: string | null = override?.transactionId ?? null;
      let auto = false;
      if (!override || (override.status === 'pending' && !override.transactionId)) {
        const m = matchCharge(c, due, amount, txs, used);
        if (m) { status = 'paid'; matched = m.id; auto = true; }
      }
      if (matched) used.add(matched);
      out.push({ charge: c, month, dueDate: due, amount, status, overdue: status === 'pending' && due < today, matchedTransactionId: matched, auto });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Charges planifiées « once » (dépenses exceptionnelles prévues) incluses via frequency yearly sans répétition. */
export function upcomingCharges(state: AppState, from: string, to: string, scope: Scope = 'me'): ChargeInstance[] {
  const out: ChargeInstance[] = [];
  let m = monthKey(from);
  while (m <= monthKey(to)) {
    for (const ci of chargesForMonth(state, m, from, scope)) {
      if (ci.status !== 'pending') continue;
      if ((ci.dueDate >= from && ci.dueDate < to) || (ci.overdue && m === monthKey(from))) out.push(ci);
    }
    m = addMonths(m, 1);
  }
  return out;
}

/* ------------------------- Dépenses variables ------------------------- */

export function budgetFor(state: AppState, categoryId: string, month: string): number {
  const o = state.monthBudgets.find((b) => b.categoryId === categoryId && b.month === month);
  if (o) return o.amount;
  return state.categories.find((c) => c.id === categoryId)?.monthlyBudget ?? 0;
}

export interface CategoryBudgetLine {
  category: Category;
  budget: number;
  spent: number;
  remaining: number;
  ratio: number;
  projected: number;
  willExceedBy: number;
}

export const UNCATEGORIZED: Category = {
  id: '__none__', name: 'Non catégorisé', kind: 'variable', color: '#8b93a7', icon: '❔', monthlyBudget: 0, keywords: [], archived: false,
};

function elapsedFraction(month: string, today: string): number {
  const tm = monthKey(today);
  if (month < tm) return 1;
  if (month > tm) return 0;
  return Number(today.slice(8, 10)) / daysInMonth(month);
}

/** Dépenses réelles d'un mois réparties en fixes (rapprochées d'une charge / catégorie fixe) et variables. */
export function monthExpenses(state: AppState, month: string, today: string, scope: Scope) {
  const cats = catMap(state);
  const charges = chargesForMonth(state, month, today, scope);
  const chargeTx = new Set(charges.map((c) => c.matchedTransactionId).filter(Boolean) as string[]);
  const txs = txInScope(state, scope).filter((t) => monthKey(t.date) === month);
  const fixed: Transaction[] = [];
  const variable: Transaction[] = [];
  for (const t of txs) {
    if (!isRealExpense(t, cats)) continue;
    const kind = t.categoryId ? cats.get(t.categoryId)?.kind : undefined;
    if (chargeTx.has(t.id) || kind === 'fixed') fixed.push(t);
    else variable.push(t);
  }
  return { fixed, variable, charges, txs };
}

export function variableBudgetLines(state: AppState, month: string, today: string, scope: Scope = 'me'): CategoryBudgetLine[] {
  const { variable } = monthExpenses(state, month, today, scope);
  const frac = elapsedFraction(month, today);
  const lines: CategoryBudgetLine[] = [];
  const variableCats = state.categories.filter((c) => c.kind === 'variable' && !c.archived);
  for (const c of [...variableCats, UNCATEGORIZED]) {
    const spent = -sum(variable.filter((t) => (t.categoryId ?? '__none__') === c.id || (c.id === '__none__' && t.categoryId && !variableCats.some((v) => v.id === t.categoryId))), (t) => t.amount);
    const budget = c.id === '__none__' ? 0 : budgetFor(state, c.id, month);
    if (c.id === '__none__' && spent === 0) continue;
    const projected = frac > 0 && frac < 1 ? Math.round(spent / Math.max(frac, 0.1)) : spent;
    lines.push({
      category: c,
      budget,
      spent,
      remaining: budget - spent,
      ratio: budget ? spent / budget : spent > 0 ? 1 : 0,
      projected,
      willExceedBy: budget && projected > budget ? projected - budget : 0,
    });
  }
  return lines;
}

/* ------------------------------ Épargne ------------------------------ */

/** Épargne réalisée = mouvements nets vers les comptes d'épargne / coffres / investissements du périmètre. */
export function savingsBetween(state: AppState, from: string, to: string, scope: Scope): number {
  const cats = catMap(state);
  const accounts = accountsInScope(state, scope);
  const savingsIds = new Set(accounts.filter((a) => SAVINGS_TYPES.has(a.type)).map((a) => a.id));
  let total = 0;
  for (const t of txInScope(state, scope)) {
    if (t.date < from || t.date > to) continue;
    if (savingsIds.has(t.accountId)) total += t.amount;
    else if (!t.isTransfer && t.amount < 0 && t.categoryId && cats.get(t.categoryId)?.kind === 'savings') total += -t.amount; // épargne vers un compte non suivi
  }
  return total;
}

export function plannedMonthlySavings(state: AppState, scope: Scope): number {
  const fromSettings = state.settings.monthlySavings + state.settings.extraSavings;
  if (fromSettings > 0) return fromSettings;
  const owners = ownersInScope(scope, viewerOf(state));
  return sum(state.goals.filter((g) => owners.includes(g.owner) && g.saved < g.target), (g) => g.monthlyContribution);
}

/* --------------------------- Bilan mensuel --------------------------- */

export interface MonthSummary {
  month: string;
  income: number;
  fixed: number;
  variable: number;
  expenses: number;
  savings: number;
  net: number;
  savingsRate: number;
  fixedPlanned: number;
  variableBudget: number;
  topCategories: { category: Category; amount: number }[];
  budgetLines: CategoryBudgetLine[];
  budgetsRespected: number;
  budgetsTotal: number;
  endBalance: number;
}

export function monthSummary(state: AppState, month: string, today: string, scope: Scope = 'me'): MonthSummary {
  const cats = catMap(state);
  const { fixed, variable, charges, txs } = monthExpenses(state, month, today, scope);
  const income = sum(txs.filter((t) => isRealIncome(t, cats)), (t) => t.amount);
  const fixedTotal = -sum(fixed, (t) => t.amount);
  const variableTotal = -sum(variable, (t) => t.amount);
  const savings = savingsBetween(state, `${month}-01`, dateInMonth(month, 31), scope);
  const byCat = new Map<string, number>();
  for (const t of [...fixed, ...variable]) byCat.set(t.categoryId ?? '__none__', (byCat.get(t.categoryId ?? '__none__') ?? 0) - t.amount);
  const topCategories = [...byCat.entries()]
    .map(([id, amount]) => ({ category: cats.get(id) ?? UNCATEGORIZED, amount }))
    .sort((a, b) => b.amount - a.amount);
  const budgetLines = variableBudgetLines(state, month, today, scope);
  const withBudget = budgetLines.filter((l) => l.budget > 0);
  const endDate = month < monthKey(today) ? dateInMonth(month, 31) : today;
  return {
    month,
    income,
    fixed: fixedTotal,
    variable: variableTotal,
    expenses: fixedTotal + variableTotal,
    savings,
    net: income - fixedTotal - variableTotal,
    savingsRate: income > 0 ? savings / income : 0,
    fixedPlanned: sum(charges.filter((c) => c.status !== 'skipped'), (c) => c.amount),
    variableBudget: sum(withBudget, (l) => l.budget),
    topCategories,
    budgetLines,
    budgetsRespected: withBudget.filter((l) => l.spent <= l.budget).length,
    budgetsTotal: withBudget.length,
    endBalance: balanceAt(state, endDate, scope, (a) => a.includeInAvailable),
  };
}

/* ---------------------- Soldes et patrimoine ---------------------- */

/** Solde reconstitué d'un compte à une date : solde actuel − opérations postérieures. */
export function accountBalanceAt(state: AppState, account: Account, date: string): number {
  const after = state.transactions.filter((t) => t.accountId === account.id && t.date > date && !t.pending && !t.cancelled);
  return account.balance - sum(after, (t) => t.amount);
}

export function balanceAt(state: AppState, date: string, scope: Scope, filter: (a: Account) => boolean = () => true): number {
  return sum(accountsInScope(state, scope).filter(filter), (a) => accountBalanceAt(state, a, date));
}

export function wealthSeries(state: AppState, months: number, today: string, scope: Scope = 'me') {
  const out: { month: string; date: string; total: number; available: number; savings: number }[] = [];
  const current = monthKey(today);
  for (let i = months - 1; i >= 0; i--) {
    const m = addMonths(current, -i);
    const date = i === 0 ? today : dateInMonth(m, 31);
    const available = balanceAt(state, date, scope, (a) => a.includeInAvailable);
    const savings = balanceAt(state, date, scope, (a) => SAVINGS_TYPES.has(a.type));
    out.push({ month: m, date, total: balanceAt(state, date, scope), available, savings });
  }
  return out;
}

/* --------------------------- Reste à vivre --------------------------- */

export interface ResteAVivre {
  today: string;
  available: number;
  remainingFixed: number;
  remainingFixedItems: ChargeInstance[];
  remainingVariablePlanned: number;
  savingsPlanned: number;
  savingsDone: number;
  savingsRemaining: number;
  commitments: number;
  /** Argent disponible pour vivre jusqu'à la paie (après charges fixes, épargne et engagements) */
  spendable: number;
  /** Reste à vivre au sens strict : après aussi les enveloppes variables prévues */
  resteAVivre: number;
  nextPayday: string;
  daysToPayday: number;
  dailyBudget: number;
  weeklyBudget: number;
  freeDaily: number;
  endOfMonthForecast: number;
  incomeReceived: boolean;
  expectedIncomeRemaining: number;
  variableSpent: number;
  variableBudget: number;
  variablePaceProjection: number;
  paceAlert: { level: 'ok' | 'warn' | 'danger'; message: string };
  budgetUsedRatio: number;
}

export function computeResteAVivre(state: AppState, today: string, scope: Scope = 'me'): ResteAVivre {
  const cats = catMap(state);
  const month = monthKey(today);
  const accounts = accountsInScope(state, scope);
  const available = sum(accounts.filter((a) => a.includeInAvailable), (a) => a.balance);
  const payday = nextPayday(today, state.settings.payday);
  const daysToPayday = Math.max(1, diffDays(today, payday));

  // Charges fixes restantes d'ici la prochaine paie (+ charges en retard non rapprochées)
  const remainingFixedItems = upcomingCharges(state, today, payday, scope);
  const remainingFixed = sum(remainingFixedItems, (c) => c.amount);

  const lines = variableBudgetLines(state, month, today, scope);
  const variableBudget = sum(lines, (l) => l.budget);
  const variableSpent = sum(lines, (l) => l.spent);
  // Enveloppes variables restantes au prorata des jours restants jusqu'à la paie
  const dim = daysInMonth(month);
  const daysLeftInMonth = dim - Number(today.slice(8, 10)) + 1;
  const remainingEnvelopes = sum(lines, (l) => Math.max(0, l.remaining));
  const remainingVariablePlanned = payday <= dateInMonth(month, dim) || daysToPayday <= daysLeftInMonth
    ? remainingEnvelopes
    : remainingEnvelopes + Math.round((variableBudget * (daysToPayday - daysLeftInMonth)) / 30);

  // Épargne programmée sur le cycle de paie en cours
  const cycleStart = previousPayday(today, state.settings.payday);
  const savingsPlanned = plannedMonthlySavings(state, scope);
  const savingsDone = Math.max(0, savingsBetween(state, cycleStart, today, scope));
  const savingsRemaining = Math.max(0, savingsPlanned - savingsDone);

  const commitments = 0; // les dépenses exceptionnelles prévues sont saisies comme charges ponctuelles
  const spendable = available - remainingFixed - savingsRemaining - commitments;
  const resteAVivre = spendable - remainingVariablePlanned;

  // Revenus
  const monthTx = txInScope(state, scope).filter((t) => monthKey(t.date) === month);
  const incomeThisMonth = sum(monthTx.filter((t) => isRealIncome(t, cats)), (t) => t.amount);
  const expected = state.settings.expectedIncome;
  const incomeReceived = expected === 0 || incomeThisMonth >= expected * 0.5;
  const paydayThisMonth = dateInMonth(month, state.settings.payday);
  const expectedIncomeRemaining = !incomeReceived && paydayThisMonth >= today ? expected : 0;

  // Projection de fin de mois au rythme actuel
  const frac = Number(today.slice(8, 10)) / dim;
  const variablePaceProjection = Math.round(variableSpent / Math.max(frac, 0.1));
  const remainingVariableAtPace = Math.max(0, variablePaceProjection - variableSpent);
  const fixedRestOfMonth = sum(
    chargesForMonth(state, month, today, scope).filter((c) => c.status === 'pending'),
    (c) => c.amount,
  );
  const endOfMonthForecast = available + expectedIncomeRemaining - fixedRestOfMonth - savingsRemaining - remainingVariableAtPace;

  let paceAlert: ResteAVivre['paceAlert'] = { level: 'ok', message: 'Ton rythme de dépenses est compatible avec ton budget.' };
  if (spendable < 0) {
    paceAlert = { level: 'danger', message: 'Tes engagements (charges + épargne) dépassent ton solde disponible jusqu\'à la paie.' };
  } else if (variableBudget > 0 && variablePaceProjection > variableBudget) {
    const over = variablePaceProjection - variableBudget;
    paceAlert = {
      level: over > variableBudget * 0.15 ? 'danger' : 'warn',
      message: `À ce rythme, tes dépenses variables dépasseraient le budget d'environ ${(over / 100).toFixed(0)} € ce mois-ci (estimation).`,
    };
  } else if (variableBudget > 0 && variableSpent / variableBudget > state.settings.alertThreshold) {
    paceAlert = { level: 'warn', message: `Tu as déjà consommé ${Math.round((variableSpent / variableBudget) * 100)} % de ton budget variable.` };
  }

  return {
    today, available, remainingFixed, remainingFixedItems, remainingVariablePlanned, savingsPlanned, savingsDone,
    savingsRemaining, commitments, spendable, resteAVivre, nextPayday: payday, daysToPayday,
    dailyBudget: Math.floor(Math.max(0, spendable) / daysToPayday),
    weeklyBudget: Math.floor((Math.max(0, spendable) / daysToPayday) * 7),
    freeDaily: Math.floor(Math.max(0, resteAVivre) / daysToPayday),
    endOfMonthForecast, incomeReceived, expectedIncomeRemaining, variableSpent, variableBudget,
    variablePaceProjection, paceAlert,
    budgetUsedRatio: variableBudget ? variableSpent / variableBudget : 0,
  };
}

/* ------------------------- Vue hebdomadaire ------------------------- */

export interface WeekSummary {
  start: string;
  end: string;
  income: number;
  expenses: number;
  variable: number;
  savings: number;
  byCategory: { category: Category; amount: number }[];
  weeklyBudget: number;
  overspent: boolean;
}

export function weekSummaries(state: AppState, count: number, today: string, scope: Scope = 'me'): WeekSummary[] {
  const cats = catMap(state);
  const txs = txInScope(state, scope);
  const out: WeekSummary[] = [];
  let start = weekStart(today);
  const starts: string[] = [];
  for (let i = 0; i < count; i++) { starts.unshift(start); start = addDays(start, -7); }
  const chargeTxIds = new Set<string>();
  const months = new Set(starts.flatMap((s) => [monthKey(s), monthKey(addDays(s, 6))]));
  for (const m of months) for (const c of chargesForMonth(state, m, today, scope)) if (c.matchedTransactionId) chargeTxIds.add(c.matchedTransactionId);

  for (const s of starts) {
    const e = addDays(s, 6);
    const wt = txs.filter((t) => t.date >= s && t.date <= e);
    const exp = wt.filter((t) => isRealExpense(t, cats));
    const variable = exp.filter((t) => !chargeTxIds.has(t.id) && (t.categoryId ? cats.get(t.categoryId)?.kind !== 'fixed' : true));
    const byCat = new Map<string, number>();
    for (const t of exp) byCat.set(t.categoryId ?? '__none__', (byCat.get(t.categoryId ?? '__none__') ?? 0) - t.amount);
    const m = monthKey(s);
    const monthlyVariableBudget = sum(state.categories.filter((c) => c.kind === 'variable' && !c.archived), (c) => budgetFor(state, c.id, m));
    const weeklyBudget = Math.round((monthlyVariableBudget * 7) / daysInMonth(m));
    const variableTotal = -sum(variable, (t) => t.amount);
    out.push({
      start: s,
      end: e,
      income: sum(wt.filter((t) => isRealIncome(t, cats)), (t) => t.amount),
      expenses: -sum(exp, (t) => t.amount),
      variable: variableTotal,
      savings: savingsBetween(state, s, e, scope),
      byCategory: [...byCat.entries()].map(([id, amount]) => ({ category: cats.get(id) ?? UNCATEGORIZED, amount })).sort((a, b) => b.amount - a.amount),
      weeklyBudget,
      overspent: weeklyBudget > 0 && variableTotal > weeklyBudget,
    });
  }
  return out;
}

/* ------------------------------ Objectifs ------------------------------ */

export interface GoalStatus {
  goal: Goal;
  progress: number;
  remaining: number;
  estimatedDate: string | null;
  monthsToGo: number | null;
  requiredMonthly: number | null;
  onTrack: boolean | null;
}

export function goalStatus(goal: Goal, today: string): GoalStatus {
  const remaining = Math.max(0, goal.target - goal.saved);
  const progress = goal.target ? Math.min(1, goal.saved / goal.target) : 0;
  let monthsToGo: number | null = null;
  let estimatedDate: string | null = null;
  if (remaining === 0) { monthsToGo = 0; estimatedDate = today; }
  else if (goal.monthlyContribution > 0) {
    monthsToGo = Math.ceil(remaining / goal.monthlyContribution);
    estimatedDate = dateInMonth(addMonths(monthKey(today), monthsToGo), Number(today.slice(8, 10)));
  }
  let requiredMonthly: number | null = null;
  let onTrack: boolean | null = null;
  if (goal.targetDate && remaining > 0) {
    const m = Math.max(1, monthsBetween(monthKey(today), monthKey(goal.targetDate)));
    requiredMonthly = Math.ceil(remaining / m);
    onTrack = goal.monthlyContribution >= requiredMonthly;
  } else if (remaining === 0) onTrack = true;
  return { goal, progress, remaining, estimatedDate, monthsToGo, requiredMonthly, onTrack };
}

/* --------------------- Moyennes historiques (base) --------------------- */

export function historicalAverages(state: AppState, today: string, months = 3, scope: Scope = 'me') {
  const current = monthKey(today);
  const list: MonthSummary[] = [];
  for (let i = 1; i <= months; i++) {
    const m = addMonths(current, -i);
    const s = monthSummary(state, m, today, scope);
    if (s.income || s.expenses) list.push(s);
  }
  const n = list.length;
  const avg = (fn: (s: MonthSummary) => number) => (n ? Math.round(sum(list, fn) / n) : 0);
  const plannedFixed = sum(chargesForMonth(state, current, today, scope), (c) => c.amount);
  const plannedVariable = sum(variableBudgetLines(state, current, today, scope), (l) => l.budget);
  return {
    monthsUsed: n,
    income: avg((s) => s.income) || state.settings.expectedIncome,
    fixed: avg((s) => s.fixed) || plannedFixed,
    variable: avg((s) => s.variable) || plannedVariable,
    savings: avg((s) => s.savings) || plannedMonthlySavings(state, scope),
    plannedFixed,
    plannedVariable,
  };
}

export function todayLocal(): string {
  return toISODate(new Date());
}

/* ------------------------------ Bilan annuel ------------------------------ */

export function yearSummary(state: AppState, year: number, today: string, scope: Scope = 'me') {
  const months: MonthSummary[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    if (key > monthKey(today)) break;
    months.push(monthSummary(state, key, today, scope));
  }
  const total = (fn: (s: MonthSummary) => number) => sum(months, fn);
  const byCat = new Map<string, { category: Category; amount: number }>();
  for (const s of months) for (const c of s.topCategories) {
    const cur = byCat.get(c.category.id) ?? { category: c.category, amount: 0 };
    cur.amount += c.amount;
    byCat.set(c.category.id, cur);
  }
  const income = total((s) => s.income);
  const savings = total((s) => s.savings);
  const end = `${year}-12-31` < today ? `${year}-12-31` : today;
  return {
    year,
    months,
    income,
    fixed: total((s) => s.fixed),
    variable: total((s) => s.variable),
    expenses: total((s) => s.expenses),
    savings,
    net: total((s) => s.net),
    savingsRate: income > 0 ? savings / income : 0,
    topCategories: [...byCat.values()].sort((a, b) => b.amount - a.amount),
    wealthStart: balanceAt(state, `${year - 1}-12-31`, scope),
    wealthEnd: balanceAt(state, end, scope),
  };
}
