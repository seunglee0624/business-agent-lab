import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMatchDiscipline, unavailableFor, resetSeasonYellows } from '../js/core/discipline.js';

const played = (extra = {}) => ({ minutes: 90, yellow: 0, red: false, secondYellow: false, ...extra });

test('경고 5장 누적이면 1경기 정지, 이후 0장부터 다시 센다', () => {
  const d = {};
  for (let i = 0; i < 4; i++) applyMatchDiscipline(d, 'L', ['p1'], { p1: played({ yellow: 1 }) });
  assert.equal(d.L.p1.yellows, 4);
  assert.equal(unavailableFor(d, 'L').has('p1'), false);
  const bans = applyMatchDiscipline(d, 'L', ['p1'], { p1: played({ yellow: 1 }) });
  assert.deepEqual(bans, [{ playerId: 'p1', games: 1, reason: 'accumulation' }]);
  assert.equal(d.L.p1.yellows, 0);
  assert.equal(unavailableFor(d, 'L').has('p1'), true);
});

test('경고 2장 퇴장은 1경기 정지이고, 그 경고는 누적에 세지 않는다', () => {
  const d = { L: { p1: { yellows: 3, ban: 0 } } };
  applyMatchDiscipline(d, 'L', ['p1'], { p1: played({ yellow: 2, red: true, secondYellow: true }) });
  assert.deepEqual(d.L.p1, { yellows: 3, ban: 1 });
});

test('다이렉트 레드는 2경기 정지', () => {
  const d = {};
  applyMatchDiscipline(d, 'L', ['p1'], { p1: played({ red: true }) });
  assert.equal(d.L.p1.ban, 2);
});

test('징계로 쉰 경기만큼 정지가 줄어든다', () => {
  const d = { L: { p1: { yellows: 0, ban: 2 } } };
  applyMatchDiscipline(d, 'L', ['p1', 'p2'], { p2: played() });
  assert.equal(d.L.p1.ban, 1);
  applyMatchDiscipline(d, 'L', ['p1', 'p2'], { p2: played() });
  assert.equal(d.L.p1.ban, 0);
  assert.equal(unavailableFor(d, 'L').has('p1'), false);
});

test('징계는 대회별로 따로 적용된다', () => {
  const d = {};
  applyMatchDiscipline(d, 'L', ['p1'], { p1: played({ red: true }) });
  assert.equal(unavailableFor(d, 'L').has('p1'), true);
  assert.equal(unavailableFor(d, 'CUP').has('p1'), false);
});

test('시즌 종료 시 누적 경고 초기화, 남은 정지는 유지', () => {
  const d = { L: { p1: { yellows: 4, ban: 1 } } };
  resetSeasonYellows(d);
  assert.deepEqual(d.L.p1, { yellows: 0, ban: 1 });
});
