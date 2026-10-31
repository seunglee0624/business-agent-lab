import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { weeklyWageBill } from '../js/core/finance.js';
import { won } from '../js/ui/format.js';
import { STAFF_KEYS, MAX_STAFF } from '../js/data/economy.js';

test('재정 조정: 주급 예산을 올리면 이적 예산이 남은 주 수만큼 줄고, 지금 주급 아래로는 못 내린다', () => {
  const state = g.createNewGame('budget');
  g.chooseLeague(state, 'ENG1', '테스트');
  const f = g.userClub(state).finance;
  const { weeks, max } = g.budgetRange(state);
  const before = { wage: f.wageBudget, transfer: f.transferBudget };
  assert.ok(g.adjustBudgets(state, before.wage + 1e7).ok);
  assert.ok(Math.abs(f.transferBudget - (before.transfer - 1e7 * weeks)) < 1e7);
  assert.ok(g.adjustBudgets(state, max).ok);
  assert.ok(f.transferBudget < 1e7);
  // 잔고를 다 주급으로 돌린 뒤에는 범위를 다시 구한다 (이적 예산은 잔고를 넘을 수 없다)
  const now = g.budgetRange(state);
  assert.ok(g.adjustBudgets(state, now.min).ok);
  assert.ok(f.wageBudget >= Math.min(before.wage, weeklyWageBill(state, g.userClub(state))) - 1e4);
  assert.equal(g.adjustBudgets(state, g.budgetRange(state).min - 1e9).ok, false);
});

test('재정 화면에 재정 조정 바와 남은 주급 여유가 보인다', async () => {
  const { financeView } = await import('../js/ui/views.js');
  const state = g.createNewGame('budget-view');
  g.chooseLeague(state, 'ENG1', '테스트');
  const html = financeView(state);
  assert.match(html, /type="range" data-change="wageBudget"/);
  assert.match(html, /남은 주급 여유/);
  assert.match(html, /id="budgetRoom"/);
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

test('이적 예산은 잔고 안에 묶인다: 시설·행사는 확인 없이는 그 돈을 못 쓰고, 주급 같은 고정 지출로 잔고가 줄면 이적 예산도 줄어든다', async () => {
  const { expense, spendable } = await import('../js/core/finance.js');
  const state = g.createNewGame('budget-lock');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  const f = club.finance;
  f.balance = 100e8;
  f.transferBudget = 99e8;
  assert.equal(spendable(state, club), 1e8);
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

test('재정 조정: 주급 예산을 줄이면 줄인 주급 × 남은 주가 그대로 이적 예산이 되고(잔고를 넘어 당겨 씀), 시즌이 지나며 당겨 쓴 한도가 줄어든다', async () => {
  const { refreshWageCredit } = await import('../js/core/finance.js');
  const state = g.createNewGame('budget-cap');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  const f = club.finance;
  f.balance = 60e8;
  f.transferBudget = 40e8;
  const r = g.budgetRange(state);
  const cut = 3e8;
  assert.ok(g.adjustBudgets(state, f.wageBudget - cut).ok);
  assert.ok(Math.abs(f.transferBudget - (40e8 + cut * r.weeks)) <= 1e6 * r.weeks, '잔고를 넘어 늘어난다');
  assert.ok(f.transferBudget > f.balance);
  assert.ok(Math.abs(f.wageCredit - cut * r.weeks) <= 1e6 * r.weeks, '당겨 쓸 수 있는 한도 = 줄인 주급 × 남은 주');
  // 다 써서 잔고가 마이너스가 되어도 된다
  f.balance -= f.transferBudget;
  f.transferBudget = 0;
  assert.ok(f.balance < 0);
  // 몇 주 지나면 당겨 쓴 한도가 그만큼 줄고, 이적 예산이 그 한도를 넘으면 맞춰 줄어든다
  f.transferBudget = f.wageCredit;
  state.date = '2027-03-01';
  refreshWageCredit(state, club);
  assert.ok(f.wageCredit < cut * r.weeks / 2);
  assert.equal(f.transferBudget, f.wageCredit);
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

test('강등 보조금: 강등된 구단은 두 시즌 동안 떠난 리그 중계권료의 50%, 25%를 받고, 다시 올라가면 끊긴다', async () => {
  const { updateParachutes, parachutePerSeason, tvPerSeason } = await import('../js/core/finance.js');
  const state = g.createNewGame('parachute');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = Object.values(state.clubs).find((c) => c.leagueId === 'ENG1' && c.id !== state.user.clubId);
  const top = tvPerSeason(club);
  club.leagueId = 'ENG2';
  updateParachutes(state, [{ clubId: club.id, from: 'ENG1', to: 'ENG2' }]);
  assert.equal(parachutePerSeason(club), top * 0.5);
  updateParachutes(state, []);
  assert.equal(parachutePerSeason(club), top * 0.25);
  updateParachutes(state, []);
  assert.equal(parachutePerSeason(club), 0);
  updateParachutes(state, [{ clubId: club.id, from: 'ENG1', to: 'ENG2' }]);
  updateParachutes(state, [{ clubId: club.id, from: 'ENG2', to: 'ENG1' }]);
  assert.equal(parachutePerSeason(club), 0, '승격하면 끊긴다');
});

test('재정 조정: 이적 예산이 0이어도 남는 잔고로 주급 예산을 올리고, 올린 만큼 잔고에서 떼어 두어 시설·행사에 못 쓴다', async () => {
  const { spendable, wageReserve } = await import('../js/core/finance.js');
  const state = g.createNewGame('budget-free');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  const f = club.finance;
  f.balance = 100e8;
  f.transferBudget = 0;
  const base = f.wageBudget;
  const r = g.budgetRange(state);
  assert.ok(r.max > base, '남는 잔고만큼 올릴 수 있다');
  assert.ok(Math.abs(r.max - (base + 100e8 / r.weeks)) < 1);
  // 반쯤 올리면 잔고의 절반이 주급용으로 묶인다
  assert.ok(g.adjustBudgets(state, base + 50e8 / r.weeks).ok);
  assert.equal(f.transferBudget, 0);
  assert.ok(Math.abs(wageReserve(state, club) - 50e8) <= r.weeks * 1e6);
  assert.ok(Math.abs(spendable(state, club) - 50e8) <= r.weeks * 1e6);
  // 다시 열어도 같은 잔고로 끝없이 올릴 수는 없다
  const again = g.budgetRange(state);
  assert.ok(Math.abs(again.max - r.max) < 1, '한도는 그대로');
  assert.ok(g.adjustBudgets(state, again.max).ok);
  assert.ok(spendable(state, club) <= r.weeks * 1e6, '끝까지 올리면 시설·행사에 쓸 돈이 없다');
  const res = g.startCampaign(state, 'documentary');
  assert.equal(res.ok, false);
  // 되돌리면 이적 예산으로 돌아온다
  assert.ok(g.adjustBudgets(state, base).ok);
  assert.ok(Math.abs(f.transferBudget - 100e8) <= r.weeks * 1e6);
  assert.equal(wageReserve(state, club), 0);
});

test('바 오른쪽 끝 값은 끝까지 밀었을 때 실제로 정해지는 주급 예산이고, 여유는 주급 예산 − 지금 주급', async () => {
  const { financeView } = await import('../js/ui/views.js');
  const state = g.createNewGame('budget-top');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  const top = Number(financeView(state).match(/data-change="wageBudget"[^>]*max="(\d+)"/)[1]);
  assert.ok(g.adjustBudgets(state, top).ok);
  assert.equal(club.finance.wageBudget, top);
  const html = financeView(state);
  assert.ok(html.includes(`id="budgetRoom">${won(club.finance.wageBudget - weeklyWageBill(state, club))}<`));
  assert.equal(g.wageRoom(5e6, 3e6), 2e6);
  assert.equal(g.wageRoom(3e6, 5e6), 0);
});

test('스태프 "올리면 +금액"은 실제로 올렸을 때 늘어나는 주급과 같다', async () => {
  const { clubView } = await import('../js/ui/views.js');
  const state = g.createNewGame('staff-wage');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  club.finance.wageBudget += 1e9;
  const shown = clubView(state, {}).match(/올리면 \+([^<]+)</)[1];
  // 화면의 첫 "올리면"은 아직 최고 수준이 아닌 첫 스태프 줄
  const key = STAFF_KEYS.find((k) => club.staff[k] < MAX_STAFF);
  const before = weeklyWageBill(state, club);
  assert.ok(g.setStaffLevel(state, key, club.staff[key] + 1).ok);
  assert.equal(shown, won(weeklyWageBill(state, club) - before));
});

test('바 오른쪽 끝은 브라우저 바가 실제로 닿는 값이다 (최소값에서 한 칸씩 가서 끝에 정확히 닿음)', () => {
  // ENG3: 최대는 1억을 넘고 지금 주급은 1억 아래인 리그
  const state = g.createNewGame('e1');
  g.chooseLeague(state, 'ENG3', '테스트');
  const r = g.budgetRange(state);
  assert.equal((r.top - r.min) % r.step, 0);
  const reach = r.min + Math.floor((r.top - r.min) / r.step) * r.step;
  assert.ok(g.adjustBudgets(state, reach).ok);
  assert.equal(g.userClub(state).finance.transferBudget, 0);
});

test('이적 예산 끌어 쓰기: 쓸 수 있는 돈이 모자라면 확인을 받아 이적 예산에서 꺼내고, 주급용으로 묶은 돈은 끝까지 못 쓴다', async () => {
  const { spendable, transferDraw } = await import('../js/core/finance.js');
  const { upgradeInfo } = await import('../js/core/facilities.js');
  const state = g.createNewGame('budget-draw');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  const f = club.finance;
  const cost = upgradeInfo(club, 'training').cost;
  f.balance = cost + 10e8;
  f.transferBudget = cost; // 쓸 수 있는 돈은 10억뿐
  assert.equal(spendable(state, club), 10e8);
  assert.equal(transferDraw(state, club, cost), cost - 10e8);
  // 확인 없이: 막히고 꺼낼 금액을 알려 준다. 돈은 그대로
  const ask = g.upgradeFacility(state, 'training');
  assert.equal(ask.ok, false);
  assert.equal(ask.code, 'transfer');
  assert.equal(ask.draw, cost - 10e8);
  assert.equal(f.balance, cost + 10e8);
  assert.equal(club.construction.length, 0);
  // 확인하면: 잔고에서 공사비가 나가고 이적 예산은 꺼낸 만큼 준다
  const res = g.upgradeFacility(state, 'training', { useTransfer: true });
  assert.ok(res.ok);
  assert.equal(f.balance, 10e8);
  assert.equal(f.transferBudget, 10e8);
  assert.equal(club.construction.length, 1);
});

test('이적 예산 끌어 쓰기: 주급용으로 묶은 돈까지는 못 쓰고, 그때는 재정 조정에서 주급 예산을 줄이라고 한다', () => {
  const state = g.createNewGame('budget-draw-wage');
  g.chooseLeague(state, 'ENG1', '테스트');
  const f = g.userClub(state).finance;
  f.balance = 100e8;
  f.transferBudget = 0;
  // 잔고를 거의 다 주급용으로 묶는다
  assert.ok(g.adjustBudgets(state, g.budgetRange(state).max).ok);
  const res = g.startCampaign(state, 'documentary', { useTransfer: true });
  assert.equal(res.ok, false);
  assert.notEqual(res.code, 'transfer');
  assert.match(res.reason, /주급/);
});

test('이적 예산 끌어 쓰기: 확인 때문에 한 번 막힌 유니폼 추가 생산도 다시 하면 된다', async () => {
  const { merchOf } = await import('../js/core/merch.js');
  const state = g.createNewGame('budget-draw-merch');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  const f = club.finance;
  const it = merchOf(club).items.kitHome;
  it.ordered = true; // 시즌 첫 생산은 이미 했다
  f.balance = 100e8;
  f.transferBudget = 100e8; // 쓸 수 있는 돈 0
  const first = g.orderMerch(state, 'kitHome', { quantity: 1000, price: it.price });
  assert.equal(first.code, 'transfer');
  assert.ok(!it.reordered, '막힌 주문은 아무것도 바꾸지 않는다');
  const again = g.orderMerch(state, 'kitHome', { quantity: 1000, price: it.price }, { useTransfer: true });
  assert.ok(again.ok);
  assert.ok(it.reordered);
  assert.equal(f.transferBudget, 100e8 - again.cost);
});
