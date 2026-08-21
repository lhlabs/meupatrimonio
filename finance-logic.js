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
  return !!item
    && item.type === 'expense'
    && norm(item.category) === norm(CONTRIBUTION_CATEGORY);
}

export function isWithdrawal(item) {
  return !!item
    && item.type === 'income'
    && norm(item.category) === norm(WITHDRAWAL_CATEGORY);
}

export function isArchivedTransaction(item) {
  return item?.archived === true;
}

export function isProjectedTransaction(item) {
  return item?.projected === true;
}

export function isStoredScheduledProjection(item) {
  return isProjectedTransaction(item)
    && item?.sourceType === 'scheduled'
    && !item?.installmentGroupId;
}

export function isVariableConsumption(item) {
  if (!item || item.type !== 'expense' || isContribution(item)) return false;
  return !['recurring', 'scheduled'].includes(item.sourceType);
}

export function monthRows(transactions, date, { includeProjected = false } = {}) {
  const key = monthKey(date);
  return transactions.filter(item =>
    !isArchivedTransaction(item)
    && (includeProjected || !isStoredScheduledProjection(item))
    && String(item?.date || '').startsWith(key)
  );
}

export function contributionBalance(transactions, throughDate = null) {
  const realized = transactions.filter(item => !isProjectedTransaction(item));
  const rows = throughDate
    ? realized.filter(item => String(item?.date || '') <= throughDate)
    : realized;
  const contributions = rows.filter(isContribution).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const withdrawals = rows.filter(isWithdrawal).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  return Math.max(0, contributions - withdrawals);
}

export function splitInstallmentAmounts(amount, installments) {
  const count = Math.max(1, Math.min(120, Math.trunc(safeNumber(installments) || 1)));
  const cents = Math.round(Math.max(0, safeNumber(amount)) * 100);
  if (cents < count) return [];
  const base = Math.floor(cents / count);
  const remainder = cents % count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

export function cardInstallmentSchedule({ amount, installments, purchaseDate, closingDay, dueDay, firstInvoiceMonth = '' }) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(purchaseDate || ''));
  if (!match) return [];
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const purchase = new Date(year, month - 1, day, 12);
  if (purchase.getFullYear() !== year || purchase.getMonth() !== month - 1 || purchase.getDate() !== day) return [];
  const close = Math.max(1, Math.min(31, Math.trunc(safeNumber(closingDay) || 1)));
  const due = Math.max(1, Math.min(31, Math.trunc(safeNumber(dueDay) || 1)));
  const amounts = splitInstallmentAmounts(amount, installments);
  if (!amounts.length) return [];
  let firstDueMonth;
  const manualInvoiceMonth = String(firstInvoiceMonth || '');
  if (manualInvoiceMonth) {
    const invoiceMatch = /^(\d{4})-(\d{2})$/.exec(manualInvoiceMonth);
    if (!invoiceMatch) return [];
    const invoiceYear = Number(invoiceMatch[1]), invoiceMonth = Number(invoiceMatch[2]);
    if (invoiceMonth < 1 || invoiceMonth > 12) return [];
    firstDueMonth = new Date(invoiceYear, invoiceMonth - 1, 1, 12);
    const firstDueDate = dueDateFor(invoiceYear, invoiceMonth - 1, due);
    if (firstDueDate < String(purchaseDate)) return [];
  } else {
    const closingDate = dueDateFor(year, month - 1, close);
    const statementMonth = new Date(year, month - 1 + (String(purchaseDate) >= closingDate ? 1 : 0), 1, 12);
    firstDueMonth = new Date(statementMonth);
    if (due <= close) firstDueMonth.setMonth(firstDueMonth.getMonth() + 1);
  }
  return amounts.map((installmentAmount, index) => {
    const cursor = new Date(firstDueMonth.getFullYear(), firstDueMonth.getMonth() + index, 1, 12);
    return {
      amount: installmentAmount,
      date: dueDateFor(cursor.getFullYear(), cursor.getMonth(), due),
      installmentNumber: index + 1,
      installmentTotal: amounts.length
    };
  });
}

export function walletMetrics(wallets = [], cards = [], transactions = [], throughDate = ymd(new Date())) {
  void cards;
  const byWallet = wallets.map(wallet => {
    const movements = transactions.filter(item =>
      !isArchivedTransaction(item)
      && !isProjectedTransaction(item)
      && item?.walletId === wallet.id
      && (!throughDate || String(item.date || '') <= throughDate)
    );
    const movementBalance = movements.reduce((sum, item) => {
      const amount = safeNumber(item.amount);
      return sum + (item.type === 'income' ? amount : item.type === 'expense' ? -amount : 0);
    }, 0);
    return { ...wallet, balance: safeNumber(wallet.initialBalance) + movementBalance };
  });
  return {
    byWallet,
    total: byWallet.reduce((sum, item) => sum + safeNumber(item.balance), 0)
  };
}

export function cardDebtMetrics(cards = [], transactions = [], scheduled = [], throughDate = ymd(new Date())) {
  void transactions;
  const byCard = cards.map(card => {
    const pending = scheduled
      .filter(item => item?.cardId === card.id && (item.status == null || item.status === 'active'))
      .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
    const incurred = pending
      .filter(item => !item.purchaseDate || !throughDate || String(item.purchaseDate) <= throughDate);
    const open = pending.reduce((sum, item) => sum + safeNumber(item.amount), 0);
    const incurredOpen = incurred.reduce((sum, item) => sum + safeNumber(item.amount), 0);
    const nextDue = pending[0]?.dueDate || '';
    const nextMonth = String(nextDue).slice(0, 7);
    const nextInvoice = nextMonth
      ? pending.filter(item => String(item.dueDate || '').startsWith(nextMonth)).reduce((sum, item) => sum + safeNumber(item.amount), 0)
      : 0;
    return {
      ...card,
      open,
      incurredOpen,
      nextDue,
      nextInvoice,
      availableLimit: Math.max(0, safeNumber(card.creditLimit) - open)
    };
  });
  return {
    byCard,
    total: byCard.reduce((sum, item) => sum + safeNumber(item.open), 0),
    incurredTotal: byCard.reduce((sum, item) => sum + safeNumber(item.incurredOpen), 0)
  };
}

export function positionMetrics(positions = [], transactions = [], throughDate = ymd(new Date()), wallets = [], cards = [], scheduled = []) {
  const manualAssets = positions
    .filter(item => ['asset', 'reserve'].includes(item?.type))
    .reduce((sum, item) => sum + safeNumber(item.value), 0);
  const manualReserve = positions
    .filter(item => item?.type === 'reserve')
    .reduce((sum, item) => sum + safeNumber(item.value), 0);
  const manualDebts = positions
    .filter(item => item?.type === 'debt')
    .reduce((sum, item) => sum + safeNumber(item.value), 0);
  const contributionAssets = contributionBalance(transactions, throughDate);
  const walletAssets = walletMetrics(wallets, cards, transactions, throughDate).total;
  const cardDebts = cardDebtMetrics(cards, transactions, scheduled, throughDate).incurredTotal;
  const assets = manualAssets + contributionAssets + walletAssets;
  const reserve = manualReserve + contributionAssets;
  const debts = manualDebts + cardDebts;
  return {
    manualAssets,
    manualReserve,
    manualDebts,
    contributionAssets,
    walletAssets,
    cardDebts,
    assets,
    reserve,
    debts,
    netWorth: assets
  };
}

export function recurringDue(recurring, date) {
  if (!recurring?.active) return null;
  const due = dueDateFor(date.getFullYear(), date.getMonth(), recurring.dayOfMonth);
  const dueMonth = due.slice(0, 7);
  const startMonth = String(recurring.startDate || '').slice(0, 7);
  if (String(recurring.id || '').startsWith('legacy_') && startMonth && dueMonth === startMonth) return null;
  if (startMonth && dueMonth < startMonth) return null;
  if (recurring.endDate && due > recurring.endDate) return null;
  return due;
}

export function projectedRecurringRows(transactions = [], recurring = [], date, now = new Date()) {
  const key = monthKey(date);
  const currentKey = monthKey(now);
  if (key < currentKey) return [];

  return recurring
    .filter(item => item?.active === true && ['income', 'expense'].includes(item.type) && safeNumber(item.amount) > 0)
    .map(item => ({ item, due: recurringDue(item, date) }))
    .filter(({ due }) => !!due)
    .filter(({ item }) => !transactions.some(tx =>
      tx?.sourceType === 'recurring'
      && tx?.sourceId === item.id
      && String(tx?.date || '').startsWith(key)
    ))
    .map(({ item, due }) => ({
      id: `projected_rec_${item.id}_${key}`,
      type: item.type,
      amount: safeNumber(item.amount),
      category: item.category,
      description: item.name || item.description || '',
      date: due,
      recurring: true,
      sourceType: 'recurring',
      sourceId: item.id,
      projected: true
    }));
}

export function projectedCardInstallmentRows(transactions = [], scheduled = [], date) {
  const key = monthKey(date);
  return scheduled
    .filter(item => item && (item.status == null || item.status === 'active'))
    .filter(item => item.cardId && item.installmentGroupId && String(item.dueDate || '').startsWith(key))
    .filter(item => safeNumber(item.amount) > 0)
    .filter(item => !transactions.some(tx => tx?.sourceType === 'scheduled' && tx?.sourceId === item.id))
    .map(item => ({
      id: `projected_card_${item.id}_${key}`,
      type: 'expense',
      amount: safeNumber(item.amount),
      category: item.category,
      description: item.description || item.name || 'Parcela do cartão',
      date: item.dueDate,
      sourceType: 'scheduled',
      sourceId: item.id,
      projected: true,
      walletId: item.walletId || null,
      cardId: item.cardId || null,
      purchaseDate: item.purchaseDate || null,
      installmentGroupId: item.installmentGroupId || null,
      installmentNumber: item.installmentNumber ?? null,
      installmentTotal: item.installmentTotal ?? null
    }));
}

export function effectiveMonthRows(transactions = [], recurring = [], date, now = new Date()) {
  return [
    ...monthRows(transactions, date, { includeProjected: true }),
    ...projectedRecurringRows(transactions, recurring, date, now)
  ];
}

export function monthMetrics(transactions, date, recurring = null, now = new Date()) {
  const forecasting = Array.isArray(recurring);
  const rows = forecasting
    ? effectiveMonthRows(transactions, recurring, date, now)
    : monthRows(transactions, date);
  const income = rows.filter(item => item.type === 'income' && !isWithdrawal(item)).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const withdrawal = rows.filter(isWithdrawal).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const archivedWithdrawal = transactions
    .filter(item => isArchivedTransaction(item) && isWithdrawal(item) && String(item?.date || '').startsWith(monthKey(date)))
    .reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const grossContribution = rows.filter(isContribution).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const contribution = grossContribution - withdrawal - archivedWithdrawal;
  const consumption = rows.filter(item => item.type === 'expense' && !isContribution(item)).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const variableConsumption = rows.filter(isVariableConsumption).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const cashIn = income + withdrawal;
  const totalOut = grossContribution + consumption;
  const balance = cashIn - totalOut;
  const contributionRate = income > 0 ? contribution / income * 100 : null;
  return { rows, income, withdrawal, archivedWithdrawal, cashIn, grossContribution, contribution, netContribution: contribution, consumption, variableConsumption, totalOut, balance, contributionRate };
}

export function monthlySpendingGoal(income, ratio = MONTHLY_SPENDING_RATIO) {
  return Math.max(0, safeNumber(income)) * clamp(safeNumber(ratio), 0, 1);
}

export function shouldMaterializeRecurring(due, todayYmd) {
  const dueMonth = String(due || '').slice(0, 7);
  const currentMonth = String(todayYmd || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(dueMonth)
    && /^\d{4}-\d{2}$/.test(currentMonth)
    && dueMonth <= currentMonth;
}

export function daysElapsedInMonth(date, now = new Date()) {
  const isCurrent = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  return isCurrent ? Math.max(1, now.getDate()) : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function dailyVariableAverage(transactions, date, now = new Date()) {
  const metrics = monthMetrics(transactions, date);
  return metrics.variableConsumption / daysElapsedInMonth(date, now);
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
  const rows = effectiveMonthRows(transactions, recurring, date, now);
  const recurringExpenses = rows
    .filter(item => item?.type === 'expense' && !isContribution(item))
    .filter(item => item.sourceType === 'recurring' || item.recurring === true)
    .reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const otherExpenses = rows
    .filter(item => item?.type === 'expense' && !isContribution(item))
    .filter(item => item.sourceType !== 'recurring' && item.recurring !== true)
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
  // Só usa o histórico após três meses completos para evitar distorção por amostra curta.
  // A base nunca fica abaixo dos compromissos recorrentes atuais e passa a capturar
  // gastos reais relevantes que não tenham sido cadastrados como recorrentes.
  const historicalBase = history.months >= 3 ? history.average : 0;
  const monthlyBase = Math.max(recurringBase, historicalBase);
  const months = monthlyBase > 0 ? safeNumber(reserve) / monthlyBase : null;
  const target = monthlyBase > 0 ? monthlyBase * Math.max(1, safeNumber(targetMonths) || 6) : null;
  const progress = target ? clamp(safeNumber(reserve) / target, 0, 1) : null;
  return {
    recurringBase,
    historicalBase,
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
  const spendingValue = safeNumber(spending);
  const spendingLimit = safeNumber(spendingGoal);
  const spendingScore = spendingValue <= spendingLimit
    ? 1
    : clamp(1 - ((spendingValue - spendingLimit) / spendingLimit), 0, 1);
  const measures = [
    { score: contributionScore, weight: 40 },
    { score: spendingScore, weight: 35 }
  ];
  if (reserveProgress != null) measures.push({ score: clamp(reserveProgress, 0, 1), weight: 25 });
  const totalWeight = measures.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = measures.reduce((sum, item) => sum + item.score * item.weight, 0);
  // O score visual é sempre uma escala 0–100. A completude informa quantos pesos
  // estão efetivamente disponíveis, sem punir o usuário por uma métrica ainda não calculável.
  let score = totalWeight > 0 ? Math.round(weightedScore / totalWeight * 100) : null;
  if (spendingValue > spendingLimit * 1.5) score = Math.min(score ?? 0, 49);
  else if (spendingValue > spendingLimit) score = Math.min(score ?? 0, 69);
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
