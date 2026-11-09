import type { Account, Category, CategoryRule, Transaction } from './types';
import { diffDays } from './dates';

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Empreinte stable d'une opération pour détecter les doublons entre imports et synchronisations. */
export function transactionHash(t: Pick<Transaction, 'accountId' | 'date' | 'amount' | 'description'>): string {
  const base = `${t.accountId}|${t.date}|${t.amount}|${normalize(t.description)}`;
  // FNV-1a 32 bits ×2 — suffisant pour une clé d'unicité locale
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Catégorisation automatique :
 * 1. règles apprises (l'utilisateur a recatégorisé une opération) — prioritaires ;
 * 2. mots-clés des catégories ;
 * 3. revenus positifs non reconnus → première catégorie « income ».
 */
export function categorize(
  t: Pick<Transaction, 'description' | 'merchant' | 'amount'>,
  categories: Category[],
  rules: CategoryRule[],
): { categoryId: string | null; markTransfer: boolean } {
  const text = normalize(`${t.merchant} ${t.description}`);
  const sortedRules = [...rules].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const r of sortedRules) {
    const p = normalize(r.pattern);
    if (p && text.includes(p)) return { categoryId: r.categoryId, markTransfer: r.markTransfer };
  }
  let best: { id: string; len: number } | null = null;
  for (const c of categories) {
    if (c.archived) continue;
    // Une dépense ne doit pas tomber dans une catégorie de revenu et inversement
    if (t.amount < 0 && c.kind === 'income') continue;
    if (t.amount > 0 && (c.kind === 'variable' || c.kind === 'fixed')) continue;
    for (const k of c.keywords) {
      const nk = normalize(k);
      if (nk && (` ${text} `).includes(` ${nk}`) && (!best || nk.length > best.len)) best = { id: c.id, len: nk.length };
    }
  }
  if (best) {
    const cat = categories.find((c) => c.id === best!.id)!;
    return { categoryId: best.id, markTransfer: cat.kind === 'transfer' };
  }
  if (t.amount > 0) {
    const income = categories.find((c) => c.kind === 'income' && !c.archived);
    return { categoryId: income?.id ?? null, markTransfer: false };
  }
  return { categoryId: null, markTransfer: false };
}

const TRANSFER_PATTERNS = [
  /\bto pocket\b/, /\bfrom pocket\b/, /\bpocket\b/, /\bvault\b/, /\bcoffre\b/, /\bsavings\b/, /\bepargne\b/,
  /\bexchanged? to\b/, /\btransfer (to|from) (ange|kelly)\b/, /\bvirement interne\b/, /\bentre mes comptes\b/,
  /\btop[- ]?up\b/, /\bcompte commun\b/, /\bjoint account\b/, /\brechargement\b/, /\bround[- ]?up\b/, /\barrondi\b/, /\bmoney added from\b/,
];

/**
 * Détection des transferts internes :
 * - libellé typique (coffre, pocket, arrondi, change de devise…)
 * - mention du nom d'un titulaire suivi (ex. "Transfer to KELLY …") quand ses comptes sont suivis
 * - paire d'opérations opposées de même montant sur deux comptes suivis à ≤ 3 jours d'écart.
 * Renvoie l'ensemble des ids à marquer comme transferts.
 */
export function detectTransfers(
  transactions: Transaction[],
  accounts: Account[],
  ownerNames: string[] = [],
): Set<string> {
  const ids = new Set<string>();
  const names = ownerNames.map(normalize).filter((n) => n.length >= 3);
  const accountIds = new Set(accounts.map((a) => a.id));

  for (const t of transactions) {
    const text = normalize(`${t.merchant} ${t.description}`);
    if (TRANSFER_PATTERNS.some((re) => re.test(text))) ids.add(t.id);
    else if (names.length && /\b(transfer|virement|vir|payment from|paiement de|to|from)\b/.test(text)
      && names.some((n) => new RegExp(`\\b${n}\\b`).test(text))) ids.add(t.id);
  }

  const outs = transactions.filter((t) => t.amount < 0 && accountIds.has(t.accountId));
  const ins = transactions.filter((t) => t.amount > 0 && accountIds.has(t.accountId));
  const used = new Set<string>();
  for (const o of outs) {
    const match = ins.find(
      (i) => !used.has(i.id) && i.accountId !== o.accountId && i.amount === -o.amount && Math.abs(diffDays(o.date, i.date)) <= 3,
    );
    if (match) {
      used.add(match.id);
      ids.add(o.id);
      ids.add(match.id);
    }
  }
  return ids;
}

/** Renvoie les transactions candidates déjà présentes (même hash, ou même identifiant externe). */
export function findDuplicates<T extends Pick<Transaction, 'hash' | 'externalId' | 'accountId'>>(
  incoming: T[],
  existing: Pick<Transaction, 'hash' | 'externalId' | 'accountId'>[],
): { fresh: T[]; duplicates: T[] } {
  const hashes = new Set(existing.map((e) => e.hash));
  const ext = new Set(existing.filter((e) => e.externalId).map((e) => `${e.accountId}|${e.externalId}`));
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const t of incoming) {
    const key = t.externalId ? `${t.accountId}|${t.externalId}` : null;
    if (hashes.has(t.hash) || (key && ext.has(key))) duplicates.push(t);
    else {
      fresh.push(t);
      hashes.add(t.hash);
      if (key) ext.add(key);
    }
  }
  return { fresh, duplicates };
}
