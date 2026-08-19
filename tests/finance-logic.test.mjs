import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dueDateFor, addYear, isContribution, monthMetrics, nextRecurringDue,
  activeRecurringExpenseTotal, reserveMetrics, scoreMetrics, projectFutureValue
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
  assert.equal(m.consumption, 1500);
  assert.equal(m.variableConsumption, 300);
  assert.equal(m.balance, 2500);
  assert.equal(m.contributionRate, 20);
  assert.equal(isContribution(tx[1]), true);
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

test('reserve base uses the larger of recurring commitments and historical consumption', () => {
  const tx=[];
  for(let m=1;m<=6;m++) tx.push({type:'expense',amount:2000,date:`2026-${String(m).padStart(2,'0')}-10`,category:'Mercado'});
  const recurring=[{active:true,type:'expense',amount:1500,category:'Moradia',endDate:''}];
  const r=reserveMetrics({reserve:12000,transactions:tx,recurring,referenceDate:new Date(2026,6,1),todayYmd:'2026-07-01',targetMonths:6});
  assert.equal(r.monthlyBase,2000);
  assert.equal(r.months,6);
  assert.equal(r.target,12000);
  assert.equal(r.progress,1);
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
