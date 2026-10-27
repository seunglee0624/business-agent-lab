import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, chooseClub, userClub, advance, simulateUserMatch, finishUserMatch, registeredCount, MAX_SQUAD, loanOut, offerLoan, buyLoanedPlayer, simulateToSeasonEnd, startNextSeason } from '../js/core/game.js';
import { weeklyWageBill } from '../js/core/finance.js';
import { overall } from '../js/core/player.js';

const fresh = (seed = 'tr2') => {
  const state = createNewGame(seed);
  chooseClub(state, Object.keys(state.clubs)[4], '테스트');
  return state;
};
// date가 될 때까지 내 경기도 결과만으로 처리하며 진행한다
const runUntil = (state, date) => {
  while (state.date < date) {
    const res = advance(state, { skipOffers: true });
    if (res.stop === 'userMatch') { simulateUserMatch(state); finishUserMatch(state); } else if (res.stop !== 'userMatch' && state.phase !== 'season') break;
  }
};
const movesBetweenAi = (state, userId) => Object.values(state.players)
  .flatMap((p) => (p.transfers ?? []).map((t) => ({ ...t, p })))
  .filter((t) => t.to !== userId && t.from !== userId);

test('AI 구단끼리 여름 이적시장에서 선수를 사고팔며, 구단마다 3명 이하로 사고 등록 인원을 넘지 않는다', () => {
  const state = fresh();
  const me = userClub(state).id;
  runUntil(state, '2026-09-01');
  const moves = movesBetweenAi(state, me).filter((t) => t.date <= '2026-08-31');
  assert.ok(moves.length >= 20, `AI 이적 ${moves.length}건`);
  assert.ok(moves.some((t) => t.from && t.fee > 0), '구단 간 유료 이적이 있어야 한다');
  const perClub = {};
  for (const t of moves) perClub[t.to] = (perClub[t.to] ?? 0) + 1;
  assert.ok(Math.max(...Object.values(perClub)) <= 3);
  for (const c of Object.values(state.clubs)) if (c.status === 'active') assert.ok(registeredCount(state, c, state.date) <= MAX_SQUAD, c.name);
  // 시장이 닫힌 뒤에는 AI 이적이 없다
  assert.ok(!movesBetweenAi(state, me).some((t) => t.date > '2026-08-31' && t.from));
});

// beforeEnd: 시즌 끝 처리 직전에 상태를 바꾼다 (시즌 중 성적으로 해고되지 않게)
const toNextSeason = (state, beforeEnd = () => {}) => { simulateToSeasonEnd(state); beforeEnd(); startNextSeason(state); };

test('임대 보내기: 선수가 다른 구단에서 뛰고, 우리 등록 인원과 주급 부담이 줄고, 시즌이 끝나면 돌아온다', () => {
  const state = fresh('loan1');
  const me = userClub(state);
  const p = state.players[me.squad[me.squad.length - 1]];
  const regBefore = registeredCount(state, me, state.date);
  const billBefore = weeklyWageBill(state, me);
  const res = loanOut(state, p.id);
  assert.equal(res.ok, true, res.reason);
  assert.notEqual(p.clubId, me.id);
  assert.ok(state.clubs[p.clubId].squad.includes(p.id));
  assert.equal(registeredCount(state, me, state.date), regBefore - 1);
  assert.ok(weeklyWageBill(state, me) < billBefore);
  assert.equal(p.loan.from, me.id);
  toNextSeason(state);
  assert.equal(p.clubId, me.id);
  assert.ok(me.squad.includes(p.id));
  assert.equal(p.loan, undefined);
});

test('임대 보내기: 이적시장이 닫혀 있으면 할 수 없다', () => {
  const state = fresh('loan2');
  runUntil(state, '2026-09-02');
  const me = userClub(state);
  assert.equal(loanOut(state, me.squad[me.squad.length - 1]).ok, false);
});

const loanTarget = (state) => {
  const me = userClub(state);
  return Object.values(state.players).find((p) => p.clubId && p.clubId !== me.id && p.contract?.promise !== 'starter'
    && !state.clubs[p.clubId].youth.includes(p.id) && overall(p) >= me.level - 5);
};

test('임대 영입: 주전이 아닌 선수를 주급 일부를 내고 데려오며, 시즌이 끝나면 돌려보낸다', () => {
  const state = fresh('loan3');
  const me = userClub(state);
  me.squad.splice(-1); // 등록 자리 하나 비우기
  me.finance.wageBudget = 1e12;
  const p = loanTarget(state);
  const owner = p.clubId;
  const billBefore = weeklyWageBill(state, me);
  assert.equal(offerLoan(state, p.id, { wageShare: 0.5 }).ok, false, '주급을 너무 적게 내면 거절');
  const res = offerLoan(state, p.id, { wageShare: 1 });
  assert.equal(res.ok, true, res.reason);
  assert.equal(p.clubId, me.id);
  assert.ok(weeklyWageBill(state, me) > billBefore);
  toNextSeason(state);
  assert.equal(p.clubId, owner);
  assert.ok(!me.squad.includes(p.id));
});

test('임대 영입: 완전 이적 옵션 금액을 내면 시즌 중에 우리 선수가 된다', () => {
  const state = fresh('loan4');
  const me = userClub(state);
  me.squad.splice(-1);
  me.finance.wageBudget = 1e12;
  me.finance.transferBudget = 1e12;
  const p = loanTarget(state);
  const res = offerLoan(state, p.id, { wageShare: 1 });
  assert.equal(res.ok, true, res.reason);
  assert.ok(res.optionFee > 0);
  const bal = me.finance.balance;
  assert.equal(buyLoanedPlayer(state, p.id).ok, true);
  assert.equal(p.loan, undefined);
  assert.equal(me.finance.balance, bal - res.optionFee);
  toNextSeason(state);
  assert.equal(p.clubId, me.id);
});

test('시즌 끝 보충: 내 구단은 18명·골키퍼 2명 이상이면 자동으로 채우지 않는다', () => {
  const state = fresh('fill1');
  const me = userClub(state);
  let before;
  toNextSeason(state, () => {
    const outfield = me.squad.filter((id) => state.players[id].position !== 'GK');
    me.squad = me.squad.filter((id) => !outfield.slice(0, 3).includes(id));
    before = new Set([...me.squad, ...me.youth]);
  });
  assert.ok(me.squad.every((id) => before.has(id)), '새로 들어온 선수가 없어야 한다');
});

test('시즌 끝 보충: 내 구단이 18명 미만이거나 골키퍼가 2명 미만이면 그만큼만 채운다', () => {
  const state = fresh('fill2');
  const me = userClub(state);
  toNextSeason(state, () => {
    const gks = me.squad.filter((id) => state.players[id].position === 'GK');
    const outfield = me.squad.filter((id) => state.players[id].position !== 'GK');
    me.squad = [gks[0], ...outfield.slice(0, 14)];
  });
  const squad = me.squad.map((id) => state.players[id]);
  assert.ok(squad.length >= 18 && squad.length <= 20, `${squad.length}명`);
  assert.ok(squad.filter((p) => p.position === 'GK').length >= 2);
});

test('시즌 끝 보충: AI 구단은 빈자리를 자유계약 선수로 먼저 채운다', () => {
  const state = fresh('fill3');
  toNextSeason(state);
  const signedFree = Object.values(state.players).filter((p) => (p.transfers ?? []).some((t) => !t.from && t.date >= '2027-06-01' && t.date <= '2027-06-30'));
  assert.ok(signedFree.length >= 10, `${signedFree.length}명`);
});

test('AI 구단끼리 임대: 여름에 어린 후보 선수를 수준 낮은 구단으로 보내고, 시즌이 끝나면 돌아온다', () => {
  const state = fresh('ailoan');
  const me = userClub(state).id;
  runUntil(state, '2026-09-01');
  const loaned = Object.values(state.players).filter((p) => p.loan && p.loan.from !== me && p.loan.to !== me);
  assert.ok(loaned.length >= 10, `AI 임대 ${loaned.length}건`);
  for (const p of loaned) {
    assert.ok(state.clubs[p.loan.to].level < state.clubs[p.loan.from].level);
    assert.ok(state.clubs[p.loan.to].squad.includes(p.id));
  }
  const owners = new Map(loaned.map((p) => [p.id, p.loan.from]));
  toNextSeason(state);
  // 원래 구단으로 돌아갔다. 돌아온 뒤 정리돼 다른 구단으로 갔다면 이적 기록이 남는다
  for (const [id, owner] of owners) {
    const p = state.players[id];
    if (!p?.clubId || p.loan?.until > '2027-06-30') continue;
    assert.ok(p.clubId === owner || (p.transfers ?? []).some((t) => t.date >= '2027-06-30'), p.name);
    assert.ok(!p.loan || p.loan.until > '2027-06-30');
  }
});
