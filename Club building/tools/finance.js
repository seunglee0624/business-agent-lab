// 재정 균형 측정: node tools/finance.js [시즌 수]
// 리그별 평균 수입·지출 구성, 주급 비율, 잔고 변화, 적자 구단 비율, 사기 분포를 본다.

import * as g from '../js/core/game.js';
import { LEAGUES } from '../js/data/countries/index.js';
import { ledgerTotal } from '../js/core/finance.js';

const N = Number(process.argv[2] ?? 1);
const state = g.createNewGame('finance');
g.chooseLeague(state, 'ENG1', '측정');

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const eok = (won) => (won / 1e8).toFixed(0);

const startBalance = new Map(Object.values(state.clubs).map((c) => [c.id, c.finance.balance]));
for (let i = 0; i < N; i++) {
  g.simulateToSeasonEnd(state);
  g.startNextSeason(state);
  if (state.phase === 'unemployed') g.chooseNewClub(state, g.jobOffers(state)[0].id);
}

const rows = [];
for (const rule of Object.values(LEAGUES)) {
  // 지난 시즌 장부 (history[0])와 그 시즌 리그 기준
  const clubs = Object.values(state.clubs).filter((c) => c.finance.history[0] && c.finance.history.length >= 1 && c.status === 'active' && c.leagueId === rule.id);
  const h = clubs.map((c) => c.finance.history[0]);
  const income = h.map((x) => ledgerTotal(x.income));
  const expense = h.map((x) => ledgerTotal(x.expense));
  rows.push({
    리그: rule.id,
    '수입(억)': eok(avg(income)),
    '중계+상금': eok(avg(h.map((x) => x.income.tv + x.income.prize))),
    입장: eok(avg(h.map((x) => x.income.gate))),
    상업: eok(avg(h.map((x) => x.income.commercial))),
    '지출(억)': eok(avg(expense)),
    주급: eok(avg(h.map((x) => x.expense.wages))),
    '주급/수입': (avg(h.map((x) => x.expense.wages)) / avg(income)).toFixed(2),
    '수지(억)': eok(avg(income) - avg(expense)),
    적자구단: `${h.filter((x, i) => income[i] < expense[i]).length}/${h.length}`,
    '잔고 변화(억)': eok(avg(clubs.map((c) => c.finance.balance - (startBalance.get(c.id) ?? 0)))),
    마이너스잔고: clubs.filter((c) => c.finance.balance < 0).length,
  });
}
console.table(rows);

const morale = Object.values(state.players).filter((p) => p.clubId && p.contract).map((p) => p.morale);
const bucket = (lo, hi) => morale.filter((m) => m >= lo && m < hi).length;
console.log(`사기: 평균 ${avg(morale).toFixed(1)} · 0~25 ${bucket(0, 25)} · 25~45 ${bucket(25, 45)} · 45~60 ${bucket(45, 60)} · 60~80 ${bucket(60, 80)} · 80~ ${bucket(80, 101)} · 이적 요청 ${Object.values(state.players).filter((p) => p.transferRequest).length}명`);
