import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { renewalDemand, requiredWage, signNew } from '../js/core/contracts.js';
import { signingBonus, isRichAi, expense, seasonRevenueEstimate, SIGNING_BONUS } from '../js/core/finance.js';
import { Rng } from '../js/core/rng.js';

const base = g.createNewGame('bonus');
g.chooseLeague(base, 'ENG2', '테스트');

const renewable = (s) => {
  const club = g.userClub(s);
  s.date = '2026-08-01';
  club.finance.wageBudget *= 2;
  const p = club.squad.map((id) => s.players[id]).find((x) => x.contract.until === '2027-06-30');
  assert.ok(p, '1년 계약 선수가 있다');
  const d = renewalDemand(s, club, p);
  return { club, p, offer: { wage: requiredWage(d, d.promise), years: 3, promise: d.promise } };
};

test('계약금은 연봉의 20%, 잔고가 연봉의 1.5년치를 넘는 AI 구단은 30%, 내 구단은 늘 20%', () => {
  const s = structuredClone(base);
  const me = g.userClub(s);
  const ai = g.activeClubs(s).find((c) => c.id !== me.id);
  assert.equal(signingBonus(s, ai, 1e7), 1e7 * 52 * SIGNING_BONUS.base);
  ai.finance.balance = seasonRevenueEstimate(ai) * 1.5 + 1;
  assert.ok(isRichAi(s, ai));
  assert.equal(signingBonus(s, ai, 1e7), 1e7 * 52 * SIGNING_BONUS.rich);
  me.finance.balance = seasonRevenueEstimate(me) * 10;
  assert.ok(!isRichAi(s, me), '내 구단은 부자 AI 규칙을 받지 않는다');
  assert.equal(signingBonus(s, me, 1e7), 1e7 * 52 * SIGNING_BONUS.base);
});

test('재계약: 서명하면 계약금을 잔고에서 내고 장부 "계약금"에 적는다', () => {
  const s = structuredClone(base);
  const { club, p, offer } = renewable(s);
  const before = club.finance.balance;
  const res = g.renewContract(s, p.id, offer);
  assert.ok(res.ok, res.reason);
  assert.equal(res.bonus, signingBonus(s, club, offer.wage));
  assert.equal(club.finance.balance, before - res.bonus);
  assert.equal(club.finance.season.expense.bonus, res.bonus);
});

test('재계약: 계약금을 낼 잔고가 없으면 협상 횟수를 쓰지 않고 거절한다', () => {
  const s = structuredClone(base);
  const { club, p, offer } = renewable(s);
  club.finance.balance = signingBonus(s, club, offer.wage) - 1;
  const res = g.renewContract(s, p.id, offer);
  assert.equal(res.ok, false);
  assert.match(res.reason, /계약금/);
  assert.equal(p.talks?.tries ?? 0, 0);
  assert.equal(p.contract.until, '2027-06-30');
});

test('AI 새 계약은 계약금을 내고, 유스 승격은 내지 않는다', () => {
  const s = structuredClone(base);
  const ai = g.activeClubs(s).find((c) => c.id !== g.userClub(s).id);
  const rng = new Rng('bonus');
  const p = s.players[ai.squad[0]];
  const before = ai.finance.balance;
  signNew(rng, s, ai, p);
  assert.equal(ai.finance.balance, before - signingBonus(s, ai, p.contract.wage));
  const after = ai.finance.balance;
  signNew(rng, s, ai, p, { youth: true });
  assert.equal(ai.finance.balance, after);
});

test('예전 저장 장부(계약금 칸 없음)에도 계약금을 적을 수 있다', () => {
  const s = structuredClone(base);
  const club = g.userClub(s);
  delete club.finance.season.expense.bonus;
  expense(club, 'bonus', 1e8);
  assert.equal(club.finance.season.expense.bonus, 1e8);
});

test('이적료 단계: 이적료 + 예상 계약금(요구 주급 기준)이 이적 예산을 넘으면 제안할 수 없다', async () => {
  const { transferDemand } = await import('../js/core/contracts.js');
  const s = structuredClone(base);
  const me = g.userClub(s);
  const p = Object.values(s.players).find((q) => q.clubId && q.clubId !== me.id && !q.loan);
  const bonus = signingBonus(s, me, transferDemand(s, me, p).wage);
  me.finance.transferBudget = 1e9 + bonus - 1;
  const res = g.bidForPlayer(s, p.id, 1e9);
  assert.equal(res.ok, false);
  assert.match(res.reason, /예상 계약금/);
  me.finance.transferBudget = 1e9 + bonus;
  assert.doesNotMatch(g.bidForPlayer(s, p.id, 1e9).reason ?? '', /이적 예산/);
});

test('협상 화면 미리 보기: 계약금과 총비용, 남는 돈이나 모자란 돈을 보여 준다', async () => {
  const { bonusPreview } = await import('../js/ui/bonus.js');
  const s = structuredClone(base);
  const me = g.userClub(s);
  const p = s.players[me.squad[0]];
  me.finance.transferBudget = 50e8;
  me.finance.balance = 60e8;
  const terms = bonusPreview(s, me, p, 'terms', 1e8, 30e8); // 주급 1억 → 계약금 10억 4,000만
  assert.match(terms, /계약금 10억 4,000만 원/);
  assert.match(terms, /이적료 \+ 계약금 40억 4,000만 원/);
  assert.match(terms, /9억 6,000만 원 남음/);
  assert.match(bonusPreview(s, me, p, 'terms', 1e8, 45e8), /모자람/);
  assert.match(bonusPreview(s, me, p, 'renew', 1e8), /잔고 60억 원 중 49억 6,000만 원 남음/);
});
