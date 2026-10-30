import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { weeklyWageBill } from '../js/core/finance.js';

test('재정 조정: 주급 예산을 올리면 이적 예산이 남은 주 수만큼 줄고, 지금 주급 아래로는 못 내린다', () => {
  const state = g.createNewGame('budget');
  g.chooseLeague(state, 'ENG1', '테스트');
  const f = g.userClub(state).finance;
  const { weeks, min, max } = g.budgetRange(state);
  const before = { wage: f.wageBudget, transfer: f.transferBudget };
  assert.ok(g.adjustBudgets(state, before.wage + 1e7).ok);
  assert.ok(Math.abs(f.transferBudget - (before.transfer - 1e7 * weeks)) < 1e7);
  assert.ok(g.adjustBudgets(state, max).ok);
  assert.ok(f.transferBudget < 1e7);
  assert.ok(g.adjustBudgets(state, min).ok);
  assert.ok(f.wageBudget >= Math.min(before.wage, weeklyWageBill(state, g.userClub(state))) - 1e4);
  assert.equal(g.adjustBudgets(state, min - 1e9).ok, false);
});

test('재정 화면에 재정 조정 바가 보인다', async () => {
  const { financeView } = await import('../js/ui/views.js');
  const state = g.createNewGame('budget-view');
  g.chooseLeague(state, 'ENG1', '테스트');
  const html = financeView(state);
  assert.match(html, /type="range" data-change="wageBudget"/);
  assert.match(html, /재정 조정/);
});

test('새 시즌 이적 예산: 남은 예산에 지난 시즌 수익의 절반을 더하고, 잔고를 넘지 않는다', async () => {
  const { setBudgets, emptyLedger } = await import('../js/core/finance.js');
  const state = g.createNewGame('budget-carry');
  g.chooseLeague(state, 'ENG1', '테스트');
  const f = g.userClub(state).finance;
  f.transferBudget = 50e8;
  f.balance = 500e8;
  const last = emptyLedger();
  last.income.tv = 100e8;
  last.income.transfers = 40e8; // 이적 수입은 이미 예산에 들어갔으므로 빼고 계산
  last.expense.wages = 60e8;
  f.history.unshift({ season: 2025, ...last, balance: f.balance });
  const b = setBudgets(state, g.userClub(state));
  assert.equal(b.carried, 50e8);
  assert.equal(b.added, 20e8);
  assert.equal(f.transferBudget, 70e8);
  f.transferBudget = 50e8;
  f.balance = 30e8;
  setBudgets(state, g.userClub(state));
  assert.equal(f.transferBudget, 30e8);
});

test('재정 조정: 이적 탭에서도 버튼으로 재정 조정 창을 열 수 있다', async () => {
  const { transfersView } = await import('../js/ui/transfers.js');
  const state = g.createNewGame('budget-tr');
  g.chooseLeague(state, 'ENG1', '테스트');
  assert.match(transfersView(state, {}), /data-action="openBudget"/);
  const html = transfersView(state, { budgetOpen: true });
  assert.match(html, /data-change="wageBudget"/);
});
