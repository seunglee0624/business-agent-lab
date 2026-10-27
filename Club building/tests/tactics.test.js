import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, chooseClub, userClub, changeTactics } from '../js/core/game.js';

// 4-4-2 자동 선발로 시작한 내 구단
const fresh = () => {
  const state = createNewGame('t');
  chooseClub(state, Object.keys(state.clubs)[4], '테스트');
  changeTactics(state, { manual: true });
  return state;
};
const ids = (t) => t.lineup.map((e) => e?.playerId);

test('포메이션을 바꾸면 같은 선수가 같은 순번 자리에 남고, 맞지 않는 역할만 기본 역할로 바뀐다', () => {
  const state = fresh();
  const t = userClub(state).tactics;
  t.lineup[8].role = 'winger'; // RM 자리
  const before = ids(t);
  changeTactics(state, { formation: '4-3-3' });
  assert.equal(t.formation, '4-3-3');
  assert.deepEqual(ids(t), before);
  assert.equal(t.lineup[5].role, 'boxToBox'); // LM → CM: 측면 미드필더는 CM에 못 선다
  assert.equal(t.lineup[8].role, 'winger'); // RM → LW: 윙어는 그대로
});

test('이미 선발인 선수를 다른 자리에 고르면 두 선수가 자리를 맞바꾸고, 역할은 자리를 따른다', () => {
  const state = fresh();
  const t = userClub(state).tactics;
  const [a, b] = [t.lineup[9], t.lineup[10]]; // ST 두 명
  t.lineup[9].role = 'poacher';
  t.lineup[10].role = 'targetMan';
  changeTactics(state, { slot: 9, playerId: b.playerId });
  assert.deepEqual(t.lineup[9], { playerId: b.playerId, role: 'poacher' });
  assert.deepEqual(t.lineup[10], { playerId: a.playerId, role: 'targetMan' });
});

test('명단 밖 선수를 고르면 그 자리만 바뀌고 역할은 유지된다', () => {
  const state = fresh();
  const club = userClub(state);
  const t = club.tactics;
  const outsider = club.squad.find((id) => !ids(t).includes(id));
  t.lineup[9].role = 'poacher';
  changeTactics(state, { slot: 9, playerId: outsider });
  assert.deepEqual(t.lineup[9], { playerId: outsider, role: 'poacher' });
  assert.equal(ids(t).filter((id) => id === outsider).length, 1);
});

test('자리 역할을 바꾸면 그 자리만 바뀐다', () => {
  const state = fresh();
  const t = userClub(state).tactics;
  const before = ids(t);
  changeTactics(state, { slot: 10, role: 'poacher' });
  assert.equal(t.lineup[10].role, 'poacher');
  assert.deepEqual(ids(t), before);
});

test('자동 선발으로 되돌리면 저장된 선발과 교체 명단을 비운다', () => {
  const state = fresh();
  changeTactics(state, { auto: true });
  const t = userClub(state).tactics;
  assert.equal(t.lineup, null);
  assert.equal(t.bench, null);
});

test('팀 전술 값(멘탈리티 등)을 바꾸고, 빈 값은 null로 둔다', () => {
  const state = fresh();
  const t = userClub(state).tactics;
  changeTactics(state, { key: 'mentality', value: 'attacking' });
  changeTactics(state, { key: 'setPieceTaker', value: '' });
  assert.equal(t.mentality, 'attacking');
  assert.equal(t.setPieceTaker, null);
});

test('지금 자동으로 짜기: 고정된 선발 11명을 서로 다른 선수로 채운다', () => {
  const state = fresh();
  changeTactics(state, { auto: true });
  changeTactics(state, { autoPick: true });
  const t = userClub(state).tactics;
  assert.equal(t.lineup.length, 11);
  assert.equal(new Set(ids(t)).size, 11);
  assert.ok(t.bench.length > 0);
});
