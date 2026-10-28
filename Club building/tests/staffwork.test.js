import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOn } from '../js/core/player.js';
import { createNewGame, chooseLeague, userClub, advance, simulateUserMatch, finishUserMatch, registeredCount } from '../js/core/game.js';

// 우리 다음 경기 날까지 주 단위로 진행한다
const toMatch = (s) => {
  let res;
  do res = advance(s, { skipOffers: true, watchMatches: true }); while (res.stop === 'week');
  return res;
};


const fresh = (seed) => {
  const state = createNewGame(seed);
  chooseLeague(state, 'ENG1', '테스트');
  return state;
};
const runUntil = (state, date) => {
  while (state.date < date && state.phase === 'season') {
    const res = toMatch(state);
    if (res.stop === 'userMatch') { simulateUserMatch(state); finishUserMatch(state); }
  }
};

test('코치가 훈련을 정한다: 경기 직전에는 강하게 하지 않는다', () => {
  const state = fresh('dl1');
  const club = userClub(state);
  club.staff.coach = 20;
  const res = toMatch(state); // 첫 경기 날에 멈춘다
  assert.equal(res.stop, 'userMatch');
  assert.equal(club.training.intensity, 'normal');
});

// 1군 자리를 하나 비우고, 유스 한 명을 1군급으로 만든다
const youthReady = (seed) => {
  const state = fresh(seed);
  const club = userClub(state);
  const [id] = club.squad.splice(-2); // 시작할 때는 유스가 없어서, 내보낸 한 명을 유스로 둔다
  club.youth.push(id);
  const y = state.players[id];
  for (const k of Object.keys(y.attrs)) y.attrs[k] = 17;
  return { state, club, y };
};

test('1군에 자리가 있으면 유스 코치가 1군급 유스를 올린다', () => {
  const { state, club, y } = youthReady('dl3');
  toMatch(state);
  assert.ok(club.squad.includes(y.id));
  assert.ok(state.inbox.some((m) => m.body.includes(y.name)));
});

// 쓸 만한 후보 선수 하나와 쓸모없는 후보 선수 하나의 계약을 곧 끝나게 만든다
const expiring = (seed) => {
  const state = fresh(seed);
  const club = userClub(state);
  club.finance.wageBudget = 1e12;
  const backups = club.squad.map((id) => state.players[id]).filter((p) => p.contract.promise !== 'starter');
  const keep = backups.find((p) => p.contract.promise === 'rotation' && ageOn(p, state.date) <= 29);
  const drop = backups.find((p) => p !== keep);
  for (const k of Object.keys(drop.attrs)) drop.attrs[k] = 3;
  for (const p of [keep, drop]) p.contract.until = '2026-09-30';
  return { state, club, keep, drop };
};

test('계약이 3개월 남으면 스태프가 쓸 만한 후보 선수는 재계약하고, 쓸모없는 선수는 내보낼 것을 알린다', () => {
  const { state, keep, drop } = expiring('dl5');
  toMatch(state);
  assert.ok(keep.contract.until > '2026-09-30', '재계약');
  assert.equal(drop.contract.until, '2026-09-30');
  assert.ok(state.inbox.some((m) => m.body.includes(`${keep.name} 재계약`)));
  assert.ok(state.inbox.some((m) => m.body.includes(drop.name)));
});

test('주간 요약: 알림은 월요일마다 "주간 요약" 하나로 묶이고, 따로 오지 않는다', () => {
  const { state, y } = youthReady('dl7');
  toMatch(state); // 첫 경기까지 6주쯤
  const summaries = state.inbox.filter((m) => m.title.startsWith('주간 요약'));
  assert.ok(summaries.length >= 4, `${summaries.length}개`);
  assert.ok(summaries.some((m) => m.body.includes(`${y.name} 1군 콜업`)));
  assert.ok(!state.inbox.some((m) => m.title === `${y.name} 1군 콜업`));
  assert.ok(!state.inbox.some((m) => /부상 회복|훈련 중 부상/.test(m.title)));
});

test('주간 요약: 중요한 메시지는 묶지 않고 바로 온다', () => {
  const state = fresh('dl8');
  const club = userClub(state);
  const p = state.players[club.squad[0]];
  p.contract.until = '2026-09-30';
  p.contract.promise = 'starter'; // 주전 계약은 스태프가 손대지 않는다
  toMatch(state);
  assert.ok(state.inbox.some((m) => m.title.endsWith('단장 부임')));
});
