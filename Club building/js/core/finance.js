// 구단 재정: 수입·지출, 매달 정산, 시즌 예산과 순위 상금. 금액은 모두 원.

import { EUR, TV_PER_CLUB, TV_EQUAL_SHARE, TICKET_PRICE, TICKET_COUNTRY, FACILITY_KEYS, facilityUpkeep, staffWage, STAFF_KEYS } from '../data/economy.js';
import { LEAGUES } from '../data/countries/index.js';
import { roundMoney } from './money.js';
import { capacity } from './facilities.js';

export const WAGE_BUDGET_RATIO = 0.7;
export const TRANSFER_BUDGET_RATIO = 0.35;
const HISTORY_SEASONS = 5;

export const emptyLedger = () => ({
  income: { tv: 0, prize: 0, gate: 0, commercial: 0, transfers: 0 },
  expense: { wages: 0, staff: 0, facilities: 0, construction: 0, transfers: 0 },
});

export const ledgerTotal = (part) => Object.values(part).reduce((s, x) => s + x, 0);

// ---- 수입 기준 ----

export const tvPerSeason = (club) => TV_PER_CLUB[club.leagueId] * EUR;

// 스폰서·상업 수입 (시즌): 구단 평판에 지수로 비례
export const commercialPerSeason = (club) => 2e6 * Math.exp((club.reputation - 55) * 0.13) * EUR;

export function ticketPrice(club) {
  const rule = LEAGUES[club.leagueId];
  return TICKET_PRICE[rule.tier] * TICKET_COUNTRY[club.country] * (1 + 0.06 * (club.facilities.megastore - 1)) * EUR;
}

// 관중 비율: 도시 규모, 메가스토어, 성적(position: 지금 순위, 없으면 중간)
export function attendanceRate(club, position = null, teams = 20) {
  const form = position ? 0.08 * (1 - (2 * (position - 1)) / Math.max(1, teams - 1)) : 0;
  return Math.max(0.3, Math.min(1, 0.7 + 0.04 * ((club.citySize ?? 3) - 3) + 0.03 * (club.facilities.megastore - 1) + form));
}

export function gatePerMatch(club, position, teams) {
  const crowd = Math.round(capacity(club) * attendanceRate(club, position, teams));
  return { crowd, income: roundMoney(crowd * ticketPrice(club)) };
}

// ---- 지출 기준 ----

export const playerWageBill = (state, club) => club.squad.reduce((s, id) => s + (state.players[id].contract?.wage ?? 0), 0);
export const staffWageBill = (club) => STAFF_KEYS.reduce((s, k) => s + roundMoney(staffWage(club.staff[k]) * EUR), 0);
// 주급 예산에 들어가는 주간 지출 (선수 + 스태프)
export const weeklyWageBill = (state, club) => playerWageBill(state, club) + staffWageBill(club);
export const monthlyUpkeep = (club) => FACILITY_KEYS.reduce((s, k) => s + roundMoney(facilityUpkeep(club.facilities[k]) * EUR), 0);

// 한 시즌 예상 수입 (예산 산정용)
export function seasonRevenueEstimate(club) {
  const rule = LEAGUES[club.leagueId];
  const homeGames = rule.teams - 1;
  return tvPerSeason(club) + commercialPerSeason(club) + gatePerMatch(club, null, rule.teams).income * homeGames;
}

// ---- 장부 ----

export function initFinance(rng, state, club) {
  club.finance = {
    balance: roundMoney(seasonRevenueEstimate(club) * rng.float(0.1, 0.6)),
    transferBudget: 0,
    wageBudget: 0,
    season: emptyLedger(),
    history: [],
  };
  setBudgets(state, club);
}

function income(club, key, amount) {
  club.finance.balance += amount;
  club.finance.season.income[key] += amount;
}

function expense(club, key, amount) {
  club.finance.balance -= amount;
  club.finance.season.expense[key] += amount;
}

// 시즌 시작: 수뇌부가 주급·이적 예산을 정한다
export function setBudgets(state, club) {
  const f = club.finance;
  const bill = weeklyWageBill(state, club);
  f.wageBudget = roundMoney(Math.max(bill * 1.02, (seasonRevenueEstimate(club) * WAGE_BUDGET_RATIO) / 52));
  f.transferBudget = roundMoney(Math.max(0, f.balance * TRANSFER_BUDGET_RATIO));
}

// 홈 경기 입장 수입
export function recordGate(state, club, position, teams) {
  const { crowd, income: amount } = gatePerMatch(club, position, teams);
  income(club, 'gate', amount);
  return crowd;
}

// 매달 마지막 날: 그달 몫을 정산한다
export function monthlySettlement(state, club) {
  income(club, 'tv', roundMoney((tvPerSeason(club) * TV_EQUAL_SHARE) / 12));
  income(club, 'commercial', roundMoney(commercialPerSeason(club) / 12));
  expense(club, 'wages', roundMoney((playerWageBill(state, club) * 52) / 12));
  expense(club, 'staff', roundMoney((staffWageBill(club) * 52) / 12));
  expense(club, 'facilities', monthlyUpkeep(club));
}

// 시즌 끝: 중계권의 나머지 절반을 순위에 따라 나눠 준다 (1위 1.5배 ~ 꼴찌 0.5배)
export function payPrizeMoney(state, club, position, teams) {
  const weight = 1.5 - (position - 1) / Math.max(1, teams - 1);
  const amount = roundMoney(tvPerSeason(club) * (1 - TV_EQUAL_SHARE) * weight);
  income(club, 'prize', amount);
  return amount;
}

// 시즌 장부를 기록으로 넘긴다
export function closeLedger(club, season) {
  const f = club.finance;
  f.history.unshift({ season, ...f.season, balance: f.balance });
  f.history.length = Math.min(f.history.length, HISTORY_SEASONS);
  f.season = emptyLedger();
}
