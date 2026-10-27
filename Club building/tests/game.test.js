import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNewGame, chooseClub, advance, startUserMatch, finishUserMatch, simulateUserMatch,
  simulateToSeasonEnd, standings, league, userClub, topScorers, withMatchRng,
} from '../js/core/game.js';
import { stepMinute, isFinished } from '../js/core/match/engine.js';

const fresh = (seed = 'g') => {
  const state = createNewGame(seed);
  chooseClub(state, Object.keys(state.clubs)[4], '테스트');
  return state;
};

test('새 게임: 구단 선택 전에는 진행하지 않는다', () => {
  const state = createNewGame('g');
  assert.equal(state.phase, 'chooseClub');
  assert.deepEqual(advance(state, { skipOffers: true }), { stop: 'chooseClub' });
});

test('계속: 첫 내 경기일에서 멈춘다', () => {
  const state = fresh();
  const res = advance(state, { skipOffers: true });
  assert.equal(res.stop, 'userMatch');
  assert.equal(state.date, league(state).fixtures[0].date);
  assert.ok([res.fixture.home, res.fixture.away].includes(state.manager.clubId));
});

test('내 경기를 1분씩 진행해 끝내면 그날 모든 경기 결과가 나온다', () => {
  const state = fresh();
  advance(state, { skipOffers: true });
  const match = startUserMatch(state);
  withMatchRng(state, (rng) => {
    while (!isFinished(match)) stepMinute(match, rng);
  });
  finishUserMatch(state);
  const today = league(state).fixtures.filter((f) => f.date === state.date);
  assert.equal(today.length, 10);
  assert.ok(today.every((f) => f.result));
  assert.equal(state.liveMatch, null);
  assert.equal(standings(state).reduce((s, r) => s + r.played, 0), 20);
});

test('시즌 끝까지: 380경기 결과, 시즌 종료, 경기 기록이 쌓인다', () => {
  const state = fresh();
  const res = simulateToSeasonEnd(state);
  assert.equal(res.stop, 'seasonEnd');
  assert.equal(state.phase, 'seasonEnd');
  assert.ok(league(state).fixtures.every((f) => f.result));
  const table = standings(state);
  assert.ok(table.every((r) => r.played === 38));
  const goals = table.reduce((s, r) => s + r.goalsFor, 0);
  const scorers = topScorers(state);
  assert.ok(scorers[0].s.goals >= 12 && scorers[0].s.goals <= 45, `득점왕 ${scorers[0].s.goals}골`);
  assert.ok(goals / 380 > 2.3 && goals / 380 < 3.6);
  assert.ok(state.inbox.some((m) => m.title === '시즌 종료'));
});

test('출전 정지 선수는 내 경기 선발과 교체 명단에 없다', () => {
  const state = fresh();
  advance(state, { skipOffers: true });
  const club = userClub(state);
  const banned = club.squad.slice(0, 5);
  state.discipline.ENG1 = Object.fromEntries(banned.map((id) => [id, { yellows: 0, ban: 1 }]));
  const match = startUserMatch(state);
  const ids = match.sides.flatMap((s) => [...s.onPitch.map((x) => x.playerId), ...s.bench]);
  for (const id of banned) assert.ok(!ids.includes(id));
  simulateUserMatch(state);
  finishUserMatch(state);
  for (const id of banned) assert.equal(state.discipline.ENG1[id].ban, 0, '한 경기 쉬면 정지가 풀린다');
});

test('같은 시드와 같은 진행이면 같은 시즌 결과', () => {
  const a = fresh('same');
  const b = fresh('same');
  simulateToSeasonEnd(a);
  simulateToSeasonEnd(b);
  assert.deepEqual(standings(a), standings(b));
});

test('중간에 저장(JSON)했다 불러와도 결과가 같다', () => {
  const a = fresh('save');
  const b = fresh('save');
  for (let i = 0; i < 10; i++) {
    advance(a, { skipOffers: true });
    simulateUserMatch(a);
    finishUserMatch(a);
  }
  for (let i = 0; i < 10; i++) {
    advance(b, { skipOffers: true });
    simulateUserMatch(b);
    finishUserMatch(b);
  }
  const restored = JSON.parse(JSON.stringify(b));
  simulateToSeasonEnd(a);
  simulateToSeasonEnd(restored);
  assert.deepEqual(standings(a), standings(restored));
});
