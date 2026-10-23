import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../js/core/rng.js';
import { generateLeague } from '../js/core/worldgen.js';
import { PREMIER_LEAGUE } from '../js/data/england.js';
import { autoLineup } from '../js/core/tactics.js';
import { overall } from '../js/core/player.js';
import { createMatch, simulateMatch, stepMinute, substitute, isFinished, summarize } from '../js/core/match/engine.js';

const world = generateLeague(Rng.fromSeed('engine'), PREMIER_LEAGUE, { seasonStart: '2026-07-01' });
const byId = Object.fromEntries(world.players.map((p) => [p.id, p]));
const setup = (club, auto = true) => {
  const { lineup, bench } = autoLineup(club.squad.map((id) => byId[id]), club.tactics.formation);
  return { clubId: club.id, tactics: club.tactics, lineup, bench, auto };
};
const newMatch = (h, a, opts = {}) => createMatch({ id: 'm', competitionId: 'ENG1', date: '2026-08-15', home: setup(h, opts.homeAuto), away: setup(a), players: byId });
const xiAvg = (club) => setup(club).lineup.reduce((s, e) => s + overall(byId[e.playerId]), 0) / 11;

test('같은 시드면 같은 경기 결과', () => {
  const [h, a] = world.clubs;
  const m1 = simulateMatch(newMatch(h, a), Rng.fromSeed('x'));
  const m2 = simulateMatch(newMatch(h, a), Rng.fromSeed('x'));
  assert.deepEqual(m1, m2);
});

test('스코어는 골 이벤트 수와 같고, 이벤트는 시간 순서', () => {
  const rng = Rng.fromSeed('order');
  for (let i = 0; i < 50; i++) {
    const m = simulateMatch(newMatch(world.clubs[i % 20], world.clubs[(i + 5) % 20]), rng);
    for (const s of [0, 1]) {
      assert.equal(m.sides[s].score, m.events.filter((e) => e.type === 'goal' && e.side === s).length);
    }
    for (let k = 1; k < m.events.length; k++) assert.ok(m.events[k].minute >= m.events[k - 1].minute || m.events[k].type === 'secondHalf');
    assert.equal(m.events.at(-1).type, 'fulltime');
  }
});

test('퇴장당한 선수는 이후 이벤트에 나오지 않고, 교체는 5명까지', () => {
  const rng = Rng.fromSeed('reds');
  let reds = 0;
  for (let i = 0; i < 400; i++) {
    const m = simulateMatch(newMatch(world.clubs[i % 20], world.clubs[(i + 3) % 20]), rng);
    for (const s of m.sides) assert.ok(s.subsUsed <= 5);
    m.events.forEach((e, idx) => {
      if (e.type !== 'red' && e.type !== 'secondYellow') return;
      reds++;
      for (const later of m.events.slice(idx + 1)) {
        assert.notEqual(later.playerId, e.playerId);
        assert.notEqual(later.assistId, e.playerId);
      }
    });
    for (const e of m.events.filter((x) => x.type === 'secondYellow')) {
      assert.equal(m.stats[e.playerId].yellow, 2);
    }
  }
  assert.ok(reds > 0);
});

test('교체 규칙: 벤치 선수만, 경기장 선수와 교대, 횟수 제한', () => {
  const [h, a] = world.clubs;
  const m = newMatch(h, a, { homeAuto: false });
  const rng = Rng.fromSeed('sub');
  while (m.minute < 30) stepMinute(m, rng);
  const side = m.sides[0];
  const outId = side.onPitch[5].playerId;
  assert.equal(substitute(m, 0, outId, 'nobody').ok, false);
  const inId = side.bench[1];
  assert.equal(substitute(m, 0, outId, inId).ok, true);
  assert.equal(side.onPitch[5].playerId, inId);
  assert.equal(m.stats[outId].minuteOff, m.minute);
  assert.equal(substitute(m, 0, outId, side.bench[0]).ok, false, '이미 나간 선수');
  for (let k = 0; k < 4; k++) substitute(m, 0, side.onPitch[k + 1].playerId, side.bench[0]);
  assert.equal(side.subsUsed, 5);
  assert.equal(substitute(m, 0, side.onPitch[9].playerId, side.bench[0]).ok, false);
});

test('경기를 끝까지 진행하면 모든 출전 선수에게 평점이 매겨진다', () => {
  const m = simulateMatch(newMatch(world.clubs[0], world.clubs[1]), Rng.fromSeed('rating'));
  assert.ok(isFinished(m));
  for (const st of Object.values(m.stats)) {
    if (st.minuteOn === null) continue;
    assert.ok(st.rating >= 3 && st.rating <= 10);
  }
  const sum = summarize(m);
  assert.equal(sum.home, m.sides[0].score);
});

test('통계: 평균 득점, 홈 이점, 강팀 우세', () => {
  const rng = Rng.fromSeed('stats');
  let n = 0, goals = 0, home = 0, away = 0, strongN = 0, strongWins = 0;
  const avg = Object.fromEntries(world.clubs.map((c) => [c.id, xiAvg(c)]));
  for (let i = 0; i < 1500; i++) {
    const h = world.clubs[i % 20];
    const a = world.clubs[(i * 7 + 3) % 20];
    if (h === a) continue;
    const m = simulateMatch(newMatch(h, a), rng);
    const [x, y] = [m.sides[0].score, m.sides[1].score];
    n++;
    goals += x + y;
    if (x > y) home++;
    if (y > x) away++;
    const diff = avg[h.id] - avg[a.id];
    if (Math.abs(diff) > 10) {
      strongN++;
      if ((diff > 0 && x > y) || (diff < 0 && y > x)) strongWins++;
    }
  }
  const gpg = goals / n;
  assert.ok(gpg > 2.3 && gpg < 3.3, `경기당 ${gpg}골`);
  assert.ok(home / n > away / n + 0.08, `홈 ${home / n} 원정 ${away / n}`);
  assert.ok(strongWins / strongN > 0.6, `강팀 승률 ${strongWins / strongN}`);
});
