import { describe, expect, it } from 'vitest';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, Repo } from '../src/server/db';
import { SecretBox } from '../src/server/crypto';
import { createApp } from '../src/server/app';
import type { BankProvider } from '../src/server/providers/types';

const PW = 'motdepasse-solide-42';

function setup(provider?: Partial<BankProvider>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mny-'));
  const repo = new Repo(openDb(':memory:'));
  const box = new SecretBox(undefined, path.join(dir, 'secret.key'));
  const p: BankProvider = {
    id: 'enablebanking', isConfigured: () => false, listInstitutions: async () => [], startAuthorization: async () => ({ url: '' }),
    completeAuthorization: async () => ({ sessionSecret: '', validUntil: null, accounts: [] }), fetchBalance: async () => null,
    fetchTransactions: async () => [], revoke: async () => {}, ...provider,
  };
  return { app: createApp({ repo, box, provider: p, backupDir: path.join(dir, 'backups') }), repo, box, dir };
}

/** Client authentifié qui envoie automatiquement l'en-tête anti-CSRF. */
function client(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const h = { 'x-mny': '1' };
  return {
    agent,
    get: (u: string) => agent.get(u),
    post: (u: string, body: object = {}) => agent.post(u).set(h).send(body),
    put: (u: string, body: object = {}) => agent.put(u).set(h).send(body),
    patch: (u: string, body: object = {}) => agent.patch(u).set(h).send(body),
    del: (u: string) => agent.delete(u).set(h),
  };
}

async function asAnge(app: ReturnType<typeof createApp>) {
  const c = client(app);
  await c.post('/api/auth/setup', { username: 'ange', displayName: 'Ange', password: PW }).expect(200);
  return c;
}

async function withKelly(app: ReturnType<typeof createApp>, ange: ReturnType<typeof client>) {
  const inv = await ange.post('/api/auth/invite').expect(200);
  const k = client(app);
  await k.post('/api/auth/accept-invite', { code: inv.body.code, username: 'kelly', displayName: 'Kelly', password: PW }).expect(200);
  return k;
}

describe('Authentification et sécurité', () => {
  it('exige une session et refuse les écritures sans en-tête anti-CSRF', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/auth/status')).body.needsSetup).toBe(true);
    await request(app).get('/api/state').expect(401);
    const c = await asAnge(app);
    await c.get('/api/state').expect(200);
    await c.agent.post('/api/accounts').send({ name: 'X' }).expect(403);
    await c.post('/api/auth/setup', { username: 'pirate', password: PW }).expect(409);
  });

  it('refuse les mauvais mots de passe, puis limite les tentatives', async () => {
    const { app, repo } = setup();
    await asAnge(app);
    const anon = client(app);
    await anon.post('/api/auth/login', { username: 'ange', password: 'mauvais-mdp-1' }).expect(401);
    await anon.post('/api/auth/login', { username: 'ANGE', password: PW }).expect(200);
    await anon.get('/api/state').expect(200);
    for (let i = 0; i < 8; i++) await client(app).post('/api/auth/login', { username: 'ange', password: 'x' });
    await client(app).post('/api/auth/login', { username: 'ange', password: PW }).expect(429);
    expect(repo.users()[0].password_hash).toMatch(/^scrypt\$/);
    expect(repo.auditFor('ange').some((e) => e.action === 'connexion_échouée')).toBe(true);
  });

  it('applique des règles de mot de passe et invalide les autres sessions au changement', async () => {
    const { app } = setup();
    await client(app).post('/api/auth/setup', { username: 'ange', password: 'court' }).expect(400);
    const c = await asAnge(app);
    const other = client(app);
    await other.post('/api/auth/login', { username: 'ange', password: PW }).expect(200);
    await c.post('/api/auth/password', { current: PW, next: 'nouveau-mdp-2026' }).expect(200);
    await other.get('/api/state').expect(401);
    await c.get('/api/state').expect(200);
  });
});

describe('Séparation des données du couple', () => {
  it('Kelly a son propre accès ; ses données restent privées tant qu\'elle ne les partage pas', async () => {
    const { app } = setup();
    const ange = await asAnge(app);
    const kelly = await withKelly(app, ange);
    const kAcc = await kelly.post('/api/accounts', { name: 'Revolut Kelly', type: 'current', balance: 50000 }).expect(200);
    const kellyAccountId = kAcc.body.accounts[0].id;
    expect(kAcc.body.accounts[0].owner).toBe('kelly');
    await ange.post('/api/accounts', { name: 'Commun', type: 'joint', owner: 'joint', balance: 1000 }).expect(200);

    // Ange ne voit pas les comptes de Kelly
    let s = (await ange.get('/api/state')).body;
    expect(s.accounts.map((a: { owner: string }) => a.owner)).toEqual(['joint']);
    expect(s.partner).toMatchObject({ name: 'Kelly', exists: true, sharesWithMe: false });
    // …et ne peut ni les créer, ni les modifier
    await ange.post('/api/accounts', { name: 'Faux compte Kelly', owner: 'kelly' }).expect(403);
    await ange.post('/api/accounts', { id: kellyAccountId, name: 'Piraté' }).expect(404);
    await ange.post('/api/transactions', { accountId: kellyAccountId, date: '2026-11-01', amount: -100, description: 'x' }).expect(404);

    // Kelly active explicitement le partage
    await kelly.put('/api/auth/sharing', { share: true }).expect(200);
    s = (await ange.get('/api/state')).body;
    const shared = s.accounts.find((a: { owner: string }) => a.owner === 'kelly');
    expect(shared.consentAt).toBeTruthy();
    // Lecture seule pour Ange
    await ange.post('/api/accounts', { id: kellyAccountId, name: 'Piraté' }).expect(403);
    // Kelly voit le compte commun mais toujours pas les comptes perso d'Ange tant qu'il ne partage pas
    await ange.post('/api/accounts', { name: 'Perso Ange', type: 'current' }).expect(200);
    const ks = (await kelly.get('/api/state')).body;
    expect(ks.accounts.map((a: { owner: string }) => a.owner).sort()).toEqual(['joint', 'kelly']);
    expect(ks.viewer.person).toBe('kelly');

    // Retrait du consentement : effet immédiat
    await kelly.put('/api/auth/sharing', { share: false }).expect(200);
    s = (await ange.get('/api/state')).body;
    expect(s.accounts.some((a: { owner: string }) => a.owner === 'kelly')).toBe(false);
  });

  it('une invitation ne sert qu\'une fois', async () => {
    const { app } = setup();
    const ange = await asAnge(app);
    const inv = await ange.post('/api/auth/invite').expect(200);
    await client(app).post('/api/auth/accept-invite', { code: inv.body.code, username: 'kelly', password: PW }).expect(200);
    await client(app).post('/api/auth/accept-invite', { code: inv.body.code, username: 'kelly2', password: PW }).expect(400);
  });
});

describe('Opérations', () => {
  it('importe un CSV Revolut sans créer de doublons au second import', async () => {
    const { app } = setup();
    const c = await asAnge(app);
    const s = await c.post('/api/accounts', { name: 'Revolut', type: 'current', balance: 0 }).expect(200);
    const accountId = s.body.accounts[0].id;
    const content = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n'
      + 'CARD_PAYMENT,Current,2026-11-02 10:00:00,2026-11-02 10:00:00,Lidl,-20.00,0,EUR,COMPLETED,980.00\n'
      + 'CARD_PAYMENT,Current,2026-11-02 11:00:00,2026-11-02 11:00:00,Lidl,-20.00,0,EUR,COMPLETED,960.00\n';
    const r1 = await c.post('/api/import', { filename: 'r.csv', content, accountId, updateBalance: true }).expect(200);
    expect(r1.body.result).toMatchObject({ imported: 2, duplicates: 0 });
    expect(r1.body.accounts[0].balance).toBe(96000);
    expect(r1.body.transactions[0].categoryId).toBe('courses');
    const r2 = await c.post('/api/import', { filename: 'r.csv', content, accountId }).expect(200);
    expect(r2.body.result).toMatchObject({ imported: 0, duplicates: 2 });
    expect(r2.body.syncRuns).toHaveLength(2);
  });

  it('apprend les catégories, gère commentaires, exclusion, justificatifs et historique des corrections', async () => {
    const { app } = setup();
    const c = await asAnge(app);
    const s = await c.post('/api/accounts', { name: 'R', type: 'current' });
    const accountId = s.body.accounts[0].id;
    const t = await c.post('/api/transactions', { accountId, date: '2026-11-03', amount: -1500, description: 'Chez Mamie Burger' }).expect(200);
    const id = t.body.transactions[0].id;
    await c.patch(`/api/transactions/${id}`, { categoryId: 'restauration', learn: true, note: 'Avec les collègues' }).expect(200);
    const t2 = await c.post('/api/transactions', { accountId, date: '2026-11-04', amount: -1200, description: 'CHEZ MAMIE BURGER Paris' }).expect(200);
    expect(t2.body.transactions.find((x: { amount: number }) => x.amount === -1200).categoryId).toBe('restauration');

    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    await c.post(`/api/transactions/${id}/attachments`, { filename: 'ticket.png', mime: 'image/png', data: png }).expect(200);
    await c.post(`/api/transactions/${id}/attachments`, { filename: 'x.exe', mime: 'application/x-msdownload', data: png }).expect(400);
    const ex = await c.patch(`/api/transactions/${id}`, { excluded: true }).expect(200);
    const tx = ex.body.transactions.find((x: { id: string }) => x.id === id);
    expect(tx).toMatchObject({ excluded: true, note: 'Avec les collègues', attachmentCount: 1 });
    const d = await c.get(`/api/transactions/${id}/details`).expect(200);
    expect(d.body.attachments[0].filename).toBe('ticket.png');
    expect(d.body.history.map((h: { action: string }) => h.action)).toContain('opération_modifiée');
    const file = await c.get(`/api/attachments/${d.body.attachments[0].id}`).expect(200);
    expect(file.headers['content-type']).toContain('image/png');
  });

  it('crée une règle personnalisée et l\'applique aux opérations existantes', async () => {
    const { app } = setup();
    const c = await asAnge(app);
    const s = await c.post('/api/accounts', { name: 'R', type: 'current' });
    const accountId = s.body.accounts[0].id;
    await c.post('/api/transactions', { accountId, date: '2026-11-03', amount: -900, description: 'Le Petit Marché' });
    const r = await c.post('/api/rules', { pattern: 'petit marche', categoryId: 'courses', applyToExisting: true }).expect(200);
    expect(r.body.applied).toBe(1);
    expect(r.body.transactions[0].categoryId).toBe('courses');
  });
});

describe('Banque, démo et sauvegarde', () => {
  it('synchronise une connexion Open Banking et historise les échecs', async () => {
    let fail = false;
    const { app, repo, box } = setup({
      isConfigured: () => true,
      startAuthorization: async () => ({ url: 'https://bank.example/auth' }),
      completeAuthorization: async () => ({ sessionSecret: 'sess-1', validUntil: '2099-01-01T00:00:00Z', accounts: [{ externalId: 'uid-1', name: 'Main', currency: 'EUR', iban: null, product: 'Current' }] }),
      fetchBalance: async () => 123456,
      fetchTransactions: async () => {
        if (fail) throw new Error('Banque indisponible');
        return [{ date: '2026-11-01', amount: -999, description: 'Spotify', merchant: 'Spotify', pending: false, externalId: 'e1', currency: 'EUR', product: null, balanceAfter: null }];
      },
    });
    const c = await asAnge(app);
    const r = await c.post('/api/bank/connect', { institution: 'Revolut', country: 'FR' }).expect(200);
    expect(r.body.url).toContain('bank.example');
    const st = repo.connections()[0];
    const authState = repo.connectionRow(st.id).auth_state;
    // Un autre navigateur sans session ne peut pas finaliser la connexion
    await request(app).get(`/api/bank/callback?code=abc&state=${authState}`).expect(401);
    await c.get(`/api/bank/callback?code=abc&state=${authState}`).expect(302);
    const row = repo.connectionRow(st.id);
    expect(row.session_secret).not.toContain('sess-1');
    expect(box.open(row.session_secret)).toBe('sess-1');
    const s = await c.get('/api/state');
    expect(s.body.accounts[0]).toMatchObject({ balance: 123456, provider: 'enablebanking', owner: 'ange' });
    expect(s.body.transactions).toHaveLength(1);
    fail = true;
    const r2 = await c.post('/api/bank/sync', {}).expect(200);
    expect(r2.body.results[0].ok).toBe(false);
    expect(r2.body.syncRuns[0]).toMatchObject({ status: 'error', message: 'Banque indisponible' });
  });

  it('le mode démo utilise une base séparée et ne touche jamais aux données réelles', async () => {
    const { app, repo } = setup();
    const c = await asAnge(app);
    await c.post('/api/accounts', { name: 'Mon vrai compte', type: 'current', balance: 4200 }).expect(200);
    await c.post('/api/auth/mode', { demo: true }).expect(200);
    const d = (await c.get('/api/state')).body;
    expect(d.demo).toBe(true);
    expect(d.accounts.some((a: { name: string }) => a.name === 'Mon vrai compte')).toBe(false);
    expect(d.transactions.length).toBeGreaterThan(100);
    expect(d.accounts.some((a: { owner: string }) => a.owner === 'kelly')).toBe(true);
    await c.post('/api/accounts', { name: 'Compte démo ajouté', type: 'current' }).expect(200);
    await c.post('/api/bank/connect', {}).expect(409);
    expect(repo.accounts().map((a) => a.name)).toEqual(['Mon vrai compte']);
    await c.post('/api/auth/mode', { demo: false }).expect(200);
    const real = (await c.get('/api/state')).body;
    expect(real.demo).toBe(false);
    expect(real.accounts.map((a: { name: string }) => a.name)).toEqual(['Mon vrai compte']);
  });

  it('crée une sauvegarde de la base et exporte les données', async () => {
    const { app, dir } = setup();
    const c = await asAnge(app);
    await c.post('/api/backup').expect(200);
    expect(fs.readdirSync(path.join(dir, 'backups')).length).toBe(1);
    const e = await c.get('/api/export').expect(200);
    expect(e.body.version).toBe(2);
    const csv = await c.get('/api/export/transactions.csv').expect(200);
    expect(csv.text).toContain('Date;Personne;Compte');
  });
});

import { ingest } from '../src/server/pipeline';

describe('Virements entre comptes importés séparément', () => {
  it('reconnaît les virements du couple même si les comptes sont importés l\'un après l\'autre', () => {
    const repo = new Repo(openDb(':memory:'));
    const mk = (id: string, owner: 'ange' | 'kelly' | 'joint') => repo.upsertAccount({ id, name: id, type: owner === 'joint' ? 'joint' : 'current', owner, institution: 'R', currency: 'EUR', balance: 0, provider: 'file', externalId: null, connectionId: null, consentAt: null, includeInAvailable: true, archived: false, updatedAt: '', originalBalance: 0 });
    mk('a', 'ange'); mk('j', 'joint'); mk('k', 'kelly');
    const p = (date: string, amount: number, description: string) => ({ date, amount, description, merchant: description, pending: false, externalId: null, currency: 'EUR', product: null, balanceAfter: null });
    ingest(repo, 'a', [p('2026-11-01', -75000, 'Virement vers M. et Mme')], 'file');
    ingest(repo, 'j', [p('2026-11-01', 75000, 'Virement reçu'), p('2026-11-02', 75000, 'Virement reçu 2')], 'file');
    ingest(repo, 'k', [p('2026-11-02', -75000, 'Virement SEPA')], 'file');
    const txs = repo.transactions();
    expect(txs).toHaveLength(4);
    expect(txs.every((t) => t.isTransfer)).toBe(true);
  });
});
