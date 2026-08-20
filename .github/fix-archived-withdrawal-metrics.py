from pathlib import Path

path = Path('finance-logic.js')
s = path.read_text()
old = """  const withdrawal = rows.filter(isWithdrawal).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const grossContribution = rows.filter(isContribution).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const contribution = grossContribution - withdrawal;
"""
new = """  const withdrawal = rows.filter(isWithdrawal).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const archivedWithdrawal = transactions
    .filter(item => isArchivedTransaction(item) && isWithdrawal(item) && String(item?.date || '').startsWith(monthKey(date)))
    .reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const grossContribution = rows.filter(isContribution).reduce((sum, item) => sum + safeNumber(item.amount), 0);
  const contribution = grossContribution - withdrawal - archivedWithdrawal;
"""
if s.count(old) != 1: raise SystemExit('monthMetrics contribution block mismatch')
s = s.replace(old, new, 1)
old = "return { rows, income, withdrawal, cashIn, grossContribution, contribution, netContribution: contribution, consumption, variableConsumption, totalOut, balance, contributionRate };"
new = "return { rows, income, withdrawal, archivedWithdrawal, cashIn, grossContribution, contribution, netContribution: contribution, consumption, variableConsumption, totalOut, balance, contributionRate };"
if s.count(old) != 1: raise SystemExit('monthMetrics return mismatch')
s = s.replace(old, new, 1)
path.write_text(s)
