import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import type { Repo, Person, UserRow, ViewContext } from './db';
import { nowIso, openDb, Repo as RepoClass, uid } from './db';
import type { SecretBox } from './crypto';
import type { BankProvider } from './providers/types';
import { ingest } from './pipeline';
import { syncConnection } from './sync';
import { loadDemo } from './demo';
import { hashPassword, invitationCode, newToken, parseCookies, passwordProblem, RateLimiter, sha256, verifyPassword } from './auth';
import { parseStatementFile } from '../shared/importers';
import { normalize } from '../shared/categorize';
import { todayISO } from '../shared/dates';
import type { Account, Category, CoupleSettings, FixedCharge, Goal, Owner, Settings, Transaction } from '../shared/types';
import { DEFAULT_ALERTS, partnerOf } from '../shared/types';

export interface AppDeps {
  repo: Repo;
  box: SecretBox;
  provider: BankProvider;
  cookieSecure?: boolean;
  backupDir?: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface Ctx extends ViewContext {
  user: UserRow;
  repo: Repo;
  tokenHash: string;
}
type AuthedRequest = Request & { ctx: Ctx };

const COOKIE = 'mny_session';
const SESSION_DAYS = 30;
const OWNERS: Owner[] = ['ange', 'kelly', 'joint'];
const PERSON_NAME: Record<Person, string> = { ange: 'Ange', kelly: 'Kelly' };

const cents = (v: unknown, field: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || Math.abs(v) > 1e12) throw new HttpError(400, `${field} doit être un montant valide (en centimes).`);
  return v;
};
const str = (v: unknown, field: string, max = 200): string => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} est requis.`);
  return v.trim().slice(0, max);
};
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(v);
const ATTACH_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const ATTACH_MAX = 5 * 1024 * 1024;

export function createApp({ repo, box, provider, cookieSecure = false, backupDir }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '10mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  /* ---------------------- Protection CSRF des écritures ---------------------- */
  // Toute requête qui modifie des données doit porter l'en-tête X-MNY (impossible à poser depuis un autre site sans CORS).
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-mny') !== '1') return res.status(403).json({ error: 'Requête refusée (protection CSRF).' });
    next();
  });

  const loginLimiter = new RateLimiter(8, 15 * 60_000);
  const inviteLimiter = new RateLimiter(8, 15 * 60_000);
  const demoRepos = new Map<string, Repo>();
  const demoRepo = (userId: string) => {
    let r = demoRepos.get(userId);
    if (!r) {
      r = new RepoClass(openDb(':memory:'));
      loadDemo(r);
      demoRepos.set(userId, r);
    }
    return r;
  };

  const setCookie = (res: Response, token: string | null) => {
    const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', cookieSecure ? 'Secure' : ''].filter(Boolean);
    if (token) res.setHeader('Set-Cookie', `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; ${attrs.join('; ')}`);
    else res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${attrs.join('; ')}`);
  };
  const startSession = (req: Request, res: Response, user: UserRow) => {
    const token = newToken();
    repo.createSession(sha256(token), user.id, 'real', SESSION_DAYS, req.get('user-agent') ?? '');
    repo.updateUser(user.id, { last_login_at: nowIso() });
    setCookie(res, token);
  };
  const wrap = (fn: (req: AuthedRequest, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req as AuthedRequest, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) { next(e); }
  };
  const ip = (req: Request) => req.ip ?? 'unknown';

  /* ------------------------------ Public ------------------------------ */
  app.get('/api/health', (_req, res) => { res.json({ ok: true, readOnly: true }); });

  app.get('/api/auth/status', (req, res) => {
    const users = repo.users();
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const s = token ? repo.session(sha256(token)) : null;
    const user = s && s.expires_at > nowIso() ? repo.userById(s.user_id) : null;
    res.json({ needsSetup: users.length === 0, authenticated: !!user, user: user ? { name: user.display_name, person: user.person } : null });
  });

  app.post('/api/auth/setup', wrap((req, res) => {
    if (repo.users().length) throw new HttpError(409, 'L\'application est déjà initialisée.');
    const b = req.body ?? {};
    const pb = passwordProblem(b.password);
    if (pb) throw new HttpError(400, pb);
    const username = str(b.username, 'Identifiant', 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'Identifiant : 3 à 40 caractères (lettres, chiffres, . _ -).');
    const user = repo.createUser({ person: 'ange', username, displayName: str(b.displayName ?? 'Ange', 'Prénom', 40), passwordHash: hashPassword(b.password) });
    repo.audit({ userId: user.id, person: user.person, action: 'compte_créé', entity: 'user', entityId: user.id });
    startSession(req, res, user);
    return { ok: true };
  }));

  app.post('/api/auth/login', wrap((req, res) => {
    const key = ip(req);
    if (!loginLimiter.check(key)) throw new HttpError(429, 'Trop de tentatives. Réessaie dans 15 minutes.');
    const { username, password } = req.body ?? {};
    const user = typeof username === 'string' ? repo.userByUsername(username.trim()) : null;
    // Vérification même si l'utilisateur n'existe pas, pour ne pas révéler les identifiants valides par le temps de réponse
    const ok = verifyPassword(String(password ?? ''), user?.password_hash ?? hashPassword('x-invalid-x-0000'));
    if (!user || !ok) {
      repo.audit({ userId: user?.id, person: user?.person, action: 'connexion_échouée', details: { ip: key } });
      throw new HttpError(401, 'Identifiant ou mot de passe incorrect.');
    }
    loginLimiter.clear(key);
    repo.audit({ userId: user.id, person: user.person, action: 'connexion', details: { ip: key } });
    startSession(req, res, user);
    return { ok: true };
  }));

  app.post('/api/auth/accept-invite', wrap((req, res) => {
    if (!inviteLimiter.check(ip(req))) throw new HttpError(429, 'Trop de tentatives. Réessaie dans 15 minutes.');
    const b = req.body ?? {};
    const inv = repo.invitation(sha256(String(b.code ?? '').trim().toUpperCase()));
    if (!inv || inv.used_at || inv.expires_at < nowIso()) throw new HttpError(400, 'Code d\'invitation invalide ou expiré.');
    if (repo.userByPerson(inv.person)) throw new HttpError(409, 'Ce profil existe déjà.');
    const pb = passwordProblem(b.password);
    if (pb) throw new HttpError(400, pb);
    const username = str(b.username, 'Identifiant', 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'Identifiant : 3 à 40 caractères (lettres, chiffres, . _ -).');
    if (repo.userByUsername(username)) throw new HttpError(409, 'Cet identifiant est déjà utilisé.');
    const user = repo.createUser({ person: inv.person, username, displayName: str(b.displayName ?? PERSON_NAME[inv.person], 'Prénom', 40), passwordHash: hashPassword(b.password) });
    repo.useInvitation(sha256(String(b.code).trim().toUpperCase()));
    repo.audit({ userId: user.id, person: user.person, action: 'invitation_acceptée', entity: 'user', entityId: user.id });
    startSession(req, res, user);
    return { ok: true };
  }));

  /* ----------------------- Authentification requise ----------------------- */
  app.use('/api', (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const s = token ? repo.session(sha256(token)) : null;
    if (!s || s.expires_at < nowIso()) return res.status(401).json({ error: 'Session expirée : reconnecte-toi.' });
    const user = repo.userById(s.user_id);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable.' });
    repo.touchSession(s.token_hash, SESSION_DAYS);
    const demo = s.mode === 'demo';
    (req as AuthedRequest).ctx = {
      person: user.person, user, partner: repo.userByPerson(partnerOf(user.person) as Person), demo,
      repo: demo ? demoRepo(user.id) : repo, tokenHash: s.token_hash,
    };
    next();
  });

  const state = (ctx: Ctx) => ctx.repo.state(ctx, provider.isConfigured() && !ctx.demo);
  const audit = (ctx: Ctx, action: string, entity = '', entityId: string | null = null, details?: unknown) => {
    if (!ctx.demo) repo.audit({ userId: ctx.user.id, person: ctx.person, action, entity, entityId, details });
  };
  const canWrite = (ctx: Ctx, owner: Owner) => ctx.repo.writableOwners(ctx).includes(owner);
  const writableAccount = (ctx: Ctx, id: unknown): Account => {
    const a = typeof id === 'string' ? ctx.repo.account(id) : null;
    if (!a || !ctx.repo.visibleOwners(ctx).includes(a.owner)) throw new HttpError(404, 'Compte introuvable.');
    if (!canWrite(ctx, a.owner)) throw new HttpError(403, `Ce compte appartient à ${ctx.partner?.display_name ?? 'ton/ta partenaire'} : lecture seule.`);
    return a;
  };
  const writableTx = (ctx: Ctx, id: string): Transaction => {
    const t = ctx.repo.transaction(id);
    if (!t) throw new HttpError(404, 'Opération introuvable.');
    writableAccount(ctx, t.accountId);
    return t;
  };
  const readableTx = (ctx: Ctx, id: string): Transaction => {
    const t = ctx.repo.transaction(id);
    const a = t ? ctx.repo.account(t.accountId) : null;
    if (!t || !a || !ctx.repo.visibleOwners(ctx).includes(a.owner)) throw new HttpError(404, 'Opération introuvable.');
    return t;
  };

  app.get('/api/state', wrap((req) => state(req.ctx)));

  /* -------------------------------- Mon profil -------------------------------- */
  app.post('/api/auth/logout', wrap((req, res) => {
    repo.deleteSession(req.ctx.tokenHash);
    audit(req.ctx, 'déconnexion');
    setCookie(res, null);
    return { ok: true };
  }));
  app.post('/api/auth/mode', wrap((req) => {
    const demo = !!req.body?.demo;
    repo.setSessionMode(req.ctx.tokenHash, demo ? 'demo' : 'real');
    if (demo && req.body?.reset) demoRepos.delete(req.ctx.user.id);
    return { ok: true, demo };
  }));
  app.put('/api/auth/profile', wrap((req) => {
    const name = str(req.body?.displayName, 'Prénom', 40);
    repo.updateUser(req.ctx.user.id, { display_name: name });
    audit(req.ctx, 'profil_modifié');
    return { ok: true };
  }));
  app.post('/api/auth/password', wrap((req) => {
    const { current, next: nextPw } = req.body ?? {};
    if (!verifyPassword(String(current ?? ''), req.ctx.user.password_hash)) throw new HttpError(400, 'Mot de passe actuel incorrect.');
    const pb = passwordProblem(nextPw);
    if (pb) throw new HttpError(400, pb);
    repo.updateUser(req.ctx.user.id, { password_hash: hashPassword(nextPw) });
    repo.deleteUserSessions(req.ctx.user.id, req.ctx.tokenHash);
    audit(req.ctx, 'mot_de_passe_modifié');
    return { ok: true };
  }));
  /** Consentement explicite au partage de MES données avec mon/ma partenaire. */
  app.put('/api/auth/sharing', wrap((req) => {
    if (req.ctx.demo) throw new HttpError(409, 'Indisponible en mode démo.');
    const share = !!req.body?.share;
    repo.updateUser(req.ctx.user.id, { share_with_partner: share ? 1 : 0, share_granted_at: share ? nowIso() : null });
    audit(req.ctx, share ? 'partage_activé' : 'partage_retiré', 'user', req.ctx.user.id);
    return { ok: true };
  }));
  app.post('/api/auth/invite', wrap((req) => {
    if (req.ctx.demo) throw new HttpError(409, 'Indisponible en mode démo.');
    const person = partnerOf(req.ctx.person) as Person;
    if (repo.userByPerson(person)) throw new HttpError(409, 'Ton/ta partenaire a déjà un accès.');
    const code = invitationCode();
    repo.createInvitation(sha256(code), person, req.ctx.user.id, 7);
    audit(req.ctx, 'invitation_créée', 'user', null, { person });
    return { code, expiresInDays: 7 };
  }));
  app.get('/api/auth/info', wrap((req) => ({
    partnerInvitationPending: !!repo.pendingInvitation(partnerOf(req.ctx.person) as Person),
    username: req.ctx.user.username,
    createdAt: req.ctx.user.created_at,
    lastLoginAt: req.ctx.user.last_login_at,
  })));
  app.get('/api/audit', wrap((req) => repo.auditFor(req.ctx.person)));
  /** Droit à l'effacement (RGPD) : supprime mes données personnelles et mon accès. */
  app.post('/api/auth/delete-me', wrap((req, res) => {
    if (!verifyPassword(String(req.body?.password ?? ''), req.ctx.user.password_hash)) throw new HttpError(400, 'Mot de passe incorrect.');
    repo.wipePerson(req.ctx.person);
    repo.audit({ userId: null, person: req.ctx.person, action: 'compte_supprimé' });
    repo.deleteUser(req.ctx.user.id);
    setCookie(res, null);
    return { ok: true };
  }));

  /* -------------------------------- Paramètres -------------------------------- */
  app.put('/api/settings', wrap((req) => {
    const b = (req.body ?? {}) as Partial<Settings>;
    const patch: Partial<Settings> = {};
    if (b.payday !== undefined) patch.payday = Math.min(31, Math.max(1, Math.round(Number(b.payday)) || 1));
    for (const k of ['expectedIncome', 'monthlySavings', 'extraSavings'] as const) if (b[k] !== undefined) patch[k] = Math.max(0, cents(b[k], k));
    if (b.alertThreshold !== undefined) patch.alertThreshold = Math.min(1, Math.max(0.3, Number(b.alertThreshold) || 0.85));
    if (b.currency !== undefined) patch.currency = /^[A-Z]{3}$/.test(String(b.currency)) ? String(b.currency) : 'EUR';
    if (b.fxRates !== undefined) {
      const rates: Record<string, number> = {};
      for (const [k, v] of Object.entries(b.fxRates ?? {})) if (/^[A-Z]{3}$/.test(k) && Number(v) > 0 && Number(v) < 10000) rates[k] = Number(v);
      patch.fxRates = rates;
    }
    if (b.alerts !== undefined) {
      const alerts = { ...DEFAULT_ALERTS };
      for (const k of Object.keys(DEFAULT_ALERTS) as (keyof typeof DEFAULT_ALERTS)[]) {
        const v = (b.alerts as unknown as Record<string, { enabled?: boolean; threshold?: number }>)[k];
        if (v) alerts[k] = { enabled: !!v.enabled, threshold: Math.max(0, Number(v.threshold) || 0) };
      }
      patch.alerts = alerts;
    }
    req.ctx.repo.saveSettings(req.ctx.person, patch);
    audit(req.ctx, 'paramètres_modifiés', 'settings', null, Object.keys(patch));
    return state(req.ctx);
  }));
  app.put('/api/couple', wrap((req) => {
    const b = req.body ?? {};
    const c: CoupleSettings = {
      splitMode: ['equal', 'income', 'manual', 'category'].includes(b.splitMode) ? b.splitMode : 'equal',
      manualShare: Math.min(1, Math.max(0, Number(b.manualShare ?? 0.5))),
      categoryShares: Object.fromEntries(Object.entries(b.categoryShares ?? {}).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Math.min(1, Math.max(0, Number(v)))])),
    };
    req.ctx.repo.saveCouple(c);
    audit(req.ctx, 'répartition_couple_modifiée', 'couple', null, c);
    return state(req.ctx);
  }));

  /* --------------------------------- Comptes --------------------------------- */
  app.post('/api/accounts', wrap((req) => {
    const b = req.body ?? {};
    const ctx = req.ctx;
    const owner: Owner = OWNERS.includes(b.owner) ? b.owner : ctx.person;
    if (!canWrite(ctx, owner)) throw new HttpError(403, `Seul(e) ${ctx.partner?.display_name ?? 'ton/ta partenaire'} peut ajouter ou modifier ses comptes, depuis son propre accès.`);
    const existing = b.id ? writableAccount(ctx, b.id) : null;
    const type = ['current', 'savings', 'vault', 'wallet', 'joint', 'investment'].includes(b.type) ? b.type : 'current';
    const a: Account = {
      id: existing?.id ?? uid(),
      name: str(b.name, 'Nom', 80),
      type,
      owner,
      institution: typeof b.institution === 'string' ? b.institution.slice(0, 80) : 'Revolut',
      currency: typeof b.currency === 'string' && /^[A-Z]{3}$/.test(b.currency) ? b.currency : 'EUR',
      balance: existing?.balance ?? 0,
      provider: existing?.provider ?? 'manual',
      externalId: existing?.externalId ?? null,
      connectionId: existing?.connectionId ?? null,
      consentAt: null,
      includeInAvailable: typeof b.includeInAvailable === 'boolean' ? b.includeInAvailable : ['current', 'wallet', 'joint'].includes(type),
      archived: !!b.archived,
      updatedAt: nowIso(),
      originalBalance: 0,
    };
    ctx.repo.upsertAccount(a);
    if (typeof b.balance === 'number' && (!existing || existing.provider !== 'enablebanking')) ctx.repo.setBalance(a.id, cents(b.balance, 'Solde'), todayISO());
    audit(ctx, existing ? 'compte_modifié' : 'compte_ajouté', 'account', a.id, { name: a.name, owner: a.owner });
    return state(ctx);
  }));
  app.delete('/api/accounts/:id', wrap((req) => {
    const a = writableAccount(req.ctx, String(req.params.id));
    req.ctx.repo.deleteAccount(a.id);
    audit(req.ctx, 'compte_supprimé', 'account', a.id, { name: a.name });
    return state(req.ctx);
  }));

  /* ------------------------------ Transactions ------------------------------ */
  app.post('/api/transactions', wrap((req) => {
    const b = req.body ?? {};
    const a = writableAccount(req.ctx, b.accountId);
    if (!isDate(b.date)) throw new HttpError(400, 'Date invalide.');
    const description = str(b.description, 'Libellé');
    const amount = cents(b.amount, 'Montant');
    const r = ingest(req.ctx.repo, a.id, [{ date: b.date, amount, description, merchant: description, pending: false, externalId: null, currency: null, product: null, balanceAfter: null }], 'manual');
    if (b.adjustBalance) req.ctx.repo.setBalance(a.id, a.balance + amount, todayISO());
    audit(req.ctx, 'opération_ajoutée', 'transaction', null, { accountId: a.id, date: b.date, amount, description });
    return { ...state(req.ctx), result: r };
  }));
  app.patch('/api/transactions/:id', wrap((req) => {
    const ctx = req.ctx;
    const before = writableTx(ctx, String(req.params.id));
    const b = req.body ?? {};
    const patch: Partial<Transaction> = {};
    if ('categoryId' in b) patch.categoryId = typeof b.categoryId === 'string' && b.categoryId ? b.categoryId : null;
    for (const k of ['isTransfer', 'excluded', 'cancelled', 'shared'] as const) if (k in b) patch[k] = !!b[k];
    if ('note' in b) patch.note = String(b.note ?? '').slice(0, 1000);
    const t = ctx.repo.updateTransaction(before.id, patch)!;
    const changes = Object.fromEntries(Object.keys(patch).filter((k) => (before as never)[k] !== (t as never)[k]).map((k) => [k, { avant: (before as never)[k], après: (t as never)[k] }]));
    if (Object.keys(changes).length) audit(ctx, 'opération_modifiée', 'transaction', t.id, changes);
    // Apprentissage : mémoriser le choix pour les opérations futures du même commerçant
    if (b.learn && t.categoryId) {
      const pattern = normalize(t.merchant || t.description).replace(/\d+/g, ' ').split(' ').filter(Boolean).slice(0, 3).join(' ');
      if (pattern.length >= 3) {
        ctx.repo.upsertRule(pattern, t.categoryId, t.isTransfer);
        if (b.applyToSimilar) {
          for (const o of ctx.repo.transactions()) {
            if (o.id !== t.id && normalize(`${o.merchant} ${o.description}`).includes(pattern)) ctx.repo.updateTransaction(o.id, { categoryId: t.categoryId, isTransfer: t.isTransfer });
          }
        }
      }
    }
    return state(ctx);
  }));
  app.delete('/api/transactions/:id', wrap((req) => {
    const t = writableTx(req.ctx, String(req.params.id));
    if (t.source !== 'manual') throw new HttpError(400, 'Une opération bancaire ne se supprime pas : exclue-la ou marque-la comme annulée.');
    req.ctx.repo.deleteTransaction(t.id);
    audit(req.ctx, 'opération_supprimée', 'transaction', t.id, { date: t.date, amount: t.amount, description: t.description });
    return state(req.ctx);
  }));
  app.get('/api/transactions/:id/details', wrap((req) => {
    const t = readableTx(req.ctx, String(req.params.id));
    return { attachments: req.ctx.repo.attachments(t.id), history: req.ctx.demo ? [] : repo.auditForEntity(t.id) };
  }));
  app.post('/api/transactions/:id/attachments', wrap((req) => {
    const t = writableTx(req.ctx, String(req.params.id));
    const { filename, mime, data } = req.body ?? {};
    if (!ATTACH_TYPES.has(mime)) throw new HttpError(400, 'Format accepté : PDF, JPG, PNG, WEBP ou HEIC.');
    const buf = Buffer.from(String(data ?? ''), 'base64');
    if (!buf.length || buf.length > ATTACH_MAX) throw new HttpError(400, 'Fichier vide ou trop volumineux (5 Mo max).');
    const id = req.ctx.repo.addAttachment({ transactionId: t.id, filename: str(filename, 'Nom', 120).replace(/[^\w.\- ()À-ÿ]/g, '_'), mime, data: buf, createdBy: req.ctx.user.id });
    audit(req.ctx, 'justificatif_ajouté', 'transaction', t.id, { filename });
    return { id, ...state(req.ctx) };
  }));
  app.get('/api/attachments/:id', (req, res, next) => {
    try {
      const ctx = (req as unknown as AuthedRequest).ctx;
      const a = ctx.repo.attachment(String(req.params.id));
      if (!a) throw new HttpError(404, 'Justificatif introuvable.');
      readableTx(ctx, a.transaction_id);
      res.setHeader('Content-Type', a.mime);
      res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(a.filename)}"`);
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
      res.send(a.data);
    } catch (e) { next(e); }
  });
  app.delete('/api/attachments/:id', wrap((req) => {
    const a = req.ctx.repo.attachment(String(req.params.id));
    if (!a) throw new HttpError(404, 'Justificatif introuvable.');
    writableTx(req.ctx, a.transaction_id);
    req.ctx.repo.deleteAttachment(a.id);
    audit(req.ctx, 'justificatif_supprimé', 'transaction', a.transaction_id, { filename: a.filename });
    return state(req.ctx);
  }));

  /* ----------------------------------- Règles ----------------------------------- */
  app.post('/api/rules', wrap((req) => {
    const b = req.body ?? {};
    const pattern = normalize(str(b.pattern, 'Motif', 60));
    if (pattern.length < 2) throw new HttpError(400, 'Motif trop court.');
    if (!req.ctx.repo.categories().some((c) => c.id === b.categoryId)) throw new HttpError(400, 'Catégorie inconnue.');
    req.ctx.repo.upsertRule(pattern, b.categoryId, !!b.markTransfer);
    let applied = 0;
    if (b.applyToExisting) {
      const writable = new Set(req.ctx.repo.accounts().filter((a) => canWrite(req.ctx, a.owner)).map((a) => a.id));
      for (const t of req.ctx.repo.transactions()) {
        if (writable.has(t.accountId) && normalize(`${t.merchant} ${t.description}`).includes(pattern)) {
          req.ctx.repo.updateTransaction(t.id, { categoryId: b.categoryId, isTransfer: !!b.markTransfer || t.isTransfer });
          applied++;
        }
      }
    }
    audit(req.ctx, 'règle_ajoutée', 'rule', null, { pattern, categoryId: b.categoryId, applied });
    return { ...state(req.ctx), applied };
  }));
  app.delete('/api/rules/:id', wrap((req) => { req.ctx.repo.deleteRule(String(req.params.id)); audit(req.ctx, 'règle_supprimée', 'rule', String(req.params.id)); return state(req.ctx); }));

  /* ------------------------------ Import CSV / OFX ------------------------------ */
  app.post('/api/import/preview', wrap((req) => {
    const { filename, content } = req.body ?? {};
    const parsed = parseStatementFile(str(filename, 'Nom de fichier'), String(content ?? ''));
    const products = [...new Set(parsed.transactions.map((t) => t.product).filter(Boolean))];
    return { format: parsed.format, count: parsed.transactions.length, errors: parsed.errors.slice(0, 20), products, sample: parsed.transactions.slice(0, 8), closingBalance: parsed.closingBalance };
  }));
  app.post('/api/import', wrap((req) => {
    const ctx = req.ctx;
    const { filename, content, accountId, product, updateBalance } = req.body ?? {};
    const account = writableAccount(ctx, accountId);
    const runId = ctx.repo.startRun('file', null, ctx.person);
    try {
      const parsed = parseStatementFile(str(filename, 'Nom de fichier'), String(content ?? ''));
      let list = parsed.transactions;
      if (product) list = list.filter((t) => t.product === product);
      if (!list.length) throw new Error(parsed.errors[0] ?? 'Aucune opération à importer.');
      const r = ingest(ctx.repo, account.id, list, 'file');
      if (updateBalance) {
        const withBal = list.filter((t) => t.balanceAfter !== null && !t.pending).sort((a, b) => a.date.localeCompare(b.date));
        const bal = withBal.length ? withBal[withBal.length - 1].balanceAfter : parsed.closingBalance;
        if (bal !== null && bal !== undefined) ctx.repo.setBalance(account.id, bal, todayISO());
      }
      ctx.repo.finishRun(runId, { status: 'success', ...r, message: `Import ${filename} → ${account.name}` });
      audit(ctx, 'import_relevé', 'account', account.id, { filename, ...r });
      return { ...state(ctx), result: { ...r, errors: parsed.errors.slice(0, 20) } };
    } catch (e) {
      ctx.repo.finishRun(runId, { status: 'error', message: (e as Error).message });
      throw new HttpError(400, (e as Error).message);
    }
  }));

  /* ------------------------------ Catégories & budgets ------------------------------ */
  app.post('/api/categories', wrap((req) => {
    const b = req.body ?? {};
    const c: Category = {
      id: typeof b.id === 'string' && /^[\w-]{1,60}$/.test(b.id) ? b.id : uid(),
      name: str(b.name, 'Nom', 60),
      kind: ['fixed', 'variable', 'income', 'savings', 'transfer'].includes(b.kind) ? b.kind : 'variable',
      color: typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#94a3b8',
      icon: typeof b.icon === 'string' ? [...b.icon].slice(0, 2).join('') : '📦',
      monthlyBudget: 0,
      keywords: Array.isArray(b.keywords) ? b.keywords.map(String).map((s: string) => s.trim().slice(0, 40)).filter(Boolean).slice(0, 50) : [],
      archived: !!b.archived,
    };
    req.ctx.repo.upsertCategory(c);
    if (typeof b.monthlyBudget === 'number') req.ctx.repo.setDefaultBudget(req.ctx.person, c.id, Math.max(0, cents(b.monthlyBudget, 'Budget')));
    audit(req.ctx, 'catégorie_enregistrée', 'category', c.id, { name: c.name });
    return state(req.ctx);
  }));
  app.delete('/api/categories/:id', wrap((req) => { req.ctx.repo.deleteCategory(String(req.params.id)); audit(req.ctx, 'catégorie_supprimée', 'category', String(req.params.id)); return state(req.ctx); }));
  app.put('/api/month-budgets', wrap((req) => {
    const { categoryId, month, amount } = req.body ?? {};
    if (!isMonth(month)) throw new HttpError(400, 'Mois invalide.');
    if (amount === null) req.ctx.repo.clearMonthBudget(req.ctx.person, categoryId, month);
    else req.ctx.repo.setMonthBudget(req.ctx.person, { categoryId, month, amount: Math.max(0, cents(amount, 'Montant')) });
    return state(req.ctx);
  }));

  /* ------------------------------ Charges fixes ------------------------------ */
  app.post('/api/charges', wrap((req) => {
    const b = req.body ?? {};
    const ctx = req.ctx;
    if (!isMonth(b.startMonth)) throw new HttpError(400, 'Mois de début invalide.');
    const existing = b.id ? ctx.repo.charge(b.id) : null;
    if (existing && !canWrite(ctx, existing.owner)) throw new HttpError(403, 'Charge en lecture seule.');
    const account = b.accountId ? writableAccount(ctx, b.accountId) : null;
    const owner: Owner = account ? account.owner : OWNERS.includes(b.owner) && canWrite(ctx, b.owner) ? b.owner : ctx.person;
    const c: FixedCharge = {
      id: existing?.id ?? uid(),
      name: str(b.name, 'Nom', 80),
      amount: Math.abs(cents(b.amount, 'Montant')),
      dayOfMonth: Math.min(31, Math.max(1, Number(b.dayOfMonth) || 1)),
      frequency: ['weekly', 'monthly', 'quarterly', 'yearly'].includes(b.frequency) ? b.frequency : 'monthly',
      accountId: account?.id ?? null,
      categoryId: b.categoryId || null,
      startMonth: b.startMonth,
      endMonth: isMonth(b.endMonth) ? b.endMonth : null,
      matchKeyword: typeof b.matchKeyword === 'string' ? b.matchKeyword.slice(0, 60) : '',
      active: b.active !== false,
      owner,
    };
    ctx.repo.upsertCharge(c);
    audit(ctx, existing ? 'charge_modifiée' : 'charge_ajoutée', 'charge', c.id, { name: c.name, amount: c.amount });
    return state(ctx);
  }));
  app.delete('/api/charges/:id', wrap((req) => {
    const c = req.ctx.repo.charge(String(req.params.id));
    if (!c || !canWrite(req.ctx, c.owner)) throw new HttpError(404, 'Charge introuvable.');
    req.ctx.repo.deleteCharge(c.id);
    audit(req.ctx, 'charge_supprimée', 'charge', c.id, { name: c.name });
    return state(req.ctx);
  }));
  app.put('/api/charges/:id/month', wrap((req) => {
    const c = req.ctx.repo.charge(String(req.params.id));
    if (!c || !canWrite(req.ctx, c.owner)) throw new HttpError(404, 'Charge introuvable.');
    const { month, status, amount } = req.body ?? {};
    if (!isMonth(month)) throw new HttpError(400, 'Mois invalide.');
    if (status === 'auto') req.ctx.repo.clearChargeMonth(c.id, month);
    else {
      if (!['paid', 'pending', 'skipped'].includes(status)) throw new HttpError(400, 'Statut invalide.');
      req.ctx.repo.setChargeMonth({ chargeId: c.id, month, status, amount: typeof amount === 'number' ? amount : null, transactionId: null });
    }
    return state(req.ctx);
  }));

  /* -------------------------------- Objectifs -------------------------------- */
  app.post('/api/goals', wrap((req) => {
    const b = req.body ?? {};
    const ctx = req.ctx;
    const existing = b.id ? ctx.repo.goal(b.id) : null;
    if (existing && !canWrite(ctx, existing.owner)) throw new HttpError(403, 'Objectif en lecture seule.');
    const owner: Owner = OWNERS.includes(b.owner) && canWrite(ctx, b.owner) ? b.owner : ctx.person;
    const g: Goal = {
      id: existing?.id ?? uid(),
      name: str(b.name, 'Nom', 80),
      target: Math.max(1, cents(b.target, 'Montant cible')),
      saved: Math.max(0, cents(b.saved ?? 0, 'Montant épargné')),
      monthlyContribution: Math.max(0, cents(b.monthlyContribution ?? 0, 'Contribution')),
      targetDate: isDate(b.targetDate) ? b.targetDate : null,
      owner,
      horizon: ['short', 'medium', 'long'].includes(b.horizon) ? b.horizon : 'medium',
      kind: ['security', 'project', 'investment', 'other'].includes(b.kind) ? b.kind : 'project',
      accountId: b.accountId ? writableAccount(ctx, b.accountId).id : null,
      createdAt: existing?.createdAt ?? nowIso(),
    };
    ctx.repo.upsertGoal(g);
    audit(ctx, existing ? 'objectif_modifié' : 'objectif_ajouté', 'goal', g.id, { name: g.name });
    return state(ctx);
  }));
  app.delete('/api/goals/:id', wrap((req) => {
    const g = req.ctx.repo.goal(String(req.params.id));
    if (!g || !canWrite(req.ctx, g.owner)) throw new HttpError(404, 'Objectif introuvable.');
    req.ctx.repo.deleteGoal(g.id);
    audit(req.ctx, 'objectif_supprimé', 'goal', g.id, { name: g.name });
    return state(req.ctx);
  }));

  /* ------------------------------ Archives mensuelles ------------------------------ */
  app.post('/api/archives', wrap((req) => {
    const { month, summary } = req.body ?? {};
    if (!isMonth(month) || month >= todayISO().slice(0, 7)) throw new HttpError(400, 'Seul un mois terminé peut être archivé.');
    req.ctx.repo.archiveMonth(req.ctx.person, month, summary ?? {});
    audit(req.ctx, 'mois_archivé', 'archive', month);
    return state(req.ctx);
  }));
  app.delete('/api/archives/:month', wrap((req) => {
    req.ctx.repo.unarchiveMonth(req.ctx.person, String(req.params.month));
    audit(req.ctx, 'mois_désarchivé', 'archive', String(req.params.month));
    return state(req.ctx);
  }));

  /* ------------------------- Connexion bancaire (DSP2) ------------------------- */
  const bankGuard = (ctx: Ctx) => {
    if (ctx.demo) throw new HttpError(409, 'La connexion bancaire est désactivée en mode démo.');
    if (!provider.isConfigured()) throw new HttpError(409, 'Connexion bancaire non configurée : voir docs/REVOLUT.md.');
  };
  app.get('/api/bank/institutions', wrap(async (req) => { bankGuard(req.ctx); return provider.listInstitutions(String(req.query.country || 'FR')); }));
  app.post('/api/bank/connect', wrap(async (req) => {
    bankGuard(req.ctx);
    const b = req.body ?? {};
    const owner: Owner = b.owner === 'joint' ? 'joint' : req.ctx.person;
    const st = crypto.randomBytes(24).toString('hex');
    const validUntil = new Date(Date.now() + 179 * 86_400_000).toISOString();
    const institution = typeof b.institution === 'string' ? b.institution.slice(0, 60) : 'Revolut';
    const country = typeof b.country === 'string' && /^[A-Z]{2}$/.test(b.country) ? b.country : 'FR';
    const { url } = await provider.startAuthorization({ institution, country, state: st, validUntil });
    const id = uid();
    repo.insertConnection({ id, provider: 'enablebanking', institution, country, owner, status: 'pending', validUntil, consentBy: req.ctx.person, createdAt: nowIso(), lastSyncAt: null, authState: st });
    audit(req.ctx, 'connexion_bancaire_démarrée', 'connection', id, { institution, owner });
    return { url };
  }));
  app.get('/api/bank/callback', async (req, res) => {
    const ctx = (req as AuthedRequest).ctx;
    const { code, state: st, error } = req.query as Record<string, string>;
    const redirect = (q: string) => res.redirect(`/parametres?tab=comptes&${q}`);
    try {
      if (error) return redirect(`bank_error=${encodeURIComponent(error)}`);
      const row = st ? repo.connectionByState(st) : null;
      if (!row || !code || row.consent_by !== ctx.person) return redirect('bank_error=state');
      const { sessionSecret, validUntil, accounts } = await provider.completeAuthorization(code);
      repo.updateConnection(row.id, { status: 'active', sessionSecret: box.seal(sessionSecret), validUntil: validUntil ?? row.valid_until, authState: null });
      const known = repo.accounts();
      for (const pa of accounts) {
        const exists = known.find((a) => a.externalId === pa.externalId);
        const isSavings = /saving|vault|epargne|pocket/i.test(`${pa.product ?? ''} ${pa.name}`);
        repo.upsertAccount({
          id: exists?.id ?? uid(),
          name: exists?.name ?? `${row.institution} — ${pa.name}${pa.currency !== 'EUR' ? ` (${pa.currency})` : ''}`,
          type: exists?.type ?? (row.owner === 'joint' ? 'joint' : isSavings ? 'savings' : 'current'),
          owner: row.owner, institution: row.institution, currency: pa.currency, balance: exists?.balance ?? 0,
          provider: 'enablebanking', externalId: pa.externalId, connectionId: row.id, consentAt: null,
          includeInAvailable: exists?.includeInAvailable ?? !isSavings, archived: false, updatedAt: nowIso(), originalBalance: 0,
        });
      }
      audit(ctx, 'connexion_bancaire_établie', 'connection', row.id, { comptes: accounts.length });
      await syncConnection(repo, box, provider, row.id);
      redirect('bank_connected=1');
    } catch (e) {
      redirect(`bank_error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
    }
  });
  app.post('/api/bank/sync', wrap(async (req) => {
    bankGuard(req.ctx);
    const id = req.body?.connectionId;
    const mine = repo.connections().filter((c) => canWrite(req.ctx, c.owner));
    if (id && !mine.some((c) => c.id === id)) throw new HttpError(404, 'Connexion introuvable.');
    const results = id ? [await syncConnection(repo, box, provider, id)] : await Promise.all(mine.filter((c) => c.status !== 'pending').map((c) => syncConnection(repo, box, provider, c.id)));
    audit(req.ctx, 'synchronisation_manuelle', 'connection', id ?? null, { ok: results.filter((r) => r.ok).length, erreurs: results.filter((r) => !r.ok).length });
    return { ...state(req.ctx), results };
  }));
  app.delete('/api/bank/connections/:id', wrap(async (req) => {
    const row = repo.connectionRow(String(req.params.id));
    if (!row || !canWrite(req.ctx, row.owner)) throw new HttpError(404, 'Connexion introuvable.');
    if (row.session_secret && provider.isConfigured()) {
      try { await provider.revoke(box.open(row.session_secret)); } catch { /* révocation best-effort */ }
    }
    repo.deleteConnection(row.id);
    audit(req.ctx, 'connexion_bancaire_révoquée', 'connection', row.id);
    return state(req.ctx);
  }));

  /* --------------------------- Données, export, RGPD --------------------------- */
  app.post('/api/reset', wrap((req) => {
    if (req.body?.confirm !== 'SUPPRIMER') throw new HttpError(400, 'Confirmation requise.');
    if (req.ctx.demo) { demoRepos.delete(req.ctx.user.id); return state({ ...req.ctx, repo: demoRepo(req.ctx.user.id) }); }
    repo.wipePerson(req.ctx.person);
    audit(req.ctx, 'données_personnelles_effacées');
    return state(req.ctx);
  }));
  app.post('/api/backup', wrap(async (req) => {
    if (req.ctx.demo || !backupDir) throw new HttpError(409, 'Sauvegarde serveur indisponible.');
    const file = await repo.backup(backupDir);
    audit(req.ctx, 'sauvegarde_manuelle', 'backup', null, { file });
    return { ok: true, file: file.split(/[\\/]/).pop() };
  }));
  app.get('/api/export', (req, res) => {
    const ctx = (req as AuthedRequest).ctx;
    const s = state(ctx);
    audit(ctx, 'export_données', 'export', null, { format: 'json' });
    res.setHeader('Content-Disposition', `attachment; filename="anges-mny-${ctx.demo ? 'DEMO-' : ''}${todayISO()}.json"`);
    res.json({ exportedAt: nowIso(), version: 2, ...s });
  });
  app.get('/api/export/transactions.csv', (req, res) => {
    const ctx = (req as AuthedRequest).ctx;
    const s = state(ctx);
    const cat = new Map(s.categories.map((c) => [c.id, c.name]));
    const acc = new Map(s.accounts.map((a) => [a.id, a]));
    const owner = (o: Owner) => (o === 'joint' ? 'Commun' : o === ctx.person ? s.settings.userName : s.settings.partnerName);
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const statut = (t: Transaction) => (t.cancelled ? 'annulée' : t.pending ? 'en attente' : 'réalisée');
    const rows = ['Date;Personne;Compte;Libellé;Montant;Devise;Catégorie;Statut;Transfert interne;Exclue;Dépense commune;Commentaire'];
    for (const t of s.transactions) {
      const a = acc.get(t.accountId);
      rows.push([t.date, esc(a ? owner(a.owner) : ''), esc(a?.name ?? ''), esc(t.description), ((t.originalAmount ?? t.amount) / 100).toFixed(2).replace('.', ','), a?.currency ?? 'EUR',
        esc(cat.get(t.categoryId ?? '') ?? ''), statut(t), t.isTransfer ? 'oui' : 'non', t.excluded ? 'oui' : 'non', t.shared ? 'oui' : 'non', esc(t.note)].join(';'));
    }
    audit(ctx, 'export_données', 'export', null, { format: 'csv', lignes: s.transactions.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="operations-${ctx.demo ? 'DEMO-' : ''}${todayISO()}.csv"`);
    res.send('﻿' + rows.join('\n'));
  });

  // Aucune route d'écriture vers la banque n'existe : application en lecture seule.
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Route inconnue.' }); });
  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : err.type === 'entity.too.large' ? 413 : err.status && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Erreur interne. Consulte les journaux du serveur.' : err.message });
  });
  return app;
}
