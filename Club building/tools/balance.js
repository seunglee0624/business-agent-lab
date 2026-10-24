// 경기 엔진 밸런스 측정: node tools/balance.js [경기 수]
// 가상 프리미어리그를 만들어 경기를 반복 시뮬레이션하고 주요 통계를 출력한다.

import { Rng } from '../js/core/rng.js';
import { generateLeague } from '../js/core/worldgen.js';
import { PREMIER_LEAGUE } from '../js/data/england.js';
import { autoLineup } from '../js/core/tactics.js';
import { overall } from '../js/core/player.js';
import { createMatch, simulateMatch } from '../js/core/match/engine.js';

const N = Number(process.argv[2] ?? 2000);
const rng = Rng.fromSeed('balance');
const { clubs, players } = generateLeague(rng, PREMIER_LEAGUE, { seasonStart: '2026-07-01' });
const byId = Object.fromEntries(players.map((p) => [p.id, p]));
const setup = (c) => ({ clubId: c.id, tactics: c.tactics, ...autoLineup(c.squad.map((i) => byId[i]), c.tactics.formation) });
const xiAvg = Object.fromEntries(clubs.map((c) => [c.id, setup(c).lineup.reduce((s, e) => s + overall(byId[e.playerId]), 0) / 11]));

const t = { n: 0, goals: 0, home: 0, draw: 0, away: 0, shots: 0, onTarget: 0, yellows: 0, reds: 0, pens: 0, penGoals: 0, subs: 0, strongN: 0, strongWins: 0 };
const goalsByPos = {};
const ratings = [];

for (let k = 0; k < N; k++) {
  const h = clubs[k % 20];
  const a = clubs[(k * 7 + 3) % 20];
  if (h === a) continue;
  const m = simulateMatch(createMatch({ id: `m${k}`, home: setup(h), away: setup(a), players: byId }), rng);
  const [x, y] = [m.sides[0].score, m.sides[1].score];
  t.n++;
  t.goals += x + y;
  if (x > y) t.home++;
  else if (x === y) t.draw++;
  else t.away++;
  for (const s of m.sides) {
    t.shots += s.shots;
    t.onTarget += s.onTarget;
    t.subs += s.subsUsed;
  }
  for (const e of m.events) {
    if (e.type === 'yellow') t.yellows++;
    if (e.type === 'secondYellow') { t.yellows++; t.reds++; }
    if (e.type === 'red') t.reds++;
    if (e.type === 'penalty') t.pens++;
    if (e.type === 'goal') {
      if (e.kind === 'penalty') t.penGoals++;
      const pos = byId[e.playerId].position;
      goalsByPos[pos] = (goalsByPos[pos] ?? 0) + 1;
    }
  }
  for (const st of Object.values(m.stats)) if (st.minutes > 0) ratings.push(st.rating);
  const diff = xiAvg[h.id] - xiAvg[a.id];
  if (Math.abs(diff) > 7) {
    t.strongN++;
    if ((diff > 0 && x > y) || (diff < 0 && y > x)) t.strongWins++;
  }
}

const per = (v) => (v / t.n).toFixed(2);
const pct = (v, d = t.n) => `${((v / d) * 100).toFixed(1)}%`;
console.log(`경기 수            ${t.n}`);
console.log(`경기당 골          ${per(t.goals)}`);
console.log(`홈 승 / 무 / 원정  ${pct(t.home)} / ${pct(t.draw)} / ${pct(t.away)}`);
console.log(`경기당 슈팅 (유효) ${per(t.shots)} (${per(t.onTarget)})`);
console.log(`경기당 경고        ${per(t.yellows)}`);
console.log(`경기당 퇴장        ${per(t.reds)}`);
console.log(`경기당 페널티킥    ${per(t.pens)} (성공률 ${pct(t.penGoals, t.pens)})`);
console.log(`팀당 교체          ${(t.subs / t.n / 2).toFixed(2)}`);
console.log(`강팀 승률 (7 이상)  ${pct(t.strongWins, t.strongN)} (${t.strongN}경기)`);
console.log(`평균 평점          ${(ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(2)}`);
console.log('포지션별 득점      ' + Object.entries(goalsByPos).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k} ${pct(v, t.goals)}`).join(', '));
