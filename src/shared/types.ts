/**
 * Modèle de données d'Ange's MNY.
 * Tous les montants sont stockés en CENTIMES (entiers) pour éviter les erreurs d'arrondi.
 * Transactions : montant signé (négatif = sortie, positif = entrée).
 */

export type Owner = 'ange' | 'kelly' | 'joint';
export type AccountType = 'current' | 'savings' | 'vault' | 'wallet' | 'joint' | 'investment';
export type Provider = 'manual' | 'file' | 'enablebanking';
export type CategoryKind = 'fixed' | 'variable' | 'income' | 'savings' | 'transfer';
export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type GoalHorizon = 'short' | 'medium' | 'long';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  owner: Owner;
  institution: string;
  currency: string;
  balance: number; // centimes
  provider: Provider;
  externalId: string | null;
  connectionId: string | null;
  /** Pour les comptes de Kelly : consentement explicite enregistré (ISO date) */
  consentAt: string | null;
  /** Compte pris en compte dans l'argent disponible (compte courant / portefeuille) */
  includeInAvailable: boolean;
  archived: boolean;
  updatedAt: string;
  /** Solde dans la devise du compte (balance est converti en devise principale) */
  originalBalance: number;
}

export interface Transaction {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  amount: number; // centimes signés
  description: string;
  merchant: string;
  categoryId: string | null;
  /** Transfert interne (entre mes comptes / comptes du couple) : exclu des dépenses et revenus */
  isTransfer: boolean;
  pending: boolean;
  externalId: string | null;
  hash: string;
  source: Provider;
  note: string;
  /** Exclue volontairement des calculs (reste visible dans l'historique) */
  excluded: boolean;
  /** Opération annulée (remboursée par le commerçant, rejetée…) : hors calculs et hors solde */
  cancelled: boolean;
  /** Dépense commune payée depuis un compte personnel (entre dans la répartition du couple) */
  shared: boolean;
  attachmentCount: number;
  /** Montant dans la devise d'origine si le compte n'est pas en euros */
  originalAmount: number | null;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  /** Budget mensuel par défaut (centimes) — dépenses variables */
  monthlyBudget: number;
  keywords: string[];
  archived: boolean;
}

export interface FixedCharge {
  id: string;
  name: string;
  amount: number; // centimes, positif
  dayOfMonth: number; // 1-31
  frequency: Frequency;
  accountId: string | null;
  categoryId: string | null;
  startMonth: string; // YYYY-MM
  endMonth: string | null; // YYYY-MM inclus
  /** Mot-clé pour rapprocher automatiquement la charge d'une transaction */
  matchKeyword: string;
  active: boolean;
  owner: Owner;
}

/** Statut / ajustement d'une charge pour un mois donné */
export interface ChargeMonth {
  chargeId: string;
  month: string; // YYYY-MM
  status: 'paid' | 'pending' | 'skipped';
  amount: number | null; // surcharge du montant pour ce mois
  transactionId: string | null;
}

/** Budget d'une catégorie pour un mois précis (surcharge du budget par défaut) */
export interface MonthBudget {
  categoryId: string;
  month: string;
  amount: number;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  monthlyContribution: number;
  targetDate: string | null; // YYYY-MM-DD
  owner: Owner;
  horizon: GoalHorizon;
  kind: 'security' | 'project' | 'investment' | 'other';
  accountId: string | null;
  createdAt: string;
}

export interface Settings {
  currency: string;
  /** Jour de paie habituel (1-31) */
  payday: number;
  /** Revenu mensuel attendu (centimes) — sert de repli si la paie n'est pas encore arrivée */
  expectedIncome: number;
  /** Épargne mensuelle fixe programmée (centimes) */
  monthlySavings: number;
  /** Épargne supplémentaire du mois (centimes) */
  extraSavings: number;
  /** Seuil d'alerte (fraction du budget) */
  alertThreshold: number;
  partnerName: string;
  userName: string;
  /** Préférences d'alertes de l'utilisateur */
  alerts: AlertSettings;
  /** Taux de conversion manuels vers la devise principale (ex. { USD: 0.92 }) */
  fxRates: Record<string, number>;
}

export interface AlertRule {
  enabled: boolean;
  /** Seuil en centimes (ou facteur pour « inhabituelle ») */
  threshold: number;
}

export interface AlertSettings {
  budgetOverrun: AlertRule;
  largeExpense: AlertRule;
  lowBalance: AlertRule;
  upcomingCharge: AlertRule;
  savingsMissed: AlertRule;
  unusualExpense: AlertRule;
  overdraftRisk: AlertRule;
  goalReached: AlertRule;
}

export type SplitMode = 'equal' | 'income' | 'manual' | 'category';

/** Paramètres partagés du couple (répartition des dépenses communes) */
export interface CoupleSettings {
  splitMode: SplitMode;
  /** Part de « ange » en mode manuel (0..1) */
  manualShare: number;
  /** Part de « ange » par catégorie (0..1), mode par catégorie */
  categoryShares: Record<string, number>;
}

export interface PartnerInfo {
  person: Owner;
  name: string;
  exists: boolean;
  /** Le/la partenaire partage ses comptes avec moi */
  sharesWithMe: boolean;
  sharedSince: string | null;
  /** Revenu mensuel déclaré (seulement si partagé) */
  expectedIncome: number | null;
}

export interface ViewerInfo {
  userId: string;
  person: Owner;
  name: string;
  username: string;
  /** Je partage mes comptes avec mon/ma partenaire */
  sharing: boolean;
}

export interface ArchivedMonth {
  month: string;
  person: Owner;
  closedAt: string;
  summary: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: string;
}

export interface SyncRun {
  id: string;
  provider: Provider;
  connectionId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'error';
  imported: number;
  duplicates: number;
  transfers: number;
  message: string;
}

export interface BalanceSnapshot {
  accountId: string;
  date: string;
  balance: number;
}

export interface BankConnection {
  id: string;
  provider: Provider;
  institution: string;
  country: string;
  owner: Owner;
  status: 'pending' | 'active' | 'expired' | 'error';
  validUntil: string | null;
  consentBy: string | null;
  createdAt: string;
  lastSyncAt: string | null;
}

export interface CategoryRule {
  id: string;
  pattern: string;
  categoryId: string;
  markTransfer: boolean;
}

export interface AppState {
  settings: Settings;
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  charges: FixedCharge[];
  chargeMonths: ChargeMonth[];
  monthBudgets: MonthBudget[];
  goals: Goal[];
  snapshots: BalanceSnapshot[];
  syncRuns: SyncRun[];
  connections: BankConnection[];
  rules: CategoryRule[];
  bankingConfigured: boolean;
  viewer: ViewerInfo;
  partner: PartnerInfo;
  couple: CoupleSettings;
  archives: ArchivedMonth[];
  demo: boolean;
}

export const DEFAULT_ALERTS: AlertSettings = {
  budgetOverrun: { enabled: true, threshold: 0 },
  largeExpense: { enabled: true, threshold: 15000 },
  lowBalance: { enabled: true, threshold: 20000 },
  upcomingCharge: { enabled: true, threshold: 10000 },
  savingsMissed: { enabled: true, threshold: 0 },
  unusualExpense: { enabled: true, threshold: 3 },
  overdraftRisk: { enabled: true, threshold: 0 },
  goalReached: { enabled: true, threshold: 0 },
};

export const DEFAULT_COUPLE: CoupleSettings = { splitMode: 'equal', manualShare: 0.5, categoryShares: {} };

export function partnerOf(p: Owner): Owner {
  return p === 'kelly' ? 'ange' : 'kelly';
}

export const DEFAULT_SETTINGS: Settings = {
  currency: 'EUR',
  payday: 1,
  expectedIncome: 0,
  monthlySavings: 0,
  extraSavings: 0,
  alertThreshold: 0.85,
  partnerName: 'Kelly',
  userName: 'Ange',
  alerts: DEFAULT_ALERTS,
  fxRates: {},
};
