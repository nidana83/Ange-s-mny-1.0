/**
 * Projections financières par scénario. Il s'agit de SIMULATIONS fondées sur des hypothèses,
 * jamais de certitudes.
 */
import { addMonths } from './dates';

export interface ExceptionalExpense {
  id: string;
  label: string;
  monthOffset: number; // 1 = le mois prochain
  amount: number; // centimes positifs
}

export interface ProjectionParams {
  startAvailable: number;
  startSavings: number;
  monthlyIncome: number;
  monthlyFixed: number;
  monthlyVariable: number;
  monthlySavings: number;
  /** Rendement annuel de l'épargne (ex. 0.02 pour 2 %) */
  savingsYield: number;
  /** Inflation annuelle appliquée aux dépenses */
  inflation: number;
  /** Évolution annuelle des revenus */
  incomeGrowth: number;
  exceptional: ExceptionalExpense[];
  horizonMonths: number;
}

export type ScenarioKey = 'prudent' | 'equilibre' | 'optimiste';

export interface ScenarioDef {
  key: ScenarioKey;
  label: string;
  description: string;
  incomeFactor: number;
  fixedFactor: number;
  variableFactor: number;
  savingsFactor: number;
  yieldDelta: number;
}

export const SCENARIOS: ScenarioDef[] = [
  { key: 'prudent', label: 'Prudent', description: 'Dépenses variables +15 %, charges +5 %, épargne −30 %, revenus stables.', incomeFactor: 1, fixedFactor: 1.05, variableFactor: 1.15, savingsFactor: 0.7, yieldDelta: -0.005 },
  { key: 'equilibre', label: 'Équilibré', description: 'Ton comportement financier actuel, prolongé.', incomeFactor: 1, fixedFactor: 1, variableFactor: 1, savingsFactor: 1, yieldDelta: 0 },
  { key: 'optimiste', label: 'Optimiste', description: 'Dépenses variables −15 %, épargne +25 %, revenus +2 %.', incomeFactor: 1.02, fixedFactor: 1, variableFactor: 0.85, savingsFactor: 1.25, yieldDelta: 0.005 },
];

export interface ProjectionPoint {
  offset: number;
  month: string;
  available: number;
  savings: number;
  total: number;
  income: number;
  expenses: number;
  saved: number;
}

export function simulate(params: ProjectionParams, scenario: ScenarioDef, startMonth: string): ProjectionPoint[] {
  const points: ProjectionPoint[] = [];
  let available = params.startAvailable;
  let savings = params.startSavings;
  const yieldMonthly = Math.max(0, params.savingsYield + scenario.yieldDelta) / 12;
  points.push({ offset: 0, month: startMonth, available, savings, total: available + savings, income: 0, expenses: 0, saved: 0 });
  for (let i = 1; i <= params.horizonMonths; i++) {
    const years = (i - 1) / 12;
    const income = Math.round(params.monthlyIncome * scenario.incomeFactor * Math.pow(1 + params.incomeGrowth, years));
    const infl = Math.pow(1 + params.inflation, years);
    const fixed = Math.round(params.monthlyFixed * scenario.fixedFactor * infl);
    const variable = Math.round(params.monthlyVariable * scenario.variableFactor * infl);
    const exceptional = params.exceptional.filter((e) => e.monthOffset === i).reduce((s, e) => s + e.amount, 0);
    const expenses = fixed + variable + exceptional;
    const surplus = income - expenses;
    // On épargne le montant prévu tant que le compte courant reste positif
    const target = Math.round(params.monthlySavings * scenario.savingsFactor);
    const saved = Math.max(0, Math.min(target, available + surplus));
    available += surplus - saved;
    savings = Math.round(savings * (1 + yieldMonthly)) + saved;
    if (available < 0 && savings > 0) {
      // Découvert couvert par l'épargne de précaution
      const draw = Math.min(savings, -available);
      savings -= draw;
      available += draw;
    }
    points.push({ offset: i, month: addMonths(startMonth, i), available, savings, total: available + savings, income, expenses, saved });
  }
  return points;
}

export const MILESTONES = [3, 6, 12, 36, 60];

export function compareScenarios(params: ProjectionParams, startMonth: string) {
  return SCENARIOS.map((s) => {
    const points = simulate(params, s, startMonth);
    return {
      scenario: s,
      points,
      milestones: MILESTONES.filter((m) => m <= params.horizonMonths).map((m) => points[m]),
      firstNegative: points.find((p) => p.total < 0)?.month ?? null,
    };
  });
}

/** Mois (offset) où l'épargne simulée atteint un montant donné, ou null. */
export function monthReaching(points: ProjectionPoint[], amount: number): ProjectionPoint | null {
  return points.find((p) => p.savings >= amount) ?? null;
}
