// 선수 계약: 처음 계약, 재계약 협상, 시즌 끝 만료 처리

import { PROMISES } from '../data/economy.js';
import { seasonOf, addDays } from './calendar.js';
import { overall, ageOn } from './player.js';
import { wageFor, roundMoney, monthsBetween } from './money.js';
import { boostFor } from './boost.js';
import { weeklyWageBill, seasonRevenueEstimate, expense } from './finance.js';

export const RENEWAL_MONTHS = 12; // 계약이 이만큼 남으면 재계약 협상을 할 수 있다
export const MAX_TALKS_PER_MONTH = 3;

// 계약 기간은 다음 날이 속한 시즌부터 센다 (6월 30일 계약은 새 시즌부터)
export const contractEnd = (date, years) => `${seasonOf(addDays(date, 1)) + years}-06-30`;

export function newContract(p, { date, years, promise, wageMult = 1 }) {
  return {
    wage: roundMoney(wageFor(overall(p)) * wageMult),
    until: contractEnd(date, years),
    promise,
    signed: date,
  };
}

// 선수단 안 능력 순위로 출전 약속을 정한다 (11명 주전, 7명 로테이션, 나머지 백업)
export function promiseForRank(rank) {
  return rank < 11 ? 'starter' : rank < 18 ? 'rotation' : 'backup';
}

function squadRank(state, club, p) {
  const ovr = overall(p);
  return club.squad.filter((id) => id !== p.id && overall(state.players[id]) > ovr).length;
}

function contractYears(rng, age) {
  if (age >= 31) return rng.int(1, 2);
  return rng.weighted([1, 2, 3, 4, 5], (y) => [1.5, 3, 3, 2, 1][y - 1]);
}

// 세계를 만들 때·새 구단이 생길 때 선수단 전체에 계약을 붙인다
export function assignInitialContracts(rng, club, players, date) {
  const sorted = players.slice().sort((a, b) => overall(b) - overall(a));
  sorted.forEach((p, rank) => {
    p.contract = newContract(p, { date, years: contractYears(rng, ageOn(p, date)), promise: promiseForRank(rank), wageMult: rng.float(0.85, 1.15) });
  });
}

// AI 구단 주급 절제: 주급이 예상 수입의 AI_WAGE_TARGET를 넘으면 새 계약·재계약 주급을 깎는다 (선수 능력이 오르며 주급이 수입보다 빨리 느는 것을 막는다)
export const AI_WAGE_TARGET = 0.55;
export function aiWageMult(state, club) {
  if (club.id === state.user?.clubId) return 1;
  const target = (seasonRevenueEstimate(club) * AI_WAGE_TARGET) / 52;
  const bill = weeklyWageBill(state, club);
  return bill > 0 ? Math.max(0.7, Math.min(1.1, target / bill)) : 1;
}

// 시즌 중 새로 들어온 선수 한 명 (보강, 유스 승격)
export function signNew(rng, state, club, p, { youth = false } = {}) {
  const promise = youth ? 'backup' : promiseForRank(squadRank(state, club, p));
  const mult = (youth ? 0.6 : rng.float(0.9, 1.1)) * aiWageMult(state, club);
  p.contract = newContract(p, { date: state.date, years: youth ? 3 : contractYears(rng, ageOn(p, state.date)), promise, wageMult: mult });
}

// ---- 재계약 ----

export function canRenew(state, p) {
  return !!p.contract && monthsBetween(state.date, p.contract.until) <= RENEWAL_MONTHS;
}

// 선수가 먼저 말하는 요구 조건
export function renewalDemand(state, club, p) {
  const age = ageOn(p, state.date);
  const m = boostFor(state, club).wage;
  const base = fairWage(state, club, p) * (age <= 24 && p.potential - overall(p) >= 6 ? 1.2 : 1.1) * m;
  const wage = roundMoney(Math.max(base, age < 30 ? p.contract.wage * 1.05 * m : 0));
  const years = age <= 23 ? 5 : age <= 27 ? 4 : age <= 30 ? 3 : age <= 32 ? 2 : 1;
  return { wage, years, promise: promiseForRank(squadRank(state, club, p)) };
}

// 약속을 요구보다 낮추면 주급을 더 원하고, 높여 주면 조금 덜 받아도 된다
export function requiredWage(demand, promise) {
  const diff = PROMISES[promise].rank - PROMISES[demand.promise].rank;
  return demand.wage * (diff < 0 ? 1 + 0.15 * -diff : 1 - 0.08 * diff);
}

// 구단 주급 수준: 선수단이 능력 기준 주급의 몇 배를 받는지 (작은 구단일수록 1보다 작다)
export function clubWageLevel(state, club) {
  let paid = 0;
  let fair = 0;
  for (const id of club.squad) {
    const q = state.players[id];
    if (!q?.contract) continue;
    paid += q.contract.wage;
    fair += wageFor(overall(q));
  }
  return fair > 0 ? Math.max(0.5, Math.min(1.5, paid / fair)) : 1;
}

// 선수 능력과 우리 선수단 주급 수준을 반씩 섞은 기준 주급
export const fairWage = (state, club, p) => wageFor(overall(p)) * Math.sqrt(clubWageLevel(state, club));

// 이적해 올 선수의 요구 조건: 능력·우리 주급 수준 기준 주급보다 7% 더, 다만 지금 주급보다 5% 넘게 깎이는 건 싫어한다
export const TRANSFER_WAGE_RAISE = 1.07;
export function transferDemand(state, club, p) {
  const wage = roundMoney(Math.max(fairWage(state, club, p) * TRANSFER_WAGE_RAISE * boostFor(state, club).wage, (p.contract?.wage ?? 0) * 0.95));
  return { wage, promise: promiseForRank(squadRank(state, club, p)) };
}

// offer: { wage, years, promise }. 돌려주는 값: { ok, reason }
export function offerRenewal(state, club, p, offer) {
  if (!(offer.years >= 1 && offer.years <= 5)) return { ok: false, reason: '계약 기간은 1~5년입니다.' };
  if (!canRenew(state, p)) return { ok: false, reason: `계약이 ${RENEWAL_MONTHS}개월 이하로 남아야 협상할 수 있습니다.` };
  const month = state.date.slice(0, 7);
  if (p.talks?.month !== month) p.talks = { month, tries: 0 };
  if (p.talks.tries >= MAX_TALKS_PER_MONTH) return { ok: false, reason: '이번 달에는 더 이상 협상하지 않겠다고 합니다. 다음 달에 다시 시도하세요.' };
  const wage = roundMoney(offer.wage);
  const bill = weeklyWageBill(state, club) - p.contract.wage + wage;
  if (bill > club.finance.wageBudget) return { ok: false, reason: '주급 예산을 넘습니다.' };
  p.talks.tries++;
  const demand = renewalDemand(state, club, p);
  if (wage < requiredWage(demand, offer.promise) * 0.95) {
    const left = MAX_TALKS_PER_MONTH - p.talks.tries;
    return { ok: false, reason: `조건이 맞지 않는다며 거절했습니다.${left ? ` (이번 달 ${left}번 더 협상할 수 있습니다)` : ''}` };
  }
  p.contract = { wage, until: contractEnd(state.date, offer.years), promise: offer.promise, signed: state.date };
  delete p.talks;
  return { ok: true };
}

// ---- 시즌 끝 만료 ----

// 만료되는 계약: 내 구단은 재계약하지 않은 선수가 떠나고, AI 구단은 쓸모 있는 선수만 재계약한다
// 돌려주는 값: 떠나는 선수 목록 [{ club, player }]
export function expiringContracts(state, rng, endDate, userId) {
  const leaving = [];
  for (const club of Object.values(state.clubs)) {
    if (club.status !== 'active') continue;
    for (const id of club.squad) {
      const p = state.players[id];
      if (!p.contract || p.contract.until > endDate) continue;
      const age = ageOn(p, endDate);
      // 이적이 생기기 전(3-2)까지 AI 구단은 크게 처지는 선수만 내보낸다
      // AI: 30세 이상인데 선수단 능력 순위 22위 밖(1군에 들기 어려움)이면 재계약하지 않고 유스에게 자리를 준다
      const rank = club.squad.map((x) => overall(state.players[x])).filter((o) => o > overall(p)).length;
      if (club.id !== userId && age < 33 && overall(p) >= club.level - 14 && !(age >= 30 && rank >= 22)) {
        const next = newContract(p, { date: endDate, years: Math.min(3, contractYears(rng, age)), promise: p.contract.promise, wageMult: rng.float(0.9, 1.1) * aiWageMult(state, club) });
        // 주급 예산을 넘으면 주전(능력 상위 11명)만 붙잡고 나머지는 보낸다
        const over = weeklyWageBill(state, club) - p.contract.wage + next.wage > club.finance.wageBudget;
        if (over && rank >= 11) leaving.push({ club, player: p });
        else p.contract = next;
      } else {
        leaving.push({ club, player: p });
      }
    }
  }
  return leaving;
}

// 계약 해지(방출): 남은 계약 주급의 절반을 위약금으로 주고 자유계약 선수로 내보낸다
export const RELEASE_SHARE = 0.5;
export function releaseCost(state, p) {
  if (!p.contract) return 0;
  const weeks = Math.max(0, (new Date(`${p.contract.until}T00:00:00Z`) - new Date(`${state.date}T00:00:00Z`)) / (7 * 86400000));
  return roundMoney(weeks * p.contract.wage * RELEASE_SHARE);
}

export function releasePlayer(state, club, p) {
  if (!club.squad.includes(p.id) && !club.youth.includes(p.id)) return { ok: false, reason: '우리 구단 선수가 아닙니다.' };
  if (p.loan) return { ok: false, reason: '임대 중인 선수는 방출할 수 없습니다.' };
  const cost = releaseCost(state, p);
  expense(club, 'wages', cost);
  club.squad = club.squad.filter((id) => id !== p.id);
  club.youth = club.youth.filter((id) => id !== p.id);
  if (club.tactics.lineup) club.tactics.lineup = null;
  p.lastClubId = club.id;
  p.clubId = null;
  p.contract = null;
  p.transferRequest = false;
  p.transferListed = false;
  p.freeSince = state.date;
  return { ok: true, cost };
}

