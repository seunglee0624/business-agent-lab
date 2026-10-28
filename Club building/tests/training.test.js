import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, chooseLeague, userClub } from '../js/core/game.js';
import { setTraining } from '../js/core/training.js';
import { monthlyDevelopment } from '../js/core/development.js';
import { Rng } from '../js/core/rng.js';

// 코치가 고르는 훈련이 성장에 미치는 효과: 같은 세계에서 훈련만 바꿔 넉 달 성장시킨다
const ALL = ['finishing', 'longShots', 'passing', 'crossing', 'dribbling', 'heading', 'tackling', 'marking', 'vision', 'positioning', 'composure', 'offTheBall', 'workRate', 'pace', 'stamina', 'strength'];
const ATTACK = ['finishing', 'longShots', 'dribbling', 'offTheBall', 'crossing'];
const DEFENSE = ['tackling', 'marking', 'positioning', 'heading'];
// 능력치 + 아직 반영되지 않은 소수 성장분
const sum = (players, ids, keys) => ids.reduce((s, id) => s + keys.reduce((t, k) => t + players[id].attrs[k] + (players[id].progress?.[k] ?? 0), 0), 0);

const grow = (seed, plan) => {
  const state = createNewGame(seed);
  chooseLeague(state, 'ENG1', '테스트');
  const club = userClub(state);
  const before = structuredClone(state.players);
  assert.equal(setTraining(club, plan).ok, true);
  const rng = Rng.fromSeed('grow');
  for (const id of club.squad) state.players[id].minutesMonth = 360;
  for (let i = 0; i < 4; i++) monthlyDevelopment(state, rng);
  return (keys) => sum(state.players, club.squad, keys) - sum(before, club.squad, keys);
};

test('훈련 강도: 강하게 하면 가볍게보다 선수들이 더 많이 큰다', () => {
  const hard = grow('tr-int', { focus: 'balanced', intensity: 'hard' });
  const light = grow('tr-int', { focus: 'balanced', intensity: 'light' });
  assert.ok(hard(ALL) > light(ALL), `강하게 ${hard(ALL)} / 가볍게 ${light(ALL)}`);
});

test('훈련 중점: 공격 훈련은 공격 능력치를, 수비 훈련은 수비 능력치를 더 키운다', () => {
  const atk = grow('tr-focus', { focus: 'attack', intensity: 'normal' });
  const def = grow('tr-focus', { focus: 'defense', intensity: 'normal' });
  assert.ok(atk(ATTACK) > def(ATTACK));
  assert.ok(def(DEFENSE) > atk(DEFENSE));
});

test('훈련: 없는 중점이나 강도는 받지 않는다', () => {
  const club = {};
  assert.equal(setTraining(club, { focus: 'magic', intensity: 'normal' }).ok, false);
  assert.equal(setTraining(club, { focus: 'attack', intensity: 'insane' }).ok, false);
});
