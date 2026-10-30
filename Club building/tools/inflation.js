// 능력 인플레이션 진단: 시즌마다 리그 단계별 1군 평균 능력이 어디서 바뀌는지 나눠 본다
// 사용: node tools/inflation.js [시즌 수] [시드]
//   성장: 시즌 동안 남아 있던 선수의 능력 변화 (나이대별)
//   나감: 시즌 끝에 1군에서 빠진 선수 (은퇴·방출·이적·강등), 들어옴: 새로 들어온 선수 (유스 승격·영입·보충 생성)
import * as g from '../js/core/game.js';
import { LEAGUES } from '../js/data/countries/index.js';
import { overall, ageOn } from '../js/core/player.js';

const SEASONS = Number(process.argv[2] ?? 10);
const state = g.createNewGame(process.argv[3] ?? 'inflation');
g.chooseLeague(state, 'ENG1', '진단');

// 단계별 1군 선수: id → { ovr, tier, age }
function snapshot() {
  const out = new Map();
  for (const c of Object.values(state.clubs)) {
    if (c.status !== 'active') continue;
    const tier = LEAGUES[c.leagueId].tier;
    for (const id of c.squad) {
      const p = state.players[id];
      out.set(id, { ovr: overall(p), tier, age: ageOn(p, state.date), clubId: c.id, youth: !!p.youthSince });
    }
  }
  return out;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (x) => (Number.isNaN(x) ? '-' : x.toFixed(1));

const rows = [];
const ages = {};
for (let i = 0; i < SEASONS; i++) {
  const start = snapshot();
  for (;;) {
    const res = g.advance(state, { skipOffers: true });
    if (res.stop === 'userMatch') { g.simulateUserMatch(state); g.finishUserMatch(state); }
    if (state.phase !== 'season') break;
  }
  const end = snapshot();
  g.startNextSeason(state);
  const next = snapshot();
  for (const tier of [1, 2, 3]) {
    const stay = [...start].filter(([id, s]) => s.tier === tier && end.has(id));
    const growth = stay.map(([id, s]) => end.get(id).ovr - s.ovr);
    for (const [id, s] of stay) {
      const band = s.age <= 21 ? '~21' : s.age <= 25 ? '22-25' : s.age <= 29 ? '26-29' : s.age <= 32 ? '30-32' : '33~';
      ((ages[tier] ??= {})[band] ??= []).push(end.get(id).ovr - s.ovr);
    }
    const before = [...end].filter(([, s]) => s.tier === tier);
    const after = [...next].filter(([, s]) => s.tier === tier);
    // 승강으로 구단째 옮긴 경우는 따로 센다. 나머지는 같은 구단 안의 선수 교체
    const clubTier = (cid) => (state.clubs[cid]?.status === 'active' ? LEAGUES[state.clubs[cid].leagueId].tier : null);
    const movedClubs = new Set([...end.values()].filter((s) => s.tier === tier && clubTier(s.clubId) !== tier).map((s) => s.clubId));
    const arrivedClubs = new Set([...next.values()].filter((s) => s.tier === tier && end.get([...next].find(([, x]) => x.clubId === s.clubId)?.[0])?.tier !== tier).map((s) => s.clubId));
    const out = before.filter(([id, s]) => !movedClubs.has(s.clubId) && (!next.has(id) || next.get(id).tier !== tier));
    const inn = after.filter(([id, s]) => !arrivedClubs.has(s.clubId) && (!end.has(id) || end.get(id).tier !== tier));
    const movedOut = before.filter(([, s]) => movedClubs.has(s.clubId)).map(([, s]) => s.ovr);
    const movedIn = after.filter(([, s]) => arrivedClubs.has(s.clubId)).map(([, s]) => s.ovr);
    const src = (id) => (!end.has(id) && !state.players[id]?.lastClubId && state.players[id]?.youthSince ? '유스' : end.has(id) ? '다른 단계' : '새로 생성·자유계약');
    const bySrc = {};
    for (const [id, s] of inn) (bySrc[src(id)] ??= []).push(s.ovr);
    rows.push({
      시즌: state.season - 1, 단계: `${tier}부`,
      시작평균: f1(mean([...start].filter(([, s]) => s.tier === tier).map(([, s]) => s.ovr))),
      성장: f1(mean(growth)),
      나감: `${out.length}명 ${f1(mean(out.map(([, s]) => s.ovr)))}`,
      들어옴: `${inn.length}명 ${f1(mean(inn.map(([, s]) => s.ovr)))}`,
      승강: `나감 ${movedClubs.size}팀 ${f1(mean(movedOut))} · 들어옴 ${arrivedClubs.size}팀 ${f1(mean(movedIn))}`,
      출처: Object.entries(bySrc).map(([k, v]) => `${k} ${v.length}명 ${f1(mean(v))}`).join(' / '),
      다음평균: f1(mean(after.map(([, s]) => s.ovr))),
    });
  }
}
console.table(rows);
console.log('\n== 나이대별 시즌 성장 (10시즌 평균) ==');
console.table(Object.entries(ages).map(([tier, b]) => ({ 단계: `${tier}부`, ...Object.fromEntries(['~21', '22-25', '26-29', '30-32', '33~'].map((k) => [k, `${f1(mean(b[k] ?? []))} (${(b[k] ?? []).length})`])) })));
