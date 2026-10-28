import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, chooseLeague, userClub, STATE_VERSION, advance, league, simulateToSeasonEnd, startNextSeason,
  managerCandidates, hireManager, fireManager, transferRequests, answerRequest } from '../js/core/game.js';
import { weeklyWageBill } from '../js/core/finance.js';
import { clubStrength } from '../js/core/state.js';

test('새 게임: 리그를 고르면 그 리그의 가장 약한 구단의 단장이 되고, 구단에는 AI 감독이 있다', () => {
  const state = createNewGame('gm1');
  chooseLeague(state, 'ENG1', '테스트');
  const club = userClub(state);
  assert.equal(club.leagueId, 'ENG1');
  const rivals = Object.values(state.clubs).filter((c) => c.status === 'active' && c.leagueId === 'ENG1');
  assert.ok(rivals.every((c) => clubStrength(state, c) >= clubStrength(state, club)));
  assert.equal(state.phase, 'season');
  assert.equal(state.user.name, '테스트');
  assert.equal(state.user.trust, undefined, '수뇌부 신뢰도는 없다');
  const coach = club.headCoach;
  assert.ok(coach.name && coach.ability >= 1 && coach.ability <= 20 && coach.wage > 0 && coach.until > state.date);
  assert.equal(STATE_VERSION, 5);
});

const fresh = (seed, leagueId = 'ENG1') => {
  const state = createNewGame(seed);
  chooseLeague(state, leagueId, '테스트');
  return state;
};
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

test('한 주 진행: "계속"은 다음 월요일에 멈춘다', () => {
  const state = fresh('gm2');
  assert.equal(advance(state).stop, 'week');
  assert.equal(state.date, '2026-07-06');
  assert.equal(weekday(state.date), 1);
  advance(state);
  assert.equal(state.date, '2026-07-13');
});

test('한 주 진행: 그 사이 우리 경기는 결과로 처리되고, 경기 보기를 켜면 우리 경기 날 멈춘다', () => {
  const state = fresh('gm3');
  const me = userClub(state).id;
  while (state.date < '2026-09-01') advance(state, { skipOffers: true });
  const mine = league(state).fixtures.filter((f) => (f.home === me || f.away === me) && f.date < state.date);
  assert.ok(mine.length >= 2 && mine.every((f) => f.result));
  const res = advance(state, { skipOffers: true, watchMatches: true });
  assert.equal(res.stop, 'userMatch');
  assert.ok(res.fixture.home === me || res.fixture.away === me);
});

test('단장은 해고되지 않는다: 최하위로 시즌을 끝내도 구단을 계속 맡고, 수뇌부 메시지가 없다', () => {
  const state = fresh('gm4', 'ENG3');
  const club = userClub(state);
  for (const id of club.squad) for (const k of Object.keys(state.players[id].attrs)) state.players[id].attrs[k] = 2;
  simulateToSeasonEnd(state);
  startNextSeason(state);
  assert.equal(state.phase, 'season');
  assert.equal(userClub(state).id, club.id);
  assert.equal(club.status, 'active');
  assert.ok(!state.inbox.some((m) => /해고|수뇌부|감독 제의/.test(m.title)));
});

test('감독 후보: 6명쯤 있고, 능력이 높을수록 비싸다', () => {
  const state = fresh('gm5');
  const list = managerCandidates(state);
  assert.ok(list.length >= 5);
  const sorted = list.slice().sort((a, b) => a.ability - b.ability);
  assert.ok(sorted.at(-1).wage > sorted[0].wage);
  for (const c of list) assert.ok(typeof c.willing === 'boolean' && c.style);
});

test('감독 해고: 남은 계약 주급의 절반을 위약금으로 내고, 감독 없이도 진행된다 (코치가 임시로 맡는다)', () => {
  const state = fresh('gm6');
  const club = userClub(state);
  const coach = club.headCoach;
  coach.until = '2028-06-30';
  const balance = club.finance.balance;
  const res = fireManager(state);
  assert.equal(res.ok, true);
  assert.equal(club.headCoach, null);
  // 2026-07-01 → 2028-06-30 은 104주쯤: 위약금은 주급 × 남은 주 × 0.5
  assert.ok(res.compensation > coach.wage * 50 && res.compensation < coach.wage * 54, `${res.compensation / coach.wage}주치`);
  assert.equal(club.finance.balance, balance - res.compensation);
  assert.equal(advance(state, { skipOffers: true }).stop, 'week');
});

test('감독 고용: 감독 자리가 비어 있어야 하고, 오려는 후보만 데려올 수 있으며, 주급이 지출에 잡힌다', () => {
  const state = fresh('gm7');
  const club = userClub(state);
  const willing = managerCandidates(state).find((c) => c.willing);
  assert.equal(hireManager(state, willing.id).ok, false, '감독이 있으면 먼저 해고');
  fireManager(state);
  const bill = weeklyWageBill(state, club);
  const unwilling = managerCandidates(state).find((c) => !c.willing);
  if (unwilling) assert.equal(hireManager(state, unwilling.id).ok, false);
  assert.equal(hireManager(state, willing.id).ok, true);
  assert.equal(club.headCoach.id, willing.id);
  assert.ok(club.headCoach.until > state.date);
  assert.equal(weeklyWageBill(state, club), bill + willing.wage);
  assert.ok(!managerCandidates(state).some((c) => c.id === willing.id));
});

test('영입 요청: 이적시장이 열리면 감독이 2~4명을 요청하고, 승인하면 협상 목록에 오르고 거절하면 사라진다', () => {
  const state = fresh('gm8');
  const club = userClub(state);
  club.finance.transferBudget = 1e12;
  advance(state, { skipOffers: true });
  const list = transferRequests(state);
  assert.ok(list.length >= 2 && list.length <= 4, `${list.length}명`);
  for (const r of list) {
    const p = state.players[r.playerId];
    assert.ok(p.clubId && p.clubId !== club.id);
    assert.ok(r.reason);
  }
  const [a, b] = list;
  assert.equal(answerRequest(state, a.id, 'approve').ok, true);
  assert.equal(state.transfers.deals[a.playerId].stage, 'fee');
  assert.equal(answerRequest(state, b.id, 'reject').ok, true);
  assert.equal(state.transfers.deals[b.playerId], undefined);
  assert.equal(transferRequests(state).length, list.length - 2);
});

test('영입 요청: 이적시장이 닫혀 있거나 감독이 없으면 요청이 없다', () => {
  const state = fresh('gm9');
  fireManager(state);
  advance(state, { skipOffers: true });
  assert.equal(transferRequests(state).length, 0);
  const s2 = fresh('gm10');
  while (s2.date < '2026-09-07') advance(s2, { skipOffers: true });
  for (const r of transferRequests(s2)) answerRequest(s2, r.id, 'reject');
  advance(s2, { skipOffers: true });
  assert.equal(transferRequests(s2).length, 0);
});
