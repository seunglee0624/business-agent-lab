// 시즌 단위 밸런스 측정: node tools/season.js [시즌 수]
// 시즌마다 새 세계를 만들어 끝까지 진행하고 승점, 득실, 득점왕을 출력한다.

import { createNewGame, chooseLeague, simulateToSeasonEnd, standings, topScorers } from '../js/core/game.js';

const N = Number(process.argv[2] ?? 5);
const rows = [];
for (let i = 0; i < N; i++) {
  const state = createNewGame(`season-${i}`);
  chooseLeague(state, 'ENG1', '측정');
  simulateToSeasonEnd(state);
  const table = standings(state);
  const [top] = topScorers(state, 'ENG1', 1);
  const goals = table.reduce((s, r) => s + r.goalsFor, 0);
  rows.push({
    우승승점: table[0].points,
    꼴찌승점: table.at(-1).points,
    최다득점: Math.max(...table.map((r) => r.goalsFor)),
    최다실점: Math.max(...table.map((r) => r.goalsAgainst)),
    경기당골: (goals / 380).toFixed(2),
    득점왕: `${top.s.goals}골 (${top.player.position})`,
  });
}
console.table(rows);
