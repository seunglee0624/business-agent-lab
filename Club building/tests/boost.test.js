import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { transferDemand } from '../js/core/contracts.js';
import { userReputationGain, USER_BOOST } from '../js/core/boost.js';
import { income } from '../js/core/finance.js';
import { settingsView } from '../js/ui/views.js';

function fresh() {
  const state = g.createNewGame('boost');
  g.chooseLeague(state, 'ENG1', '테스트');
  return state;
}

test('구단 키우기 보정: 내 구단에 오는 선수는 주급을 10% 덜 요구하고, 다른 구단에는 보정이 없다', () => {
  const state = fresh();
  const me = g.userClub(state);
  const other = Object.values(state.clubs).find((c) => c.status === 'active' && c.leagueId === me.leagueId && c.id !== me.id);
  // 두 구단의 주급 수준을 같게 맞추고 비교한다
  other.squad = [...me.squad];
  const p = Object.values(state.players).find((q) => q.clubId && q.clubId !== me.id && q.clubId !== other.id && q.contract.wage * 0.95 < transferDemand(state, other, q).wage * 0.85);
  assert.ok(Math.abs(transferDemand(state, me, p).wage / transferDemand(state, other, p).wage - USER_BOOST.wage) < 0.01);
});

test('구단 키우기 보정: 내 구단은 입장·스폰서·굿즈·대관 수입이 10% 더 들어오고, 중계권은 그대로다', () => {
  const state = fresh();
  const me = g.userClub(state);
  const other = Object.values(state.clubs).find((c) => c.id !== me.id);
  const b = me.finance.balance;
  income(me, 'gate', 1e8);
  assert.equal(me.finance.balance - b, 1.1e8);
  income(me, 'tv', 1e8);
  assert.equal(me.finance.balance - b, 2.1e8);
  const ob = other.finance.balance;
  income(other, 'gate', 1e8);
  assert.equal(other.finance.balance - ob, 1e8);
});

test('구단 키우기 보정: 기대보다 잘하면 내 구단 평판이 더 오르고, 설정 탭에 보정 내용이 보인다', () => {
  const state = fresh();
  const club = g.userClub(state);
  assert.equal(userReputationGain(state, club, 20, 10), 2);
  assert.equal(userReputationGain(state, club, 20, 16), 1);
  assert.equal(userReputationGain(state, club, 20, 19), 0);
  const html = settingsView(state);
  assert.match(html, /구단 키우기 보정/);
  assert.match(html, /\+10%/);
});
