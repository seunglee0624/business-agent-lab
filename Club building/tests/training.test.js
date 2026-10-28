import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, chooseClub, userClub, advance, simulateUserMatch, finishUserMatch, setTraining } from '../js/core/game.js';

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
// 능력치 + 아직 반영되지 않은 소수 성장분
const sum = (state, ids, keys) => ids.reduce((s, id) => s + keys.reduce((t, k) => t + state.players[id].attrs[k] + (state.players[id].progress?.[k] ?? 0), 0), 0);
const ALL = ['finishing', 'longShots', 'passing', 'crossing', 'dribbling', 'heading', 'tackling', 'marking', 'vision', 'positioning', 'composure', 'offTheBall', 'workRate', 'pace', 'stamina', 'strength'];
const ATTACK = ['finishing', 'longShots', 'dribbling', 'offTheBall', 'crossing'];
const DEFENSE = ['tackling', 'marking', 'positioning', 'heading'];

// 같은 세계를 훈련만 다르게 몇 달 돌린다
const after = (seed, training, until = '2026-12-01') => {
  const state = fresh(seed);
  const ids = userClub(state).squad.slice();
  const before = structuredClone(state.players);
  assert.equal(setTraining(state, training).ok, true);
  runUntil(state, until);
  const alive = ids.filter((id) => userClub(state).squad.includes(id));
  return { state, ids: alive, gain: (keys) => sum(state, alive, keys) - sum({ players: before }, alive, keys) };
};

test('훈련 강도: 강하게 하면 가볍게보다 우리 선수들이 더 많이 큰다', () => {
  const hard = after('tr-int', { focus: 'balanced', intensity: 'hard' });
  const light = after('tr-int', { focus: 'balanced', intensity: 'light' });
  assert.ok(hard.gain(ALL) > light.gain(ALL), `강하게 ${hard.gain(ALL)} / 가볍게 ${light.gain(ALL)}`);
});

test('훈련 중점: 공격 훈련은 공격 능력치를, 수비 훈련은 수비 능력치를 더 키운다', () => {
  const atk = after('tr-focus', { focus: 'attack', intensity: 'normal' });
  const def = after('tr-focus', { focus: 'defense', intensity: 'normal' });
  assert.ok(atk.gain(ATTACK) > def.gain(ATTACK), `공격 능력: ${atk.gain(ATTACK)} / ${def.gain(ATTACK)}`);
  assert.ok(def.gain(DEFENSE) > atk.gain(DEFENSE), `수비 능력: ${def.gain(DEFENSE)} / ${atk.gain(DEFENSE)}`);
});

test('훈련: 없는 중점이나 강도는 받지 않는다', () => {
  const state = fresh('tr-bad');
  assert.equal(setTraining(state, { focus: 'magic', intensity: 'normal' }).ok, false);
  assert.equal(setTraining(state, { focus: 'attack', intensity: 'insane' }).ok, false);
});
