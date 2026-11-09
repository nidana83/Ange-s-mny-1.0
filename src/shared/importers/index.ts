import { toCents } from '../money';

/** Opération brute issue d'un fichier, avant rattachement à un compte. */
export interface ParsedTransaction {
  date: string;
  amount: number; // centimes signés
  description: string;
  merchant: string;
  pending: boolean;
  externalId: string | null;
  currency: string | null;
  /** Nom du sous-compte dans le fichier (ex. Revolut "Product" : Current / Savings) */
  product: string | null;
  balanceAfter: number | null;
}

export interface ParseResult {
  format: 'revolut-csv' | 'generic-csv' | 'ofx';
  transactions: ParsedTransaction[];
  errors: string[];
  closingBalance: number | null;
}

/* ----------------------------- CSV ----------------------------- */

export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectSeparator(header: string): string {
  const counts = [',', ';', '\t'].map((s) => [s, header.split(s).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

/** Convertit 2024-03-05, 05/03/2024, 2024-03-05 10:22:01, 05.03.2024 → YYYY-MM-DD */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

const H = {
  date: ['completed date', 'date', 'date operation', 'date de l operation', 'booking date', 'date comptable', 'started date', 'transaction date', 'date valeur'],
  description: ['description', 'libelle', 'libellé', 'label', 'details', 'detail', 'merchant', 'payee', 'beneficiaire'],
  amount: ['amount', 'montant', 'montant eur', 'value', 'valeur'],
  debit: ['debit', 'débit', 'paid out', 'withdrawal'],
  credit: ['credit', 'crédit', 'paid in', 'deposit'],
  fee: ['fee', 'frais'],
  state: ['state', 'status', 'statut', 'etat'],
  currency: ['currency', 'devise'],
  product: ['product', 'produit', 'compte'],
  balance: ['balance', 'solde'],
  id: ['id', 'transaction id', 'reference', 'référence'],
};

function norm(h: string): string {
  return h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findCol(headers: string[], names: string[]): number {
  const n = headers.map(norm);
  for (const name of names) {
    const idx = n.indexOf(norm(name));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseCsv(text: string): ParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { format: 'generic-csv', transactions: [], errors: ['Fichier vide ou sans en-tête.'], closingBalance: null };
  const sep = detectSeparator(lines[0]);
  const headers = splitCsvLine(lines[0], sep);
  const isRevolut = ['type', 'product', 'started date', 'completed date', 'description', 'amount'].every((h) => findCol(headers, [h]) >= 0);

  const col = {
    date: isRevolut ? findCol(headers, ['completed date']) : findCol(headers, H.date),
    started: isRevolut ? findCol(headers, ['started date']) : -1,
    description: findCol(headers, H.description),
    amount: findCol(headers, H.amount),
    debit: findCol(headers, H.debit),
    credit: findCol(headers, H.credit),
    fee: findCol(headers, H.fee),
    state: findCol(headers, H.state),
    currency: findCol(headers, H.currency),
    product: findCol(headers, H.product),
    balance: findCol(headers, H.balance),
    id: findCol(headers, H.id),
  };
  const errors: string[] = [];
  if (col.date < 0) errors.push('Colonne de date introuvable.');
  if (col.amount < 0 && col.debit < 0 && col.credit < 0) errors.push('Colonne de montant introuvable.');
  if (errors.length) return { format: isRevolut ? 'revolut-csv' : 'generic-csv', transactions: [], errors, closingBalance: null };

  const transactions: ParsedTransaction[] = [];
  let closingBalance: number | null = null;
  let closingDate = '';
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], sep);
    try {
      const state = col.state >= 0 ? cells[col.state]?.toUpperCase() : '';
      if (['REVERTED', 'DECLINED', 'FAILED', 'ANNULEE', 'ANNULÉE'].includes(state)) continue;
      const pending = state === 'PENDING' || state === 'EN ATTENTE';
      const rawDate = cells[col.date] || (col.started >= 0 ? cells[col.started] : '');
      const date = parseDate(rawDate || '');
      if (!date) { errors.push(`Ligne ${i + 1} : date invalide "${rawDate}"`); continue; }
      let amount: number;
      if (col.amount >= 0 && cells[col.amount] !== '') amount = toCents(cells[col.amount]);
      else {
        const debit = col.debit >= 0 && cells[col.debit] ? Math.abs(toCents(cells[col.debit])) : 0;
        const credit = col.credit >= 0 && cells[col.credit] ? Math.abs(toCents(cells[col.credit])) : 0;
        amount = credit - debit;
      }
      // Revolut : les frais sont dans une colonne séparée et viennent en déduction
      if (isRevolut && col.fee >= 0 && cells[col.fee]) amount -= Math.abs(toCents(cells[col.fee]));
      const description = (col.description >= 0 ? cells[col.description] : '') || 'Opération';
      const balanceAfter = col.balance >= 0 && cells[col.balance] ? toCents(cells[col.balance]) : null;
      if (balanceAfter !== null && date >= closingDate && !pending) { closingBalance = balanceAfter; closingDate = date; }
      transactions.push({
        date,
        amount,
        description,
        merchant: cleanMerchant(description),
        pending,
        externalId: col.id >= 0 ? cells[col.id] || null : null,
        currency: col.currency >= 0 ? cells[col.currency] || null : null,
        product: col.product >= 0 ? cells[col.product] || null : null,
        balanceAfter,
      });
    } catch (e) {
      errors.push(`Ligne ${i + 1} : ${(e as Error).message}`);
    }
  }
  return { format: isRevolut ? 'revolut-csv' : 'generic-csv', transactions, errors, closingBalance };
}

export function cleanMerchant(description: string): string {
  return description
    .replace(/^(paiement|payment|cb|carte|card payment|prlv sepa|prlv|vir sepa|vir)\s+/i, '')
    .replace(/\s+\d{2}\/\d{2}(\/\d{2,4})?.*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 80) || description;
}

/* ----------------------------- OFX ----------------------------- */

function ofxTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

export function parseOfx(text: string): ParseResult {
  const errors: string[] = [];
  const transactions: ParsedTransaction[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const date = parseDate(ofxTag(block, 'DTPOSTED') ?? '');
    const amt = ofxTag(block, 'TRNAMT');
    if (!date || !amt) { errors.push('Opération OFX incomplète ignorée.'); continue; }
    const name = ofxTag(block, 'NAME') ?? '';
    const memo = ofxTag(block, 'MEMO') ?? '';
    const description = [name, memo].filter(Boolean).join(' — ') || 'Opération';
    transactions.push({
      date,
      amount: toCents(amt),
      description,
      merchant: cleanMerchant(name || memo),
      pending: false,
      externalId: ofxTag(block, 'FITID'),
      currency: null,
      product: null,
      balanceAfter: null,
    });
  }
  const ledger = text.split(/<LEDGERBAL>/i)[1];
  const bal = ledger ? ofxTag(ledger, 'BALAMT') : null;
  if (!blocks.length) errors.push('Aucune opération trouvée dans le fichier OFX.');
  return { format: 'ofx', transactions, errors, closingBalance: bal ? toCents(bal) : null };
}

export function parseStatementFile(filename: string, content: string): ParseResult {
  if (/\.(ofx|qfx)$/i.test(filename) || /<OFX>/i.test(content)) return parseOfx(content);
  return parseCsv(content);
}
