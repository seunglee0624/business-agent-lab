// 장기 균형 측정: node tools/longrun.js [시즌 수] [리그] [시드]
// 단장 대신 정해진 규칙으로 실제 기능을 모두 쓰면서(이적·재계약·시설·스태프·스폰서·아시아 투어·굿즈·행사·SNS·대관)
// 여러 시즌을 진행하고, 시즌마다 우리 구단과 리그 전체 재정을 기록한다. 실패한 행동은 이유별로 센다.

import * as g from '../js/core/game.js';
import { LEAGUES } from '../js/data/countries/index.js';
import { ledgerTotal, weeklyWageBill } from '../js/core/finance.js';
import { SEASON_RESET } from '../js/core/fans.js';
if (process.env.FAN_RESET) SEASON_RESET.ratio = Number(process.env.FAN_RESET); // 측정용: 시즌 시작 만족도 보정 비율
import { askingPrice, windowEnd } from '../js/core/transfers.js';
import { transferDemand, renewalDemand, canRenew } from '../js/core/contracts.js';
import { upgradeInfo, isBuilding } from '../js/core/facilities.js';
import { FACILITY_KEYS } from '../js/data/economy.js';
import { overall } from '../js/core/player.js';
import { merchOf } from '../js/core/merch.js';
import { marketValue } from '../js/core/money.js';

const SEASONS = Number(process.argv[2] ?? 5);
const LEAGUE = process.argv[3] ?? 'ENG1';
const state = g.createNewGame(process.argv[4] ?? 'longrun');
g.chooseLeague(state, LEAGUE, '측정');
const club = () => g.userClub(state);
const eok = (x) => Math.round(x / 1e8);

// 행동 기록: 이름 → { ok, fail: { 이유: 횟수 } }
const log = {};
function act(name, res) {
  const r = (log[name] ??= { ok: 0, fail: {} });
  if (res?.ok) r.ok++;
  else {
    const why = (res?.reason ?? '알 수 없음').replace(/[0-9,.]+/g, '#').slice(0, 50);
    r.fail[why] = (r.fail[why] ?? 0) + 1;
  }
  return res;
}

// ---- 이적 ----
function transfersWeek() {
  const c = club();
  if (windowEnd(state.date)) act('감독에게 추천 요구', g.askCoach(state));
  for (const req of g.transferRequests(state)) act('영입 요청 승인', g.answerRequest(state, req.id, 'approve'));
  if (!windowEnd(state.date)) return;
  for (const [pid, deal] of Object.entries(state.transfers.deals)) {
    const p = state.players[pid];
    if (!p || p.clubId === c.id || deal.stage === 'collapsed' || deal.until < state.date) continue;
    if (deal.stage === 'fee') {
      const res = act('이적료 제안', g.bidForPlayer(state, pid, Math.min(c.finance.transferBudget, askingPrice(state, p))));
      if (!res.ok) continue;
    }
    if (state.transfers.deals[pid]?.stage === 'terms') {
      // 1군 등록이 꽉 찼으면 상위 18명 밖에서 가장 약한 선수를 임대 보낸다
      if (g.registeredCount(state, c, state.date) >= g.MAX_SQUAD) {
        const spare = c.squad.map((id) => state.players[id]).filter((x) => !x.loan).sort((a, b) => overall(b) - overall(a)).slice(18).pop();
        if (spare && !act('자리 비우기 임대', g.loanOut(state, spare.id)).ok) act('자리 비우기 방출', g.releasePlayer(state, spare.id));
      }
      // 주급 여유가 모자라면 재정 조정 바로 이적 예산을 주급 예산으로 옮긴다
      const d0 = transferDemand(state, c, p);
      const need = weeklyWageBill(state, c) + d0.wage - c.finance.wageBudget;
      if (need > 0 && g.budgetRange(state).max >= c.finance.wageBudget + need) act('재정 조정 (주급 예산 늘림)', { ok: true, ...g.adjustBudgets(state, c.finance.wageBudget + need) });
      const d = transferDemand(state, c, p);
      act('개인 조건 제안', g.offerTerms(state, pid, { wage: d.wage, years: 3, promise: d.promise }));
    }
  }
}

function sellOffers(offer) {
  const p = state.players[offer.playerId];
  // 시장가의 1.2배 이상이거나 주전이 아니면 판다
  const top = club().squad.map((id) => state.players[id]).sort((a, b) => overall(b) - overall(a)).slice(0, 13).map((x) => x.id);
  const sell = offer.fee >= marketValue(p, state.date) * 1.2 || !top.includes(p.id);
  act(sell ? '받은 제안 수락' : '받은 제안 거절', g.respondToOffer(state, offer.id, sell ? 'accept' : 'reject'));
}

// ---- 재계약: 능력 상위 18명만 ----
function renewals() {
  const c = club();
  const keep = c.squad.map((id) => state.players[id]).sort((a, b) => overall(b) - overall(a)).slice(0, 18);
  for (const p of keep) {
    if (!canRenew(state, p) || p.renewedTry === state.date.slice(0, 7)) continue;
    p.renewedTry = state.date.slice(0, 7);
    const d = renewalDemand(state, c, p);
    act('재계약', g.renewContract(state, p.id, { wage: d.wage, years: d.years, promise: d.promise }));
  }
}

// ---- 시설·스태프: 시즌 시작에 한 번 ----
function seasonStartPlans() {
  const c = club();
  act('스태프: 마케팅 담당 12', g.setStaffLevel(state, 'marketing', Math.max(12, c.staff.marketing)));
  act('스태프: 스카우트 +2', g.setStaffLevel(state, 'scout', Math.min(20, c.staff.scout + 2)));
  // 잔고가 비용의 3배 넘는 시설 중 가장 싼 것 하나
  const options = FACILITY_KEYS.filter((k) => !isBuilding(c, k)).map((k) => ({ k, info: upgradeInfo(c, k) })).filter((o) => o.info)
    .sort((a, b) => a.info.cost - b.info.cost);
  const pick = options.find((o) => c.finance.balance > o.info.cost * 3);
  if (pick) act(`시설 업그레이드`, g.upgradeFacility(state, pick.k));
  if (c.facilities.stadium >= 3 && !g.stadiumOf(c).pitchSystem && c.finance.balance > g.pitchSystemCost() * 3) act('잔디 보호 시스템', g.buildPitchSystem(state));
}

// ---- 스폰서: 빈자리·끝나 가는 자리를 업종 번갈아 영업, 제안은 한 번 더 요구하고 안 되면 수락 ----
const INDUSTRY_ORDER = ['finance', 'sport', 'tech', 'food', 'local', 'betting'];
let pitchN = 0;
function sponsorsWeek() {
  const c = club();
  const s = g.sponsorsOf(state, c);
  for (const slot of g.SLOT_KEYS) {
    if (g.canPitch(state, c, slot)) act('스폰서 영업', g.pitchSponsor(state, slot, INDUSTRY_ORDER[pitchN++ % INDUSTRY_ORDER.length]));
  }
  // 자리마다 가장 큰 제안 하나
  const best = {};
  for (const o of s.offers) if (!best[o.slot] || o.amount > best[o.slot].amount) best[o.slot] = o;
  for (const o of Object.values(best)) {
    if (!o.asks) {
      const res = g.answerSponsor(state, o.id, { ask: Math.round(o.amount * 1.12) });
      act(res.ok ? '스폰서 요구 금액 수락됨' : res.collapsed ? '스폰서 협상 결렬' : '스폰서 역제안 받음', { ok: true });
      if (res.ok || res.collapsed) continue;
    }
    if (s.offers.includes(o)) act('스폰서 수락', g.answerSponsor(state, o.id, { accept: true }));
  }
}

// ---- 굿즈: 유니폼은 첫 홈 경기 전에 예상 판매만큼, 머플러·아동용품은 품절 전망이 나오면 추천량 ----
const DESIGNS = ['modern', 'classic', 'retro', 'star'];
function merchWeek() {
  const c = club();
  const m = merchOf(c);
  for (const [i, item] of ['kitHome', 'kitAway'].entries()) {
    const it = m.items[item];
    if (it.ordered) continue;
    const design = DESIGNS[(state.season + i) % DESIGNS.length];
    const fc = g.merchForecast(state, c, item, { design });
    act('유니폼 주문', g.orderMerch(state, item, { quantity: Math.round((fc[0] + fc[1]) / 2), price: it.price, design }));
  }
  for (const item of ['scarf', 'kids', 'kitHome', 'kitAway']) {
    const it = m.items[item];
    if (it.incoming || (ITEMS_KIT.has(item) && (!it.ordered || it.reordered))) continue;
    const p = g.merchProjection(state, item);
    if (p.outDate && p.days < 40 && p.suggest > 0) act(`굿즈 추가 주문`, g.orderMerch(state, item, { quantity: p.suggest, price: it.price }));
    else if (!ITEMS_KIT.has(item) && !it.stock && !it.sold) act('굿즈 첫 주문', g.orderMerch(state, item, { quantity: Math.max(100, p.total), price: it.price }));
  }
  if (m.limited && !m.items.limited.ordered) {
    const fc = g.merchForecast(state, c, 'limited');
    act('한정판 주문', g.orderMerch(state, 'limited', { quantity: fc[0], price: m.items.limited.price }));
  }
}
const ITEMS_KIT = new Set(['kitHome', 'kitAway']);

// ---- 행사·SNS·대관 ----
const EVENT_ORDER = ['fanDay', 'halftime', 'legends'];
const CAMPAIGN_ORDER = ['shortForm', 'youtube', 'localTV', 'liveQA', 'documentary'];
let eventN = 0;
let campN = 0;
function stadiumWeek() {
  const c = club();
  // 홈 경기 3번에 한 번 행사
  const next = g.upcomingHomeFixtures(state, 1)[0];
  if (next && !g.stadiumOf(c).events.booked[next.id] && (next.round ?? 0) % 3 === 0) {
    act('경기장 행사', g.bookEvent(state, next.id, EVENT_ORDER[eventN++ % EVENT_ORDER.length]));
  }
  if (g.mediaOf(c).running.length < 1) act('SNS 캠페인', g.startCampaign(state, CAMPAIGN_ORDER[campN++ % CAMPAIGN_ORDER.length]));
  for (const o of [...g.stadiumOf(c).rentals.offers]) {
    // 잔디가 80 넘게 남아 있으면 받는다
    act(c.stadium.pitch > 80 ? '대관 수락' : '대관 거절', g.answerRental(state, o.id, c.stadium.pitch > 80));
  }
}

// ---- 진행 ----
const seasons = [];
const stops = {};
let lastSeasonStart = null;
function weekly() {
  if (lastSeasonStart !== state.season) {
    lastSeasonStart = state.season;
    seasonStartPlans();
  }
  if (g.canChooseTour(state, club()) && !(club().tour?.season === state.season)) act('아시아 투어', g.chooseTour(state, 'asia'));
  transfersWeek();
  renewals();
  sponsorsWeek();
  merchWeek();
  stadiumWeek();
}

function record() {
  const c = club();
  const h = c.finance.history[0];
  const table = state.history[0]?.leagues?.[h.leagueId ?? c.leagueId];
  const fans = g.fansOf(c);
  const top = c.squad.map((id) => state.players[id]).map(overall).sort((a, b) => b - a).slice(0, 11);
  const user = state.user.history[state.user.history.length - 1];
  seasons.push({
    시즌: `${user.season}`,
    리그: user.leagueId,
    순위: user.position,
    수입: eok(ledgerTotal(h.income)),
    중계상금: eok(h.income.tv + h.income.prize),
    입장: eok(h.income.gate),
    스폰서상업: eok(h.income.commercial),
    굿즈: eok(h.income.merch),
    대관: eok(h.income.rental),
    선수판매: eok(h.income.transfers),
    지출: eok(ledgerTotal(h.expense)),
    주급: eok(h.expense.wages),
    영입: eok(h.expense.transfers),
    시설공사: eok(h.expense.construction),
    굿즈생산: eok(h.expense.merch),
    행사SNS: eok(h.expense.events),
    잔고: eok(c.finance.balance),
    만족도: Math.round(fans.satisfaction),
    해외팬: Math.round(fans.overseas / 1000) + 'k',
    주전평균: Math.round(top.reduce((s, x) => s + x, 0) / top.length),
    평판: c.reputation,
  });
  void table;
}

// 리그 전체(우리 구단 제외) 재정: 단계별 주급/수입, 적자 구단 비율, 평균 잔고
const world = [];
function recordWorld() {
  const byTier = {};
  for (const c of Object.values(state.clubs)) {
    if (c.status !== 'active' || c.id === state.user.clubId || !c.finance.history[0]) continue;
    const h = c.finance.history[0];
    const tier = LEAGUES[c.leagueId].tier;
    const t = (byTier[tier] ??= { n: 0, ratio: 0, deficit: 0, balance: 0, income: 0 });
    const inc = ledgerTotal(h.income) - h.income.transfers;
    t.n++;
    t.ratio += h.expense.wages / Math.max(1, inc);
    t.deficit += ledgerTotal(h.income) < ledgerTotal(h.expense) ? 1 : 0;
    t.balance += c.finance.balance;
    t.income += inc;
  }
  for (const [tier, t] of Object.entries(byTier)) {
    world.push({ 시즌: state.season - 1, 단계: `${tier}부`, 평균수입: eok(t.income / t.n), 주급비율: (t.ratio / t.n).toFixed(2), 적자구단: `${Math.round((t.deficit / t.n) * 100)}%`, 평균잔고: eok(t.balance / t.n) });
  }
}

const t0 = Date.now();
for (let i = 0; i < SEASONS; i++) {
  for (;;) {
    weekly();
    const res = g.advance(state, {});
    stops[res.stop] = (stops[res.stop] ?? 0) + 1;
    if (res.stop === 'transferOffer') sellOffers(res.offer);
    if (res.stop === 'userMatch') { g.simulateUserMatch(state); g.finishUserMatch(state); }
    if (res.stop === 'decision') for (const t of res.titles) stops[`결정: ${t.replace(/[0-9]+/g, '#').split(':')[0]}`] = (stops[`결정: ${t.replace(/[0-9]+/g, '#').split(':')[0]}`] ?? 0) + 1;
    if (state.phase !== 'season') break;
  }
  g.startNextSeason(state);
  record();
  recordWorld();
}

console.log(`\n== 우리 구단 (${LEAGUE} 최약팀 시작, ${SEASONS}시즌, ${Math.round((Date.now() - t0) / 1000)}초) — 금액 억 원 ==`);
console.table(seasons);
console.log('\n== 다른 구단 평균 (리그 단계별) ==');
console.table(world);
console.log('\n== 행동 결과 ==');
for (const [name, r] of Object.entries(log)) {
  const fails = Object.entries(r.fail).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ×${n}`).join(' / ');
  console.log(`${name}: 성공 ${r.ok}, 실패 ${Object.values(r.fail).reduce((s, x) => s + x, 0)}${fails ? ` (${fails})` : ''}`);
}
console.log('\n== 진행 멈춤 ==');
console.log(Object.entries(stops).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log(`\n최종 주급 ${eok(weeklyWageBill(state, club()) * 52)}억/년 · 주급 예산 ${eok(club().finance.wageBudget * 52)}억/년 · 이적 예산 ${eok(club().finance.transferBudget)}억`);
