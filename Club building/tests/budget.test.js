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
