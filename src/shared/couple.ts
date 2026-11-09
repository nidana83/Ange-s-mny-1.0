/**
 * Finances du couple : qui dépense quoi, contributions au compte commun,
 * répartition des dépenses communes et remboursements.
 *
 * Règle d'or : un virement entre comptes du couple (ou entre mes propres comptes)
 * n'est JAMAIS une dépense ni un revenu. Il peut en revanche être une *contribution*
 * (vers le compte commun) ou un *remboursement* (entre nous deux).
 */
import type { AppState, Category, Owner, Transaction } from './types';
import { DEFAULT_COUPLE } from './types';
import { dateInMonth, diffDays, monthKey } from './dates';
import { normalize } from './categorize';
import { sum } from './money';
import { accountsInScope, counts, isRealExpense, isRealIncome, savingsBetween } from './analytics';

export const REIMBURSEMENT_CATEGORY = 'remboursement-couple';

export interface PersonMonth {
  person: Owner;
  visible: boolean;
  income: number;
  personalExpenses: number;
  sharedPaid: number;
  contributions: number;
  savings: number;
  balance: number;
}

export interface CoupleMonth {
  month: string;
  people: Record<'ange' | 'kelly', PersonMonth>;
  joint: { income: number; expenses: number; balance: number; savings: number };
  commonExpenses: number;
  commonByCategory: { category: Category | null; amount: number; shareAnge: number }[];
  unattributedContributions: number;
  /** Part effective d'Ange dans les dépenses communes (0..1) */
  shareAnge: number;
  splitNote: string | null;
  due: Record<'ange' | 'kelly', number>;
  paid: Record<'ange' | 'kelly', number>;
  reimbursements: { angeToKelly: number; kellyToAnge: number };
  /** > 0 : Kelly doit ce montant à Ange ; < 0 : Ange doit à Kelly */
  settlement: number;
}

/** Part d'Ange (0..1) pour une catégorie donnée, selon le mode de répartition. */
export function shareFor(state: AppState, categoryId: string | null): { share: number; note: string | null } {
  const c = state.couple ?? DEFAULT_COUPLE;
  switch (c.splitMode) {
    case 'manual':
      return { share: clamp(c.manualShare), note: null };
    case 'category':
      return { share: clamp(categoryId && categoryId in c.categoryShares ? c.categoryShares[categoryId] : 0.5), note: null };
    case 'income': {
      const incomes = declaredIncomes(state);
      if (!incomes) return { share: 0.5, note: 'Répartition au prorata indisponible : les deux revenus doivent être renseignés et partagés. 50/50 appliqué.' };
      return { share: incomes.ange / (incomes.ange + incomes.kelly), note: null };
    }
    default:
      return { share: 0.5, note: null };
  }
}

function clamp(n: number) {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0.5));
}

export function declaredIncomes(state: AppState): { ange: number; kelly: number } | null {
  const me = state.viewer?.person ?? 'ange';
  const mine = state.settings.expectedIncome;
  const theirs = state.partner?.sharesWithMe ? state.partner.expectedIncome : null;
  if (!mine || !theirs) return null;
  return me === 'ange' ? { ange: mine, kelly: theirs } : { ange: theirs, kelly: mine };
}

/** Attribue un virement entrant sur un compte commun à la personne qui l'a envoyé. */
function contributor(t: Transaction, state: AppState, outflows: Transaction[], ownerOf: Map<string, Owner>, used: Set<string>): Owner | null {
  const m = outflows.find((o) => !used.has(o.id) && o.amount === -t.amount && Math.abs(diffDays(o.date, t.date)) <= 3);
  if (m) {
    used.add(m.id);
    return ownerOf.get(m.accountId) ?? null;
  }
  const text = normalize(`${t.merchant} ${t.description}`);
  const names: [Owner, string][] = [];
  const me = state.viewer?.person ?? 'ange';
  names.push([me, normalize(state.viewer?.name ?? state.settings.userName)]);
  names.push([me === 'ange' ? 'kelly' : 'ange', normalize(state.partner?.name ?? state.settings.partnerName)]);
  for (const [p, n] of names) if (n.length >= 3 && new RegExp(`\\b${n}\\b`).test(text)) return p;
  return null;
}

export function coupleMonth(state: AppState, month: string): CoupleMonth {
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  const accounts = accountsInScope(state, 'couple');
  const ownerOf = new Map(accounts.map((a) => [a.id, a.owner]));
  const txs = state.transactions.filter((t) => ownerOf.has(t.accountId) && counts(t));
  const inMonth = txs.filter((t) => monthKey(t.date) === month);
  const visible = (p: Owner) => accounts.some((a) => a.owner === p) || (state.viewer?.person ?? 'ange') === p;

  const person = (p: 'ange' | 'kelly'): PersonMonth => {
    const own = inMonth.filter((t) => ownerOf.get(t.accountId) === p);
    return {
      person: p,
      visible: visible(p),
      income: sum(own.filter((t) => isRealIncome(t, cats)), (t) => t.amount),
      personalExpenses: -sum(own.filter((t) => isRealExpense(t, cats) && !t.shared), (t) => t.amount),
      sharedPaid: -sum(own.filter((t) => isRealExpense(t, cats) && t.shared), (t) => t.amount),
      contributions: 0,
      savings: 0,
      balance: 0,
    };
  };
  const people = { ange: person('ange'), kelly: person('kelly') };

  // Contributions au(x) compte(s) commun(s)
  const jointIn = inMonth.filter((t) => ownerOf.get(t.accountId) === 'joint' && t.amount > 0 && t.isTransfer);
  const personalOut = txs.filter((t) => ownerOf.get(t.accountId) !== 'joint' && t.amount < 0 && t.isTransfer);
  const used = new Set<string>();
  let unattributed = 0;
  for (const t of jointIn) {
    const who = contributor(t, state, personalOut, ownerOf, used);
    if (who === 'ange' || who === 'kelly') people[who].contributions += t.amount;
    else unattributed += t.amount;
  }

  // Dépenses communes = dépenses réelles des comptes communs + dépenses marquées « commune »
  const common = inMonth.filter((t) => isRealExpense(t, cats) && (ownerOf.get(t.accountId) === 'joint' || t.shared));
  const commonExpenses = -sum(common, (t) => t.amount);
  const byCat = new Map<string, number>();
  for (const t of common) byCat.set(t.categoryId ?? '', (byCat.get(t.categoryId ?? '') ?? 0) - t.amount);
  let note: string | null = null;
  let dueAnge = 0;
  const commonByCategory = [...byCat.entries()].map(([id, amount]) => {
    const { share, note: n } = shareFor(state, id || null);
    if (n) note = n;
    dueAnge += amount * share;
    return { category: cats.get(id) ?? null, amount, shareAnge: share };
  }).sort((a, b) => b.amount - a.amount);
  dueAnge = Math.round(dueAnge);
  if (!common.length) note = note ?? shareFor(state, null).note;

  // Remboursements entre nous (catégorie dédiée), dédoublonnés si les deux côtés sont visibles
  const reimb = inMonth.filter((t) => t.categoryId === REIMBURSEMENT_CATEGORY && ownerOf.get(t.accountId) !== 'joint');
  const flows: { dir: 'a2k' | 'k2a'; amount: number; date: string }[] = [];
  for (const t of reimb) {
    const o = ownerOf.get(t.accountId);
    const dir = (o === 'ange') === (t.amount < 0) ? 'a2k' : 'k2a';
    const amount = Math.abs(t.amount);
    if (!flows.some((f) => f.dir === dir && f.amount === amount && Math.abs(diffDays(f.date, t.date)) <= 3)) flows.push({ dir, amount, date: t.date });
  }
  const reimbursements = { angeToKelly: sum(flows.filter((f) => f.dir === 'a2k'), (f) => f.amount), kellyToAnge: sum(flows.filter((f) => f.dir === 'k2a'), (f) => f.amount) };

  const due = { ange: dueAnge, kelly: commonExpenses - dueAnge };
  const paid = { ange: people.ange.contributions + people.ange.sharedPaid, kelly: people.kelly.contributions + people.kelly.sharedPaid };
  const balA = paid.ange - due.ange;
  const balK = paid.kelly - due.kelly;
  const settlement = Math.round((balA - balK) / 2) - reimbursements.kellyToAnge + reimbursements.angeToKelly;

  const end = dateInMonth(month, 31);
  const jointTx = inMonth.filter((t) => ownerOf.get(t.accountId) === 'joint');
  for (const p of ['ange', 'kelly'] as const) {
    people[p].savings = savingsOf(state, p, `${month}-01`, end);
    people[p].balance = people[p].income - people[p].personalExpenses - people[p].sharedPaid;
  }
  return {
    month,
    people,
    joint: {
      income: sum(jointTx.filter((t) => isRealIncome(t, cats)), (t) => t.amount),
      expenses: -sum(jointTx.filter((t) => isRealExpense(t, cats)), (t) => t.amount),
      balance: sum(accounts.filter((a) => a.owner === 'joint' && a.includeInAvailable), (a) => a.balance),
      savings: savingsOf(state, 'joint', `${month}-01`, end),
    },
    commonExpenses,
    commonByCategory,
    unattributedContributions: unattributed,
    shareAnge: commonExpenses ? dueAnge / commonExpenses : shareFor(state, null).share,
    splitNote: note,
    due,
    paid,
    reimbursements,
    settlement,
  };
}

/** Épargne nette d'une personne (ou du commun) sur la période, sur ses comptes d'épargne visibles. */
function savingsOf(state: AppState, owner: Owner, from: string, to: string): number {
  return savingsBetween({ ...state, accounts: state.accounts.filter((a) => a.owner === owner) }, from, to, 'couple');
}
