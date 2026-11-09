import type { ParsedTransaction } from '../../shared/importers';

/** Compte renvoyé par un fournisseur bancaire. */
export interface ProviderAccount {
  externalId: string;
  name: string;
  currency: string;
  iban: string | null;
  product: string | null;
}

/**
 * Interface commune des connecteurs bancaires (LECTURE SEULE).
 * Aucune méthode d'initiation de paiement n'existe volontairement dans la V1.
 */
export interface BankProvider {
  readonly id: 'enablebanking';
  isConfigured(): boolean;
  listInstitutions(country: string): Promise<{ name: string; country: string; logo?: string }[]>;
  /** Démarre le parcours de consentement : renvoie l'URL de la banque où l'utilisateur s'authentifie lui-même. */
  startAuthorization(opts: { institution: string; country: string; state: string; validUntil: string }): Promise<{ url: string }>;
  /** Échange le code de retour contre une session ; renvoie le secret de session (à chiffrer) et les comptes. */
  completeAuthorization(code: string): Promise<{ sessionSecret: string; validUntil: string | null; accounts: ProviderAccount[] }>;
  fetchBalance(sessionSecret: string, accountExternalId: string): Promise<number | null>;
  fetchTransactions(sessionSecret: string, accountExternalId: string, dateFrom: string): Promise<ParsedTransaction[]>;
  revoke(sessionSecret: string): Promise<void>;
}
