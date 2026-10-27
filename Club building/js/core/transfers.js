// 이적: 다른 구단 선수 정보, 검색, 영입 협상(이적료 → 개인 조건), AI 구단의 제안, 자유계약 선수

import { hashSeed } from './rng.js';
import { overall, ratingAt, ageOn } from './player.js';
import { marketValue, roundMoney, won } from './money.js';
import { daysBetween, addDays } from './calendar.js';
import { addMessage } from './state.js';
import { withParticle } from './korean.js';
import { contractEnd, transferDemand, requiredWage, signNew } from './contracts.js';
import { weeklyWageBill, recordTransfer } from './finance.js';
import { registeredCount, MAX_SQUAD } from './season.js';
import { SQUAD_TEMPLATE } from './worldgen.js';

// ---- 선수 정보 ----

// 잠재력 범위의 반폭: 스카우트 1 → ±10, 20 → ±1
const potentialHalfWidth = (scout) => Math.round(10 - (9 * (scout - 1)) / 19);

// 범위 안에서 진짜 값의 위치는 선수마다 고정한다 (다시 봐도 범위가 바뀌지 않게)
export function potentialRange(p, scout) {
  const w = potentialHalfWidth(scout);
  const shift = hashSeed(`${p.id}:potential`) % (2 * w + 1);
  const lo = Math.max(overall(p), p.potential - shift);
  return [lo, Math.min(99, lo + 2 * w)];
}

// 화면에 보여 줄 선수 정보. 다른 구단 선수는 세부 능력치를 빼고 잠재력을 범위로 준다
export function playerInfo(state, club, p) {
  const own = p.clubId === club.id;
  const info = {
    id: p.id,
    name: p.name,
    own,
    clubId: p.clubId,
    age: ageOn(p, state.date),
    position: p.position,
    overall: overall(p),
    ratings: [p.position, ...p.secondary].map((pos) => ({ pos, rating: ratingAt(p, pos) })),
  };
  if (own) return { ...info, attrs: p.attrs, potential: p.potential };
  return { ...info, potentialRange: potentialRange(p, club.staff.scout) };
}

// ---- 검색 ----

export const SEARCH_LIMIT = 100;

// filters: { position, minAge, maxAge, maxValue, leagueId, freeOnly }
export function searchPlayers(state, club, filters = {}) {
  const rows = [];
  for (const p of Object.values(state.players)) {
    if (p.retired || p.clubId === club.id || p.loan) continue;
    if (filters.freeOnly ? p.clubId : !p.clubId) continue;
    if (filters.position && p.position !== filters.position) continue;
    if (filters.leagueId && state.clubs[p.clubId]?.leagueId !== filters.leagueId) continue;
    if (p.clubId && state.clubs[p.clubId].youth.includes(p.id)) continue;
    const age = ageOn(p, state.date);
    if (age < (filters.minAge ?? 0) || age > (filters.maxAge ?? 99)) continue;
    const value = p.clubId ? marketValue(p, state.date) : 0;
    if (filters.maxValue && value > filters.maxValue) continue;
    rows.push({ ...playerInfo(state, club, p), value, wage: p.contract?.wage ?? 0, until: p.contract?.until ?? null, transferRequest: !!p.transferRequest, injured: !!p.injury });
  }
  return rows.sort((a, b) => b.overall - a.overall).slice(0, SEARCH_LIMIT);
}

// ---- 이적시장 ----

// 여름 7/1~8/31, 겨울 1/1~1/31. 열려 있으면 마감일, 아니면 null
export function windowEnd(date) {
  const md = date.slice(5);
  const year = date.slice(0, 4);
  if (md >= '07-01' && md <= '08-31') return `${year}-08-31`;
  if (md <= '01-31') return `${year}-01-31`;
  return null;
}

export const MAX_FEE_TRIES = 3;
const DEADLINE_DAYS = 3;

// 파는 구단이 받으려는 금액: 몸값 × 출전 비중, 이적 요청과 마감 직전에는 낮춘다
export function askingPrice(state, p) {
  const role = { starter: 1.3, rotation: 1.1, backup: 0.9 }[p.contract?.promise ?? 'backup'];
  let fee = marketValue(p, state.date) * role;
  if (p.transferRequest) fee *= 0.8;
  const end = windowEnd(state.date);
  if (end && daysBetween(state.date, end) < DEADLINE_DAYS) fee *= 0.9;
  return roundMoney(fee);
}

const dealOf = (state, p) => {
  const end = windowEnd(state.date);
  let deal = state.transfers.deals[p.id];
  if (deal && deal.until < state.date) deal = null; // 지난 시장의 협상은 버린다
  return (state.transfers.deals[p.id] = deal ?? { stage: 'fee', tries: 0, fee: 0, until: end });
};

// 이적료 제안. 돌려주는 값: { ok: true, stage: 'terms', fee } | { ok: false, reason, counter? }
export function bidForPlayer(state, club, p, fee) {
  if (!p.clubId || p.clubId === club.id) return { ok: false, reason: '다른 구단 선수에게만 이적료를 제안할 수 있습니다.' };
  if (p.loan) return { ok: false, reason: '임대 중인 선수는 데려올 수 없습니다.' };
  if (!windowEnd(state.date)) return { ok: false, reason: '이적시장이 닫혀 있습니다. (여름 7/1~8/31, 겨울 1월)' };
  fee = roundMoney(fee);
  if (fee > club.finance.transferBudget) return { ok: false, reason: '이적 예산을 넘습니다.' };
  const deal = dealOf(state, p);
  if (deal.stage === 'collapsed') return { ok: false, reason: '협상이 결렬되었습니다. 다음 이적시장에 다시 시도하세요.' };
  if (deal.stage === 'terms') return { ok: true, stage: 'terms', fee: deal.fee };
  const asking = askingPrice(state, p);
  if (fee >= asking) {
    Object.assign(deal, { stage: 'terms', fee, tries: 0 });
    return { ok: true, stage: 'terms', fee };
  }
  deal.tries++;
  if (deal.tries >= MAX_FEE_TRIES) {
    deal.stage = 'collapsed';
    return { ok: false, reason: `${withParticle(state.clubs[p.clubId].name, '가')} 협상을 끝냈습니다. 다음 이적시장에 다시 시도하세요.` };
  }
  return { ok: false, reason: `거절했습니다. ${withParticle(state.clubs[p.clubId].name, '는')} 이 금액을 원합니다.`, counter: asking };
}

// ---- 개인 조건과 이적 완료 ----

export const MAX_TERM_TRIES = 3;
const REPUTATION_GAP = 15; // 지금 구단보다 평판이 이만큼 낮은 구단에는 가지 않는다

// 개인 조건 제안 (이적료 합의 뒤, 또는 자유계약 선수). offer: { wage, years, promise }
// 돌려주는 값: { ok: true, fee } | { ok: false, reason }
export function offerTerms(state, club, p, offer) {
  if (!(offer.years >= 1 && offer.years <= 5)) return { ok: false, reason: '계약 기간은 1~5년입니다.' };
  const seller = p.clubId ? state.clubs[p.clubId] : null;
  let deal = state.transfers.deals[p.id];
  if (seller) {
    if (!deal || deal.until < state.date || deal.stage === 'fee') return { ok: false, reason: '먼저 구단과 이적료를 합의해야 합니다.' };
    if (deal.stage === 'collapsed') return { ok: false, reason: '협상이 결렬되었습니다. 다음 이적시장에 다시 시도하세요.' };
    if (seller.reputation - club.reputation > REPUTATION_GAP) {
      deal.stage = 'collapsed';
      return { ok: false, reason: `${withParticle(p.name, '가')} 우리 구단의 수준(평판)이 낮다며 거절했습니다.` };
    }
  } else {
    deal = state.transfers.deals[p.id] ??= { stage: 'terms', tries: 0, fee: 0, until: '9999-12-31' };
    if (deal.stage === 'collapsed') return { ok: false, reason: '협상이 결렬되었습니다.' };
  }
  if (registeredCount(state, club, state.date) >= MAX_SQUAD) return { ok: false, reason: `1군 등록 인원(${MAX_SQUAD}명)이 꽉 찼습니다. 먼저 선수를 내보내세요.` };
  const wage = roundMoney(offer.wage);
  if (weeklyWageBill(state, club) + wage > club.finance.wageBudget) return { ok: false, reason: '주급 예산을 넘습니다.' };
  const demand = transferDemand(state, club, p);
  if (wage < requiredWage(demand, offer.promise) * 0.95) {
    deal.termTries = (deal.termTries ?? 0) + 1;
    if (deal.termTries >= MAX_TERM_TRIES) {
      deal.stage = 'collapsed';
      return { ok: false, reason: `${withParticle(p.name, '가')} 조건이 맞지 않아 협상이 결렬되었습니다.` };
    }
    return { ok: false, reason: `조건이 맞지 않는다며 거절했습니다. (${MAX_TERM_TRIES - deal.termTries}번 더 제안할 수 있습니다)` };
  }
  const fee = deal.fee;
  completeTransfer(state, p, seller, club, fee, { wage, until: contractEnd(state.date, offer.years), promise: offer.promise, signed: state.date });
  return { ok: true, fee };
}

// 선수를 옮기고 돈을 정산한다. from이 null이면 자유계약 선수
export function completeTransfer(state, p, from, to, fee, contract) {
  if (from) {
    from.squad = from.squad.filter((id) => id !== p.id);
    from.youth = from.youth.filter((id) => id !== p.id);
    if (from.tactics.lineup?.some((e) => e?.playerId === p.id)) from.tactics.lineup = null;
    recordTransfer(to, from, fee);
  }
  to.squad.push(p.id);
  (p.transfers ??= []).push({ date: state.date, from: from?.id ?? null, to: to.id, fee });
  p.clubId = to.id;
  p.contract = contract;
  p.transferRequest = false;
  p.unhappyMonths = 0;
  p.morale = Math.max(p.morale, 65);
  delete p.freeSince;
  delete state.transfers.deals[p.id];
}

// ---- AI 구단의 제안 (내 선수) ----

export const OFFER_DAYS = 7;
const COUNTER_LIMIT = 1.2; // 처음 제안의 이만큼까지는 역제안을 받아준다

export function setTransferListed(p, listed) {
  p.transferListed = !!listed;
}

// 이적시장 중 매일: 기한 지난 제안은 거절 처리하고, 새 제안이 올 수 있다
export function dailyOffers(state, rng, club) {
  const t = state.transfers;
  const end = windowEnd(state.date);
  t.incoming = t.incoming.filter((o) => o.expires >= state.date && end);
  if (!end || t.incoming.length >= 2) return null;
  const squad = club.squad.map((id) => state.players[id]);
  const keen = squad.filter((p) => p.transferListed || p.transferRequest);
  if (!rng.chance(Math.min(0.3, 0.02 + 0.04 * keen.length))) return null;
  const candidates = squad.filter((p) => !p.injury && !p.loan && !t.incoming.some((o) => o.playerId === p.id));
  if (!candidates.length) return null;
  const p = rng.weighted(candidates, (q) => (q.transferListed || q.transferRequest ? 5 : 1));
  const ovr = overall(p);
  const fee = roundMoney(marketValue(p, state.date) * rng.float(0.8, 1.05) * (p.transferListed ? 0.9 : 1));
  const buyers = Object.values(state.clubs).filter((c) => c.status === 'active' && c.id !== club.id
    && c.level >= ovr - 4 && c.level <= ovr + 12 && c.finance.transferBudget >= fee * COUNTER_LIMIT);
  if (!buyers.length) return null;
  const buyer = rng.pick(buyers);
  const offer = { id: t.nextOfferId++, playerId: p.id, clubId: buyer.id, fee, date: state.date, expires: [addDays(state.date, OFFER_DAYS), end].sort()[0] };
  t.incoming.push(offer);
  addMessage(state, {
    title: `${p.name} 이적 제안`,
    body: `${withParticle(buyer.name, '가')} ${withParticle(p.name, '를')} 사고 싶어 합니다. 제안 금액 ${won(fee)}. ${offer.expires}까지 답하지 않으면 거절한 것으로 봅니다.`,
    important: true,
  });
  return offer;
}

// answer: 'accept' | 'reject' | { counter }. 돌려주는 값: { ok, reason, fee? }
export function respondToOffer(state, rng, club, offerId, answer) {
  const t = state.transfers;
  const offer = t.incoming.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: '이미 끝난 제안입니다.' };
  t.incoming = t.incoming.filter((o) => o !== offer);
  if (answer === 'reject') return { ok: true };
  const buyer = state.clubs[offer.clubId];
  let fee = offer.fee;
  if (answer?.counter) {
    fee = roundMoney(answer.counter);
    if (fee > offer.fee * COUNTER_LIMIT || fee > buyer.finance.transferBudget) {
      return { ok: false, reason: `${withParticle(buyer.name, '가')} 너무 비싸다며 제안을 거뒀습니다.` };
    }
  }
  const p = state.players[offer.playerId];
  completeTransfer(state, p, club, buyer, fee, null);
  signNew(rng, state, buyer, p);
  trimSquad(state, buyer);
  return { ok: true, fee };
}

// AI 구단은 등록 인원을 넘으면 가장 약한 선수를 내보낸다
export function trimSquad(state, club) {
  while (registeredCount(state, club, state.date) > MAX_SQUAD) {
    const worst = club.squad.map((id) => state.players[id]).filter((p) => !p.loan).sort((a, b) => overall(a) - overall(b))[0];
    club.squad = club.squad.filter((id) => id !== worst.id);
    if (club.tactics.lineup) club.tactics.lineup = null;
    Object.assign(worst, { clubId: null, lastClubId: club.id, contract: null, transferRequest: false, freeSince: state.date });
  }
}

// ---- AI 구단끼리 이적 ----

// 시장마다 한 구단이 사는 최대 인원과 하루 시도 확률 (여름 약 1.5명, 겨울 약 0.3명)
const AI_BUYS = { summer: { max: 3, chance: 0.025 }, winter: { max: 1, chance: 0.01 } };

// 이적시장 중 매일: AI 구단 몇 곳이 약한 자리를 자유계약 선수 → 다른 구단 선수 순으로 보강한다
export function dailyAiTransfers(state, rng, userId) {
  const end = windowEnd(state.date);
  if (!end) return;
  const rule = end.endsWith('08-31') ? AI_BUYS.summer : AI_BUYS.winter;
  for (const club of Object.values(state.clubs)) {
    if (club.status !== 'active' || club.id === userId) continue;
    const buys = club.windowBuys?.until === end ? club.windowBuys : (club.windowBuys = { until: end, n: 0 });
    if (buys.n >= rule.max || !rng.chance(rule.chance)) continue;
    if (aiSign(state, rng, club, userId)) buys.n++;
  }
}

// 가장 보강이 필요한 자리: 그 자리 최고 선수가 구단 수준보다 많이 낮은 곳
function neediestPosition(state, club) {
  const best = Object.fromEntries(Object.keys(SQUAD_TEMPLATE).map((pos) => [pos, 0]));
  for (const id of club.squad) {
    const p = state.players[id];
    best[p.position] = Math.max(best[p.position], overall(p));
  }
  return Object.keys(best).sort((a, b) => best[a] - best[b])[0];
}

function aiSign(state, rng, club, userId) {
  const pos = neediestPosition(state, club);
  const fits = (p) => p.position === pos && !p.retired && !p.injury && !p.loan && ageOn(p, state.date) <= 31
    && overall(p) >= club.level - 3 && overall(p) <= club.level + 6;
  const all = Object.values(state.players);
  const free = all.filter((p) => !p.clubId && fits(p));
  if (free.length) {
    const p = rng.pick(free);
    completeTransfer(state, p, null, club, 0, null);
    signNew(rng, state, club, p);
    trimSquad(state, club);
    return true;
  }
  const bought = all.filter((p) => {
    if (!p.clubId || p.clubId === club.id || p.clubId === userId || !fits(p)) return false;
    const seller = state.clubs[p.clubId];
    if (seller.status !== 'active' || seller.youth.includes(p.id) || seller.reputation - club.reputation > REPUTATION_GAP) return false;
    return askingPrice(state, p) <= club.finance.transferBudget;
  });
  if (!bought.length) return false;
  const p = rng.pick(bought);
  const seller = state.clubs[p.clubId];
  completeTransfer(state, p, seller, club, askingPrice(state, p), null);
  signNew(rng, state, club, p);
  trimSquad(state, club);
  return true;
}
