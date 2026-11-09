/** Utilitaires de dates sans fuseau (toutes les dates sont des chaînes YYYY-MM-DD locales). */

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function addDays(date: string, delta: number): string {
  const d = parseISODate(date);
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}

export function diffDays(a: string, b: string): number {
  const ms = parseISODate(b).getTime() - parseISODate(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function monthsBetween(fromMonth: string, toMonth: string): number {
  const [y1, m1] = fromMonth.split('-').map(Number);
  const [y2, m2] = toMonth.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

/** Jour du mois borné au dernier jour (ex : le 31 en février → 28/29). */
export function dateInMonth(month: string, day: number): string {
  return `${month}-${pad(Math.min(Math.max(1, day), daysInMonth(month)))}`;
}

/** Lundi de la semaine ISO contenant la date. */
export function weekStart(date: string): string {
  const d = parseISODate(date);
  const dow = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - dow);
  return toISODate(d);
}

export function isoWeekNumber(date: string): number {
  const d = parseISODate(date);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round((diff / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function monthLabel(month: string, short = false): string {
  const [y, m] = month.split('-').map(Number);
  return short ? `${MONTHS_SHORT_FR[m - 1]} ${String(y).slice(2)}` : `${MONTHS_FR[m - 1]} ${y}`;
}

export function dateLabel(date: string): string {
  const d = parseISODate(date);
  return `${d.getDate()} ${MONTHS_SHORT_FR[d.getMonth()]}`;
}

/**
 * Prochaine date de paie strictement après `today`.
 * Si la paie tombe aujourd'hui, la prochaine est le mois suivant.
 */
export function nextPayday(today: string, payday: number): string {
  const m = monthKey(today);
  const candidate = dateInMonth(m, payday);
  if (candidate > today) return candidate;
  return dateInMonth(addMonths(m, 1), payday);
}

export function previousPayday(today: string, payday: number): string {
  const m = monthKey(today);
  const candidate = dateInMonth(m, payday);
  if (candidate <= today) return candidate;
  return dateInMonth(addMonths(m, -1), payday);
}
