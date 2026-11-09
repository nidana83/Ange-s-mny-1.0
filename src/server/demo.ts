import type { Repo } from './db';
import { nowIso, uid } from './db';
import type { Account, FixedCharge, Goal } from '../shared/types';
import type { ParsedTransaction } from '../shared/importers';
import { addDays, addMonths, dateInMonth, monthKey, todayISO } from '../shared/dates';
import { ingest } from './pipeline';

/**
 * Données de DÉMONSTRATION, clairement identifiées comme telles (institution « Démo »).
 * Elles permettent de découvrir l'application ; elles se suppriment en un clic depuis les paramètres.
 */
export function loadDemo(repo: Repo, today = todayISO()) {
  repo.wipe();
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const between = (a: number, b: number) => Math.round((a + rnd() * (b - a)) * 100);

  repo.saveSettings({ payday: 28, expectedIncome: 240000, monthlySavings: 40000, extraSavings: 0, userName: 'Ange', partnerName: 'Kelly' });

  const acc = (p: Partial<Account> & Pick<Account, 'name' | 'type' | 'owner'>): Account => ({
    id: uid(), institution: 'Revolut (démo)', currency: 'EUR', balance: 0, provider: 'manual', externalId: null, connectionId: null,
    consentAt: null, includeInAvailable: p.type === 'current' || p.type === 'joint' || p.type === 'wallet', archived: false, updatedAt: nowIso(), ...p,
  });
  const main = acc({ name: 'Revolut — Compte principal', type: 'current', owner: 'ange' });
  const security = acc({ name: 'Coffre — Fonds de sécurité', type: 'vault', owner: 'ange' });
  const travel = acc({ name: 'Coffre — Voyages', type: 'vault', owner: 'joint' });
  const joint = acc({ name: 'Compte commun Ange & Kelly', type: 'joint', owner: 'joint' });
  const kelly = acc({ name: 'Revolut — Kelly', type: 'current', owner: 'kelly', consentAt: nowIso() });
  for (const a of [main, security, travel, joint, kelly]) repo.upsertAccount(a);

  const start = addMonths(monthKey(today), -6);
  const tx: Record<string, ParsedTransaction[]> = { [main.id]: [], [security.id]: [], [travel.id]: [], [joint.id]: [], [kelly.id]: [] };
  const push = (accountId: string, date: string, amount: number, description: string) => {
    if (date > today) return;
    tx[accountId].push({ date, amount, description, merchant: description, pending: false, externalId: null, currency: 'EUR', product: null, balanceAfter: null });
  };

  const groceries = ['Carrefour Market', 'Lidl', 'Leclerc Drive', 'Monoprix', 'Picard'];
  const food = ['Uber Eats', 'McDonald\'s', 'Sushi Shop', 'Deliveroo', 'Five Guys', 'Restaurant Le Comptoir'];
  const bakery = ['Boulangerie Paul', 'Boulangerie du coin', 'Relay Gare'];
  const shop = ['Zara', 'Amazon', 'Decathlon', 'Fnac', 'Vinted'];
  const fun = ['Cinéma UGC', 'Steam', 'Bowling Star', 'Concert Zénith'];
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

  for (let m = start; m <= monthKey(today); m = addMonths(m, 1)) {
    const d = (day: number) => dateInMonth(m, day);
    // Revenus
    push(main.id, d(28), 240000, 'Salaire ACME SAS');
    push(kelly.id, d(27), 210000, 'Salaire Kelly — Studio Nova');
    // Charges fixes
    push(joint.id, d(5), -95000, 'Loyer — SCI Les Tilleuls');
    push(main.id, d(10), -between(58, 72), 'EDF Prélèvement');
    push(main.id, d(12), -2999, 'Free Telecom Box');
    push(main.id, d(14), -1599, 'Free Mobile');
    push(main.id, d(8), -4500, 'MAIF Assurance habitation');
    push(main.id, d(15), -1199, 'Spotify');
    push(main.id, d(18), -1349, 'Netflix');
    push(main.id, d(3), -8640, 'Navigo RATP');
    // Contributions au compte commun (transferts internes)
    push(main.id, d(1), -60000, 'Transfer to Compte commun');
    push(joint.id, d(1), 60000, 'Transfer from Ange');
    push(kelly.id, d(1), -60000, 'Transfer to Compte commun');
    push(joint.id, d(1), 60000, 'Transfer from Kelly');
    // Épargne : coffres
    push(main.id, d(29), -30000, 'To pocket EUR Fonds de sécurité');
    push(security.id, d(29), 30000, 'From EUR main account');
    push(joint.id, d(29), -10000, 'To pocket EUR Voyages');
    push(travel.id, d(29), 10000, 'From joint account');
    // Dépenses variables
    for (let w = 0; w < 5; w++) {
      const day = 2 + w * 6 + Math.floor(rnd() * 3);
      push(joint.id, d(day), -between(55, 95), pick(groceries));
      push(main.id, d(Math.min(28, day + 1)), -between(9, 32), pick(food));
      push(main.id, d(Math.min(28, day + 2)), -between(2, 7), pick(bakery));
      if (rnd() > 0.5) push(main.id, d(Math.min(28, day + 3)), -between(40, 65), 'TotalEnergies Station');
      if (rnd() > 0.6) push(main.id, d(Math.min(28, day + 4)), -between(15, 70), pick(shop));
      if (rnd() > 0.65) push(main.id, d(Math.min(28, day + 2)), -between(10, 35), pick(fun));
      push(kelly.id, d(Math.min(28, day + 1)), -between(8, 40), pick([...food, ...shop]));
    }
    push(main.id, d(20), -between(12, 30), 'Pharmacie Centrale');
    push(main.id, d(22), -between(15, 35), 'Sephora');
  }

  const balances: Record<string, number> = { [main.id]: 0, [security.id]: 0, [travel.id]: 0, [joint.id]: 0, [kelly.id]: 0 };
  const opening: Record<string, number> = { [main.id]: 85000, [security.id]: 150000, [travel.id]: 40000, [joint.id]: 30000, [kelly.id]: 60000 };
  for (const [id, list] of Object.entries(tx)) {
    ingest(repo, id, list, 'manual');
    balances[id] = opening[id] + list.reduce((s, t) => s + t.amount, 0);
    repo.setBalance(id, balances[id], today);
  }

  const cat = (id: string) => id;
  const charge = (name: string, amount: number, day: number, accountId: string, categoryId: string, matchKeyword: string): FixedCharge => ({
    id: uid(), name, amount, dayOfMonth: day, frequency: 'monthly', accountId, categoryId: cat(categoryId), startMonth: start, endMonth: null, matchKeyword, active: true,
  });
  for (const c of [
    charge('Loyer', 95000, 5, joint.id, 'logement', 'loyer'),
    charge('Électricité EDF', 6500, 10, main.id, 'energie', 'edf'),
    charge('Box Internet', 2999, 12, main.id, 'telecom', 'free telecom'),
    charge('Forfait mobile', 1599, 14, main.id, 'telecom', 'free mobile'),
    charge('Assurance habitation', 4500, 8, main.id, 'assurances', 'maif'),
    charge('Spotify', 1199, 15, main.id, 'abonnements', 'spotify'),
    charge('Netflix', 1349, 18, main.id, 'abonnements', 'netflix'),
    charge('Pass Navigo', 8640, 3, main.id, 'transport-fixe', 'navigo'),
  ]) repo.upsertCharge(c);

  const goal = (g: Omit<Goal, 'id' | 'createdAt'>): Goal => ({ ...g, id: uid(), createdAt: nowIso() });
  for (const g of [
    goal({ name: 'Fonds de sécurité', target: 600000, saved: balances[security.id], monthlyContribution: 30000, targetDate: null, owner: 'ange', horizon: 'medium', kind: 'security', accountId: security.id }),
    goal({ name: 'Voyage au Japon', target: 400000, saved: balances[travel.id], monthlyContribution: 10000, targetDate: addDays(dateInMonth(addMonths(monthKey(today), 14), 1), 0), owner: 'joint', horizon: 'medium', kind: 'project', accountId: travel.id }),
    goal({ name: 'Nouveau canapé', target: 120000, saved: 20000, monthlyContribution: 0, targetDate: dateInMonth(addMonths(monthKey(today), 6), 1), owner: 'joint', horizon: 'short', kind: 'project', accountId: null }),
  ]) repo.upsertGoal(g);
}
