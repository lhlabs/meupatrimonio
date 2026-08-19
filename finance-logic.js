export const CONTRIBUTION_CATEGORY = 'Investimentos/Aportes';

export const norm = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const safeNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function ymd(date) {
  return `${monthKey(date)}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dueDateFor(year, monthIndex, day) {
  const requested = Math.max(1, Math.min(31, Math.trunc(safeNumber(day) || 1)));
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(Math.min(requested, last)).padStart(2, '0')}`;
}

export function addYear(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return '';
  const last = new Date(year + 1, month, 0).getDate();
  return `${year + 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function isContribution(item) {
  if (!item || item.type !== 'expense') return false;
  const category = norm(item.category);
  return category.includes('aporte') || category.includes('investimento');
}

export function isVariableConsumption(item) {
  if (!item || item.type !== 'expense' || isContribution(item)) return false;
  return !['recurring', 'scheduled'].includes(item.sourceType);
}

export function monthRows(transactions, date) {
  const key = monthKey(date);
  return transactions.filter(item => String(item?.date || '').startsWith(key));
}

export function monthMetrics(transactions, date) {
  const rows = monthRows(transactions, date);
  const income = rows.filter(item => item.type === 'income').reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const contribution = rows.filter(isContribution).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const consumption = rows.filter(item => item.type === 'expense' && !isContribution(item)).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const variableConsumption = rows.filter(isVariableConsumption).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const totalOut = contribution + consumption;
  const balance = income - totalOut;
  const contributionRate = income > 0 ? contribution / income * 100 : null;
  return { rows, income, contribution, consumption, variableConsumption, totalOut, balance, contributionRate };
}

export function daysElapsedInMonth(date, now = new Date()) {
  const isCurrent = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  return isCurrent ? Math.max(1, now.getDate()) : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function dailyVariableAverage(transactions, date, now = new Date()) {
  const metrics = monthMetrics(transactions, date);
  return metrics.variableConsumption / daysElapsedInMonth(date, now);
}

export function recurringDue(recurring, date) {
  if (!recurring?.active) return null;
  const due = dueDateFor(date.getFullYear(), date.getMonth(), recurring.dayOfMonth);
  if (recurring.startDate && due < recurring.startDate) return null;
  if (recurring.endDate && due > recurring.endDate) return null;
  return due;
}

export function nextRecurringDue(recurring, fromDate = new Date()) {
  if (!recurring?.active) return null;
  const startDay = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const from = ymd(startDay);
  for (let offset = 0; offset <= 24; offset += 1) {
    const month = new Date(fromDate.getFullYear(), fromDate.getMonth() + offset, 1);
    const due = recurringDue(recurring, month);
    if (due && due >= from) return due;
  }
  return null;
}

export function activeRecurringExpenseTotal(recurring, todayYmd) {
  return recurring
    .filter(item => item?.active === true && item.type === 'expense' && !isContribution(item) && safeNumber(item.amount) > 0)
    .filter(item => !item.startDate || item.startDate <= todayYmd)
    .filter(item => !item.endDate || item.endDate >= todayYmd)
    .reduce((sum, item) => sum + safeNumber(item.amount), 0);
}

export function rollingConsumptionAverage(transactions, referenceDate = new Date(), maxMonths = 6) {
  const values = [];
  for (let offset = 1; offset <= maxMonths; offset += 1) {
    const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - offset, 1);
    const metrics = monthMetrics(transactions, date);
    if (metrics.consumption > 0) values.push(metrics.consumption);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function reserveMetrics({ reserve, transactions, recurring, referenceDate = new Date(), todayYmd = ymd(new Date()), targetMonths = 6 }) {
  const recurringBase = activeRecurringExpenseTotal(recurring, todayYmd);
  const historicalBase = rollingConsumptionAverage(transactions, referenceDate, 6);
  const monthlyBase = Math.max(recurringBase, historicalBase);
  const months = monthlyBase > 0 ? safeNumber(reserve) / monthlyBase : null;
  const target = monthlyBase > 0 ? monthlyBase * Math.max(1, safeNumber(targetMonths) || 6) : null;
  const progress = target ? clamp(safeNumber(reserve) / target, 0, 1) : null;
  return { recurringBase, historicalBase, monthlyBase, months, target, progress };
}

export function scoreMetrics({ contribution, contributionGoal, dailyAverage, dailyGoal, reserveProgress }) {
  if (!(safeNumber(contributionGoal) > 0) || !(safeNumber(dailyGoal) > 0)) {
    return { score: null, completeness: 0, contributionScore: null, dailyScore: null, reserveScore: reserveProgress == null ? null : clamp(reserveProgress, 0, 1) };
  }
  const contributionScore = clamp(safeNumber(contribution) / safeNumber(contributionGoal), 0, 1);
  const dailyScore = dailyAverage <= safeNumber(dailyGoal) ? 1 : clamp(safeNumber(dailyGoal) / Math.max(dailyAverage, 0.01), 0, 1);
  const measures = [
    { score: contributionScore, weight: 40 },
    { score: dailyScore, weight: 35 }
  ];
  if (reserveProgress != null) measures.push({ score: clamp(reserveProgress, 0, 1), weight: 25 });
  const totalWeight = measures.reduce((sum, item) => sum + item.weight, 0);
  // Missing dimensions remain missing: a partial score cannot masquerade as 100/100.
  const score = Math.round(measures.reduce((sum, item) => sum + item.score * item.weight, 0));
  return { score, completeness: totalWeight, contributionScore, dailyScore, reserveScore: reserveProgress == null ? null : clamp(reserveProgress, 0, 1) };
}

export function projectFutureValue({ annualRealRate, years, startingValue, monthlyContribution }) {
  const rate = safeNumber(annualRealRate);
  const months = Math.max(0, Math.trunc(safeNumber(years) * 12));
  const monthlyRate = Math.pow(1 + rate / 100, 1 / 12) - 1;
  const start = safeNumber(startingValue);
  const contribution = Math.max(0, safeNumber(monthlyContribution));
  if (!months) return start;
  return start * Math.pow(1 + monthlyRate, months) + (monthlyRate ? contribution * (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate : contribution * months);
}
