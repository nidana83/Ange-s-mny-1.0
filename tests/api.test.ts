import { describe, expect, it } from 'vitest';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, Repo } from '../src/server/db';
import { SecretBox } from '../src/server/crypto';
import { createApp } from '../src/server/app';
import type { BankProvider } from '../src/server/providers/types';

function setup(provider?: Partial<BankProvider>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mny-'));
  const repo = new Repo(openDb(':memory:'));
  const box = new SecretBox(undefined, path.join(dir, 'secret.key'));
  const p: BankProvider = {
    id: 'enablebanking', isConfigured: () => false, listInstitutions: async () => [], startAuthorization: async () => ({ url: '' }),
    completeAuthorization: async () => ({ sessionSecret: '', validUntil: null, accounts: [] }), fetchBalance: async () => null,
    fetchTransactions: async () => [], revoke: async () => {}, ...provider,
  };
  return { app: createApp({ repo, box, provider: p }), repo, box };
}

describe('API', () => {
  it('importe un CSV Revolut sans créer de doublons au second import', async () => {
    const { app } = setup();
    const s = await request(app).post('/api/accounts').send({ name: 'Revolut', type: 'current', owner: 'ange', balance: 0 }).expect(200);
    const accountId = s.body.accounts[0].id;
    const content = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n'
      + 'CARD_PAYMENT,Current,2026-11-02 10:00:00,2026-11-02 10:00:00,Lidl,-20.00,0,EUR,COMPLETED,980.00\n'
      + 'CARD_PAYMENT,Current,2026-11-02 11:00:00,2026-11-02 11:00:00,Lidl,-20.00,0,EUR,COMPLETED,960.00\n';
    const r1 = await request(app).post('/api/import').send({ filename: 'r.csv', content, accountId, updateBalance: true }).expect(200);
    expect(r1.body.result).toMatchObject({ imported: 2, duplicates: 0 });
    expect(r1.body.accounts[0].balance).toBe(96000);
    expect(r1.body.transactions[0].categoryId).toBe('courses');
    const r2 = await request(app).post('/api/import').send({ filename: 'r.csv', content, accountId }).expect(200);
    expect(r2.body.result).toMatchObject({ imported: 0, duplicates: 2 });
    expect(r2.body.syncRuns).toHaveLength(2);
  });

  it('exige le consentement de Kelly', async () => {
    const { app } = setup();
    await request(app).post('/api/accounts').send({ name: 'Kelly', owner: 'kelly' }).expect(400);
    const ok = await request(app).post('/api/accounts').send({ name: 'Kelly', owner: 'kelly', consent: true }).expect(200);
    expect(ok.body.accounts[0].consentAt).toBeTruthy();
  });

  it('apprend la catégorie choisie par l\'utilisateur', async () => {
    const { app } = setup();
    const s = await request(app).post('/api/accounts').send({ name: 'R', type: 'current' });
    const accountId = s.body.accounts[0].id;
    const t = await request(app).post('/api/transactions').send({ accountId, date: '2026-11-03', amount: -1500, description: 'Chez Mamie Burger' }).expect(200);
    const id = t.body.transactions[0].id;
    await request(app).patch(`/api/transactions/${id}`).send({ categoryId: 'restauration', learn: true }).expect(200);
    const t2 = await request(app).post('/api/transactions').send({ accountId, date: '2026-11-04', amount: -1200, description: 'CHEZ MAMIE BURGER Paris' }).expect(200);
    expect(t2.body.transactions.find((x: { amount: number }) => x.amount === -1200).categoryId).toBe('restauration');
  });

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
    const c = await request(app).post('/api/bank/connect').send({ institution: 'Revolut', country: 'FR' }).expect(200);
    expect(c.body.url).toContain('bank.example');
    const st = repo.connections()[0];
    const authState = repo.connectionRow(st.id).auth_state;
    await request(app).get(`/api/bank/callback?code=abc&state=${authState}`).expect(302);
    const row = repo.connectionRow(st.id);
    expect(row.session_secret).not.toContain('sess-1'); // chiffré au repos
    expect(box.open(row.session_secret)).toBe('sess-1');
    const s = await request(app).get('/api/state');
    expect(s.body.accounts[0]).toMatchObject({ balance: 123456, provider: 'enablebanking' });
    expect(s.body.transactions).toHaveLength(1);
    fail = true;
    const r = await request(app).post('/api/bank/sync').send({}).expect(200);
    expect(r.body.results[0].ok).toBe(false);
    expect(r.body.syncRuns[0]).toMatchObject({ status: 'error', message: 'Banque indisponible' });
  });

  it('charge les données de démonstration', async () => {
    const { app } = setup();
    const s = await request(app).post('/api/demo').expect(200);
    expect(s.body.accounts.length).toBe(5);
    expect(s.body.transactions.length).toBeGreaterThan(100);
    expect(s.body.transactions.filter((t: { isTransfer: boolean }) => t.isTransfer).length).toBeGreaterThan(10);
  });
});
