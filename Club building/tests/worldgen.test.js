import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../js/core/rng.js';
import { generateLeague, SQUAD_TEMPLATE } from '../js/core/worldgen.js';
import { PREMIER_LEAGUE, ENGLAND_CITIES } from '../js/data/england.js';
import { overall, ageOn } from '../js/core/player.js';
import { autoLineup } from '../js/core/tactics.js';
import { FORMATIONS } from '../js/data/formations.js';

const SEASON_START = '2026-07-01';
const make = (seed) => generateLeague(Rng.fromSeed(seed), PREMIER_LEAGUE, { seasonStart: SEASON_START });

test('리그 규칙대로 구단 20개, 구단마다 25명', () => {
  const { clubs, players } = make('a');
  assert.equal(clubs.length, 20);
  for (const club of clubs) assert.equal(club.squad.length, 25);
  assert.equal(players.length, 500);
});

test('구단 이름은 겹치지 않고 실제 구단 이름을 피한다', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const { clubs } = make(seed);
    assert.equal(new Set(clubs.map((c) => c.name)).size, clubs.length);
    for (const city of ENGLAND_CITIES) {
      for (const suffix of city.avoid) {
        assert.ok(!clubs.some((c) => c.name === `${city.name} ${suffix}`), `${city.name} ${suffix}`);
      }
    }
  }
});

test('구단마다 포지션 구성이 템플릿과 같다', () => {
  const { clubs, players } = make('a');
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  for (const club of clubs) {
    const counts = {};
    for (const id of club.squad) counts[byId[id].position] = (counts[byId[id].position] || 0) + 1;
    assert.deepEqual(counts, SQUAD_TEMPLATE);
  }
});

test('전력 계층별 평균 능력: 강팀 > 중위권 > 약팀', () => {
  const { clubs, players } = make('a');
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const avg = (tier) => {
    const xs = clubs.filter((c) => c.tier === tier).flatMap((c) => c.squad.map((id) => overall(byId[id])));
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  };
  assert.ok(avg('strong') > avg('mid') + 3, `strong ${avg('strong')} mid ${avg('mid')}`);
  assert.ok(avg('mid') > avg('weak') + 2, `mid ${avg('mid')} weak ${avg('weak')}`);
});

test('능력치는 1~20, 잠재력은 현재 능력 이상', () => {
  const { players } = make('a');
  for (const p of players) {
    for (const v of Object.values(p.attrs)) assert.ok(Number.isInteger(v) && v >= 1 && v <= 20);
    assert.ok(p.potential >= overall(p));
  }
});

test('시즌 시작일 기준 나이는 17~35세', () => {
  const { players } = make('a');
  for (const p of players) {
    const age = ageOn(p, SEASON_START);
    assert.ok(age >= 17 && age <= 35, `${p.name} ${age}`);
  }
});

test('같은 시드는 같은 세계를 만든다', () => {
  assert.deepEqual(make('same'), make('same'));
});

test('자동 선발은 포메이션 슬롯을 모두 채우고 골키퍼를 골키퍼 자리에 둔다', () => {
  const { clubs, players } = make('a');
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  for (const formation of Object.keys(FORMATIONS)) {
    const squad = clubs[0].squad.map((id) => byId[id]);
    const { lineup, bench } = autoLineup(squad, formation);
    assert.equal(lineup.filter(Boolean).length, 11);
    assert.equal(byId[lineup[0].playerId].position, 'GK');
    assert.equal(bench.length, 9);
    const ids = [...lineup.map((e) => e.playerId), ...bench];
    assert.equal(new Set(ids).size, ids.length);
  }
});

test('출전할 수 없는 선수는 선발하지 않는다', () => {
  const { clubs, players } = make('a');
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const squad = clubs[0].squad.map((id) => byId[id]);
  const first = autoLineup(squad, '4-4-2');
  const banned = new Set([first.lineup[5].playerId]);
  const second = autoLineup(squad, '4-4-2', { unavailable: banned });
  assert.ok(!second.lineup.some((e) => banned.has(e.playerId)));
  assert.ok(!second.bench.some((id) => banned.has(id)));
});
