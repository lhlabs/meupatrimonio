import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dueDateFor, addYear, isContribution, isWithdrawal, contributionBalance, monthMetrics,
  nextRecurringDue, activeRecurringExpenseTotal, completedConsumptionHistory,
  periodSpendingMetrics, reserveMetrics, scoreMetrics, projectFutureValue
} from '../finance-logic.js';

test('dueDateFor clamps invalid month-end days', () => {
  assert.equal(dueDateFor(2027, 1, 31), '2027-02-28');
  assert.equal(dueDateFor(2028, 1, 31), '2028-02-29');
});

test('addYear preserves leap dates safely', () => {
  assert.equal(addYear('2028-02-29'), '2029-02-28');
});

test('contributions are separated from consumption and cash balance', () => {
  const tx = [
    {type:'income', amount:5000, date:'2026-08-01', category:'Salário'},
    {type:'expense', amount:1000, date:'2026-08-02', category:'Investimentos/Aportes'},
    {type:'expense', amount:1200, date:'2026-08-03', category:'Moradia', sourceType:'recurring'},
    {type:'expense', amount:300, date:'2026-08-04', category:'Mercado'}
  ];
  const m = monthMetrics(tx, new Date(2026,7,1));
  assert.equal(m.income, 5000);
  assert.equal(m.contribution, 1000);
  assert.equal(m.netContribution, 1000);
  assert.equal(m.withdrawal, 0);
  assert.equal(m.consumption, 1500);
  assert.equal(m.variableConsumption, 300);
  assert.equal(m.balance, 2500);
  assert.equal(m.contributionRate, 20);
  assert.equal(isContribution(tx[1]), true);
});

test('withdrawal moves patrimony back to monthly cash without becoming income', () => {
  const tx = [
    {type:'income', amount:5000, date:'2026-08-01', category:'Salário'},
    {type:'expense', amount:1000, date:'2026-08-02', category:'Investimentos/Aportes'},
    {type:'income', amount:400, date:'2026-08-10', category:'Resgate de Patrimônio'},
    {type:'expense', amount:300, date:'2026-08-11', category:'Mercado'}
  ];
  const m = monthMetrics(tx, new Date(2026,7,1));
  assert.equal(isWithdrawal(tx[2]), true);
  assert.equal(m.income, 5000);
  assert.equal(m.withdrawal, 400);
  assert.equal(m.cashIn, 5400);
  assert.equal(m.grossContribution, 1000);
  assert.equal(m.contribution, 600);
  assert.equal(m.netContribution, 600);
  assert.equal(m.balance, 4100);
  assert.equal(m.contributionRate, 12);
  assert.equal(contributionBalance(tx), 600);
});

test('new contributions accumulate immediately in derived patrimony', () => {
  const tx = [
    {id:'old',type:'expense',amount:1000,date:'2026-08-01',category:'Investimentos/Aportes'},
    {id:'new1',type:'expense',amount:750,date:'2026-08-18',category:'Investimentos/Aportes'},
    {id:'new2',type:'expense',amount:250,date:'2026-08-19',category:'Investimentos/Aportes'}
  ];
  assert.equal(contributionBalance(tx), 2000);
});

test('deleting a contribution automatically lowers derived patrimony', () => {
  const tx = [
    {id:'a',type:'expense',amount:1000,date:'2026-08-02',category:'Investimentos/Aportes'},
    {id:'b',type:'expense',amount:500,date:'2026-08-09',category:'Investimentos/Aportes'}
  ];
  assert.equal(contributionBalance(tx),1500);
  assert.equal(contributionBalance(tx.filter(item=>item.id!=='b')),1000);
});

test('withdrawal reduces derived patrimony by exactly the amount returned to cash', () => {
  const tx = [
    {type:'expense',amount:2000,date:'2026-08-01',category:'Investimentos/Aportes'},
    {type:'income',amount:600,date:'2026-08-18',category:'Resgate de Patrimônio'}
  ];
  assert.equal(contributionBalance(tx),1400);
  assert.equal(monthMetrics(tx,new Date(2026,7,1)).balance,-1400);
});

test('derived patrimony never becomes negative after withdrawals', () => {
  const tx = [
    {type:'expense',amount:500,date:'2026-08-01',category:'Investimentos/Aportes'},
    {type:'income',amount:700,date:'2026-08-02',category:'Resgate de Patrimônio'}
  ];
  assert.equal(contributionBalance(tx),0);
});

test('next recurring due crosses into the next month after current due passed', () => {
  const recurring={active:true,type:'expense',amount:100,dayOfMonth:5,startDate:'2026-01-01',endDate:'',category:'Moradia'};
  assert.equal(nextRecurringDue(recurring,new Date(2026,7,18)), '2026-09-05');
});

test('future recurring commitments do not inflate current reserve base', () => {
  const recurring=[
    {active:true,type:'expense',amount:1000,category:'Moradia',startDate:'2026-09-01',endDate:''},
    {active:true,type:'expense',amount:500,category:'Mercado',startDate:'2026-01-01',endDate:''}
  ];
  assert.equal(activeRecurringExpenseTotal(recurring,'2026-08-18'),500);
});

test('period spending is recurring commitments plus other period expenses', () => {
  const tx=[
    {type:'expense',amount:1200,date:'2026-08-05',category:'Moradia',sourceType:'recurring'},
    {type:'expense',amount:300,date:'2026-08-10',category:'Mercado'},
    {type:'expense',amount:200,date:'2026-08-12',category:'Academia',sourceType:'scheduled'},
    {type:'expense',amount:1000,date:'2026-08-15',category:'Investimentos/Aportes'}
  ];
  const recurring=[
    {active:true,type:'expense',amount:1200,dayOfMonth:5,category:'Moradia',startDate:'2026-01-01',endDate:''},
    {active:true,type:'expense',amount:800,dayOfMonth:25,category:'Veículo',startDate:'2026-01-01',endDate:''}
  ];
  const result=periodSpendingMetrics(tx,recurring,new Date(2026,7,1),new Date(2026,7,19));
  assert.equal(result.recurringExpenses,2000);
  assert.equal(result.otherExpenses,500);
  assert.equal(result.totalExpenses,2500);
});

test('past period spending prefers realized recurring expenses', () => {
  const tx=[
    {type:'expense',amount:900,date:'2026-07-05',category:'Moradia',sourceType:'recurring'},
    {type:'expense',amount:100,date:'2026-07-08',category:'Mercado'}
  ];
  const recurring=[
    {active:true,type:'expense',amount:1500,dayOfMonth:5,category:'Moradia',startDate:'2026-01-01',endDate:''}
  ];
  const result=periodSpendingMetrics(tx,recurring,new Date(2026,6,1),new Date(2026,7,19));
  assert.equal(result.recurringExpenses,900);
  assert.equal(result.otherExpenses,100);
  assert.equal(result.totalExpenses,1000);
});

test('completed consumption history ignores the current partial month', () => {
  const tx=[
    {type:'expense',amount:6397,date:'2026-08-10',category:'Mercado'},
    {type:'expense',amount:2000,date:'2026-07-10',category:'Mercado'}
  ];
  const history=completedConsumptionHistory(tx,'2026-08-18',6);
  assert.deepEqual(history.values,[2000]);
  assert.equal(history.average,2000);
  assert.equal(history.months,1);
});

test('reserve target is stable when user navigates from August to September', () => {
  const tx=[{type:'expense',amount:6397,date:'2026-08-10',category:'Mercado'}];
  const recurring=[{active:true,type:'expense',amount:2000,category:'Moradia',startDate:'2026-01-01',endDate:''}];
  const august=reserveMetrics({reserve:20000,transactions:tx,recurring,referenceDate:new Date(2026,7,1),todayYmd:'2026-08-18',targetMonths:6});
  const september=reserveMetrics({reserve:20000,transactions:tx,recurring,referenceDate:new Date(2026,8,1),todayYmd:'2026-08-18',targetMonths:6});
  assert.equal(august.monthlyBase,2000);
  assert.equal(august.target,12000);
  assert.equal(september.monthlyBase,2000);
  assert.equal(september.target,12000);
  assert.equal(september.target,august.target);
});

test('high historical spending never overrides recurring reserve base', () => {
  const tx=[
    {type:'expense',amount:3000,date:'2026-07-10',category:'Mercado'},
    {type:'expense',amount:3000,date:'2026-06-10',category:'Mercado'},
    {type:'expense',amount:3000,date:'2026-05-10',category:'Mercado'}
  ];
  const recurring=[{active:true,type:'expense',amount:2000,category:'Moradia',startDate:'2026-01-01',endDate:''}];
  const r=reserveMetrics({reserve:18000,transactions:tx,recurring,todayYmd:'2026-08-18',targetMonths:6});
  assert.equal(r.historyMonths,3);
  assert.equal(r.observedHistoricalBase,3000);
  assert.equal(r.historicalBase,0);
  assert.equal(r.monthlyBase,2000);
  assert.equal(r.target,12000);
  assert.equal(r.progress,1);
  assert.equal(r.months,9);
});

test('reserve target is exactly six months of recurring expenses when configured for six months', () => {
  const recurring=[
    {active:true,type:'expense',amount:1200,category:'Moradia',startDate:'2026-01-01',endDate:''},
    {active:true,type:'expense',amount:800,category:'Veículo',startDate:'2026-01-01',endDate:''}
  ];
  const r=reserveMetrics({reserve:6000,transactions:[],recurring,todayYmd:'2026-08-19',targetMonths:6});
  assert.equal(r.recurringBase,2000);
  assert.equal(r.monthlyBase,2000);
  assert.equal(r.target,12000);
  assert.equal(r.months,3);
  assert.equal(r.progress,0.5);
});

test('score requires the two user-controlled monthly goals', () => {
  assert.equal(scoreMetrics({contribution:1000,contributionGoal:0,dailyAverage:20,dailyGoal:50,reserveProgress:1}).score,null);
  const partial=scoreMetrics({contribution:1000,contributionGoal:1000,dailyAverage:40,dailyGoal:50,reserveProgress:null});
  assert.equal(partial.completeness,75);
  assert.equal(partial.score,75);
  const s=scoreMetrics({contribution:1000,contributionGoal:1000,dailyAverage:40,dailyGoal:50,reserveProgress:0.5});
  assert.equal(s.completeness,100);
  assert.equal(s.score,88);
});

test('projection handles zero real rate', () => {
  assert.equal(projectFutureValue({annualRealRate:0,years:1,startingValue:1000,monthlyContribution:100}),2200);
});
