import crypto from 'node:crypto';
import fs from 'node:fs';
import type { BankProvider, ProviderAccount } from './types';
import type { ParsedTransaction } from '../../shared/importers';
import { cleanMerchant } from '../../shared/importers';
import { toCents } from '../../shared/money';

/**
 * Connecteur Enable Banking (agrégateur Open Banking PSD2 agréé, couvre Revolut dans l'EEE).
 * Documentation : https://enablebanking.com/docs/api/reference/
 *
 * - Authentification de l'application : JWT RS256 signé avec la clé privée de l'application.
 * - Authentification de l'utilisateur : directement chez Revolut (SCA), jamais dans Ange's MNY.
 * - Accès en lecture seule (AIS : comptes, soldes, opérations). Pas d'initiation de paiement.
 */
export class EnableBankingProvider implements BankProvider {
  readonly id = 'enablebanking' as const;
  private base = 'https://api.enablebanking.com';

  constructor(
    private appId: string | undefined,
    private keyPath: string | undefined,
    private redirectUrl: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  isConfigured(): boolean {
    return !!(this.appId && this.keyPath && fs.existsSync(this.keyPath));
  }

  private jwt(): string {
    if (!this.isConfigured()) throw new Error('Enable Banking n\'est pas configuré (ENABLE_BANKING_APP_ID / ENABLE_BANKING_KEY_PATH).');
    const header = { typ: 'JWT', alg: 'RS256', kid: this.appId };
    const iat = Math.floor(Date.now() / 1000);
    const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + 3600 };
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = `${enc(header)}.${enc(payload)}`;
    const sig = crypto.sign('RSA-SHA256', Buffer.from(data), fs.readFileSync(this.keyPath!, 'utf8')).toString('base64url');
    return `${data}.${sig}`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.jwt()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { const j = JSON.parse(text); msg = j.message || j.detail || j.error || text; } catch { /* texte brut */ }
      const err = new Error(`Enable Banking ${res.status} : ${String(msg).slice(0, 300)}`) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async listInstitutions(country: string) {
    const r = await this.call<{ aspsps: { name: string; country: string; logo?: string }[] }>('GET', `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`);
    return r.aspsps.map((a) => ({ name: a.name, country: a.country, logo: a.logo }));
  }

  async startAuthorization(opts: { institution: string; country: string; state: string; validUntil: string }) {
    const r = await this.call<{ url: string }>('POST', '/auth', {
      access: { valid_until: opts.validUntil },
      aspsp: { name: opts.institution, country: opts.country },
      state: opts.state,
      redirect_url: this.redirectUrl,
      psu_type: 'personal',
    });
    return { url: r.url };
  }

  async completeAuthorization(code: string) {
    type Acc = { uid: string; account_id?: { iban?: string }; name?: string; details?: string; product?: string; currency?: string; cash_account_type?: string };
    const r = await this.call<{ session_id: string; accounts: Acc[]; access?: { valid_until?: string } }>('POST', '/sessions', { code });
    const accounts: ProviderAccount[] = r.accounts.map((a) => ({
      externalId: a.uid,
      name: a.name || a.details || a.product || 'Compte Revolut',
      currency: a.currency || 'EUR',
      iban: a.account_id?.iban ?? null,
      product: a.product ?? a.cash_account_type ?? null,
    }));
    return { sessionSecret: r.session_id, validUntil: r.access?.valid_until ?? null, accounts };
  }

  async fetchBalance(_session: string, accountUid: string) {
    type Bal = { balance_amount: { amount: string; currency: string }; balance_type: string };
    const r = await this.call<{ balances: Bal[] }>('GET', `/accounts/${encodeURIComponent(accountUid)}/balances`);
    // Priorité : solde disponible (ITAV/CLAV), sinon solde comptable (CLBD/ITBD)
    const order = ['ITAV', 'CLAV', 'XPCD', 'ITBD', 'CLBD'];
    const best = order.map((type) => r.balances.find((x) => x.balance_type === type)).find(Boolean) ?? r.balances[0];
    return best ? toCents(best.balance_amount.amount) : null;
  }

  async fetchTransactions(_session: string, accountUid: string, dateFrom: string): Promise<ParsedTransaction[]> {
    type Tx = {
      entry_reference?: string; transaction_id?: string; transaction_amount: { amount: string; currency: string };
      credit_debit_indicator: 'CRDT' | 'DBIT'; status?: string; booking_date?: string; value_date?: string; transaction_date?: string;
      creditor?: { name?: string }; debtor?: { name?: string }; remittance_information?: string[]; bank_transaction_code?: { description?: string };
    };
    const out: ParsedTransaction[] = [];
    let continuation: string | undefined;
    let pages = 0;
    do {
      const qs = new URLSearchParams({ date_from: dateFrom });
      if (continuation) qs.set('continuation_key', continuation);
      const r = await this.call<{ transactions: Tx[]; continuation_key?: string }>('GET', `/accounts/${encodeURIComponent(accountUid)}/transactions?${qs}`);
      for (const t of r.transactions) {
        const sign = t.credit_debit_indicator === 'DBIT' ? -1 : 1;
        const counterparty = sign < 0 ? t.creditor?.name : t.debtor?.name;
        const description = [counterparty, ...(t.remittance_information ?? [])].filter(Boolean).join(' — ') || t.bank_transaction_code?.description || 'Opération';
        const date = t.booking_date || t.value_date || t.transaction_date;
        if (!date) continue;
        out.push({
          date: date.slice(0, 10),
          amount: sign * Math.abs(toCents(t.transaction_amount.amount)),
          description,
          merchant: counterparty || cleanMerchant(description),
          pending: t.status === 'PDNG',
          externalId: t.entry_reference || t.transaction_id || null,
          currency: t.transaction_amount.currency,
          product: null,
          balanceAfter: null,
        });
      }
      continuation = r.continuation_key || undefined;
      pages++;
    } while (continuation && pages < 50);
    return out;
  }

  async revoke(sessionId: string) {
    await this.call('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
  }
}
