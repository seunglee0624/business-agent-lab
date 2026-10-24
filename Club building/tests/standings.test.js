import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings } from '../js/core/standings.js';
import { PREMIER_LEAGUE } from '../js/data/england.js';

const fx = (date, home, away, h, a) => ({ date, home, away, result: h === null ? null : { home: h, away: a } });

test('승점, 득실, 전적을 계산한다', () => {
  const rows = computeStandings([
    fx('2026-08-15', 'A', 'B', 2, 0),
    fx('2026-08-22', 'B', 'C', 1, 1),
    fx('2026-08-29', 'C', 'A', 3, 1),
    fx('2026-09-12', 'A', 'C', null, null),
  ], ['A', 'B', 'C'], PREMIER_LEAGUE);
  const by = Object.fromEntries(rows.map((r) => [r.clubId, r]));
  assert.deepEqual([by.A.played, by.A.won, by.A.lost, by.A.points, by.A.goalDiff], [2, 1, 1, 3, 0]);
  assert.deepEqual([by.C.points, by.C.goalsFor, by.C.goalsAgainst], [4, 4, 2]);
  assert.deepEqual(by.A.form, ['W', 'L']);
  assert.deepEqual(rows.map((r) => r.clubId), ['C', 'A', 'B']);
});

test('승점이 같으면 골득실, 그다음 다득점 순', () => {
  const rows = computeStandings([
    fx('2026-08-15', 'A', 'X', 1, 0),
    fx('2026-08-15', 'B', 'Y', 3, 2),
    fx('2026-08-15', 'C', 'Z', 2, 0),
  ], ['A', 'B', 'C', 'X', 'Y', 'Z'], PREMIER_LEAGUE);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.clubId), ['C', 'B', 'A']);
});

test('최근 5경기만 폼에 남는다', () => {
  const fixtures = Array.from({ length: 7 }, (_, i) => fx(`2026-08-${10 + i}`, 'A', 'B', i < 2 ? 0 : 1, 0));
  const [a] = computeStandings(fixtures, ['A', 'B'], PREMIER_LEAGUE);
  assert.deepEqual(a.form, ['W', 'W', 'W', 'W', 'W']);
});
