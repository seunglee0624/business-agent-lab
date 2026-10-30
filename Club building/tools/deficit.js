// 적자 진단: 시즌마다 리그 단계별로 적자 구단과 흑자 구단의 수입·지출 항목 평균을 비교한다
// 사용: node tools/deficit.js [시즌 수] [시드]
import * as g from '../js/core/game.js';
import { LEAGUES } from '../js/data/countries/index.js';
import { ledgerTotal } from '../js/core/finance.js';

const SEASONS = Number(process.argv[2] ?? 6);
const state = g.createNewGame(process.argv[3] ?? 'deficit');
g.chooseLeague(state, 'ENG1', '진단');
const eok = (x) => Math.round(x / 1e8);
const rows = [];
for (let i = 0; i < SEASONS; i++) {
  for (;;) {
    const res = g.advance(state, { skipOffers: true });
    if (res.stop === 'userMatch') { g.simulateUserMatch(state); g.finishUserMatch(state); }
    if (state.phase !== 'season') break;
  }
  g.startNextSeason(state);
  const groups = {};
  for (const c of Object.values(state.clubs)) {
    if (c.status !== 'active' || c.id === state.user.clubId || !c.finance.history[0]) continue;
    const h = c.finance.history[0];
    const tier = LEAGUES[c.leagueId].tier;
    if (tier !== 1 && tier !== 3) continue;
    const key = `${tier}부 ${ledgerTotal(h.income) < ledgerTotal(h.expense) ? '적자' : '흑자'}`;
    const gr = (groups[key] ??= { n: 0, inc: {}, exp: {} });
    gr.n++;
    for (const [k, v] of Object.entries(h.income)) gr.inc[k] = (gr.inc[k] ?? 0) + v;
    for (const [k, v] of Object.entries(h.expense)) gr.exp[k] = (gr.exp[k] ?? 0) + v;
  }
  for (const [key, gr] of Object.entries(groups).sort()) {
    const avg = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k} ${eok(v / gr.n)}`).join(' ');
    rows.push({ 시즌: state.season - 1, 구분: key, 구단: gr.n, 수입: avg(gr.inc), 지출: avg(gr.exp) });
  }
}
for (const r of rows) console.log(`${r.시즌} ${r.구분} (${r.구단}팀)\n  수입: ${r.수입}\n  지출: ${r.지출}`);
