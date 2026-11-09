import type { Repo } from './db';
import { nowIso } from './db';
import type { SecretBox } from './crypto';
import type { BankProvider } from './providers/types';
import { ingest } from './pipeline';
import { addDays, todayISO } from '../shared/dates';

export interface SyncOutcome {
  ok: boolean;
  runs: string[];
  message: string;
}

/**
 * Synchronise une connexion bancaire : soldes + opérations depuis la dernière synchro (avec 7 jours de recouvrement).
 * Chaque exécution est historisée dans sync_runs ; un échec est conservé pour être notifié dans l'interface.
 */
export async function syncConnection(repo: Repo, box: SecretBox, provider: BankProvider, connectionId: string): Promise<SyncOutcome> {
  const row = repo.connectionRow(connectionId);
  const runId = repo.startRun(provider.id, connectionId, row?.owner ?? null);
  try {
    if (!row) throw new Error('Connexion introuvable.');
    if (!row.session_secret) throw new Error('Consentement non finalisé : reconnecte le compte.');
    if (row.valid_until && row.valid_until < nowIso()) {
      repo.updateConnection(connectionId, { status: 'expired' });
      throw new Error('Le consentement bancaire a expiré (PSD2 : 180 jours max). Renouvelle-le depuis la page Comptes.');
    }
    const session = box.open(row.session_secret);
    const accounts = repo.accounts().filter((a) => a.connectionId === connectionId && a.externalId && !a.archived);
    let imported = 0, duplicates = 0, transfers = 0;
    for (const a of accounts) {
      const last = repo.transactions().find((t) => t.accountId === a.id && !t.pending)?.date;
      const from = last ? addDays(last, -7) : addDays(todayISO(), -365);
      const txs = await provider.fetchTransactions(session, a.externalId!, from);
      const r = ingest(repo, a.id, txs, 'enablebanking');
      imported += r.imported; duplicates += r.duplicates; transfers += r.transfers;
      const balance = await provider.fetchBalance(session, a.externalId!);
      if (balance !== null) repo.setBalance(a.id, balance, todayISO());
    }
    repo.updateConnection(connectionId, { status: 'active', lastSyncAt: nowIso() });
    const message = `${accounts.length} compte(s) synchronisé(s).`;
    repo.finishRun(runId, { status: 'success', imported, duplicates, transfers, message });
    return { ok: true, runs: [runId], message };
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 401 || err.status === 403) repo.updateConnection(connectionId, { status: 'expired' });
    else if (row) repo.updateConnection(connectionId, { status: 'error' });
    repo.finishRun(runId, { status: 'error', message: err.message });
    return { ok: false, runs: [runId], message: err.message };
  }
}

export async function syncAll(repo: Repo, box: SecretBox, provider: BankProvider): Promise<SyncOutcome[]> {
  if (!provider.isConfigured()) return [];
  const out: SyncOutcome[] = [];
  for (const c of repo.connections().filter((c) => c.status === 'active' || c.status === 'error')) {
    out.push(await syncConnection(repo, box, provider, c.id));
  }
  return out;
}

export function startScheduler(repo: Repo, box: SecretBox, provider: BankProvider, hours: number): NodeJS.Timeout | null {
  if (!provider.isConfigured() || hours <= 0) return null;
  // PSD2 limite les accès sans action de l'utilisateur à 4 par jour : on ne descend pas sous 6 h.
  const ms = Math.max(6, hours) * 3_600_000;
  const timer = setInterval(() => { void syncAll(repo, box, provider); }, ms);
  timer.unref();
  return timer;
}
