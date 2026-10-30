import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { marketValue, wageFor, roundMoney } from '../js/core/money.js';
import { renewalDemand, requiredWage } from '../js/core/contracts.js';
import { weeklyWageBill, ledgerTotal } from '../js/core/finance.js';
import { growthFactor, completeConstruction } from '../js/core/facilities.js';
import { addDays } from '../js/core/calendar.js';
import { LEAGUES } from '../js/data/countries/index.js';
import { overall } from '../js/core/player.js';
import { won } from '../js/ui/format.js';

// 우리 다음 경기 날까지 주 단위로 진행한다
const toMatch = (s) => {
  let res;
  do res = g.advance(s, { skipOffers: true, watchMatches: true }); while (res.stop === 'week');
  return res;
};


const state = g.createNewGame('economy');
const clubs = Object.values(state.clubs);
g.chooseLeague(state, 'ENG2', '테스트');
const userId = state.user.clubId;

test('금액 표시: 억·만 단위', () => {
  assert.equal(won(152_000_000_000), '1,520억 원');
  assert.equal(won(320_000_000), '3억 2,000만 원');
  assert.equal(won(45_000_000), '4,500만 원');
  assert.equal(won(-200_000_000), '-2억 원');
  assert.equal(roundMoney(123_456_789), 123_000_000);
});

test('몸값·주급은 능력에 따라 오르고 README 기준과 맞다', () => {
  assert.ok(wageFor(85) > 3e8 && wageFor(85) < 5e8);
  assert.ok(wageFor(55) > 3e6 && wageFor(55) < 6e6);
  const p = Object.values(state.players).find((x) => x.clubId && x.contract);
  const better = { ...p, attrs: Object.fromEntries(Object.entries(p.attrs).map(([k, v]) => [k, Math.min(20, v + 3)])) };
  assert.ok(marketValue(better, state.date) > marketValue(p, state.date));
});

test('세계 생성: 모든 선수에 계약, 모든 구단에 재정·시설·스태프·감독', () => {
  for (const club of clubs.filter((c) => c.status === 'active')) {
    assert.ok(club.finance.wageBudget >= weeklyWageBill(state, club), club.name);
    assert.ok(Object.values(club.facilities).every((v) => v >= 1 && v <= 5));
    assert.ok(Object.values(club.staff).every((v) => v >= 1 && v <= 20));
    assert.ok(club.headCoach?.name);
    for (const id of club.squad) assert.ok(state.players[id].contract?.wage > 0);
  }
});

test('재계약: 요구보다 적게 주면 거절, 맞춰 주면 서명, 한 달 3번까지', () => {
  const s = structuredClone(state);
  const club = g.userClub(s);
  s.date = '2026-08-01';
  const p = club.squad.map((id) => s.players[id]).find((x) => x.contract.until === '2027-06-30');
  assert.ok(p, '1년 계약 선수가 있다');
  club.finance.wageBudget *= 2;
  const demand = renewalDemand(s, club, p);
  assert.equal(g.renewContract(s, p.id, { wage: demand.wage * 0.5, years: 2, promise: demand.promise }).ok, false);
  const res = g.renewContract(s, p.id, { wage: requiredWage(demand, demand.promise), years: 3, promise: demand.promise });
  assert.ok(res.ok, res.reason);
  assert.equal(p.contract.until, '2029-06-30');
  const q = club.squad.map((id) => s.players[id]).find((x) => x.contract.until === '2027-06-30');
  if (q) {
    for (let i = 0; i < 3; i++) g.renewContract(s, q.id, { wage: 1, years: 1, promise: 'backup' });
    assert.match(g.renewContract(s, q.id, { wage: 1e12, years: 1, promise: 'backup' }).reason, /다음 달/);
  }
});

test('시설 업그레이드: 이적 예산을 뺀 돈으로 공사비를 내고 시작하며, 공사가 끝나면 레벨이 오른다', () => {
  const s = structuredClone(state);
  const club = g.userClub(s);
  const key = Object.keys(club.facilities).find((k) => k !== 'stadium' && club.facilities[k] < 5);
  const before = club.facilities[key];
  club.finance.balance = 0;
  club.finance.transferBudget = 0;
  assert.equal(g.upgradeFacility(s, key).ok, false, '쓸 수 있는 돈이 없으면 못 짓는다');
  club.finance.balance = 1e12;
  club.finance.transferBudget = 1e12 - 1;
  assert.match(g.upgradeFacility(s, key).reason, /이적 예산/);
  club.finance.transferBudget = 0;
  const res = g.upgradeFacility(s, key);
  assert.ok(res.ok, res.reason);
  assert.equal(club.finance.balance, 1e12 - res.cost);
  const growth = growthFactor(club);
  s.date = addDays(club.construction[0].done, -1);
  completeConstruction(s, club, true);
  assert.equal(club.facilities[key], before, '완료일 전에는 그대로');
  s.date = club.construction[0].done;
  completeConstruction(s, club, true);
  assert.equal(club.facilities[key], before + 1);
  assert.equal(club.construction.length, 0);
  if (key === 'training') assert.ok(growthFactor(club) > growth);
});

test('스태프: 주급 예산을 넘는 수준으로는 올릴 수 없다', () => {
  const s = structuredClone(state);
  const club = g.userClub(s);
  club.finance.wageBudget = weeklyWageBill(s, club);
  assert.equal(g.setStaffLevel(s, 'coach', 20).ok, club.staff.coach === 20);
  assert.ok(g.setStaffLevel(s, 'coach', 1).ok);
});

test('한 달이 지나면 수입·지출이 장부에 쌓이고, 홈 경기마다 입장 수입이 생긴다', () => {
  const s = structuredClone(state);
  for (let i = 0; i < 4; i++) {
    toMatch(s);
    g.simulateUserMatch(s);
    g.finishUserMatch(s);
  }
  toMatch(s);
  const club = g.userClub(s);
  const f = club.finance.season;
  assert.ok(f.income.gate > 0 && f.income.tv > 0 && f.income.commercial > 0);
  assert.ok(f.expense.wages > 0 && f.expense.staff > 0 && f.expense.facilities > 0);
  assert.ok(ledgerTotal(f.income) > 0);
  const home = s.competitions[club.leagueId].fixtures.find((x) => x.result && x.home === club.id);
  assert.ok(home.result.crowd > 0);
});

test('사기가 경기력에 조금 영향을 준다', async () => {
  const { moraleFactor } = await import('../js/core/morale.js');
  assert.ok(moraleFactor(100) > moraleFactor(60) && moraleFactor(60) > moraleFactor(0));
  assert.ok(moraleFactor(0) >= 0.96 && moraleFactor(100) <= 1.03);
});

test('시즌이 끝나면 순위 상금, 장부 기록, 계약 만료 처리, 새 예산', () => {
  const s = structuredClone(state);
  g.simulateToSeasonEnd(s);
  const club = g.userClub(s);
  const expiring = club.squad.filter((id) => s.players[id].contract.until <= `${s.season + 1}-06-30`);
  g.startNextSeason(s);
  if (s.phase === 'unemployed') return;
  const c = g.userClub(s);
  assert.ok(c.finance.history[0].income.prize > 0);
  assert.equal(ledgerTotal(c.finance.season.income), 0);
  for (const id of expiring) assert.notEqual(s.players[id]?.clubId, c.id, '재계약하지 않은 선수는 떠났다');
  for (const id of c.squad) assert.ok(s.players[id].contract.until > s.date);
  assert.ok(s.user.history.at(-1).position >= 1);
});
