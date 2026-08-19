export const CONTRIBUTION_CATEGORY = 'Investimentos/Aportes';
export const WITHDRAWAL_CATEGORY = 'Resgate de Patrimônio';
export const MONTHLY_SPENDING_RATIO = 0.60;

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

export function isWithdrawal(item) {
  if (!item || item.type !== 'income') return false;
  const category = norm(item.category);
  return category.includes('resgate de patrimonio') || category.includes('resgate patrimonio');
}

export function isVariableConsumption(item) {
  if (!item || item.type !== 'expense' || isContribution(item)) return false;
  return !['recurring', 'scheduled'].includes(item.sourceType);
}

export function monthRows(transactions, date) {
  const key = monthKey(date);
  return transactions.filter(item => String(item?.date || '').startsWith(key));
}

export function contributionBalance(transactions, throughDate = null) {
  const rows = throughDate
    ? transactions.filter(item => String(item?.date || '') <= throughDate)
    : transactions;
  const contributions = rows.filter(isContribution).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const withdrawals = rows.filter(isWithdrawal).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  return Math.max(0, contributions - withdrawals);
}

export function positionMetrics(positions = [], transactions = [], throughDate = ymd(new Date())) {
  const manualAssets = positions
    .filter(item => ['asset', 'reserve'].includes(item?.type))
    .reduce((sum, item) => sum + safeNumber(item.value), 0);
  const manualReserve = positions
    .filter(item => item?.type === 'reserve')
    .reduce((sum, item) => sum + safeNumber(item.value), 0);
  const debts = positions
    .filter(item => item?.type === 'debt')
    .reduce((sum, item) => sum + safeNumber(item.value), 0);
  const contributionAssets = contributionBalance(transactions, throughDate);
  const assets = manualAssets + contributionAssets;
  const reserve = manualReserve + contributionAssets;
  return {
    manualAssets,
    manualReserve,
    contributionAssets,
    assets,
    reserve,
    debts,
    netWorth: assets - debts
  };
}

export function monthMetrics(transactions, date) {
  const rows = monthRows(transactions, date);
  const income = rows.filter(item => item.type === 'income' && !isWithdrawal(item)).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const withdrawal = rows.filter(isWithdrawal).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const grossContribution = rows.filter(isContribution).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const contribution = grossContribution - withdrawal;
  const consumption = rows.filter(item => item.type === 'expense' && !isContribution(item)).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const variableConsumption = rows.filter(isVariableConsumption).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const cashIn = income + withdrawal;
  const totalOut = grossContribution + consumption;
  const balance = cashIn - totalOut;
  const contributionRate = income > 0 ? contribution / income * 100 : null;
  return { rows, income, withdrawal, cashIn, grossContribution, contribution, netContribution: contribution, consumption, variableConsumption, totalOut, balance, contributionRate };
}

export function monthlySpendingGoal(income, ratio = MONTHLY_SPENDING_RATIO) {
  return Math.max(0, safeNumber(income)) * clamp(safeNumber(ratio), 0, 1);
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
  const startMonth = String(recurring.startDate || '').slice(0, 7);
  if (String(recurring.id || '').startsWith('legacy_') && startMonth && due.slice(0, 7) === startMonth) return null;
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
  const referenceDay = /^\d{4}-\d{2}-\d{2}$/.test(String(todayYmd || '')) ? String(todayYmd) : ymd(new Date());
  const referenceMonth = referenceDay.slice(0, 7);
  return recurring
    .filter(item => item?.active === true && item.type === 'expense' && !isContribution(item) && safeNumber(item.amount) > 0)
    .filter(item => !item.startDate || String(item.startDate).slice(0, 7) <= referenceMonth)
    .filter(item => !item.endDate || String(item.endDate) >= referenceDay)
    .reduce((sum, item) => sum + safeNumber(item.amount), 0);
}

export function recurringExpenseTotalForMonth(recurring, date) {
  return recurring
    .filter(item => item?.active === true && item.type === 'expense' && !isContribution(item) && safeNumber(item.amount) > 0)
    .filter(item => recurringDue(item, date))
    .reduce((sum, item) => sum + safeNumber(item.amount), 0);
}

export function periodSpendingMetrics(transactions, recurring, date, now = new Date()) {
  const rows = monthRows(transactions, date);
  const realizedRecurring = rows
    .filter(item => item.type === 'expense' && item.sourceType === 'recurring' && !isContribution(item))
    .reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const currentKey = monthKey(now);
  const requestedKey = monthKey(date);
  const definedRecurring = requestedKey === currentKey
    ? activeRecurringExpenseTotal(recurring, ymd(now))
    : recurringExpenseTotalForMonth(recurring, date);
  const isPastMonth = requestedKey < currentKey;
  const recurringExpenses = isPastMonth ? realizedRecurring : Math.max(realizedRecurring, definedRecurring);
  const otherExpenses = rows
    .filter(item => item.type === 'expense' && item.sourceType !== 'recurring' && !isContribution(item))
    .reduce((sum, item) => sum + safeNumber(item.amount), 0);
  return {
    recurringExpenses,
    otherExpenses,
    totalExpenses: recurringExpenses + otherExpenses
  };
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

export function completedConsumptionHistory(transactions, todayYmd = ymd(new Date()), maxMonths = 6) {
  const [year, month] = String(todayYmd).split('-').map(Number);
  const anchor = Number.isFinite(year) && Number.isFinite(month) ? new Date(year, month - 1, 1) : new Date();
  anchor.setDate(1);
  const values = [];
  for (let offset = 1; offset <= maxMonths; offset += 1) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth() - offset, 1);
    const metrics = monthMetrics(transactions, date);
    if (metrics.consumption > 0) values.push(metrics.consumption);
  }
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return { average, months: values.length, values };
}

export function reserveMetrics({ reserve, transactions, recurring, referenceDate = new Date(), todayYmd = ymd(new Date()), targetMonths = 6 }) {
  void referenceDate;
  const recurringBase = activeRecurringExpenseTotal(recurring, todayYmd);
  const history = completedConsumptionHistory(transactions, todayYmd, 6);
  const monthlyBase = recurringBase;
  const months = monthlyBase > 0 ? safeNumber(reserve) / monthlyBase : null;
  const target = monthlyBase > 0 ? monthlyBase * Math.max(1, safeNumber(targetMonths) || 6) : null;
  const progress = target ? clamp(safeNumber(reserve) / target, 0, 1) : null;
  return {
    recurringBase,
    historicalBase: 0,
    observedHistoricalBase: history.average,
    historyMonths: history.months,
    monthlyBase,
    months,
    target,
    progress
  };
}

export function scoreMetrics({ contribution, contributionGoal, spending, spendingGoal, reserveProgress }) {
  const hasContributionGoal = safeNumber(contributionGoal) > 0;
  const hasSpendingGoal = safeNumber(spendingGoal) > 0;
  if (!hasContributionGoal || !hasSpendingGoal) {
    return {
      score: null,
      completeness: 0,
      contributionScore: hasContributionGoal ? clamp(safeNumber(contribution) / safeNumber(contributionGoal), 0, 1) : null,
      spendingScore: null,
      reserveScore: reserveProgress == null ? null : clamp(reserveProgress, 0, 1)
    };
  }
  const contributionScore = clamp(safeNumber(contribution) / safeNumber(contributionGoal), 0, 1);
  const spendingScore = safeNumber(spending) <= safeNumber(spendingGoal)
    ? 1
    : clamp(safeNumber(spendingGoal) / Math.max(safeNumber(spending), 0.01), 0, 1);
  const measures = [
    { score: contributionScore, weight: 40 },
    { score: spendingScore, weight: 35 }
  ];
  if (reserveProgress != null) measures.push({ score: clamp(reserveProgress, 0, 1), weight: 25 });
  const totalWeight = measures.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.round(measures.reduce((sum, item) => sum + item.score * item.weight, 0));
  return {
    score,
    completeness: totalWeight,
    contributionScore,
    spendingScore,
    reserveScore: reserveProgress == null ? null : clamp(reserveProgress, 0, 1)
  };
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
