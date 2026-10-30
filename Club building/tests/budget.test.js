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

test('새 시즌 이적 예산: 남은 예산에 지난 시즌 수익의 절반을 더하고, 잔고의 20% 아래로 내려가지 않으며, 잔고를 넘지 않는다', async () => {
  const { setBudgets, emptyLedger } = await import('../js/core/finance.js');
  const state = g.createNewGame('budget-carry');
  g.chooseLeague(state, 'ENG1', '테스트');
  const f = g.userClub(state).finance;
  f.transferBudget = 50e8;
  f.balance = 300e8;
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
  // 적자 시즌 뒤에도 잔고의 20%는 남는다
  f.transferBudget = 0;
  f.balance = 100e8;
  f.history[0].income.tv = 0;
  setBudgets(state, g.userClub(state));
  assert.equal(f.transferBudget, 20e8);
});

test('재정 조정: 이적 탭에서도 버튼으로 재정 조정 창을 열 수 있다', async () => {
  const { transfersView } = await import('../js/ui/transfers.js');
  const state = g.createNewGame('budget-tr');
  g.chooseLeague(state, 'ENG1', '테스트');
  assert.match(transfersView(state, {}), /data-action="openBudget"/);
  const html = transfersView(state, { budgetOpen: true });
  assert.match(html, /data-change="wageBudget"/);
});

test('이적 예산은 잔고 안에 묶인다: 시설·행사는 그 돈을 못 쓰고, 주급 같은 고정 지출로 잔고가 줄면 이적 예산도 줄어든다', async () => {
  const { expense, spendable } = await import('../js/core/finance.js');
  const state = g.createNewGame('budget-lock');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  const f = club.finance;
  f.balance = 100e8;
  f.transferBudget = 99e8;
  assert.equal(spendable(club), 1e8);
  const res = g.startCampaign(state, 'documentary');
  assert.equal(res.ok, false);
  assert.match(res.reason, /이적 예산/);
  f.transferBudget = 50e8;
  assert.ok(g.startCampaign(state, 'documentary').ok);
  assert.equal(f.transferBudget, 50e8, '고를 수 있는 지출은 이적 예산을 건드리지 않는다');
  expense(club, 'wages', f.balance - 30e8);
  assert.equal(f.balance, 30e8);
  assert.equal(f.transferBudget, 30e8);
});

test('재정 조정: 주급 예산을 줄여도 이적 예산은 잔고를 넘지 않는다', async () => {
  const state = g.createNewGame('budget-cap');
  g.chooseLeague(state, 'ENG1', '테스트');
  const f = g.userClub(state).finance;
  f.balance = f.transferBudget + 1e8;
  const r = g.budgetRange(state);
  assert.ok(g.adjustBudgets(state, r.min).ok);
  assert.ok(f.transferBudget <= f.balance);
  assert.ok(Math.abs(f.transferBudget - f.balance) <= r.weeks * 1e6);
});

test('AI 구단 예산: 주급이 수입의 70%를 넘으면 주급 예산을 지금 주급에서 묶고, 적자 시즌 뒤에는 잔고 20% 하한이 없다', async () => {
  const { setBudgets, weeklyWageBill, emptyLedger } = await import('../js/core/finance.js');
  const state = g.createNewGame('budget-ai');
  g.chooseLeague(state, 'ENG1', '테스트');
  const ai = Object.values(state.clubs).find((c) => c.status === 'active' && c.id !== state.user.clubId && c.leagueId === 'ENG1');
  for (const id of ai.squad) state.players[id].contract.wage *= 3;
  const last = emptyLedger();
  last.expense.wages = 10e8;
  ai.finance.history.unshift({ season: 2025, ...last, balance: ai.finance.balance });
  ai.finance.transferBudget = 0;
  setBudgets(state, ai);
  assert.ok(Math.abs(ai.finance.wageBudget - weeklyWageBill(state, ai)) <= 1e6, '1.1배 여유 없이 지금 주급');
  assert.equal(ai.finance.transferBudget, 0, '적자 뒤에는 하한 없음');
});
