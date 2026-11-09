import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  Account, AppState, BalanceSnapshot, BankConnection, Category, CategoryRule, ChargeMonth, FixedCharge, Goal,
  MonthBudget, Settings, SyncRun, Transaction,
} from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { defaultCategories } from '../shared/defaults';

export type DB = Database.Database;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS bank_connections (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, institution TEXT NOT NULL, country TEXT NOT NULL,
  owner TEXT NOT NULL, status TEXT NOT NULL, valid_until TEXT, consent_by TEXT,
  session_secret TEXT, auth_state TEXT, created_at TEXT NOT NULL, last_sync_at TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, owner TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'EUR', balance INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'manual', external_id TEXT, connection_id TEXT REFERENCES bank_connections(id) ON DELETE SET NULL,
  consent_at TEXT, include_in_available INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, color TEXT NOT NULL, icon TEXT NOT NULL,
  monthly_budget INTEGER NOT NULL DEFAULT 0, keywords TEXT NOT NULL DEFAULT '[]', archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL, amount INTEGER NOT NULL, description TEXT NOT NULL, merchant TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, is_transfer INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0, external_id TEXT, hash TEXT NOT NULL, source TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_hash ON transactions(hash);

CREATE TABLE IF NOT EXISTS fixed_charges (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, amount INTEGER NOT NULL, day_of_month INTEGER NOT NULL,
  frequency TEXT NOT NULL, account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, start_month TEXT NOT NULL, end_month TEXT,
  match_keyword TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS charge_months (
  charge_id TEXT NOT NULL REFERENCES fixed_charges(id) ON DELETE CASCADE, month TEXT NOT NULL,
  status TEXT NOT NULL, amount INTEGER, transaction_id TEXT, PRIMARY KEY (charge_id, month)
);

CREATE TABLE IF NOT EXISTS month_budgets (
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE, month TEXT NOT NULL, amount INTEGER NOT NULL,
  PRIMARY KEY (category_id, month)
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, target INTEGER NOT NULL, saved INTEGER NOT NULL DEFAULT 0,
  monthly_contribution INTEGER NOT NULL DEFAULT 0, target_date TEXT, owner TEXT NOT NULL, horizon TEXT NOT NULL,
  kind TEXT NOT NULL, account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, date TEXT NOT NULL, balance INTEGER NOT NULL,
  PRIMARY KEY (account_id, date)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, connection_id TEXT, started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL, imported INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0,
  transfers INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS category_rules (
  id TEXT PRIMARY KEY, pattern TEXT NOT NULL UNIQUE, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  mark_transfer INTEGER NOT NULL DEFAULT 0
);
`;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(SCHEMA);
  const count = (db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
  if (count === 0) {
    const repo = new Repo(db);
    for (const c of defaultCategories()) repo.upsertCategory(c);
  }
  return db;
}

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
const b = (v: unknown) => (v ? 1 : 0);

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapAccount = (r: any): Account => ({
  id: r.id, name: r.name, type: r.type, owner: r.owner, institution: r.institution, currency: r.currency, balance: r.balance,
  provider: r.provider, externalId: r.external_id, connectionId: r.connection_id, consentAt: r.consent_at,
  includeInAvailable: !!r.include_in_available, archived: !!r.archived, updatedAt: r.updated_at,
});
const mapTx = (r: any): Transaction => ({
  id: r.id, accountId: r.account_id, date: r.date, amount: r.amount, description: r.description, merchant: r.merchant,
  categoryId: r.category_id, isTransfer: !!r.is_transfer, pending: !!r.pending, externalId: r.external_id, hash: r.hash,
  source: r.source, note: r.note,
});
const mapCategory = (r: any): Category => ({
  id: r.id, name: r.name, kind: r.kind, color: r.color, icon: r.icon, monthlyBudget: r.monthly_budget,
  keywords: JSON.parse(r.keywords), archived: !!r.archived,
});
const mapCharge = (r: any): FixedCharge => ({
  id: r.id, name: r.name, amount: r.amount, dayOfMonth: r.day_of_month, frequency: r.frequency, accountId: r.account_id,
  categoryId: r.category_id, startMonth: r.start_month, endMonth: r.end_month, matchKeyword: r.match_keyword, active: !!r.active,
});
const mapGoal = (r: any): Goal => ({
  id: r.id, name: r.name, target: r.target, saved: r.saved, monthlyContribution: r.monthly_contribution, targetDate: r.target_date,
  owner: r.owner, horizon: r.horizon, kind: r.kind, accountId: r.account_id, createdAt: r.created_at,
});
const mapConnection = (r: any): BankConnection => ({
  id: r.id, provider: r.provider, institution: r.institution, country: r.country, owner: r.owner, status: r.status,
  validUntil: r.valid_until, consentBy: r.consent_by, createdAt: r.created_at, lastSyncAt: r.last_sync_at,
});
const mapRun = (r: any): SyncRun => ({
  id: r.id, provider: r.provider, connectionId: r.connection_id, startedAt: r.started_at, finishedAt: r.finished_at,
  status: r.status, imported: r.imported, duplicates: r.duplicates, transfers: r.transfers, message: r.message,
});

export class Repo {
  constructor(public db: DB) {}

  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /* Paramètres */
  getSettings(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const s: any = { ...DEFAULT_SETTINGS };
    for (const r of rows) if (r.key in s) s[r.key] = JSON.parse(r.value);
    return s;
  }
  saveSettings(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS) stmt.run(k, JSON.stringify(v));
    return this.getSettings();
  }
  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(`__${key}`) as { value: string } | undefined;
    return r ? JSON.parse(r.value) : null;
  }
  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`__${key}`, JSON.stringify(value));
  }

  /* Comptes */
  accounts(): Account[] {
    return (this.db.prepare('SELECT * FROM accounts ORDER BY owner, name').all()).map(mapAccount);
  }
  account(id: string): Account | null {
    const r = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    return r ? mapAccount(r) : null;
  }
  upsertAccount(a: Account) {
    this.db.prepare(`INSERT INTO accounts (id, name, type, owner, institution, currency, balance, provider, external_id, connection_id, consent_at, include_in_available, archived, updated_at)
      VALUES (@id, @name, @type, @owner, @institution, @currency, @balance, @provider, @externalId, @connectionId, @consentAt, @inc, @arch, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, owner=excluded.owner, institution=excluded.institution,
      currency=excluded.currency, balance=excluded.balance, provider=excluded.provider, external_id=excluded.external_id,
      connection_id=excluded.connection_id, consent_at=excluded.consent_at, include_in_available=excluded.include_in_available,
      archived=excluded.archived, updated_at=excluded.updated_at`).run({ ...a, inc: b(a.includeInAvailable), arch: b(a.archived) });
  }
  deleteAccount(id: string) { this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id); }
  setBalance(id: string, balance: number, date: string) {
    this.db.prepare('UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?').run(balance, nowIso(), id);
    this.db.prepare('INSERT INTO balance_snapshots(account_id, date, balance) VALUES (?, ?, ?) ON CONFLICT(account_id, date) DO UPDATE SET balance = excluded.balance').run(id, date, balance);
  }

  /* Transactions */
  transactions(): Transaction[] {
    return (this.db.prepare('SELECT * FROM transactions ORDER BY date DESC, created_at DESC').all()).map(mapTx);
  }
  insertTransaction(t: Transaction) {
    this.db.prepare(`INSERT OR IGNORE INTO transactions (id, account_id, date, amount, description, merchant, category_id, is_transfer, pending, external_id, hash, source, note, created_at)
      VALUES (@id, @accountId, @date, @amount, @description, @merchant, @categoryId, @tr, @pd, @externalId, @hash, @source, @note, @createdAt)`)
      .run({ ...t, tr: b(t.isTransfer), pd: b(t.pending), createdAt: nowIso() });
  }
  updateTransaction(id: string, patch: Partial<Pick<Transaction, 'categoryId' | 'isTransfer' | 'note' | 'pending' | 'amount' | 'date' | 'description' | 'merchant'>>) {
    const cur = this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!cur) return null;
    const t = { ...mapTx(cur), ...patch };
    this.db.prepare(`UPDATE transactions SET category_id=@categoryId, is_transfer=@tr, note=@note, pending=@pd, amount=@amount, date=@date, description=@description, merchant=@merchant WHERE id=@id`)
      .run({ ...t, tr: b(t.isTransfer), pd: b(t.pending) });
    return t;
  }
  deleteTransaction(id: string) { this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id); }
  markTransfers(ids: string[]) {
    const stmt = this.db.prepare('UPDATE transactions SET is_transfer = 1 WHERE id = ?');
    for (const id of ids) stmt.run(id);
  }
  /** Supprime une opération en attente remplacée par sa version comptabilisée. */
  deletePendingMatching(accountId: string, amount: number, from: string, to: string) {
    this.db.prepare('DELETE FROM transactions WHERE account_id = ? AND pending = 1 AND amount = ? AND date BETWEEN ? AND ?').run(accountId, amount, from, to);
  }

  /* Catégories */
  categories(): Category[] { return (this.db.prepare('SELECT * FROM categories ORDER BY kind, name').all()).map(mapCategory); }
  upsertCategory(c: Category) {
    this.db.prepare(`INSERT INTO categories (id, name, kind, color, icon, monthly_budget, keywords, archived) VALUES (@id, @name, @kind, @color, @icon, @monthlyBudget, @kw, @arch)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, color=excluded.color, icon=excluded.icon, monthly_budget=excluded.monthly_budget, keywords=excluded.keywords, archived=excluded.archived`)
      .run({ ...c, kw: JSON.stringify(c.keywords), arch: b(c.archived) });
  }
  deleteCategory(id: string) { this.db.prepare('DELETE FROM categories WHERE id = ?').run(id); }

  /* Règles */
  rules(): CategoryRule[] {
    return (this.db.prepare('SELECT * FROM category_rules').all() as any[]).map((r) => ({ id: r.id, pattern: r.pattern, categoryId: r.category_id, markTransfer: !!r.mark_transfer }));
  }
  upsertRule(pattern: string, categoryId: string, markTransfer: boolean) {
    this.db.prepare('INSERT INTO category_rules (id, pattern, category_id, mark_transfer) VALUES (?, ?, ?, ?) ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id, mark_transfer = excluded.mark_transfer')
      .run(uid(), pattern, categoryId, b(markTransfer));
  }
  deleteRule(id: string) { this.db.prepare('DELETE FROM category_rules WHERE id = ?').run(id); }

  /* Charges fixes */
  charges(): FixedCharge[] { return (this.db.prepare('SELECT * FROM fixed_charges ORDER BY day_of_month').all()).map(mapCharge); }
  upsertCharge(c: FixedCharge) {
    this.db.prepare(`INSERT INTO fixed_charges (id, name, amount, day_of_month, frequency, account_id, category_id, start_month, end_month, match_keyword, active)
      VALUES (@id, @name, @amount, @dayOfMonth, @frequency, @accountId, @categoryId, @startMonth, @endMonth, @matchKeyword, @act)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, amount=excluded.amount, day_of_month=excluded.day_of_month, frequency=excluded.frequency,
      account_id=excluded.account_id, category_id=excluded.category_id, start_month=excluded.start_month, end_month=excluded.end_month,
      match_keyword=excluded.match_keyword, active=excluded.active`).run({ ...c, act: b(c.active) });
  }
  deleteCharge(id: string) { this.db.prepare('DELETE FROM fixed_charges WHERE id = ?').run(id); }
  chargeMonths(): ChargeMonth[] {
    return (this.db.prepare('SELECT * FROM charge_months').all() as any[]).map((r) => ({ chargeId: r.charge_id, month: r.month, status: r.status, amount: r.amount, transactionId: r.transaction_id }));
  }
  setChargeMonth(m: ChargeMonth) {
    this.db.prepare(`INSERT INTO charge_months (charge_id, month, status, amount, transaction_id) VALUES (@chargeId, @month, @status, @amount, @transactionId)
      ON CONFLICT(charge_id, month) DO UPDATE SET status=excluded.status, amount=excluded.amount, transaction_id=excluded.transaction_id`).run(m);
  }
  clearChargeMonth(chargeId: string, month: string) { this.db.prepare('DELETE FROM charge_months WHERE charge_id = ? AND month = ?').run(chargeId, month); }

  /* Budgets mensuels */
  monthBudgets(): MonthBudget[] {
    return (this.db.prepare('SELECT * FROM month_budgets').all() as any[]).map((r) => ({ categoryId: r.category_id, month: r.month, amount: r.amount }));
  }
  setMonthBudget(m: MonthBudget) {
    this.db.prepare('INSERT INTO month_budgets (category_id, month, amount) VALUES (@categoryId, @month, @amount) ON CONFLICT(category_id, month) DO UPDATE SET amount = excluded.amount').run(m);
  }
  clearMonthBudget(categoryId: string, month: string) { this.db.prepare('DELETE FROM month_budgets WHERE category_id = ? AND month = ?').run(categoryId, month); }

  /* Objectifs */
  goals(): Goal[] { return (this.db.prepare('SELECT * FROM goals ORDER BY created_at').all()).map(mapGoal); }
  upsertGoal(g: Goal) {
    this.db.prepare(`INSERT INTO goals (id, name, target, saved, monthly_contribution, target_date, owner, horizon, kind, account_id, created_at)
      VALUES (@id, @name, @target, @saved, @monthlyContribution, @targetDate, @owner, @horizon, @kind, @accountId, @createdAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, target=excluded.target, saved=excluded.saved, monthly_contribution=excluded.monthly_contribution,
      target_date=excluded.target_date, owner=excluded.owner, horizon=excluded.horizon, kind=excluded.kind, account_id=excluded.account_id`).run(g);
  }
  deleteGoal(id: string) { this.db.prepare('DELETE FROM goals WHERE id = ?').run(id); }

  /* Snapshots */
  snapshots(): BalanceSnapshot[] {
    return (this.db.prepare('SELECT * FROM balance_snapshots ORDER BY date').all() as any[]).map((r) => ({ accountId: r.account_id, date: r.date, balance: r.balance }));
  }

  /* Connexions bancaires */
  connections(): BankConnection[] { return (this.db.prepare('SELECT * FROM bank_connections ORDER BY created_at DESC').all()).map(mapConnection); }
  connectionRow(id: string): any { return this.db.prepare('SELECT * FROM bank_connections WHERE id = ?').get(id); }
  connectionByState(state: string): any { return this.db.prepare('SELECT * FROM bank_connections WHERE auth_state = ?').get(state); }
  insertConnection(c: BankConnection & { authState: string }) {
    this.db.prepare(`INSERT INTO bank_connections (id, provider, institution, country, owner, status, valid_until, consent_by, auth_state, created_at)
      VALUES (@id, @provider, @institution, @country, @owner, @status, @validUntil, @consentBy, @authState, @createdAt)`).run(c);
  }
  updateConnection(id: string, patch: { status?: string; sessionSecret?: string | null; validUntil?: string | null; lastSyncAt?: string; authState?: string | null }) {
    const cur = this.connectionRow(id);
    if (!cur) return;
    this.db.prepare('UPDATE bank_connections SET status=?, session_secret=?, valid_until=?, last_sync_at=?, auth_state=? WHERE id=?').run(
      patch.status ?? cur.status,
      patch.sessionSecret !== undefined ? patch.sessionSecret : cur.session_secret,
      patch.validUntil !== undefined ? patch.validUntil : cur.valid_until,
      patch.lastSyncAt ?? cur.last_sync_at,
      patch.authState !== undefined ? patch.authState : cur.auth_state,
      id,
    );
  }
  deleteConnection(id: string) { this.db.prepare('DELETE FROM bank_connections WHERE id = ?').run(id); }

  /* Synchronisations */
  syncRuns(limit = 50): SyncRun[] { return (this.db.prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?').all(limit)).map(mapRun); }
  startRun(provider: string, connectionId: string | null): string {
    const id = uid();
    this.db.prepare('INSERT INTO sync_runs (id, provider, connection_id, started_at, status) VALUES (?, ?, ?, ?, ?)').run(id, provider, connectionId, nowIso(), 'running');
    return id;
  }
  finishRun(id: string, r: { status: 'success' | 'error'; imported?: number; duplicates?: number; transfers?: number; message?: string }) {
    this.db.prepare('UPDATE sync_runs SET finished_at=?, status=?, imported=?, duplicates=?, transfers=?, message=? WHERE id=?')
      .run(nowIso(), r.status, r.imported ?? 0, r.duplicates ?? 0, r.transfers ?? 0, r.message ?? '', id);
  }

  state(bankingConfigured: boolean): AppState {
    return {
      settings: this.getSettings(),
      accounts: this.accounts(),
      transactions: this.transactions(),
      categories: this.categories(),
      charges: this.charges(),
      chargeMonths: this.chargeMonths(),
      monthBudgets: this.monthBudgets(),
      goals: this.goals(),
      snapshots: this.snapshots(),
      syncRuns: this.syncRuns(),
      connections: this.connections(),
      rules: this.rules(),
      bankingConfigured,
    };
  }

  wipe() {
    this.db.exec(`DELETE FROM transactions; DELETE FROM charge_months; DELETE FROM fixed_charges; DELETE FROM month_budgets; DELETE FROM goals;
      DELETE FROM balance_snapshots; DELETE FROM sync_runs; DELETE FROM category_rules; DELETE FROM accounts; DELETE FROM bank_connections;
      DELETE FROM settings WHERE key NOT LIKE '\\_\\_%' ESCAPE '\\';`);
  }
}
