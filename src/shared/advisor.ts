/**
 * Conseiller financier d'Ange's MNY.
 * Toutes les réponses sont calculées à partir des données réelles de l'application.
 * Quand une information manque, le conseiller le dit au lieu de l'inventer ;
 * les projections sont toujours présentées comme des estimations.
 */
import type { AppState } from './types';
import { addMonths, monthKey, monthLabel } from './dates';
import { formatMoney, formatPct, sum } from './money';
import { normalize, } from './categorize';
import {
  computeResteAVivre, goalStatus, monthSummary, ownersInScope, savingsBetween, type Scope,
} from './analytics';

export interface Insight {
  id: string;
  level: 'good' | 'info' | 'warn' | 'danger';
  title: string;
  detail: string;
}

const eur = (c: number) => formatMoney(c, 'EUR', { decimals: c % 100 !== 0 });

export function generateInsights(state: AppState, today: string, scope: Scope = 'me'): Insight[] {
  const out: Insight[] = [];
  if (!state.transactions.length) {
    return [{ id: 'empty', level: 'info', title: 'Pas encore de données', detail: 'Importe un relevé ou connecte ton compte pour recevoir des conseils fondés sur tes vraies dépenses.' }];
  }
  const month = monthKey(today);
  const cur = monthSummary(state, month, today, scope);
  const prev = monthSummary(state, addMonths(month, -1), today, scope);
  const rav = computeResteAVivre(state, today, scope);
  const day = Number(today.slice(8, 10));

  // 1. Comparaison catégorie par catégorie avec le mois précédent, à date équivalente
  const prevByCat = new Map(prev.topCategories.map((c) => [c.category.id, c.amount]));
  for (const c of cur.topCategories.slice(0, 6)) {
    const p = prevByCat.get(c.category.id);
    if (!p || p < 2000 || day < 20) continue;
    const delta = (c.amount - p) / p;
    if (delta > 0.2) out.push({ id: `cat-up-${c.category.id}`, level: 'warn', title: `${c.category.name} : +${Math.round(delta * 100)} %`, detail: `Tu as dépensé ${Math.round(delta * 100)} % de plus en ${c.category.name.toLowerCase()} que le mois précédent (${eur(c.amount)} contre ${eur(p)}).` });
  }

  // 2. Budgets : respectés / en risque
  for (const l of cur.budgetLines) {
    if (!l.budget) continue;
    if (l.spent > l.budget) out.push({ id: `over-${l.category.id}`, level: 'danger', title: `Budget ${l.category.name} dépassé`, detail: `Dépensé ${eur(l.spent)} pour un budget de ${eur(l.budget)} (dépassement de ${eur(l.spent - l.budget)}).` });
    else if (l.willExceedBy > 0) out.push({ id: `risk-${l.category.id}`, level: 'warn', title: `Risque sur ${l.category.name}`, detail: `À ton rythme actuel, tu risques de dépasser ton budget ${l.category.name.toLowerCase()} d'environ ${eur(l.willExceedBy)} (estimation).` });
    else if (day >= 10 && l.ratio <= Math.min(1, day / 30)) out.push({ id: `ok-${l.category.id}`, level: 'good', title: `${l.category.name} sous contrôle`, detail: `Ton budget ${l.category.name.toLowerCase()} est respecté : ${eur(l.spent)} sur ${eur(l.budget)}.` });
  }

  // 3. Surplus à affecter à l'épargne
  if (rav.resteAVivre > 5000 && rav.daysToPayday <= 10) {
    const security = state.goals.find((g) => g.kind === 'security' && g.saved < g.target);
    out.push({ id: 'surplus', level: 'good', title: 'Surplus disponible', detail: `Il te reste environ ${eur(rav.resteAVivre)} non budgétés avant la paie.${security ? ` Tu pourrais en affecter une partie à « ${security.name} ».` : ' Tu pourrais les affecter à ton épargne.'}` });
  }

  // 4. Tendance des dépenses variables sur 3 mois
  const m1 = monthSummary(state, addMonths(month, -1), today, scope).variable;
  const m2 = monthSummary(state, addMonths(month, -2), today, scope).variable;
  const m3 = monthSummary(state, addMonths(month, -3), today, scope).variable;
  if (m3 > 0 && m1 > m2 && m2 > m3 && m1 > m3 * 1.1) out.push({ id: 'trend', level: 'warn', title: 'Dépenses variables en hausse', detail: `Tes dépenses variables augmentent depuis trois mois : ${eur(m3)} → ${eur(m2)} → ${eur(m1)}.` });

  // 5. Rythme global
  if (rav.paceAlert.level !== 'ok') out.push({ id: 'pace', level: rav.paceAlert.level === 'danger' ? 'danger' : 'warn', title: 'Rythme de dépenses', detail: rav.paceAlert.message });

  // 6. Taux d'épargne du mois précédent
  if (prev.income > 0) {
    const rate = prev.savingsRate;
    if (rate >= 0.15) out.push({ id: 'rate', level: 'good', title: `Taux d'épargne : ${formatPct(rate)}`, detail: `En ${monthLabel(prev.month)}, tu as épargné ${eur(prev.savings)}, soit ${formatPct(rate)} de tes revenus. Bravo.` });
    else if (rate < 0.05) out.push({ id: 'rate', level: 'info', title: `Taux d'épargne : ${formatPct(rate)}`, detail: `En ${monthLabel(prev.month)}, ton taux d'épargne était de ${formatPct(rate)}. Un objectif de 10 % représenterait ${eur(Math.round(prev.income * 0.1))} par mois.` });
  }

  // 7. Objectifs en retard
  for (const g of state.goals) {
    const s = goalStatus(g, today);
    if (s.onTrack === false && s.requiredMonthly) out.push({ id: `goal-${g.id}`, level: 'info', title: `Objectif « ${g.name} »`, detail: `Pour l'atteindre à la date prévue, il faudrait ${eur(s.requiredMonthly)} par mois (actuellement ${eur(g.monthlyContribution)}).` });
  }

  // 8. Opérations non catégorisées
  const uncategorized = state.transactions.filter((t) => !t.categoryId && !t.isTransfer && monthKey(t.date) === month).length;
  if (uncategorized >= 3) out.push({ id: 'uncat', level: 'info', title: `${uncategorized} opérations à catégoriser`, detail: 'Catégorise-les pour fiabiliser tes budgets : l\'application retiendra tes choix pour les prochaines opérations.' });

  const order = { danger: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/* ------------------------- Questions / réponses ------------------------- */

function extractAmount(q: string): number | null {
  const m = q.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euros?)?/i);
  return m ? Math.round(Number(m[1].replace(',', '.')) * 100) : null;
}

export interface Answer {
  text: string;
  /** Les éléments de calcul affichés pour la transparence */
  details?: string[];
}

export function answerQuestion(question: string, state: AppState, today: string, scope: Scope = 'me'): Answer {
  const q = normalize(question);
  const month = monthKey(today);
  const rav = computeResteAVivre(state, today, scope);
  const partner = normalize(state.settings.partnerName || 'kelly');

  if (!state.accounts.length) return { text: 'Je n\'ai encore aucun compte à analyser. Ajoute un compte ou importe un relevé pour que je puisse te répondre avec tes vraies données.' };

  // Achat envisagé
  if (/(permettre|acheter|achat|offrir)/.test(q)) {
    const amount = extractAmount(question);
    if (!amount) return { text: 'Quel est le montant de l\'achat ? Par exemple : « Est-ce que je peux me permettre un achat de 150 € ? »' };
    const after = rav.resteAVivre - amount;
    const afterSpendable = rav.spendable - amount;
    const details = [
      `Dépensable jusqu'à la paie : ${eur(rav.spendable)}`,
      `Reste à vivre après budgets prévus : ${eur(rav.resteAVivre)}`,
      `Jours avant la paie : ${rav.daysToPayday}`,
    ];
    if (after >= 0) return { text: `Oui, a priori. Après un achat de ${eur(amount)}, il te resterait ${eur(after)} non budgétés jusqu'à la paie, sans toucher à tes budgets ni à ton épargne prévue.`, details };
    if (afterSpendable >= 0) return { text: `C'est possible, mais cela empiéterait sur tes budgets prévus de ${eur(-after)}. Ton budget journalier passerait de ${eur(rav.dailyBudget)} à ${eur(Math.floor(afterSpendable / rav.daysToPayday))} jusqu'à la paie.`, details };
    return { text: `Je te le déconseille : cet achat de ${eur(amount)} dépasserait ce qui reste après tes charges fixes et ton épargne programmée (manque estimé : ${eur(-afterSpendable)}).`, details };
  }

  // Combien puis-je dépenser aujourd'hui
  if (/(depenser|budget) (aujourd hui|ce jour|par jour)|combien.*aujourd hui|par jour/.test(q)) {
    return {
      text: `Tu peux dépenser environ ${eur(rav.dailyBudget)} par jour jusqu'à ta prochaine paie (${rav.daysToPayday} jours), soit ${eur(rav.weeklyBudget)} par semaine.`,
      details: [`Solde disponible : ${eur(rav.available)}`, `Charges fixes restantes : −${eur(rav.remainingFixed)}`, `Épargne programmée restante : −${eur(rav.savingsRemaining)}`, `= ${eur(rav.spendable)} / ${rav.daysToPayday} j`],
    };
  }

  // Économies avec Kelly / épargne commune
  if (new RegExp(`(econom|epargn).*(${partner}|ensemble|couple|nous)|(${partner}|couple).*(econom|epargn)`).test(q)) {
    const owners: string[] = ['joint', 'kelly'];
    const goals = state.goals.filter((g) => owners.includes(g.owner));
    const saved = sum(goals, (g) => g.saved);
    const coupleSaved = savingsBetween(state, `${month}-01`, today, 'couple');
    const kellyLinked = state.accounts.some((a) => a.owner === 'kelly' && a.consentAt);
    return {
      text: goals.length
        ? `Vos objectifs communs totalisent ${eur(saved)} épargnés sur ${eur(sum(goals, (g) => g.target))}. Ce mois-ci, ${eur(coupleSaved)} ont été mis de côté sur les comptes d'épargne suivis du couple.`
        : `Aucun objectif commun n'est encore défini. Ce mois-ci, ${eur(coupleSaved)} ont été mis de côté sur les comptes d'épargne suivis.`,
      details: kellyLinked ? undefined : [`Les comptes de ${state.settings.partnerName} ne sont pas inclus : son consentement n'a pas été enregistré.`],
    };
  }

  // Dépenses d'une catégorie
  if (/(depense|coute|claque|combien)/.test(q)) {
    const cat = state.categories.find((c) => {
      const n = normalize(c.name);
      return q.includes(n) || n.split(' ').some((w) => w.length > 4 && q.includes(w)) || c.keywords.some((k) => normalize(k).length > 3 && q.includes(normalize(k)));
    });
    if (cat) {
      const target = /mois dernier|mois precedent/.test(q) ? addMonths(month, -1) : month;
      const s = monthSummary(state, target, today, scope);
      const spent = s.topCategories.find((c) => c.category.id === cat.id)?.amount ?? 0;
      const line = s.budgetLines.find((l) => l.category.id === cat.id);
      return { text: `En ${monthLabel(target)}, tu as dépensé ${eur(spent)} en ${cat.name.toLowerCase()}${line?.budget ? ` pour un budget de ${eur(line.budget)} (reste ${eur(line.remaining)})` : ''}.` };
    }
  }

  // Fin du mois
  if (/fin (du|de) mois|restera|rester a la fin|solde.*fin/.test(q)) {
    return {
      text: `Estimation : ton solde disponible serait d'environ ${eur(rav.endOfMonthForecast)} à la fin de ${monthLabel(month)}, si ton rythme de dépenses actuel se poursuit. Ce n'est pas une certitude.`,
      details: [`Solde actuel : ${eur(rav.available)}`, rav.expectedIncomeRemaining ? `Revenu attendu : +${eur(rav.expectedIncomeRemaining)}` : 'Revenu du mois déjà perçu ou non renseigné', `Projection des dépenses variables : ${eur(rav.variablePaceProjection)}`],
    };
  }

  // Budget équilibré
  if (/equilibr|sain|ca va|situation/.test(q)) {
    const plannedOut = rav.variableBudget + sum(state.charges.filter((c) => c.active && c.frequency === 'monthly'), (c) => c.amount) + rav.savingsPlanned;
    const income = state.settings.expectedIncome || monthSummary(state, addMonths(month, -1), today, scope).income;
    if (!income) return { text: 'Je ne connais pas encore ton revenu mensuel. Renseigne-le dans les paramètres ou importe un mois complet de relevé.' };
    const gap = income - plannedOut;
    return {
      text: gap >= 0
        ? `Oui, ton budget prévisionnel est équilibré : tes charges, budgets variables et épargne (${eur(plannedOut)}) restent sous tes revenus (${eur(income)}). Marge : ${eur(gap)}.`
        : `Ton budget prévisionnel est déséquilibré : tu prévois ${eur(plannedOut)} de sorties pour ${eur(income)} de revenus (écart ${eur(gap)}).`,
    };
  }

  // Économiser X € de plus
  if (/(economiser|epargner|mettre de cote)/.test(q)) {
    const target = extractAmount(question) ?? 10_000;
    const prev = monthSummary(state, addMonths(month, -1), today, scope);
    const candidates = prev.budgetLines.filter((l) => l.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 4);
    if (!candidates.length) return { text: 'Je n\'ai pas assez d\'historique de dépenses variables pour te proposer un plan d\'économies.' };
    const total = sum(candidates, (l) => l.spent);
    const plan = candidates.map((l) => {
      const cut = Math.round((l.spent / total) * target);
      return `${l.category.name} : −${eur(cut)} (de ${eur(l.spent)} à ${eur(l.spent - cut)}, soit −${Math.round((cut / l.spent) * 100)} %)`;
    });
    return { text: `Pour économiser ${eur(target)} de plus par mois, voici une répartition proportionnelle à tes plus grosses dépenses variables du mois dernier :`, details: [...plan, 'Programme ensuite un virement automatique vers ton épargne le jour de la paie.'] };
  }

  // Reste à vivre
  if (/reste a vivre|disponible|combien.*(reste|ai je)/.test(q)) {
    return { text: `Ton reste à vivre est de ${eur(rav.resteAVivre)} après charges fixes, épargne programmée et budgets prévus. Avant budgets, tu disposes de ${eur(rav.spendable)} jusqu'au ${rav.nextPayday.split('-').reverse().join('/')}.` };
  }

  // Objectifs
  if (/objectif|projet/.test(q)) {
    const owners = ownersInScope(scope);
    const list = state.goals.filter((g) => owners.includes(g.owner)).map((g) => {
      const s = goalStatus(g, today);
      return `${g.name} : ${Math.round(s.progress * 100)} %${s.estimatedDate ? `, atteint vers ${monthLabel(monthKey(s.estimatedDate))} (estimation)` : ', pas de contribution mensuelle définie'}`;
    });
    return list.length ? { text: 'Voici où en sont tes objectifs :', details: list } : { text: 'Tu n\'as pas encore défini d\'objectif d\'épargne.' };
  }

  return {
    text: 'Je n\'ai pas compris la question. Je sais répondre à des questions comme :',
    details: [
      'Combien puis-je dépenser aujourd\'hui ?',
      'Est-ce que je peux me permettre un achat de 150 € ?',
      'Combien ai-je dépensé en restauration ce mois-ci ?',
      `Combien avons-nous économisé avec ${state.settings.partnerName} ?`,
      'Combien me restera-t-il à la fin du mois ?',
      'Est-ce que mon budget est équilibré ?',
      'Comment économiser 100 € supplémentaires par mois ?',
    ],
  };
}
