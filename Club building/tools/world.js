// 여러 시즌 세계 변화 측정: node tools/world.js [시즌 수]
// 시즌마다 끝까지 진행하고 다음 시즌으로 넘기며, 선수 수·나이·능력 분포가 무너지지 않는지 본다.

import * as g from '../js/core/game.js';
import { overall, ageOn } from '../js/core/player.js';
import { LEAGUES } from '../js/data/countries/index.js';

const N = Number(process.argv[2] ?? 3);
const state = g.createNewGame('world');
g.chooseClub(state, Object.keys(state.clubs)[0], '측정');

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const rows = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  g.simulateToSeasonEnd(state);
  const seasonMs = performance.now() - t0;
  const [top] = g.topScorers(state, 'ENG1', 1);
  const summary = g.startNextSeason(state);
  if (state.phase === 'chooseJob') g.chooseNewClub(state, g.jobOffers(state)[0].id);

  const active = Object.values(state.clubs).filter((c) => c.status === 'active');
  const squadPlayers = active.flatMap((c) => c.squad.map((id) => state.players[id]));
  const youth = active.flatMap((c) => c.youth);
  const tierAvg = (tier) => avg(active.filter((c) => LEAGUES[c.leagueId].tier === tier).flatMap((c) => c.squad.map((id) => overall(state.players[id]))));
  rows.push({
    시즌: `${state.season - 1}-${String(state.season).slice(2)}`,
    '계산(초)': (seasonMs / 1000).toFixed(1),
    구단: active.length,
    보관: Object.values(state.clubs).filter((c) => c.status === 'archived').length,
    복귀: summary.added.filter((a) => a.returned).length,
    '25명 아닌 구단': active.filter((c) => c.squad.length !== 25).length,
    유스: youth.length,
    평균나이: avg(squadPlayers.map((p) => ageOn(p, state.date))).toFixed(1),
    '1부 능력': tierAvg(1).toFixed(1),
    '2부 능력': tierAvg(2).toFixed(1),
    '3부 능력': tierAvg(3).toFixed(1),
    'EPL 득점왕': top ? `${top.s.goals}골` : '-',
    '저장(MB)': (JSON.stringify(state).length / 1e6).toFixed(1),
  });
}
console.table(rows);
