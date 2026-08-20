from pathlib import Path

finance = Path('finance-logic.js')
s = finance.read_text()
old = """export function isWithdrawal(item) {
  return !!item
    && item.type === 'income'
    && norm(item.category) === norm(WITHDRAWAL_CATEGORY);
}

export function isVariableConsumption(item) {
"""
new = """export function isWithdrawal(item) {
  return !!item
    && item.type === 'income'
    && norm(item.category) === norm(WITHDRAWAL_CATEGORY);
}

export function isArchivedTransaction(item) {
  return item?.archived === true;
}

export function isVariableConsumption(item) {
"""
if s.count(old) != 1: raise SystemExit('finance withdrawal helper mismatch')
s = s.replace(old, new, 1)
old = "return transactions.filter(item => String(item?.date || '').startsWith(key));"
new = "return transactions.filter(item => !isArchivedTransaction(item) && String(item?.date || '').startsWith(key));"
if s.count(old) != 1: raise SystemExit('monthRows mismatch')
s = s.replace(old, new, 1)
old = "const movements = transactions.filter(item => item?.walletId === wallet.id && (!throughDate || String(item.date || '') <= throughDate));"
new = "const movements = transactions.filter(item => !isArchivedTransaction(item) && item?.walletId === wallet.id && (!throughDate || String(item.date || '') <= throughDate));"
if s.count(old) != 1: raise SystemExit('wallet movements mismatch')
s = s.replace(old, new, 1)
finance.write_text(s)

app = Path('app.js')
s = app.read_text()
old = """  isContribution, isWithdrawal, monthKey, monthMetrics, monthlySpendingGoal,
"""
new = """  isArchivedTransaction, isContribution, isWithdrawal, monthKey, monthMetrics, monthlySpendingGoal,
"""
if s.count(old) != 1: raise SystemExit('app import mismatch')
s = s.replace(old, new, 1)
old = "let list = txCache.slice().sort((a,b) => String(b.date).localeCompare(String(a.date)));"
new = "let list = txCache.filter(tx => !isArchivedTransaction(tx)).sort((a,b) => String(b.date).localeCompare(String(a.date)));"
if s.count(old) != 1: raise SystemExit('renderTransactions mismatch')
s = s.replace(old, new, 1)
old = """  if (target.dataset.deleteTx && confirm('Excluir este lançamento?')) await runAction(target, async () => { await deleteDoc(userDoc('transactions', target.dataset.deleteTx)); await loadAll(); }, 'Lançamento excluído');
"""
new = """  if (target.dataset.deleteTx && confirm('Excluir este lançamento?')) {
    const transactionId = target.dataset.deleteTx;
    const transaction = txCache.find(item => item.id === transactionId);
    await runAction(target, async () => {
      if (isWithdrawal(transaction)) {
        await updateDoc(userDoc('transactions', transactionId), { archived:true, walletId:null, cardId:null });
      } else {
        await deleteDoc(userDoc('transactions', transactionId));
      }
      await loadAll();
    }, 'Lançamento excluído');
  }
"""
if s.count(old) != 1: raise SystemExit('delete transaction handler mismatch')
s = s.replace(old, new, 1)
old = "sheetXml('Lançamentos',['Data','Tipo','Categoria','Descrição','Valor','Origem','Carteira','Cartão','Parcela'],txCache.map(tx => [tx.date,tx.type,tx.category,tx.description || '',safeNumber(tx.amount),tx.sourceType || 'manual',walletById(tx.walletId)?.name || '',cardById(tx.cardId)?.name || '',tx.installmentTotal ? `${tx.installmentNumber}/${tx.installmentTotal}` : '']))"
new = "sheetXml('Lançamentos',['Data','Tipo','Categoria','Descrição','Valor','Origem','Carteira','Cartão','Parcela'],txCache.filter(tx => !isArchivedTransaction(tx)).map(tx => [tx.date,tx.type,tx.category,tx.description || '',safeNumber(tx.amount),tx.sourceType || 'manual',walletById(tx.walletId)?.name || '',cardById(tx.cardId)?.name || '',tx.installmentTotal ? `${tx.installmentNumber}/${tx.installmentTotal}` : '']))"
if s.count(old) != 1: raise SystemExit('Excel transactions mismatch')
s = s.replace(old, new, 1)
app.write_text(s)

mobile = Path('mobile/mobile.js')
s = mobile.read_text()
old = """  CONTRIBUTION_CATEGORY, cardDebtMetrics, monthMetrics, periodSpendingMetrics, positionMetrics, projectedCardInstallmentRows, safeNumber, walletMetrics, ymd
"""
new = """  CONTRIBUTION_CATEGORY, cardDebtMetrics, isArchivedTransaction, monthMetrics, periodSpendingMetrics, positionMetrics, projectedCardInstallmentRows, safeNumber, walletMetrics, ymd
"""
if s.count(old) != 1: raise SystemExit('mobile import mismatch')
s = s.replace(old, new, 1)
old = "const rows = txCache.slice().sort(compareTransactions).slice(0,8);"
new = "const rows = txCache.filter(tx => !isArchivedTransaction(tx)).sort(compareTransactions).slice(0,8);"
if s.count(old) != 1: raise SystemExit('mobile recent mismatch')
s = s.replace(old, new, 1)
mobile.write_text(s)

sw = Path('sw.js')
s = sw.read_text()
if "const CACHE='meu-patrimonio-v42';" not in s: raise SystemExit('root cache mismatch')
s = s.replace("const CACHE='meu-patrimonio-v42';", "const CACHE='meu-patrimonio-v43';", 1)
sw.write_text(s)

msw = Path('mobile/sw.js')
s = msw.read_text()
if "const CACHE = 'mp-mobile-v16';" not in s: raise SystemExit('mobile cache mismatch')
s = s.replace("const CACHE = 'mp-mobile-v16';", "const CACHE = 'mp-mobile-v17';", 1)
msw.write_text(s)
