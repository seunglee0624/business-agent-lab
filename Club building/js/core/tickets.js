// 티켓·시즌권: 등급별(보통·빅매치·라이벌전) 가격, 시즌권, 홈 경기 관중과 가격 기록

import { LEAGUES } from '../data/countries/index.js';
import { attendanceRate, ticketPrice, income } from './finance.js';
import { capacity } from './facilities.js';
import { fansOf, SEGMENT_KEYS } from './fans.js';
import { roundMoney } from './money.js';

export const GRADES = {
  normal: { name: '보통', mult: 1, demand: 1 },
  big: { name: '빅매치', mult: 1.4, demand: 1.12 },
  rival: { name: '라이벌전', mult: 1.6, demand: 1.18 },
};
export const GRADE_KEYS = Object.keys(GRADES);
export const SEASON_TICKET_DISCOUNT = 0.75;
export const SEASON_TICKET_MAX = 0.7;
const SEASON_TICKET_BASE = 0.45;
const HISTORY_GAMES = 20;
// 팬층별 가격 민감도 (높을수록 비싸면 덜 온다)
const ELASTICITY = { loyal: 0.5, trendy: 1, family: 1.6, local: 1.2 };

const homeGames = (club) => LEAGUES[club.leagueId].teams - 1;

// 등급별 기본 가격
export function referencePrice(club, grade) {
  return roundMoney(ticketPrice(club) * GRADES[grade].mult);
}
export const referenceSeasonTicket = (club) => roundMoney(ticketPrice(club) * homeGames(club) * SEASON_TICKET_DISCOUNT);

// 저장 파일에 티켓 정보가 없으면 기본 가격으로 만든다
export function ticketsOf(club) {
  club.tickets ??= {
    prices: Object.fromEntries(GRADE_KEYS.map((g) => [g, referencePrice(club, g)])),
    seasonPrice: referenceSeasonTicket(club),
    seasonSold: null, // 첫 홈 경기 날 확정
    history: [],
  };
  return club.tickets;
}

const elasticity = (club) => SEGMENT_KEYS.reduce((s, k) => s + (fansOf(club).shares[k] / 100) * ELASTICITY[k], 0);
const priceEffect = (club, ratio) => Math.pow(Math.max(0.2, ratio), -elasticity(club));

// 라이벌: 같은 도시 구단, 없으면 같은 리그에서 평판이 가장 비슷한 구단
export function rivalOf(state, club) {
  const peers = Object.values(state.clubs).filter((c) => c.id !== club.id && c.status === 'active');
  const same = peers.filter((c) => c.city === club.city).sort((a, b) => b.reputation - a.reputation)[0];
  if (same) return same;
  return peers.filter((c) => c.leagueId === club.leagueId)
    .sort((a, b) => Math.abs(a.reputation - club.reputation) - Math.abs(b.reputation - club.reputation) || (a.id < b.id ? -1 : 1))[0] ?? null;
}

export function matchGrade(state, home, away) {
  if (rivalOf(state, home)?.id === away.id || rivalOf(state, away)?.id === home.id) return 'rival';
  const top4 = Object.values(state.clubs).filter((c) => c.leagueId === home.leagueId && c.id !== home.id)
    .sort((a, b) => b.reputation - a.reputation).slice(0, 4).map((c) => c.id);
  return away.reputation >= home.reputation + 5 || top4.includes(away.id) ? 'big' : 'normal';
}

// 시즌권 판매량 (석)
export function seasonTicketDemand(club, price = ticketsOf(club).seasonPrice) {
  const ratio = price / referenceSeasonTicket(club);
  const share = SEASON_TICKET_BASE * priceEffect(club, ratio) * (fansOf(club).satisfaction / 60);
  return Math.round(capacity(club) * Math.max(0, Math.min(SEASON_TICKET_MAX, share)));
}

// 한 경기 관중: 시즌권 좌석 + 남은 좌석에서 일반 티켓
export function matchCrowd(club, grade, price, position, teams, holders = ticketsOf(club).seasonSold ?? seasonTicketDemand(club), demand = 1) {
  const cap = capacity(club);
  const ratio = price / referencePrice(club, grade);
  // 시즌권 좌석을 뺀 나머지 좌석이 관중 비율·등급·가격에 따라 팔린다
  const rate = Math.min(1, attendanceRate(club, position, teams) * GRADES[grade].demand * demand * priceEffect(club, ratio));
  const sold = Math.round((cap - holders) * rate);
  return { crowd: holders + sold, sold, holders, income: roundMoney(sold * price) };
}

// 마케팅 담당 수준에 따른 예상 범위 폭: 1이면 ±25%, 20이면 ±3%
export const forecastWidth = (club) => 0.25 - ((Math.min(20, club.staff.marketing ?? 1) - 1) / 19) * 0.22;

export function forecast(club, grade, price) {
  const w = forecastWidth(club);
  const { crowd, income: amount } = matchCrowd(club, grade, price, null, LEAGUES[club.leagueId].teams);
  const cap = capacity(club);
  return {
    crowd: [Math.round(crowd * (1 - w)), Math.min(cap, Math.round(crowd * (1 + w)))],
    income: [roundMoney(amount * (1 - w)), roundMoney(amount * (1 + w))],
  };
}

export function seasonForecast(club, price) {
  const w = forecastWidth(club);
  const n = seasonTicketDemand(club, price);
  return { sold: [Math.round(n * (1 - w)), Math.round(n * (1 + w))], income: [roundMoney(n * price * (1 - w)), roundMoney(n * price * (1 + w))] };
}

// 정할 수 있는 가격: 기본 가격의 50%~200% (step 단위로 맞춘 값)
export function priceRange(club, grade) {
  const ref = grade === 'season' ? referenceSeasonTicket(club) : referencePrice(club, grade);
  const step = ref >= 1e6 ? 1e4 : 1e3;
  return { ref, step, min: Math.round(ref * 0.5 / step) * step, max: Math.round(ref * 2 / step) * step };
}

// 가격 바꾸기 (시즌권은 첫 홈 경기 전까지만)
export function setTicketPrice(club, grade, price) {
  const t = ticketsOf(club);
  if (!(price > 0)) return { ok: false, reason: '가격을 확인하세요.' };
  if (grade !== 'season' && !GRADES[grade]) return { ok: false, reason: '없는 등급입니다.' };
  const r = priceRange(club, grade);
  if (price < r.min || price > r.max) return { ok: false, reason: '기본 가격의 50%~200% 안에서 정하세요.' };
  if (grade === 'season') {
    if (t.seasonSold !== null) return { ok: false, reason: '시즌권은 이미 판매가 확정되었습니다. 다음 시즌 전에 바꿀 수 있습니다.' };
    t.seasonPrice = roundMoney(price);
    return { ok: true };
  }
  t.prices[grade] = roundMoney(price);
  return { ok: true };
}

// 홈 경기 날 (demand: 행사로 늘어난 수요 배율): 첫 홈 경기면 시즌권을 확정하고, 일반 티켓 수입을 넣는다. 관중 수를 돌려준다
export function recordHomeGate(state, home, away, position, teams, league, demand = 1) {
  const t = ticketsOf(home);
  if (league && t.seasonSold === null) {
    t.seasonSold = seasonTicketDemand(home);
    income(home, 'gate', roundMoney(t.seasonSold * t.seasonPrice));
  }
  const grade = matchGrade(state, home, away);
  const price = t.prices[grade];
  // 리그 경기가 아니면 시즌권 좌석이 없다
  const res = matchCrowd(home, grade, price, position, teams, league ? t.seasonSold : 0, demand);
  income(home, 'gate', res.income);
  if (home.id === state.user?.clubId) {
    t.history.unshift({ date: state.date, opponent: away.id, grade, price, crowd: res.crowd, capacity: capacity(home), satisfaction: fansOf(home).satisfaction });
    t.history.length = Math.min(t.history.length, HISTORY_GAMES);
  }
  return res.crowd;
}

// 평균 가격 비율 (기본 가격 대비). 팬 만족도에 쓴다
export function priceLevel(club) {
  const t = ticketsOf(club);
  const ratios = GRADE_KEYS.map((g) => t.prices[g] / referencePrice(club, g));
  ratios.push(t.seasonPrice / referenceSeasonTicket(club));
  return ratios.reduce((s, x) => s + x, 0) / ratios.length;
}

// 새 시즌: 시즌권 판매를 다시 연다
export function resetSeasonTickets(club) {
  ticketsOf(club).seasonSold = null;
}
