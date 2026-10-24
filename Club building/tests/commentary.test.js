import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../js/core/rng.js';
import { generateLeague } from '../js/core/worldgen.js';
import { LEAGUES } from '../js/data/countries/index.js';

const PREMIER_LEAGUE = LEAGUES.ENG1;
import { autoLineup } from '../js/core/tactics.js';
import { createMatch, simulateMatch } from '../js/core/match/engine.js';
import { commentary, withParticle } from '../js/core/match/commentary.js';

test('받침에 맞는 조사', () => {
  assert.equal(withParticle('김민준', '가'), '김민준이');
  assert.equal(withParticle('해리 스미스', '가'), '해리 스미스가');
  assert.equal(withParticle('런던 시티', '가'), '런던 시티가');
  assert.equal(withParticle('리즈 유나이티드', '는'), '리즈 유나이티드는');
  assert.equal(withParticle('헐 로버스', '를'), '헐 로버스를');
  assert.equal(withParticle('서울', '로'), '서울로');
});

test('모든 이벤트에 빈칸 없는 중계 문장이 나온다', () => {
  const { clubs, players } = generateLeague(Rng.fromSeed('c'), PREMIER_LEAGUE, { seasonStart: '2026-07-01' });
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const setup = (c) => ({ clubId: c.id, tactics: c.tactics, ...autoLineup(c.squad.map((i) => byId[i]), c.tactics.formation) });
  const rng = Rng.fromSeed('c2');
  for (let i = 0; i < 30; i++) {
    const m = simulateMatch(createMatch({ id: 'm', home: setup(clubs[i % 20]), away: setup(clubs[(i + 1) % 20]), players: byId }), rng);
    for (const e of m.events) {
      const text = commentary(m, e, { home: clubs[i % 20].name, away: clubs[(i + 1) % 20].name });
      assert.ok(text.length > 0, e.type);
      assert.ok(!/\{|\}|undefined|null|\(가\)/.test(text), text);
    }
  }
});
