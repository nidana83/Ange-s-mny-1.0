import { describe, expect, it } from 'vitest';
import type { Account, AppState, FixedCharge, Transaction } from '../src/shared/types';
import { DEFAULT_COUPLE, DEFAULT_SETTINGS } from '../src/shared/types';
import { defaultCategories } from '../src/shared/defaults';
import { categorize, detectTransfers, findDuplicates, transactionHash } from '../src/shared/categorize';
import { parseCsv, parseOfx } from '../src/shared/importers';
import { toCents } from '../src/shared/money';
import { nextPayday } from '../src/shared/dates';
import {
  chargesForMonth, computeResteAVivre, goalStatus, monthSummary, variableBudgetLines, weekSummaries,
} from '../src/shared/analytics';
import { compareScenarios, SCENARIOS, simulate } from '../src/shared/projections';
import { answerQuestion, generateInsights } from '../src/shared/advisor';

const acc = (p: Partial<Account> & { id: string }): Account => ({
  name: p.id, type: 'current', owner: 'ange', institution: 'Revolut', currency: 'EUR', balance: 0, provider: 'manual',
  externalId: null, connectionId: null, consentAt: null, includeInAvailable: true, archived: false, updatedAt: '', originalBalance: 0, ...p,
});
let n = 0;
const tx = (accountId: string, date: string, amount: number, description: string, p: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, accountId, date, amount, description, merchant: description, categoryId: null, isTransfer: false, pending: false,
  externalId: null, hash: `h${n}`, source: 'manual', note: '', excluded: false, cancelled: false, shared: false, attachmentCount: 0, originalAmount: null, ...p,
});

function baseState(p: Partial<AppState> = {}): AppState {
  return {
    settings: { ...DEFAULT_SETTINGS, payday: 28, expectedIncome: 200000, monthlySavings: 30000 },
    accounts: [], transactions: [], categories: defaultCategories(), charges: [], chargeMonths: [], monthBudgets: [], goals: [],
    snapshots: [], syncRuns: [], connections: [], rules: [], bankingConfigured: false,
    viewer: { userId: 'u1', person: 'ange', name: 'Ange', username: 'ange', sharing: false },
    partner: { person: 'kelly', name: 'Kelly', exists: true, sharesWithMe: false, sharedSince: null, expectedIncome: null },
    couple: { ...DEFAULT_COUPLE }, archives: [], demo: false, ...p,
  };
}

describe('montants', () => {
  it('convertit les formats français et anglais en centimes', () => {
    expect(toCents('1 234,56 €')).toBe(123456);
    expect(toCents('1.234,56')).toBe(123456);
    expect(toCents('-12.5')).toBe(-1250);
    expect(toCents('1,234.50')).toBe(123450);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});

describe('dates', () => {
  it('calcule la prochaine paie', () => {
    expect(nextPayday('2026-11-09', 28)).toBe('2026-11-28');
    expect(nextPayday('2026-11-28', 28)).toBe('2026-12-28');
    expect(nextPayday('2026-02-10', 31)).toBe('2026-02-28');
  });
});

describe('import', () => {
  it('lit un relevé CSV Revolut (frais, opérations annulées, solde)', () => {
    const csv = [
      'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
      'CARD_PAYMENT,Current,2026-11-02 12:00:01,2026-11-03 09:00:00,Carrefour,-45.20,0.00,EUR,COMPLETED,954.80',
      'CARD_PAYMENT,Current,2026-11-04 12:00:01,,Uber Eats,-18.00,0.00,EUR,PENDING,',
      'CARD_PAYMENT,Current,2026-11-04 13:00:01,2026-11-04 13:00:02,Zara,-30.00,0.00,EUR,REVERTED,954.80',
      'EXCHANGE,Current,2026-11-05 10:00:00,2026-11-05 10:00:00,Exchanged to USD,-100.00,0.50,EUR,COMPLETED,854.30',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.format).toBe('revolut-csv');
    expect(r.transactions).toHaveLength(3);
    expect(r.transactions[0]).toMatchObject({ date: '2026-11-03', amount: -4520, product: 'Current' });
    expect(r.transactions[1]).toMatchObject({ date: '2026-11-04', pending: true });
    expect(r.transactions[2].amount).toBe(-10050);
    expect(r.closingBalance).toBe(85430);
  });

  it('lit un CSV bancaire français (point-virgule, débit/crédit)', () => {
    const csv = 'Date;Libellé;Débit;Crédit\n05/11/2026;PRLV SEPA EDF;65,00;\n06/11/2026;VIR SALAIRE;;2 400,00';
    const r = parseCsv(csv);
    expect(r.transactions.map((t) => [t.date, t.amount])).toEqual([['2026-11-05', -6500], ['2026-11-06', 240000]]);
  });

  it('lit un fichier OFX', () => {
    const ofx = '<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261102<TRNAMT>-12.50<FITID>A1<NAME>BOULANGERIE</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>500.00</LEDGERBAL></OFX>';
    const r = parseOfx(ofx);
    expect(r.transactions[0]).toMatchObject({ date: '2026-11-02', amount: -1250, externalId: 'A1' });
    expect(r.closingBalance).toBe(50000);
  });
});

describe('catégorisation, doublons, transferts', () => {
  const cats = defaultCategories();
  it('catégorise par mot-clé et respecte les règles apprises', () => {
    expect(categorize({ description: 'CB CARREFOUR MARKET 02/11', merchant: '', amount: -1000 }, cats, []).categoryId).toBe('courses');
    expect(categorize({ description: 'Salaire ACME', merchant: '', amount: 200000 }, cats, []).categoryId).toBe('salaire');
    expect(categorize({ description: 'Chez Tonton', merchant: '', amount: -1000 }, cats, [{ id: 'r', pattern: 'chez tonton', categoryId: 'restauration', markTransfer: false }]).categoryId).toBe('restauration');
    expect(categorize({ description: 'To pocket EUR Voyages', merchant: '', amount: -1000 }, cats, []).markTransfer).toBe(true);
  });

  it('détecte les doublons par empreinte et identifiant externe', () => {
    const a = { accountId: 'a', date: '2026-11-01', amount: -500, description: 'Café' };
    const h = transactionHash(a);
    expect(transactionHash({ ...a, description: '  CAFÉ ' })).toBe(h);
    const { fresh, duplicates } = findDuplicates([{ ...a, hash: h, externalId: null }, { ...a, hash: 'x', externalId: 'E1' }], [{ hash: h, externalId: 'E1', accountId: 'a' }]);
    expect(fresh).toHaveLength(0);
    expect(duplicates).toHaveLength(2);
  });

  it('ne compte pas les virements entre comptes du couple comme des dépenses', () => {
    const accounts = [acc({ id: 'main' }), acc({ id: 'joint', owner: 'joint', type: 'joint' })];
    const txs = [tx('main', '2026-11-01', -60000, 'Virement vers Compte commun'), tx('joint', '2026-11-02', 60000, 'Virement reçu'), tx('main', '2026-11-03', -2000, 'Boulangerie')];
    const ids = detectTransfers(txs, accounts);
    expect([...ids].sort()).toEqual([txs[0].id, txs[1].id].sort());
  });
});

describe('budget du mois', () => {
  const main = acc({ id: 'main', balance: 150000 });
  const vault = acc({ id: 'vault', type: 'vault', includeInAvailable: false, balance: 50000 });
  const loyer: FixedCharge = { id: 'c1', name: 'Loyer', amount: 80000, dayOfMonth: 5, frequency: 'monthly', accountId: 'main', categoryId: 'logement', startMonth: '2026-01', endMonth: null, matchKeyword: 'loyer', active: true, owner: 'ange' };
  const edf: FixedCharge = { ...loyer, id: 'c2', name: 'EDF', amount: 6500, dayOfMonth: 20, categoryId: 'energie', matchKeyword: 'edf' };
  const state = baseState({
    accounts: [main, vault],
    charges: [loyer, edf],
    transactions: [
      tx('main', '2026-11-05', -80000, 'PRLV Loyer novembre', { categoryId: 'logement' }),
      tx('main', '2026-11-03', -6500, 'Restaurant', { categoryId: 'restauration' }),
      tx('main', '2026-11-08', -4500, 'Uber Eats', { categoryId: 'restauration' }),
      tx('main', '2026-11-06', -10000, 'Lidl', { categoryId: 'courses' }),
      tx('main', '2026-10-28', 200000, 'Salaire', { categoryId: 'salaire' }),
      tx('main', '2026-11-02', -10000, 'To pocket', { isTransfer: true }),
      tx('vault', '2026-11-02', 10000, 'From main', { isTransfer: true }),
    ],
  });

  it('rapproche automatiquement les charges payées', () => {
    const c = chargesForMonth(state, '2026-11', '2026-11-10');
    expect(c.find((x) => x.charge.id === 'c1')).toMatchObject({ status: 'paid', auto: true });
    expect(c.find((x) => x.charge.id === 'c2')).toMatchObject({ status: 'pending', overdue: false });
  });

  it('déduit les dépenses du budget de la catégorie (ex. restauration 100 € − 110 €)', () => {
    const lines = variableBudgetLines(state, '2026-11', '2026-11-10');
    const resto = lines.find((l) => l.category.id === 'restauration')!;
    expect(resto).toMatchObject({ budget: 10000, spent: 11000, remaining: -1000 });
  });

  it('calcule le reste à vivre sans compter les transferts internes', () => {
    const r = computeResteAVivre(state, '2026-11-10');
    expect(r.available).toBe(150000);
    expect(r.remainingFixed).toBe(6500);
    expect(r.savingsDone).toBe(10000);
    expect(r.savingsRemaining).toBe(20000);
    expect(r.spendable).toBe(150000 - 6500 - 20000);
    expect(r.daysToPayday).toBe(18);
    expect(r.dailyBudget).toBe(Math.floor(r.spendable / 18));
    expect(r.resteAVivre).toBe(r.spendable - r.remainingVariablePlanned);
  });

  it('produit un bilan mensuel cohérent', () => {
    const s = monthSummary(state, '2026-11', '2026-11-10');
    expect(s.fixed).toBe(80000);
    expect(s.variable).toBe(21000);
    expect(s.savings).toBe(10000);
    expect(s.topCategories[0].category.id).toBe('logement');
    const w = weekSummaries(state, 2, '2026-11-10');
    expect(w).toHaveLength(2);
    expect(w[0].expenses + w[1].expenses).toBe(101000);
  });

  it('exclut les comptes de Kelly sans consentement', () => {
    const s2 = { ...state, accounts: [...state.accounts, acc({ id: 'k', owner: 'kelly', balance: 999999 })] };
    expect(computeResteAVivre(s2, '2026-11-10', 'couple').available).toBe(150000);
    const s3 = { ...state, accounts: [...state.accounts, acc({ id: 'k', owner: 'kelly', balance: 1000, consentAt: '2026-11-01' })] };
    expect(computeResteAVivre(s3, '2026-11-10', 'couple').available).toBe(151000);
    expect(computeResteAVivre(s3, '2026-11-10', 'me').available).toBe(150000);
  });

  it('répond aux questions avec les vraies données', () => {
    expect(answerQuestion('Combien ai-je dépensé en restauration ce mois-ci ?', state, '2026-11-10').text).toMatch(/110\s?€/);
    expect(answerQuestion('Est-ce que je peux me permettre un achat de 150 € ?', state, '2026-11-10').text).toMatch(/Oui|possible|déconseille/);
    expect(answerQuestion('Combien puis-je dépenser aujourd\'hui ?', state, '2026-11-10').text).toContain('par jour');
    expect(generateInsights(state, '2026-11-10').some((i) => i.id === 'over-restauration')).toBe(true);
  });
});

describe('objectifs et projections', () => {
  it('estime la date d\'atteinte d\'un objectif', () => {
    const s = goalStatus({ id: 'g', name: 'Voyage', target: 300000, saved: 100000, monthlyContribution: 50000, targetDate: '2027-03-01', owner: 'joint', horizon: 'short', kind: 'project', accountId: null, createdAt: '' }, '2026-11-09');
    expect(s.monthsToGo).toBe(4);
    expect(s.estimatedDate).toBe('2027-03-09');
    expect(s.requiredMonthly).toBe(50000);
    expect(s.onTrack).toBe(true);
  });

  it('simule les trois scénarios dans le bon ordre', () => {
    const params = { startAvailable: 100000, startSavings: 200000, monthlyIncome: 250000, monthlyFixed: 120000, monthlyVariable: 70000, monthlySavings: 40000, savingsYield: 0.02, inflation: 0.02, incomeGrowth: 0, exceptional: [{ id: 'x', label: 'Voiture', monthOffset: 6, amount: 300000 }], horizonMonths: 60 };
    const res = compareScenarios(params, '2026-11');
    const at12 = res.map((r) => r.points[12].total);
    expect(at12[0]).toBeLessThan(at12[1]);
    expect(at12[1]).toBeLessThan(at12[2]);
    const eq = simulate(params, SCENARIOS[1], '2026-11');
    expect(eq[5].total - eq[6].total).toBeGreaterThan(200000); // la dépense exceptionnelle est bien prise en compte
  });
});

import { coupleMonth } from '../src/shared/couple';
import { computeAlerts } from '../src/shared/alerts';
import { detectRecurring } from '../src/shared/recurring';

describe('couple', () => {
  const ange = acc({ id: 'a', owner: 'ange', balance: 100000 });
  const kelly = acc({ id: 'k', owner: 'kelly', balance: 100000, consentAt: '2026-11-01' });
  const joint = acc({ id: 'j', owner: 'joint', type: 'joint', balance: 50000 });
  const txs = [
    tx('a', '2026-11-01', -60000, 'Virement compte commun', { isTransfer: true }),
    tx('j', '2026-11-01', 60000, 'Virement de Ange', { isTransfer: true }),
    tx('k', '2026-11-02', -40000, 'Virement compte commun', { isTransfer: true }),
    tx('j', '2026-11-02', 40000, 'Virement de Kelly', { isTransfer: true }),
    tx('j', '2026-11-05', -80000, 'Loyer', { categoryId: 'logement' }),
    tx('a', '2026-11-06', -10000, 'Courses communes', { categoryId: 'courses', shared: true }),
    tx('a', '2026-11-07', -5000, 'Cinéma perso', { categoryId: 'loisirs' }),
    tx('a', '2026-11-03', 250000, 'Salaire', { categoryId: 'salaire' }),
    tx('k', '2026-11-03', 150000, 'Salaire', { categoryId: 'salaire' }),
  ];

  it('répartit les dépenses communes à 50/50 et calcule qui doit combien', () => {
    const s = baseState({ accounts: [ange, kelly, joint], transactions: txs });
    const c = coupleMonth(s, '2026-11');
    expect(c.commonExpenses).toBe(90000);
    expect(c.people.ange.contributions).toBe(60000);
    expect(c.people.kelly.contributions).toBe(40000);
    expect(c.people.ange.sharedPaid).toBe(10000);
    expect(c.people.ange.personalExpenses).toBe(5000);
    expect(c.due).toEqual({ ange: 45000, kelly: 45000 });
    // Ange a payé 70 000, Kelly 40 000 : (25 000 − (−5 000)) / 2 = 15 000 dus par Kelly
    expect(c.settlement).toBe(15000);
    // Les virements vers le compte commun ne sont ni des dépenses ni des revenus
    expect(c.people.ange.income).toBe(250000);
    expect(c.joint.income).toBe(0);
  });

  it('applique le prorata des revenus et les remboursements', () => {
    const s = baseState({
      accounts: [ange, kelly, joint],
      transactions: [...txs, tx('k', '2026-11-10', -5000, 'Remboursement Ange', { categoryId: 'remboursement-couple', isTransfer: true }), tx('a', '2026-11-10', 5000, 'Remboursement Kelly', { categoryId: 'remboursement-couple', isTransfer: true })],
      settings: { ...DEFAULT_SETTINGS, expectedIncome: 300000 },
      partner: { person: 'kelly', name: 'Kelly', exists: true, sharesWithMe: true, sharedSince: '2026-11-01', expectedIncome: 100000 },
      couple: { splitMode: 'income', manualShare: 0.5, categoryShares: {} },
    });
    const c = coupleMonth(s, '2026-11');
    expect(c.shareAnge).toBeCloseTo(0.75);
    expect(c.due).toEqual({ ange: 67500, kelly: 22500 });
    expect(c.reimbursements).toEqual({ angeToKelly: 0, kellyToAnge: 5000 });
    // (2 500 − 17 500) / 2 = −7 500, puis −5 000 déjà remboursés par Kelly → Ange doit 12 500
    expect(c.settlement).toBe(-12500);
  });

  it('ignore les comptes de Kelly tant qu\'elle ne les partage pas', () => {
    const s = baseState({ accounts: [ange, { ...kelly, consentAt: null }, joint], transactions: txs });
    const c = coupleMonth(s, '2026-11');
    expect(c.people.kelly.income).toBe(0);
    expect(c.people.kelly.visible).toBe(false);
  });
});

describe('exclusions, alertes et récurrences', () => {
  const main = acc({ id: 'main', balance: 10000 });
  it('les opérations exclues ou annulées sortent des calculs', () => {
    const s = baseState({ accounts: [main], transactions: [tx('main', '2026-11-03', -5000, 'Resto', { categoryId: 'restauration', excluded: true }), tx('main', '2026-11-04', -3000, 'Resto', { categoryId: 'restauration', cancelled: true }), tx('main', '2026-11-05', -2000, 'Resto', { categoryId: 'restauration' })] });
    expect(monthSummary(s, '2026-11', '2026-11-10').variable).toBe(2000);
  });

  it('déclenche les alertes selon les seuils et respecte la désactivation', () => {
    const transactions = [tx('main', '2026-11-08', -25000, 'Apple Store', { categoryId: 'shopping' })];
    const s = baseState({ accounts: [main], transactions });
    const kinds = computeAlerts(s, '2026-11-10').map((a) => a.kind);
    expect(kinds).toContain('largeExpense');
    expect(kinds).toContain('lowBalance');
    expect(kinds).toContain('budgetOverrun');
    const off = baseState({ accounts: [main], transactions, settings: { ...s.settings, alerts: { ...s.settings.alerts, largeExpense: { enabled: false, threshold: 15000 }, lowBalance: { enabled: true, threshold: 5000 } } } });
    const k2 = computeAlerts(off, '2026-11-10').map((a) => a.kind);
    expect(k2).not.toContain('largeExpense');
    expect(k2).not.toContain('lowBalance');
  });

  it('identifie les paiements récurrents mensuels', () => {
    const s = baseState({ accounts: [main], transactions: ['2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15'].map((d) => tx('main', d, -1199, 'Spotify P1234', { categoryId: 'abonnements' })) });
    const r = detectRecurring(s);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ frequency: 'monthly', amount: 1199, occurrences: 4, nextDate: '2026-11-15', tracked: false });
  });
});
