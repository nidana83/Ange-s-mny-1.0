import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import type { Repo } from './db';
import { nowIso, uid } from './db';
import type { SecretBox } from './crypto';
import type { BankProvider } from './providers/types';
import { ingest } from './pipeline';
import { syncAll, syncConnection } from './sync';
import { loadDemo } from './demo';
import { parseStatementFile } from '../shared/importers';
import { normalize } from '../shared/categorize';
import { todayISO } from '../shared/dates';
import type { Account, Category, FixedCharge, Goal, Owner } from '../shared/types';

export interface AppDeps {
  repo: Repo;
  box: SecretBox;
  provider: BankProvider;
  publicUrl?: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const OWNERS: Owner[] = ['ange', 'kelly', 'joint'];
const cents = (v: unknown, field: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) throw new HttpError(400, `${field} doit être un entier (centimes).`);
  return v;
};
const str = (v: unknown, field: string, max = 200): string => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} est requis.`);
  return v.trim().slice(0, max);
};
const isMonth = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function createApp({ repo, box, provider }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '15mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const wrap = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) { next(e); }
  };
  const state = () => repo.state(provider.isConfigured());

  app.get('/api/health', (_req, res) => { res.json({ ok: true, readOnly: true }); });
  app.get('/api/state', wrap(() => state()));

  /* ------------------------------ Paramètres ------------------------------ */
  app.put('/api/settings', wrap((req) => { repo.saveSettings(req.body ?? {}); return state(); }));

  /* -------------------------------- Comptes -------------------------------- */
  app.post('/api/accounts', wrap((req) => {
    const b = req.body ?? {};
    const owner = OWNERS.includes(b.owner) ? b.owner : 'ange';
    if (owner === 'kelly' && !b.consent) throw new HttpError(400, 'Le consentement explicite de Kelly est requis pour suivre ses comptes.');
    const existing = b.id ? repo.account(b.id) : null;
    const a: Account = {
      id: existing?.id ?? uid(),
      name: str(b.name, 'Nom'),
      type: ['current', 'savings', 'vault', 'wallet', 'joint', 'investment'].includes(b.type) ? b.type : 'current',
      owner,
      institution: typeof b.institution === 'string' ? b.institution.slice(0, 80) : 'Revolut',
      currency: typeof b.currency === 'string' && /^[A-Z]{3}$/.test(b.currency) ? b.currency : 'EUR',
      balance: existing?.balance ?? 0,
      provider: existing?.provider ?? 'manual',
      externalId: existing?.externalId ?? null,
      connectionId: existing?.connectionId ?? null,
      consentAt: owner === 'kelly' ? (existing?.consentAt ?? nowIso()) : null,
      includeInAvailable: b.includeInAvailable ?? ['current', 'wallet', 'joint'].includes(b.type),
      archived: !!b.archived,
      updatedAt: nowIso(),
    };
    repo.upsertAccount(a);
    if (typeof b.balance === 'number') repo.setBalance(a.id, cents(b.balance, 'Solde'), todayISO());
    return state();
  }));
  app.post('/api/accounts/:id/consent', wrap((req) => {
    const a = repo.account(String(req.params.id));
    if (!a) throw new HttpError(404, 'Compte introuvable.');
    repo.upsertAccount({ ...a, consentAt: req.body?.granted ? nowIso() : null, updatedAt: nowIso() });
    return state();
  }));
  app.delete('/api/accounts/:id', wrap((req) => { repo.deleteAccount(String(req.params.id)); return state(); }));

  /* ------------------------------ Transactions ------------------------------ */
  app.post('/api/transactions', wrap((req) => {
    const b = req.body ?? {};
    if (!repo.account(b.accountId)) throw new HttpError(400, 'Compte inconnu.');
    if (!isDate(b.date)) throw new HttpError(400, 'Date invalide.');
    const description = str(b.description, 'Libellé');
    const r = ingest(repo, b.accountId, [{
      date: b.date, amount: cents(b.amount, 'Montant'), description, merchant: description, pending: false,
      externalId: null, currency: null, product: null, balanceAfter: null,
    }], 'manual');
    if (b.adjustBalance) {
      const a = repo.account(b.accountId)!;
      repo.setBalance(a.id, a.balance + b.amount, todayISO());
    }
    return { ...state(), result: r };
  }));
  app.patch('/api/transactions/:id', wrap((req) => {
    const b = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if ('categoryId' in b) patch.categoryId = b.categoryId || null;
    if ('isTransfer' in b) patch.isTransfer = !!b.isTransfer;
    if ('note' in b) patch.note = String(b.note).slice(0, 500);
    const t = repo.updateTransaction(String(req.params.id), patch);
    if (!t) throw new HttpError(404, 'Opération introuvable.');
    // Apprentissage : mémoriser le choix pour les opérations futures du même commerçant
    if (b.learn && t.categoryId) {
      const pattern = normalize(t.merchant || t.description).split(' ').slice(0, 3).join(' ');
      if (pattern.length >= 3) {
        repo.upsertRule(pattern, t.categoryId, t.isTransfer);
        if (b.applyToSimilar) {
          for (const o of repo.transactions()) {
            if (o.id !== t.id && normalize(`${o.merchant} ${o.description}`).includes(pattern)) repo.updateTransaction(o.id, { categoryId: t.categoryId, isTransfer: t.isTransfer });
          }
        }
      }
    }
    return state();
  }));
  app.delete('/api/transactions/:id', wrap((req) => { repo.deleteTransaction(String(req.params.id)); return state(); }));
  app.delete('/api/rules/:id', wrap((req) => { repo.deleteRule(String(req.params.id)); return state(); }));

  /* --------------------------- Import CSV / OFX --------------------------- */
  app.post('/api/import/preview', wrap((req) => {
    const { filename, content } = req.body ?? {};
    const parsed = parseStatementFile(str(filename, 'Nom de fichier'), String(content ?? ''));
    const products = [...new Set(parsed.transactions.map((t) => t.product).filter(Boolean))];
    return { format: parsed.format, count: parsed.transactions.length, errors: parsed.errors.slice(0, 20), products, sample: parsed.transactions.slice(0, 8), closingBalance: parsed.closingBalance };
  }));
  app.post('/api/import', wrap((req) => {
    const { filename, content, accountId, product, updateBalance } = req.body ?? {};
    const account = repo.account(accountId);
    if (!account) throw new HttpError(400, 'Choisis le compte de destination.');
    const runId = repo.startRun('file', null);
    try {
      const parsed = parseStatementFile(str(filename, 'Nom de fichier'), String(content ?? ''));
      let list = parsed.transactions;
      if (product) list = list.filter((t) => t.product === product);
      if (!list.length) throw new Error(parsed.errors[0] ?? 'Aucune opération à importer.');
      const r = ingest(repo, account.id, list, 'file');
      // Solde : dernier solde du fichier si présent (relevé Revolut), sinon inchangé
      if (updateBalance) {
        const withBal = list.filter((t) => t.balanceAfter !== null && !t.pending).sort((a, b) => a.date.localeCompare(b.date));
        const bal = withBal.length ? withBal[withBal.length - 1].balanceAfter : parsed.closingBalance;
        if (bal !== null && bal !== undefined) repo.setBalance(account.id, bal, todayISO());
      }
      repo.finishRun(runId, { status: 'success', ...r, message: `Import ${filename} → ${account.name}` });
      return { ...state(), result: { ...r, errors: parsed.errors.slice(0, 20) } };
    } catch (e) {
      repo.finishRun(runId, { status: 'error', message: (e as Error).message });
      throw new HttpError(400, (e as Error).message);
    }
  }));

  /* ------------------------------ Catégories ------------------------------ */
  app.post('/api/categories', wrap((req) => {
    const b = req.body ?? {};
    const c: Category = {
      id: typeof b.id === 'string' && b.id ? b.id : uid(),
      name: str(b.name, 'Nom', 60),
      kind: ['fixed', 'variable', 'income', 'savings', 'transfer'].includes(b.kind) ? b.kind : 'variable',
      color: typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#94a3b8',
      icon: typeof b.icon === 'string' ? b.icon.slice(0, 4) : '📦',
      monthlyBudget: cents(b.monthlyBudget ?? 0, 'Budget'),
      keywords: Array.isArray(b.keywords) ? b.keywords.map(String).map((s: string) => s.trim()).filter(Boolean).slice(0, 50) : [],
      archived: !!b.archived,
    };
    repo.upsertCategory(c);
    return state();
  }));
  app.delete('/api/categories/:id', wrap((req) => { repo.deleteCategory(String(req.params.id)); return state(); }));
  app.put('/api/month-budgets', wrap((req) => {
    const { categoryId, month, amount } = req.body ?? {};
    if (!isMonth(month)) throw new HttpError(400, 'Mois invalide.');
    if (amount === null) repo.clearMonthBudget(categoryId, month);
    else repo.setMonthBudget({ categoryId, month, amount: cents(amount, 'Montant') });
    return state();
  }));

  /* ------------------------------ Charges fixes ------------------------------ */
  app.post('/api/charges', wrap((req) => {
    const b = req.body ?? {};
    if (!isMonth(b.startMonth)) throw new HttpError(400, 'Mois de début invalide.');
    const c: FixedCharge = {
      id: typeof b.id === 'string' && b.id ? b.id : uid(),
      name: str(b.name, 'Nom', 80),
      amount: cents(b.amount, 'Montant'),
      dayOfMonth: Math.min(31, Math.max(1, Number(b.dayOfMonth) || 1)),
      frequency: ['weekly', 'monthly', 'quarterly', 'yearly'].includes(b.frequency) ? b.frequency : 'monthly',
      accountId: b.accountId || null,
      categoryId: b.categoryId || null,
      startMonth: b.startMonth,
      endMonth: isMonth(b.endMonth) ? b.endMonth : null,
      matchKeyword: typeof b.matchKeyword === 'string' ? b.matchKeyword.slice(0, 60) : '',
      active: b.active !== false,
    };
    repo.upsertCharge(c);
    return state();
  }));
  app.delete('/api/charges/:id', wrap((req) => { repo.deleteCharge(String(req.params.id)); return state(); }));
  app.put('/api/charges/:id/month', wrap((req) => {
    const { month, status, amount } = req.body ?? {};
    if (!isMonth(month)) throw new HttpError(400, 'Mois invalide.');
    if (status === 'auto') repo.clearChargeMonth(String(req.params.id), month);
    else {
      if (!['paid', 'pending', 'skipped'].includes(status)) throw new HttpError(400, 'Statut invalide.');
      repo.setChargeMonth({ chargeId: String(req.params.id), month, status, amount: typeof amount === 'number' ? amount : null, transactionId: null });
    }
    return state();
  }));

  /* -------------------------------- Objectifs -------------------------------- */
  app.post('/api/goals', wrap((req) => {
    const b = req.body ?? {};
    const existing = repo.goals().find((g) => g.id === b.id);
    const g: Goal = {
      id: existing?.id ?? uid(),
      name: str(b.name, 'Nom', 80),
      target: cents(b.target, 'Montant cible'),
      saved: cents(b.saved ?? 0, 'Montant épargné'),
      monthlyContribution: cents(b.monthlyContribution ?? 0, 'Contribution'),
      targetDate: isDate(b.targetDate) ? b.targetDate : null,
      owner: OWNERS.includes(b.owner) ? b.owner : 'ange',
      horizon: ['short', 'medium', 'long'].includes(b.horizon) ? b.horizon : 'medium',
      kind: ['security', 'project', 'investment', 'other'].includes(b.kind) ? b.kind : 'project',
      accountId: b.accountId || null,
      createdAt: existing?.createdAt ?? nowIso(),
    };
    repo.upsertGoal(g);
    return state();
  }));
  app.delete('/api/goals/:id', wrap((req) => { repo.deleteGoal(String(req.params.id)); return state(); }));

  /* ------------------------- Connexion bancaire (PSD2) ------------------------- */
  app.get('/api/bank/institutions', wrap(async (req) => {
    if (!provider.isConfigured()) throw new HttpError(409, 'Connexion bancaire non configurée.');
    return provider.listInstitutions(String(req.query.country || 'FR'));
  }));
  app.post('/api/bank/connect', wrap(async (req) => {
    if (!provider.isConfigured()) throw new HttpError(409, 'Connexion bancaire non configurée : voir docs/REVOLUT.md.');
    const b = req.body ?? {};
    const owner: Owner = OWNERS.includes(b.owner) ? b.owner : 'ange';
    if (owner === 'kelly' && !b.consent) throw new HttpError(400, 'Kelly doit donner son consentement explicite et s\'authentifier elle-même chez Revolut.');
    const state = crypto.randomBytes(24).toString('hex');
    const validUntil = new Date(Date.now() + 179 * 86_400_000).toISOString();
    const { url } = await provider.startAuthorization({ institution: b.institution || 'Revolut', country: b.country || 'FR', state, validUntil });
    repo.insertConnection({
      id: uid(), provider: 'enablebanking', institution: b.institution || 'Revolut', country: b.country || 'FR', owner, status: 'pending',
      validUntil, consentBy: owner === 'kelly' ? 'kelly' : owner === 'joint' ? 'ange+kelly' : 'ange', createdAt: nowIso(), lastSyncAt: null, authState: state,
    });
    return { url };
  }));
  app.get('/api/bank/callback', async (req, res) => {
    const { code, state: st, error } = req.query as Record<string, string>;
    const redirect = (q: string) => res.redirect(`/comptes?${q}`);
    try {
      if (error) return redirect(`bank_error=${encodeURIComponent(error)}`);
      const row = st ? repo.connectionByState(st) : null;
      if (!row || !code) return redirect('bank_error=state');
      const { sessionSecret, validUntil, accounts } = await provider.completeAuthorization(code);
      repo.updateConnection(row.id, { status: 'active', sessionSecret: box.seal(sessionSecret), validUntil: validUntil ?? row.valid_until, authState: null });
      const known = repo.accounts();
      for (const pa of accounts) {
        const exists = known.find((a) => a.externalId === pa.externalId);
        repo.upsertAccount({
          id: exists?.id ?? uid(),
          name: exists?.name ?? `${row.institution} — ${pa.name}${pa.currency !== 'EUR' ? ` (${pa.currency})` : ''}`,
          type: exists?.type ?? (row.owner === 'joint' ? 'joint' : /saving|vault|epargne/i.test(pa.product ?? pa.name) ? 'savings' : 'current'),
          owner: row.owner,
          institution: row.institution,
          currency: pa.currency,
          balance: exists?.balance ?? 0,
          provider: 'enablebanking',
          externalId: pa.externalId,
          connectionId: row.id,
          consentAt: row.owner === 'kelly' ? nowIso() : null,
          includeInAvailable: exists?.includeInAvailable ?? !/saving|vault/i.test(pa.product ?? ''),
          archived: false,
          updatedAt: nowIso(),
        });
      }
      await syncConnection(repo, box, provider, row.id);
      redirect('bank_connected=1');
    } catch (e) {
      redirect(`bank_error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
    }
  });
  app.post('/api/bank/sync', wrap(async (req) => {
    const id = req.body?.connectionId;
    const results = id ? [await syncConnection(repo, box, provider, id)] : await syncAll(repo, box, provider);
    return { ...state(), results };
  }));
  app.delete('/api/bank/connections/:id', wrap(async (req) => {
    const row = repo.connectionRow(String(req.params.id));
    if (row?.session_secret && provider.isConfigured()) {
      try { await provider.revoke(box.open(row.session_secret)); } catch { /* révocation best-effort */ }
    }
    repo.deleteConnection(String(req.params.id));
    return state();
  }));

  /* ------------------------------ Données ------------------------------ */
  app.post('/api/demo', wrap(() => { loadDemo(repo); return state(); }));
  app.post('/api/reset', wrap((req) => {
    if (req.body?.confirm !== 'SUPPRIMER') throw new HttpError(400, 'Confirmation requise.');
    repo.wipe();
    return state();
  }));
  app.get('/api/export', (_req, res) => {
    const s = repo.state(provider.isConfigured());
    res.setHeader('Content-Disposition', `attachment; filename="anges-mny-${todayISO()}.json"`);
    res.json({ exportedAt: nowIso(), version: 1, ...s });
  });
  app.get('/api/export/transactions.csv', (_req, res) => {
    const s = repo.state(provider.isConfigured());
    const cat = new Map(s.categories.map((c) => [c.id, c.name]));
    const acc = new Map(s.accounts.map((a) => [a.id, a.name]));
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = ['Date;Compte;Libellé;Montant;Catégorie;Transfert interne;En attente'];
    for (const t of s.transactions) rows.push([t.date, esc(acc.get(t.accountId) ?? ''), esc(t.description), (t.amount / 100).toFixed(2).replace('.', ','), esc(cat.get(t.categoryId ?? '') ?? ''), t.isTransfer ? 'oui' : 'non', t.pending ? 'oui' : 'non'].join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="operations-${todayISO()}.csv"`);
    res.send('﻿' + rows.join('\n'));
  });

  // Toute écriture vers la banque est volontairement absente : application en lecture seule.
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Route inconnue.' }); });
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : err.status && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Erreur interne.' });
  });
  return app;
}
