import type { Repo } from './db';
import { uid } from './db';
import type { ParsedTransaction } from '../shared/importers';
import type { Transaction } from '../shared/types';
import { categorize, detectTransfers, findDuplicates, transactionHash } from '../shared/categorize';
import { addDays, todayISO } from '../shared/dates';

export interface IngestResult {
  imported: number;
  duplicates: number;
  transfers: number;
}

/**
 * Pipeline commun aux imports de fichiers et aux synchronisations bancaires :
 * empreinte → dédoublonnage → catégorisation auto → détection des transferts internes.
 */
export function ingest(repo: Repo, accountId: string, parsed: ParsedTransaction[], source: Transaction['source']): IngestResult {
  const categories = repo.categories();
  const rules = repo.rules();
  const existing = repo.transactions();
  const accounts = repo.accounts();
  const settings = repo.getSettings();

  // Deux opérations identiques le même jour (ex. deux cafés) restent distinctes grâce à un rang d'occurrence stable.
  const seen = new Map<string, number>();
  const candidates: Transaction[] = parsed.map((p) => {
    const base = transactionHash({ accountId, date: p.date, amount: p.amount, description: p.description });
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const { categoryId, markTransfer } = categorize(p, categories, rules);
    return {
      id: uid(),
      accountId,
      date: p.date,
      amount: p.amount,
      description: p.description,
      merchant: p.merchant,
      categoryId,
      isTransfer: markTransfer,
      pending: p.pending,
      externalId: p.externalId,
      hash: n === 0 ? base : `${base}-${n}`,
      source,
      note: '',
    };
  });

  // Les opérations en attente sont rafraîchies à chaque synchro : on supprime les anciennes « pending ».
  const { fresh, duplicates } = findDuplicates(candidates, existing.filter((e) => !e.pending));
  let transfers = 0;
  repo.tx(() => {
    for (const t of fresh) {
      if (!t.pending) repo.deletePendingMatching(accountId, t.amount, addDays(t.date, -5), addDays(t.date, 2));
      else repo.deletePendingMatching(accountId, t.amount, t.date, t.date);
      repo.insertTransaction(t);
    }
    // Détection des transferts sur une fenêtre glissante incluant les nouvelles opérations
    const since = addDays(fresh.reduce((m, t) => (t.date < m ? t.date : m), todayISO()), -4);
    const windowTx = repo.transactions().filter((t) => t.date >= since && !t.isTransfer);
    const names = [settings.userName, settings.partnerName].filter(Boolean);
    const ids = [...detectTransfers(windowTx, accounts, names)];
    repo.markTransfers(ids);
    transfers = ids.length;
  });
  return { imported: fresh.length, duplicates: duplicates.length, transfers };
}
