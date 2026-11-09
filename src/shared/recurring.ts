/** Détection des paiements récurrents (abonnements, prélèvements…) à partir de l'historique. */
import type { AppState, Transaction } from './types';
import { addDays, diffDays } from './dates';
import { normalize } from './categorize';
import { counts } from './analytics';

export interface Recurring {
  key: string;
  label: string;
  amount: number; // centimes positifs (médiane)
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  occurrences: number;
  lastDate: string;
  nextDate: string;
  transactionIds: string[];
  categoryId: string | null;
  accountId: string;
  /** Déjà suivi comme charge fixe */
  tracked: boolean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function merchantKey(t: Pick<Transaction, 'merchant' | 'description'>): string {
  return normalize(t.merchant || t.description).replace(/\d+/g, '').split(' ').filter(Boolean).slice(0, 3).join(' ');
}

const FREQS: { f: Recurring['frequency']; days: number; tol: number }[] = [
  { f: 'weekly', days: 7, tol: 2 },
  { f: 'monthly', days: 30.5, tol: 5 },
  { f: 'quarterly', days: 91, tol: 10 },
  { f: 'yearly', days: 365, tol: 20 },
];

export function detectRecurring(state: AppState): Recurring[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of state.transactions) {
    if (t.amount >= 0 || t.isTransfer || !counts(t)) continue;
    const k = merchantKey(t);
    if (k.length < 3) continue;
    const key = `${t.accountId}|${k}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((t) => -t.amount);
    const med = median(amounts);
    // Montant stable : au moins 80 % des occurrences à ±15 % de la médiane
    const stable = sorted.filter((t) => Math.abs(-t.amount - med) <= Math.max(100, med * 0.15));
    if (stable.length < 3 || stable.length / sorted.length < 0.8) continue;
    const gaps = stable.slice(1).map((t, i) => diffDays(stable[i].date, t.date));
    const g = median(gaps);
    const freq = FREQS.find((x) => Math.abs(g - x.days) <= x.tol);
    if (!freq) continue;
    const regular = gaps.filter((x) => Math.abs(x - freq.days) <= freq.tol * 1.5).length / gaps.length;
    if (regular < 0.7) continue;
    const last = stable[stable.length - 1];
    const label = last.merchant || last.description;
    const k = key.split('|')[1];
    const tracked = state.charges.some((c) => c.active && (normalize(c.matchKeyword || c.name).length > 2) && (k.includes(normalize(c.matchKeyword || c.name)) || normalize(c.matchKeyword || c.name).includes(k)));
    out.push({
      key,
      label,
      amount: med,
      frequency: freq.f,
      occurrences: stable.length,
      lastDate: last.date,
      nextDate: addDays(last.date, Math.round(freq.days)),
      transactionIds: stable.map((t) => t.id),
      categoryId: last.categoryId,
      accountId: last.accountId,
      tracked,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
