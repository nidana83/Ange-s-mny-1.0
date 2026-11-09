import type { Category } from './types';

type Def = [id: string, name: string, kind: Category['kind'], color: string, icon: string, budget: number, keywords: string[]];

const DEFS: Def[] = [
  // Revenus
  ['salaire', 'Salaire', 'income', '#22c55e', '💼', 0, ['salaire', 'salary', 'payroll', 'paie', 'virement employeur']],
  ['autres-revenus', 'Autres revenus', 'income', '#4ade80', '➕', 0, ['remboursement', 'refund', 'caf', 'cashback', 'interest', 'interets']],
  // Charges fixes
  ['logement', 'Logement / loyer', 'fixed', '#6366f1', '🏠', 0, ['loyer', 'rent', 'syndic', 'charges copro']],
  ['energie', 'Énergie & eau', 'fixed', '#818cf8', '⚡', 0, ['edf', 'engie', 'totalenergies', 'veolia', 'eau', 'electricite', 'gaz']],
  ['telecom', 'Internet & téléphone', 'fixed', '#a78bfa', '📶', 0, ['free mobile', 'free telecom', 'orange', 'sfr', 'bouygues', 'sosh', 'red by sfr']],
  ['assurances', 'Assurances', 'fixed', '#c084fc', '🛡️', 0, ['assurance', 'maif', 'macif', 'axa', 'allianz', 'matmut', 'mutuelle']],
  ['abonnements', 'Abonnements', 'fixed', '#e879f9', '🔁', 0, ['netflix', 'spotify', 'disney', 'amazon prime', 'apple com bill', 'youtube premium', 'canal', 'deezer', 'icloud']],
  ['credits', 'Crédits', 'fixed', '#f472b6', '🏦', 0, ['pret', 'credit', 'echeance', 'cofidis', 'cetelem']],
  ['transport-fixe', 'Transports (abonnement)', 'fixed', '#fb7185', '🚇', 0, ['navigo', 'ratp', 'sncf abonnement', 'tcl', 'tisseo']],
  // Dépenses variables
  ['courses', 'Courses alimentaires', 'variable', '#f59e0b', '🛒', 30000, ['carrefour', 'leclerc', 'auchan', 'lidl', 'aldi', 'intermarche', 'monoprix', 'franprix', 'casino', 'super u', 'picard', 'grand frais', 'biocoop']],
  ['restauration', 'Fast-food & restauration', 'variable', '#f97316', '🍔', 10000, ['mcdonald', 'burger king', 'kfc', 'uber eats', 'deliveroo', 'just eat', 'restaurant', 'sushi', 'pizza', 'o tacos', 'five guys', 'starbucks']],
  ['boulangerie', 'Snacks & boulangerie', 'variable', '#fbbf24', '🥐', 3000, ['boulangerie', 'paul', 'brioche doree', 'patisserie', 'snack', 'relay']],
  ['hygiene', 'Hygiène & entretien', 'variable', '#2dd4bf', '🧴', 4000, ['sephora', 'action', 'normal', 'pharmacie', 'yves rocher', 'nocibe', 'marionnaud']],
  ['shopping', 'Shopping', 'variable', '#ec4899', '🛍️', 8000, ['zara', 'h m', 'amazon', 'zalando', 'shein', 'decathlon', 'fnac', 'ikea', 'primark', 'uniqlo', 'vinted']],
  ['loisirs', 'Loisirs', 'variable', '#8b5cf6', '🎮', 5000, ['cinema', 'ugc', 'pathe', 'steam', 'playstation', 'nintendo', 'fnac spectacles', 'ticketmaster']],
  ['sorties', 'Sorties', 'variable', '#a855f7', '🍸', 5000, ['bar', 'pub', 'club', 'concert', 'bowling']],
  ['carburant', 'Transport & carburant', 'variable', '#0ea5e9', '⛽', 6000, ['total', 'esso', 'shell', 'bp', 'uber', 'bolt', 'heetch', 'blablacar', 'sncf', 'peage', 'parking', 'lime']],
  ['sante', 'Santé', 'variable', '#10b981', '🩺', 3000, ['medecin', 'doctolib', 'dentiste', 'opticien', 'kine', 'laboratoire']],
  ['animaux', 'Animaux', 'variable', '#84cc16', '🐾', 2000, ['veterinaire', 'animalis', 'maxi zoo', 'croquettes']],
  ['imprevus', 'Dépenses imprévues', 'variable', '#ef4444', '⚠️', 5000, []],
  ['autres', 'Autres', 'variable', '#94a3b8', '📦', 3000, []],
  // Épargne & transferts
  ['epargne', 'Épargne', 'savings', '#14b8a6', '🐷', 0, ['livret', 'epargne', 'savings']],
  ['transfert', 'Transfert interne', 'transfer', '#64748b', '🔄', 0, ['to pocket', 'from pocket', 'vault', 'coffre', 'exchanged to', 'top up', 'round up']],
];

export function defaultCategories(): Category[] {
  return DEFS.map(([id, name, kind, color, icon, monthlyBudget, keywords]) => ({ id, name, kind, color, icon, monthlyBudget, keywords, archived: false }));
}
