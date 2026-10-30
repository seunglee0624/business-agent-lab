// 구단 재정: 수입·지출, 매달 정산, 시즌 예산과 순위 상금. 금액은 모두 원.

import { EUR, TV_PER_CLUB, TV_EQUAL_SHARE, TICKET_PRICE, TICKET_COUNTRY, FACILITY_KEYS, facilityUpkeep, staffWage, STAFF_KEYS } from '../data/economy.js';
import { LEAGUES } from '../data/countries/index.js';
import { roundMoney } from './money.js';
import { capacity } from './facilities.js';
import { fanFactor, protestPenalty } from './fans.js';

export const WAGE_BUDGET_RATIO = 0.7;
export const MERCH_SHARE = 0.3; // 우리 구단은 상업 수입 중 이 몫을 굿즈 판매로 번다
export const TRANSFER_BUDGET_RATIO = 0.45;
const HISTORY_SEASONS = 5;

export const emptyLedger = () => ({
  income: { tv: 0, prize: 0, gate: 0, commercial: 0, merch: 0, rental: 0, transfers: 0 },
  expense: { wages: 0, staff: 0, facilities: 0, construction: 0, merch: 0, events: 0, transfers: 0 },
});

export const ledgerTotal = (part) => Object.values(part).reduce((s, x) => s + x, 0);

// ---- 수입 기준 ----

export const tvPerSeason = (club) => TV_PER_CLUB[club.leagueId] * EUR;

// 스폰서·상업 수입 (시즌): 구단 평판에 지수로 비례
export const commercialPerSeason = (club) => 3e6 * Math.exp((club.reputation - 55) * 0.13) * EUR;

export function ticketPrice(club) {
  const rule = LEAGUES[club.leagueId];
  return TICKET_PRICE[rule.tier] * TICKET_COUNTRY[club.country] * (1 + 0.06 * (club.facilities.megastore - 1)) * EUR;
}

// 관중 비율: 도시 규모, 메가스토어, 성적(position: 지금 순위, 없으면 중간)
export function attendanceRate(club, position = null, teams = 20) {
  const form = position ? 0.08 * (1 - (2 * (position - 1)) / Math.max(1, teams - 1)) : 0;
  const base = 0.7 + 0.04 * ((club.citySize ?? 3) - 3) + 0.03 * (club.facilities.megastore - 1) + form;
  return Math.max(0.3, Math.min(1, base * fanFactor(club) * protestPenalty(club)));
}

export function gatePerMatch(club, position, teams) {
  const crowd = Math.round(capacity(club) * attendanceRate(club, position, teams));
  return { crowd, income: roundMoney(crowd * ticketPrice(club)) };
}

// ---- 지출 기준 ----

// 임대 선수는 주급을 나눠 낸다 (데려온 구단 wageShare, 원래 구단 나머지)
const loanShare = (p, club) => (!p.loan ? 1 : p.loan.to === club.id ? p.loan.wageShare : 1 - p.loan.wageShare);
export const playerWageBill = (state, club) => [...club.squad, ...(club.loanedOut ?? [])]
  .reduce((s, id) => { const p = state.players[id]; return s + roundMoney((p.contract?.wage ?? 0) * loanShare(p, club)); }, 0);
// 스태프 + 감독 주급
export const staffWageBill = (club) => STAFF_KEYS.reduce((s, k) => s + roundMoney(staffWage(club.staff[k]) * EUR), 0) + (club.headCoach?.wage ?? 0);
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

export function income(club, key, amount) {
  club.finance.balance += amount;
  club.finance.season.income[key] += amount;
}

// 이적 예산은 잔고 안에 묶어 둔 돈이다. 주급처럼 막을 수 없는 지출로 잔고가 그 아래로 내려가면 이적 예산도 같이 줄어든다
export function expense(club, key, amount) {
  const f = club.finance;
  f.balance -= amount;
  f.season.expense[key] += amount;
  f.transferBudget = Math.max(0, Math.min(f.transferBudget, f.balance));
}

// 시설·행사처럼 고를 수 있는 지출에 쓸 수 있는 돈: 잔고에서 이적 예산을 뺀 만큼
export const spendable = (club) => Math.max(0, club.finance.balance - club.finance.transferBudget);
export function spendCheck(club, cost) {
  if (cost <= spendable(club)) return null;
  return club.finance.balance >= cost ? '이적 예산으로 묶인 돈은 쓸 수 없습니다. 재정 조정에서 이적 예산을 줄이세요.' : '잔고가 부족합니다.';
}

export const PROFIT_TO_BUDGET = 0.5;
export const WAGE_HEADROOM = 1.1; // 재계약·영입으로 주급이 오를 여유
export const TRANSFER_FLOOR = 0.2; // 적자 시즌 뒤에도 잔고의 20%는 이적 예산으로

// 시즌 시작: 주급 예산은 수입 기준으로 새로 정하고, 이적 예산은 남은 예산에 지난 시즌 수익(이적 거래 제외)의 절반을 더한다. 첫 시즌은 잔고의 45%. 주급 예산은 지금 주급의 1.1배 이상, 이적 예산은 잔고의 20% 이상
export function setBudgets(state, club) {
  const f = club.finance;
  const bill = weeklyWageBill(state, club);
  f.wageBudget = roundMoney(Math.max(bill * WAGE_HEADROOM, (seasonRevenueEstimate(club) * WAGE_BUDGET_RATIO) / 52));
  const last = f.history[0];
  if (!last) {
    f.transferBudget = roundMoney(Math.max(0, f.balance * TRANSFER_BUDGET_RATIO));
    return null;
  }
  const carried = f.transferBudget;
  const profit = (ledgerTotal(last.income) - last.income.transfers) - (ledgerTotal(last.expense) - last.expense.transfers);
  const added = roundMoney(profit * PROFIT_TO_BUDGET);
  f.transferBudget = roundMoney(Math.max(0, Math.min(Math.max(0, f.balance), Math.max(carried + added, f.balance * TRANSFER_FLOOR))));
  return { carried, added, total: f.transferBudget };
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
  // 우리 구단의 상업 수입은 스폰서 계약(sponsors.js)과 굿즈(merch.js)로 들어온다
  if (club.id !== state.user?.clubId) income(club, 'commercial', roundMoney((commercialPerSeason(club) * fanFactor(club)) / 12));
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

// 이적료: 사는 구단은 이적 예산에서 빼고, 파는 구단은 판 돈을 예산에 더한다 (적자면 빚을 먼저 갚고 남는 만큼)
export function recordTransfer(buyer, seller, fee) {
  if (!fee) return 0;
  buyer.finance.transferBudget = Math.max(0, buyer.finance.transferBudget - fee);
  expense(buyer, 'transfers', fee);
  income(seller, 'transfers', fee);
  const added = Math.min(fee, Math.max(0, seller.finance.balance));
  seller.finance.transferBudget += added;
  return added;
}

// 시즌 장부를 기록으로 넘긴다
export function closeLedger(club, season) {
  const f = club.finance;
  f.history.unshift({ season, ...f.season, balance: f.balance });
  f.history.length = Math.min(f.history.length, HISTORY_SEASONS);
  f.season = emptyLedger();
}

// 예산 조정: 남은 시즌 주 수만큼의 주급이 이적 예산과 맞바뀐다. 주급 예산은 지금 주급보다 낮출 수 없다
export function budgetRange(state, club) {
  const f = club.finance;
  const end = new Date(`${state.season + 1}-06-30`);
  const weeks = Math.max(1, Math.ceil((end - new Date(state.date)) / (7 * 864e5)));
  const bill = weeklyWageBill(state, club);
  const unit = bill >= 1e8 ? 1e6 : 1e4;
  const min = Math.min(f.wageBudget, Math.ceil(bill / unit) * unit);
  const max = f.wageBudget + f.transferBudget / weeks;
  return { weeks, min, max, pool: f.transferBudget + f.wageBudget * weeks };
}

export function adjustBudgets(state, club, wageBudget) {
  const { weeks, min, max, pool } = budgetRange(state, club);
  if (!(wageBudget >= min - 1 && wageBudget <= max + 1)) return { ok: false, reason: '조정할 수 없는 금액입니다.' };
  const f = club.finance;
  // 바를 오른쪽 끝(반올림 단위 안)까지 밀면 이적 예산을 모두 주급으로 돌린다
  const unit = max >= 1e8 ? 1e6 : 1e4;
  if (wageBudget >= max - unit) {
    f.wageBudget = roundMoney(max);
    f.transferBudget = 0;
    return { ok: true };
  }
  f.wageBudget = roundMoney(Math.max(min, wageBudget));
  f.transferBudget = roundMoney(Math.max(0, pool - f.wageBudget * weeks));
  return { ok: true };
}
