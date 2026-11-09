import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  Account, AppState, ArchivedMonth, AuditEntry, BalanceSnapshot, BankConnection, Category, CategoryRule, ChargeMonth,
  CoupleSettings, FixedCharge, Goal, MonthBudget, Owner, PartnerInfo, Settings, SyncRun, Transaction, ViewerInfo,
} from '../shared/types';
import { DEFAULT_ALERTS, DEFAULT_COUPLE, DEFAULT_SETTINGS, partnerOf } from '../shared/types';
import { defaultCategories } from '../shared/defaults';

export type DB = Database.Database;
export type Person = 'ange' | 'kelly';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, person TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL, share_with_partner INTEGER NOT NULL DEFAULT 0, share_granted_at TEXT,
  created_at TEXT NOT NULL, last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, mode TEXT NOT NULL DEFAULT 'real',
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, user_agent TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS invitations (
  code_hash TEXT PRIMARY KEY, person TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, user_id TEXT, person TEXT, action TEXT NOT NULL, entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT, details TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_person ON audit_log(person, at);

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

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL, created_by TEXT
);

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
CREATE TABLE IF NOT EXISTS person_budgets (
  person TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE, month TEXT NOT NULL DEFAULT '*',
  amount INTEGER NOT NULL, PRIMARY KEY (person, category_id, month)
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

CREATE TABLE IF NOT EXISTS archives (
  person TEXT NOT NULL, month TEXT NOT NULL, closed_at TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY (person, month)
);
`;

/** Ajoute une colonne si elle n'existe pas encore (migrations sans perte de données). */
function addColumn(db: DB, table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

function migrate(db: DB) {
  addColumn(db, 'transactions', 'excluded', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'transactions', 'cancelled', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'transactions', 'shared', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'fixed_charges', 'owner', "TEXT NOT NULL DEFAULT 'ange'");
  addColumn(db, 'sync_runs', 'person', 'TEXT');
  // Paramètres v1 (globaux) → paramètres personnels d'Ange
  const legacy = db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE '%:%' AND key != 'couple' AND key NOT LIKE '\\_\\_%' ESCAPE '\\'").all() as { key: string; value: string }[];
  for (const r of legacy) {
    db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)').run(`p:ange:${r.key}`, r.value);
    db.prepare('DELETE FROM settings WHERE key = ?').run(r.key);
  }
  // Budgets v1 → budgets personnels d'Ange
  db.exec(`INSERT OR IGNORE INTO person_budgets (person, category_id, month, amount) SELECT 'ange', id, '*', monthly_budget FROM categories WHERE monthly_budget > 0
            AND NOT EXISTS (SELECT 1 FROM person_budgets);
           INSERT OR IGNORE INTO person_budgets (person, category_id, month, amount) SELECT 'ange', category_id, month, amount FROM month_budgets;
           DELETE FROM month_budgets;`);
  // Nouvelles catégories par défaut ajoutées dans les versions suivantes
  const existing = new Set((db.prepare('SELECT id FROM categories').all() as { id: string }[]).map((r) => r.id));
  if (existing.size) for (const c of defaultCategories()) if (!existing.has(c.id)) new Repo(db).upsertCategory(c);
}

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(SCHEMA);
  const count = (db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
  if (count === 0) {
    const repo = new Repo(db);
    for (const c of defaultCategories()) {
      repo.upsertCategory({ ...c, monthlyBudget: 0 });
      if (c.monthlyBudget) for (const p of ['ange', 'kelly'] as Person[]) repo.setDefaultBudget(p, c.id, c.monthlyBudget);
    }
  }
  migrate(db);
  return db;
}

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
const b = (v: unknown) => (v ? 1 : 0);

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapAccount = (r: any): Account => ({
  id: r.id, name: r.name, type: r.type, owner: r.owner, institution: r.institution, currency: r.currency, balance: r.balance,
  provider: r.provider, externalId: r.external_id, connectionId: r.connection_id, consentAt: r.consent_at,
  includeInAvailable: !!r.include_in_available, archived: !!r.archived, updatedAt: r.updated_at, originalBalance: r.balance,
});
const mapTx = (r: any): Transaction => ({
  id: r.id, accountId: r.account_id, date: r.date, amount: r.amount, description: r.description, merchant: r.merchant,
  categoryId: r.category_id, isTransfer: !!r.is_transfer, pending: !!r.pending, externalId: r.external_id, hash: r.hash,
  source: r.source, note: r.note, excluded: !!r.excluded, cancelled: !!r.cancelled, shared: !!r.shared,
  attachmentCount: r.attachment_count ?? 0, originalAmount: null,
});
const mapCategory = (r: any): Category => ({
  id: r.id, name: r.name, kind: r.kind, color: r.color, icon: r.icon, monthlyBudget: r.monthly_budget,
  keywords: JSON.parse(r.keywords), archived: !!r.archived,
});
const mapCharge = (r: any): FixedCharge => ({
  id: r.id, name: r.name, amount: r.amount, dayOfMonth: r.day_of_month, frequency: r.frequency, accountId: r.account_id,
  categoryId: r.category_id, startMonth: r.start_month, endMonth: r.end_month, matchKeyword: r.match_keyword, active: !!r.active,
  owner: r.owner,
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

export interface UserRow {
  id: string; person: Person; username: string; display_name: string; password_hash: string;
  share_with_partner: number; share_granted_at: string | null; created_at: string; last_login_at: string | null;
}

/** Ce que voit l'utilisateur connecté. */
export interface ViewContext {
  person: Person;
  user: UserRow | null;
  partner: UserRow | null;
  /** En mode démo, le/la partenaire fictif(ve) partage ses données */
  demo: boolean;
}

const PERSONAL_KEYS = new Set(Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'userName' && k !== 'partnerName'));

export class Repo {
  constructor(public db: DB) {}

  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /* ----------------------------- Utilisateurs ----------------------------- */
  users(): UserRow[] { return this.db.prepare('SELECT * FROM users').all() as UserRow[]; }
  userById(id: string): UserRow | null { return (this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow) ?? null; }
  userByPerson(p: Person): UserRow | null { return (this.db.prepare('SELECT * FROM users WHERE person = ?').get(p) as UserRow) ?? null; }
  userByUsername(u: string): UserRow | null { return (this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(u) as UserRow) ?? null; }
  createUser(u: { person: Person; username: string; displayName: string; passwordHash: string }): UserRow {
    const id = uid();
    this.db.prepare('INSERT INTO users (id, person, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, u.person, u.username, u.displayName, u.passwordHash, nowIso());
    return this.userById(id)!;
  }
  updateUser(id: string, patch: Partial<{ display_name: string; password_hash: string; share_with_partner: number; share_granted_at: string | null; last_login_at: string }>) {
    for (const [k, v] of Object.entries(patch)) this.db.prepare(`UPDATE users SET ${k} = ? WHERE id = ?`).run(v, id);
  }
  deleteUser(id: string) { this.db.prepare('DELETE FROM users WHERE id = ?').run(id); }

  /* ------------------------------- Sessions ------------------------------- */
  createSession(tokenHash: string, userId: string, mode: 'real' | 'demo', ttlDays: number, userAgent: string) {
    const now = new Date();
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, mode, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(tokenHash, userId, mode, now.toISOString(), new Date(now.getTime() + ttlDays * 86_400_000).toISOString(), now.toISOString(), userAgent.slice(0, 200));
  }
  session(tokenHash: string): { token_hash: string; user_id: string; mode: 'real' | 'demo'; expires_at: string } | null {
    return (this.db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) as any) ?? null;
  }
  touchSession(tokenHash: string, ttlDays: number) {
    const now = new Date();
    this.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(now.toISOString(), new Date(now.getTime() + ttlDays * 86_400_000).toISOString(), tokenHash);
  }
  setSessionMode(tokenHash: string, mode: 'real' | 'demo') { this.db.prepare('UPDATE sessions SET mode = ? WHERE token_hash = ?').run(mode, tokenHash); }
  deleteSession(tokenHash: string) { this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash); }
  deleteUserSessions(userId: string, except?: string) { this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, except ?? ''); }
  purgeSessions() { this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso()); }

  /* ------------------------------ Invitations ------------------------------ */
  createInvitation(codeHash: string, person: Person, createdBy: string, days: number) {
    this.db.prepare('DELETE FROM invitations WHERE person = ? AND used_at IS NULL').run(person);
    this.db.prepare('INSERT INTO invitations (code_hash, person, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(codeHash, person, createdBy, nowIso(), new Date(Date.now() + days * 86_400_000).toISOString());
  }
  invitation(codeHash: string): { person: Person; expires_at: string; used_at: string | null } | null {
    return (this.db.prepare('SELECT * FROM invitations WHERE code_hash = ?').get(codeHash) as any) ?? null;
  }
  useInvitation(codeHash: string) { this.db.prepare('UPDATE invitations SET used_at = ? WHERE code_hash = ?').run(nowIso(), codeHash); }
  pendingInvitation(person: Person): { expires_at: string } | null {
    return (this.db.prepare('SELECT expires_at FROM invitations WHERE person = ? AND used_at IS NULL AND expires_at > ?').get(person, nowIso()) as any) ?? null;
  }

  /* ---------------------------------- Audit ---------------------------------- */
  audit(e: { userId?: string | null; person?: string | null; action: string; entity?: string; entityId?: string | null; details?: unknown }) {
    this.db.prepare('INSERT INTO audit_log (id, at, user_id, person, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid(), nowIso(), e.userId ?? null, e.person ?? null, e.action, e.entity ?? '', e.entityId ?? null,
        typeof e.details === 'string' ? e.details : e.details ? JSON.stringify(e.details) : '');
  }
  auditFor(person: string, limit = 200): AuditEntry[] {
    return (this.db.prepare('SELECT * FROM audit_log WHERE person = ? ORDER BY at DESC LIMIT ?').all(person, limit) as any[])
      .map((r) => ({ id: r.id, at: r.at, action: r.action, entity: r.entity, entityId: r.entity_id, details: r.details }));
  }
  auditForEntity(entityId: string): AuditEntry[] {
    return (this.db.prepare('SELECT * FROM audit_log WHERE entity_id = ? ORDER BY at DESC').all(entityId) as any[])
      .map((r) => ({ id: r.id, at: r.at, action: r.action, entity: r.entity, entityId: r.entity_id, details: r.details }));
  }

  /* ------------------------------- Paramètres ------------------------------- */
  getSettings(person: Person): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all(`p:${person}:%`) as { key: string; value: string }[];
    const s: any = { ...DEFAULT_SETTINGS, alerts: { ...DEFAULT_ALERTS } };
    for (const r of rows) {
      const k = r.key.split(':')[2];
      if (PERSONAL_KEYS.has(k)) s[k] = JSON.parse(r.value);
    }
    s.alerts = { ...DEFAULT_ALERTS, ...s.alerts };
    return s;
  }
  saveSettings(person: Person, patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(patch)) if (PERSONAL_KEYS.has(k)) stmt.run(`p:${person}:${k}`, JSON.stringify(v));
    return this.getSettings(person);
  }
  getCouple(): CoupleSettings {
    const r = this.db.prepare("SELECT value FROM settings WHERE key = 'couple'").get() as { value: string } | undefined;
    return { ...DEFAULT_COUPLE, ...(r ? JSON.parse(r.value) : {}) };
  }
  saveCouple(c: CoupleSettings) {
    this.db.prepare("INSERT INTO settings(key, value) VALUES ('couple', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(c));
  }
  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(`__${key}`) as { value: string } | undefined;
    return r ? JSON.parse(r.value) : null;
  }
  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`__${key}`, JSON.stringify(value));
  }

  /* --------------------------------- Comptes --------------------------------- */
  accounts(): Account[] { return (this.db.prepare('SELECT * FROM accounts ORDER BY owner, name').all()).map(mapAccount); }
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

  /* ------------------------------ Transactions ------------------------------ */
  transactions(): Transaction[] {
    return (this.db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id = t.id) AS attachment_count
      FROM transactions t ORDER BY date DESC, created_at DESC`).all()).map(mapTx);
  }
  transaction(id: string): Transaction | null {
    const r = this.db.prepare('SELECT t.*, (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id = t.id) AS attachment_count FROM transactions t WHERE id = ?').get(id);
    return r ? mapTx(r) : null;
  }
  insertTransaction(t: Transaction) {
    this.db.prepare(`INSERT OR IGNORE INTO transactions (id, account_id, date, amount, description, merchant, category_id, is_transfer, pending, external_id, hash, source, note, created_at, excluded, cancelled, shared)
      VALUES (@id, @accountId, @date, @amount, @description, @merchant, @categoryId, @tr, @pd, @externalId, @hash, @source, @note, @createdAt, @ex, @ca, @sh)`)
      .run({ ...t, tr: b(t.isTransfer), pd: b(t.pending), ex: b(t.excluded), ca: b(t.cancelled), sh: b(t.shared), createdAt: nowIso() });
  }
  updateTransaction(id: string, patch: Partial<Pick<Transaction, 'categoryId' | 'isTransfer' | 'note' | 'pending' | 'amount' | 'date' | 'description' | 'merchant' | 'excluded' | 'cancelled' | 'shared'>>) {
    const cur = this.transaction(id);
    if (!cur) return null;
    const t = { ...cur, ...patch };
    this.db.prepare(`UPDATE transactions SET category_id=@categoryId, is_transfer=@tr, note=@note, pending=@pd, amount=@amount, date=@date,
      description=@description, merchant=@merchant, excluded=@ex, cancelled=@ca, shared=@sh WHERE id=@id`)
      .run({ ...t, tr: b(t.isTransfer), pd: b(t.pending), ex: b(t.excluded), ca: b(t.cancelled), sh: b(t.shared) });
    return t;
  }
  deleteTransaction(id: string) { this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id); }
  markTransfers(ids: string[]) {
    const stmt = this.db.prepare('UPDATE transactions SET is_transfer = 1 WHERE id = ?');
    for (const id of ids) stmt.run(id);
  }
  deletePendingMatching(accountId: string, amount: number, from: string, to: string) {
    this.db.prepare('DELETE FROM transactions WHERE account_id = ? AND pending = 1 AND amount = ? AND date BETWEEN ? AND ?').run(accountId, amount, from, to);
  }

  /* ------------------------------ Justificatifs ------------------------------ */
  attachments(transactionId: string) {
    return (this.db.prepare('SELECT id, filename, mime, size, created_at FROM attachments WHERE transaction_id = ? ORDER BY created_at').all(transactionId) as any[])
      .map((r) => ({ id: r.id, filename: r.filename, mime: r.mime, size: r.size, createdAt: r.created_at }));
  }
  attachment(id: string): { id: string; transaction_id: string; filename: string; mime: string; data: Buffer } | null {
    return (this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as any) ?? null;
  }
  addAttachment(a: { transactionId: string; filename: string; mime: string; data: Buffer; createdBy: string | null }) {
    const id = uid();
    this.db.prepare('INSERT INTO attachments (id, transaction_id, filename, mime, size, data, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, a.transactionId, a.filename, a.mime, a.data.length, a.data, nowIso(), a.createdBy);
    return id;
  }
  deleteAttachment(id: string) { this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id); }

  /* -------------------------------- Catégories -------------------------------- */
  categories(): Category[] { return (this.db.prepare('SELECT * FROM categories ORDER BY kind, name').all()).map(mapCategory); }
  upsertCategory(c: Category) {
    this.db.prepare(`INSERT INTO categories (id, name, kind, color, icon, monthly_budget, keywords, archived) VALUES (@id, @name, @kind, @color, @icon, @monthlyBudget, @kw, @arch)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, color=excluded.color, icon=excluded.icon, keywords=excluded.keywords, archived=excluded.archived`)
      .run({ ...c, monthlyBudget: 0, kw: JSON.stringify(c.keywords), arch: b(c.archived) });
  }
  deleteCategory(id: string) { this.db.prepare('DELETE FROM categories WHERE id = ?').run(id); }

  /* ------------------------- Budgets (par personne) ------------------------- */
  setDefaultBudget(person: Person, categoryId: string, amount: number) {
    this.db.prepare("INSERT INTO person_budgets (person, category_id, month, amount) VALUES (?, ?, '*', ?) ON CONFLICT(person, category_id, month) DO UPDATE SET amount = excluded.amount").run(person, categoryId, amount);
  }
  setMonthBudget(person: Person, m: MonthBudget) {
    this.db.prepare('INSERT INTO person_budgets (person, category_id, month, amount) VALUES (?, ?, ?, ?) ON CONFLICT(person, category_id, month) DO UPDATE SET amount = excluded.amount').run(person, m.categoryId, m.month, m.amount);
  }
  clearMonthBudget(person: Person, categoryId: string, month: string) {
    this.db.prepare('DELETE FROM person_budgets WHERE person = ? AND category_id = ? AND month = ?').run(person, categoryId, month);
  }
  budgets(person: Person): { categoryId: string; month: string; amount: number }[] {
    return (this.db.prepare('SELECT category_id, month, amount FROM person_budgets WHERE person = ?').all(person) as any[]).map((r) => ({ categoryId: r.category_id, month: r.month, amount: r.amount }));
  }

  /* ---------------------------------- Règles ---------------------------------- */
  rules(): CategoryRule[] {
    return (this.db.prepare('SELECT * FROM category_rules ORDER BY pattern').all() as any[]).map((r) => ({ id: r.id, pattern: r.pattern, categoryId: r.category_id, markTransfer: !!r.mark_transfer }));
  }
  upsertRule(pattern: string, categoryId: string, markTransfer: boolean) {
    this.db.prepare('INSERT INTO category_rules (id, pattern, category_id, mark_transfer) VALUES (?, ?, ?, ?) ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id, mark_transfer = excluded.mark_transfer')
      .run(uid(), pattern, categoryId, b(markTransfer));
  }
  deleteRule(id: string) { this.db.prepare('DELETE FROM category_rules WHERE id = ?').run(id); }

  /* ------------------------------ Charges fixes ------------------------------ */
  charges(): FixedCharge[] { return (this.db.prepare('SELECT * FROM fixed_charges ORDER BY day_of_month').all()).map(mapCharge); }
  charge(id: string): FixedCharge | null { const r = this.db.prepare('SELECT * FROM fixed_charges WHERE id = ?').get(id); return r ? mapCharge(r) : null; }
  upsertCharge(c: FixedCharge) {
    this.db.prepare(`INSERT INTO fixed_charges (id, name, amount, day_of_month, frequency, account_id, category_id, start_month, end_month, match_keyword, active, owner)
      VALUES (@id, @name, @amount, @dayOfMonth, @frequency, @accountId, @categoryId, @startMonth, @endMonth, @matchKeyword, @act, @owner)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, amount=excluded.amount, day_of_month=excluded.day_of_month, frequency=excluded.frequency,
      account_id=excluded.account_id, category_id=excluded.category_id, start_month=excluded.start_month, end_month=excluded.end_month,
      match_keyword=excluded.match_keyword, active=excluded.active, owner=excluded.owner`).run({ ...c, act: b(c.active) });
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

  /* -------------------------------- Objectifs -------------------------------- */
  goals(): Goal[] { return (this.db.prepare('SELECT * FROM goals ORDER BY created_at').all()).map(mapGoal); }
  goal(id: string): Goal | null { const r = this.db.prepare('SELECT * FROM goals WHERE id = ?').get(id); return r ? mapGoal(r) : null; }
  upsertGoal(g: Goal) {
    this.db.prepare(`INSERT INTO goals (id, name, target, saved, monthly_contribution, target_date, owner, horizon, kind, account_id, created_at)
      VALUES (@id, @name, @target, @saved, @monthlyContribution, @targetDate, @owner, @horizon, @kind, @accountId, @createdAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, target=excluded.target, saved=excluded.saved, monthly_contribution=excluded.monthly_contribution,
      target_date=excluded.target_date, owner=excluded.owner, horizon=excluded.horizon, kind=excluded.kind, account_id=excluded.account_id`).run(g);
  }
  deleteGoal(id: string) { this.db.prepare('DELETE FROM goals WHERE id = ?').run(id); }

  snapshots(): BalanceSnapshot[] {
    return (this.db.prepare('SELECT * FROM balance_snapshots ORDER BY date').all() as any[]).map((r) => ({ accountId: r.account_id, date: r.date, balance: r.balance }));
  }

  /* ------------------------- Connexions bancaires ------------------------- */
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

  /* ----------------------------- Synchronisations ----------------------------- */
  syncRuns(limit = 100): (SyncRun & { person: string | null })[] {
    return (this.db.prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?').all(limit) as any[]).map((r) => ({ ...mapRun(r), person: r.person }));
  }
  startRun(provider: string, connectionId: string | null, person: string | null = null): string {
    const id = uid();
    this.db.prepare('INSERT INTO sync_runs (id, provider, connection_id, started_at, status, person) VALUES (?, ?, ?, ?, ?, ?)').run(id, provider, connectionId, nowIso(), 'running', person);
    return id;
  }
  finishRun(id: string, r: { status: 'success' | 'error'; imported?: number; duplicates?: number; transfers?: number; message?: string }) {
    this.db.prepare('UPDATE sync_runs SET finished_at=?, status=?, imported=?, duplicates=?, transfers=?, message=? WHERE id=?')
      .run(nowIso(), r.status, r.imported ?? 0, r.duplicates ?? 0, r.transfers ?? 0, r.message ?? '', id);
  }

  /* --------------------------------- Archives --------------------------------- */
  archives(person: Person): ArchivedMonth[] {
    return (this.db.prepare('SELECT * FROM archives WHERE person = ? ORDER BY month DESC').all(person) as any[])
      .map((r) => ({ month: r.month, person: r.person, closedAt: r.closed_at, summary: JSON.parse(r.summary) }));
  }
  archiveMonth(person: Person, month: string, summary: unknown) {
    this.db.prepare('INSERT INTO archives (person, month, closed_at, summary) VALUES (?, ?, ?, ?) ON CONFLICT(person, month) DO UPDATE SET closed_at = excluded.closed_at, summary = excluded.summary')
      .run(person, month, nowIso(), JSON.stringify(summary));
  }
  unarchiveMonth(person: Person, month: string) { this.db.prepare('DELETE FROM archives WHERE person = ? AND month = ?').run(person, month); }

  /* ----------------------- Vue filtrée par utilisateur ----------------------- */

  /** Propriétaires dont l'utilisateur peut LIRE les données. */
  visibleOwners(ctx: ViewContext): Owner[] {
    const partner = partnerOf(ctx.person);
    const shares = ctx.demo || !!ctx.partner?.share_with_partner;
    return shares ? [ctx.person, 'joint', partner] : [ctx.person, 'joint'];
  }

  /** Propriétaires dont l'utilisateur peut MODIFIER les données (jamais celles du/de la partenaire). */
  writableOwners(ctx: ViewContext): Owner[] {
    return [ctx.person, 'joint'];
  }

  /**
   * État complet tel que l'utilisateur a le droit de le voir.
   * Séparation stricte : les données personnelles du/de la partenaire ne sont incluses
   * que s'il/elle a explicitement activé le partage (consentement horodaté).
   */
  state(ctx: ViewContext, bankingConfigured: boolean): AppState {
    const me = ctx.person;
    const partner = partnerOf(me) as Person;
    const owners = this.visibleOwners(ctx);
    const settings = this.getSettings(me);
    const partnerShares = ctx.demo || !!ctx.partner?.share_with_partner;
    const sharedSince = ctx.demo ? nowIso() : ctx.partner?.share_granted_at ?? null;
    settings.userName = ctx.user?.display_name ?? (me === 'ange' ? 'Ange' : 'Kelly');
    settings.partnerName = ctx.partner?.display_name ?? (partner === 'ange' ? 'Ange' : 'Kelly');

    const base = settings.currency;
    const rate = (cur: string) => (cur === base ? 1 : settings.fxRates[cur] ?? 1);
    const accounts = this.accounts()
      .filter((a) => owners.includes(a.owner))
      .map((a) => ({
        ...a,
        balance: Math.round(a.balance * rate(a.currency)),
        originalBalance: a.balance,
        consentAt: a.owner === partner ? sharedSince : a.consentAt,
      }));
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const transactions = this.transactions().filter((t) => accById.has(t.accountId)).map((t) => {
      const r = rate(accById.get(t.accountId)!.currency);
      return r === 1 ? t : { ...t, amount: Math.round(t.amount * r), originalAmount: t.amount };
    });
    const budgets = this.budgets(me);
    const defaults = new Map(budgets.filter((x) => x.month === '*').map((x) => [x.categoryId, x.amount]));
    const categories = this.categories().map((c) => ({ ...c, monthlyBudget: defaults.get(c.id) ?? 0 }));
    const monthBudgets: MonthBudget[] = budgets.filter((x) => x.month !== '*').map((x) => ({ categoryId: x.categoryId, month: x.month, amount: x.amount }));
    const charges = this.charges().filter((c) => owners.includes(c.owner) && (!c.accountId || accById.has(c.accountId) || !this.account(c.accountId)));
    const chargeIds = new Set(charges.map((c) => c.id));
    const connections = this.connections().filter((c) => c.owner === me || c.owner === 'joint');
    const connIds = new Set(connections.map((c) => c.id));
    const partnerSettings = partnerShares ? this.getSettings(partner) : null;

    const viewer: ViewerInfo = {
      userId: ctx.user?.id ?? '', person: me, name: settings.userName, username: ctx.user?.username ?? '',
      sharing: ctx.demo ? true : !!ctx.user?.share_with_partner,
    };
    const partnerInfo: PartnerInfo = {
      person: partner, name: settings.partnerName, exists: ctx.demo || !!ctx.partner,
      sharesWithMe: partnerShares, sharedSince, expectedIncome: partnerSettings?.expectedIncome || null,
    };
    return {
      settings,
      accounts,
      transactions,
      categories,
      charges,
      chargeMonths: this.chargeMonths().filter((m) => chargeIds.has(m.chargeId)),
      monthBudgets,
      goals: this.goals().filter((g) => owners.includes(g.owner)),
      snapshots: this.snapshots().filter((s) => accById.has(s.accountId)),
      syncRuns: this.syncRuns().filter((r) => r.person === me || (r.connectionId && connIds.has(r.connectionId))),
      connections,
      rules: this.rules(),
      bankingConfigured,
      viewer,
      partner: partnerInfo,
      couple: this.getCouple(),
      archives: this.archives(me),
      demo: ctx.demo,
    };
  }

  /** Supprime toutes les données financières (pas les utilisateurs). */
  wipeFinancialData() {
    this.db.exec(`DELETE FROM attachments; DELETE FROM transactions; DELETE FROM charge_months; DELETE FROM fixed_charges; DELETE FROM person_budgets;
      DELETE FROM goals; DELETE FROM balance_snapshots; DELETE FROM sync_runs; DELETE FROM category_rules; DELETE FROM accounts;
      DELETE FROM bank_connections; DELETE FROM archives; DELETE FROM settings WHERE key LIKE 'p:%' OR key = 'couple';`);
  }

  /** Supprime les données personnelles d'une personne (droit à l'effacement RGPD). */
  wipePerson(person: Person) {
    this.tx(() => {
      this.db.prepare('DELETE FROM accounts WHERE owner = ?').run(person);
      this.db.prepare('DELETE FROM goals WHERE owner = ?').run(person);
      this.db.prepare('DELETE FROM fixed_charges WHERE owner = ?').run(person);
      this.db.prepare('DELETE FROM bank_connections WHERE owner = ?').run(person);
      this.db.prepare('DELETE FROM person_budgets WHERE person = ?').run(person);
      this.db.prepare('DELETE FROM archives WHERE person = ?').run(person);
      this.db.prepare('DELETE FROM settings WHERE key LIKE ?').run(`p:${person}:%`);
    });
  }

  async backup(dir: string, keep = 14): Promise<string> {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `anges-mny-${new Date().toISOString().slice(0, 10)}.db`);
    await this.db.backup(file);
    const files = fs.readdirSync(dir).filter((f) => /^anges-mny-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
    return file;
  }
}
