import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOn } from '../js/core/player.js';
import { createNewGame, chooseClub, userClub, advance, simulateUserMatch, finishUserMatch, setTraining, setDelegation, registeredCount } from '../js/core/game.js';

const fresh = (seed) => {
  const state = createNewGame(seed);
  chooseClub(state, Object.keys(state.clubs)[4], '테스트');
  return state;
};
const runUntil = (state, date) => {
  while (state.date < date && state.phase === 'season') {
    const res = advance(state, { skipOffers: true });
    if (res.stop === 'userMatch') { simulateUserMatch(state); finishUserMatch(state); }
  }
};

test('위임 기본값: 훈련·유스·재계약 모두 스태프에게 맡겨져 있다', () => {
  const state = fresh('dl0');
  assert.deepEqual(userClub(state).delegation, { training: 'staff', youth: 'staff', renewals: 'staff' });
});

test('훈련을 맡기면 경기 직전에는 코치가 강도를 낮추고, 직접 하면 내가 정한 강도가 그대로다', () => {
  for (const [who, expect] of [['staff', 'normal'], ['manager', 'hard']]) {
    const state = fresh('dl1');
    const club = userClub(state);
    club.staff.coach = 20;
    setTraining(state, { focus: 'balanced', intensity: 'hard' });
    setDelegation(state, { training: who });
    const res = advance(state, { skipOffers: true }); // 첫 경기 날에 멈춘다
    assert.equal(res.stop, 'userMatch');
    assert.equal(club.training.intensity, expect, who);
  }
});

test('훈련을 직접 정하면 훈련 위임이 "직접"으로 바뀐다', () => {
  const state = fresh('dl2');
  setTraining(state, { focus: 'attack', intensity: 'normal' });
  assert.equal(userClub(state).delegation.training, 'manager');
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

test('유스를 맡기면 1군에 자리가 있을 때 유스 코치가 1군급 유스를 올린다', () => {
  const { state, club, y } = youthReady('dl3');
  advance(state, { skipOffers: true });
  assert.ok(club.squad.includes(y.id));
  assert.ok(state.inbox.some((m) => m.body.includes(y.name)));
});

test('유스를 직접 하면 아무도 올리지 않는다', () => {
  const { state, club, y } = youthReady('dl4');
  setDelegation(state, { youth: 'manager' });
  advance(state, { skipOffers: true });
  assert.ok(!club.squad.includes(y.id));
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

test('재계약을 맡기면 계약 3개월 전에 쓸 만한 후보 선수는 재계약하고, 쓸모없는 선수는 내보낼 것을 알린다', () => {
  const { state, keep, drop } = expiring('dl5');
  advance(state, { skipOffers: true });
  assert.ok(keep.contract.until > '2026-09-30', '재계약');
  assert.equal(drop.contract.until, '2026-09-30');
  assert.ok(state.inbox.some((m) => m.body.includes(`${keep.name} 재계약`)));
  assert.ok(state.inbox.some((m) => m.body.includes(drop.name)));
});

test('재계약을 직접 하면 스태프가 손대지 않는다', () => {
  const { state, keep } = expiring('dl6');
  setDelegation(state, { renewals: 'manager' });
  advance(state, { skipOffers: true });
  assert.equal(keep.contract.until, '2026-09-30');
});

test('주간 요약: 알림은 월요일마다 "주간 요약" 하나로 묶이고, 따로 오지 않는다', () => {
  const { state, y } = youthReady('dl7');
  advance(state, { skipOffers: true });
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
  advance(state, { skipOffers: true });
  assert.ok(state.inbox.some((m) => m.title === '수뇌부의 시즌 목표'));
});
