import { test } from 'node:test';
import { totalCount, MAX_TOTAL } from '../js/core/registration.js';
import assert from 'node:assert/strict';
import {
  createNewGame, chooseLeague, userClub, playerInfo, searchPlayers, bidForPlayer, offerTerms,
  advance, simulateUserMatch, finishUserMatch, respondToOffer, setTransferListed, suggestedCounter,
} from '../js/core/game.js';
import { ageOn } from '../js/core/player.js';
import { overall } from '../js/core/player.js';

// 7월 1일, 이적시장이 열린 상태로 시작하는 내 구단
const fresh = (seed = 'tr') => {
  const state = createNewGame(seed);
  chooseLeague(state, 'ENG1', '테스트');
  return state;
};
const otherPlayer = (state, pick = (p) => true) => {
  const me = userClub(state).id;
  return Object.values(state.players).find((p) => p.clubId && p.clubId !== me && pick(p));
};

test('다른 구단 선수는 현재 능력과 자리별 능력만 보이고, 세부 능력치는 숨고 잠재력은 범위로 보인다', () => {
  const state = fresh();
  const p = otherPlayer(state);
  const info = playerInfo(state, p.id);
  assert.equal(info.own, false);
  assert.equal(info.overall, overall(p));
  assert.equal(info.attrs, undefined);
  assert.equal(info.potential, undefined);
  const [lo, hi] = info.potentialRange;
  assert.ok(lo <= p.potential && p.potential <= hi);
  assert.ok(info.ratings.some((r) => r.pos === p.position && r.rating === overall(p)));
});

test('우리 선수는 세부 능력치와 정확한 잠재력이 보인다', () => {
  const state = fresh();
  const p = state.players[userClub(state).squad[0]];
  const info = playerInfo(state, p.id);
  assert.equal(info.own, true);
  assert.deepEqual(info.attrs, p.attrs);
  assert.equal(info.potential, p.potential);
});

test('스카우트 수준이 높을수록 잠재력 범위가 좁고, 같은 수준에서는 다시 봐도 범위가 같다', () => {
  const state = fresh();
  const p = otherPlayer(state, (q) => q.potential < 89 && q.potential - overall(q) >= 10);
  const club = userClub(state);
  club.staff.scout = 1;
  const [lo1, hi1] = playerInfo(state, p.id).potentialRange;
  assert.deepEqual(playerInfo(state, p.id).potentialRange, [lo1, hi1]);
  club.staff.scout = 20;
  const [lo20, hi20] = playerInfo(state, p.id).potentialRange;
  assert.ok(hi20 - lo20 <= 2);
  assert.ok(hi1 - lo1 >= 12);
});

test('검색: 조건에 맞는 다른 구단 선수만 능력 높은 순으로, 몸값과 함께 나온다', () => {
  const state = fresh();
  const rows = searchPlayers(state, { position: 'ST', maxAge: 23, leagueId: 'GER1' });
  assert.ok(rows.length > 0);
  for (const r of rows) {
    const p = state.players[r.id];
    assert.equal(p.position, 'ST');
    assert.ok(ageOn(p, state.date) <= 23);
    assert.equal(state.clubs[p.clubId].leagueId, 'GER1');
    assert.ok(r.value > 0);
  }
  assert.deepEqual(rows.map((r) => r.overall), rows.map((r) => r.overall).sort((a, b) => b - a));
  const mine = new Set(userClub(state).squad);
  assert.ok(searchPlayers(state, {}).every((r) => !mine.has(r.id)));
});

test('검색: 몸값 상한을 넘는 선수는 빠진다', () => {
  const state = fresh();
  const cap = 30e8;
  const rows = searchPlayers(state, { maxValue: cap });
  assert.ok(rows.length > 0 && rows.every((r) => r.value <= cap));
});

const rich = (state) => {
  userClub(state).finance.transferBudget = 1e13;
  return state;
};

test('이적료: 낮게 부르면 역제안이 오고, 세 번 실패하면 이번 시장에서는 결렬된다', () => {
  const state = rich(fresh());
  const p = otherPlayer(state);
  const first = bidForPlayer(state, p.id, 1e6);
  assert.equal(first.ok, false);
  assert.ok(first.counter > 1e6);
  bidForPlayer(state, p.id, 1e6);
  const third = bidForPlayer(state, p.id, 1e6);
  assert.equal(third.ok, false);
  assert.equal(third.counter, undefined);
  assert.equal(bidForPlayer(state, p.id, 1e12).ok, false); // 결렬 뒤에는 큰 금액도 안 받는다
});

test('이적료: 역제안 금액을 받아들이면 개인 조건 협상으로 넘어간다', () => {
  const state = rich(fresh());
  const p = otherPlayer(state);
  const { counter } = bidForPlayer(state, p.id, 1e6);
  assert.deepEqual(bidForPlayer(state, p.id, counter), { ok: true, stage: 'terms', fee: counter });
});

test('이적료: 이적 예산을 넘거나 이적시장이 닫혀 있으면 제안할 수 없다', () => {
  const state = fresh();
  const p = otherPlayer(state);
  userClub(state).finance.transferBudget = 5e8;
  assert.match(bidForPlayer(state, p.id, 6e8).reason, /예산/);
  state.date = '2026-10-01';
  assert.match(bidForPlayer(state, p.id, 1e8).reason, /이적시장/);
});

// 이적료 합의까지 마친 상태 (등록 자리 하나를 비워 둔다)
const agreed = (seed) => {
  const state = rich(fresh(seed));
  const me = userClub(state);
  me.squad.pop();
  me.finance.wageBudget = 1e13;
  const p = otherPlayer(state, (q) => state.clubs[q.clubId].reputation <= me.reputation);
  const { counter } = bidForPlayer(state, p.id, 1e6);
  bidForPlayer(state, p.id, counter);
  return { state, me, p, fee: counter, seller: state.clubs[p.clubId] };
};
const generous = { wage: 1e10, years: 3, promise: 'starter' };

test('개인 조건이 맞으면 이적이 끝난다: 소속, 계약, 잔고, 장부, 이적 예산이 바뀐다', () => {
  const { state, me, p, fee, seller } = agreed();
  const [myBal, myBudget, sellBal, sellBudget] = [me.finance.balance, me.finance.transferBudget, seller.finance.balance, seller.finance.transferBudget];
  const res = offerTerms(state, p.id, generous);
  assert.equal(res.ok, true);
  assert.equal(p.clubId, me.id);
  assert.ok(me.squad.includes(p.id) && !seller.squad.includes(p.id));
  assert.deepEqual([p.contract.wage, p.contract.promise, p.contract.until], [1e10, 'starter', '2029-06-30']);
  assert.equal(me.finance.balance, myBal - fee);
  assert.equal(me.finance.transferBudget, Math.min(myBudget - fee, me.finance.balance)); // 이적 예산은 잔고를 넘지 않는다
  assert.equal(me.finance.season.expense.transfers, fee);
  assert.equal(seller.finance.balance, sellBal + fee);
  assert.equal(seller.finance.season.income.transfers, fee);
  assert.equal(seller.finance.transferBudget, sellBudget + fee); // 흑자 구단은 판 돈 전부를 예산에 더한다
});

test('개인 조건: 이적료 합의 전에는 협상할 수 없고, 주급이 낮으면 거절하며 세 번이면 결렬된다', () => {
  const { state, p } = agreed();
  const stranger = otherPlayer(state, (q) => q.id !== p.id);
  assert.match(offerTerms(state, stranger.id, generous).reason, /이적료/);
  const low = { wage: 1e4, years: 3, promise: 'backup' };
  assert.equal(offerTerms(state, p.id, low).ok, false);
  offerTerms(state, p.id, low);
  assert.match(offerTerms(state, p.id, low).reason, /결렬/);
  assert.equal(offerTerms(state, p.id, generous).ok, false);
});

test('개인 조건: 우리 구단 평판이 크게 낮으면 선수가 거절한다', () => {
  const { state, me, p } = agreed();
  me.reputation = state.clubs[p.clubId].reputation - 30;
  assert.match(offerTerms(state, p.id, generous).reason, /평판|수준/);
  assert.notEqual(p.clubId, me.id);
});

test('개인 조건: 등록 25명이 꽉 차도 영입은 되고 새 선수는 미등록이 될 수 있으며, 선수단 30명이면 영입할 수 없다', () => {
  const { state, me, p } = agreed();
  const filler = (n) => {
    for (let i = 0; i < n; i++) {
      me.squad.push(`filler${i}`);
      state.players[`filler${i}`] = { ...state.players[me.squad[0]], id: `filler${i}`, birthDate: '1995-01-01', youthSince: undefined };
    }
  };
  filler(MAX_TOTAL - totalCount(state, me, state.date));
  assert.match(offerTerms(state, p.id, generous).reason, /30명/);
});

test('자유계약 선수: 이적시장이 닫혀 있어도 이적료 없이 개인 조건만으로 영입한다', () => {
  const state = fresh();
  const me = userClub(state);
  me.squad.pop();
  me.finance.wageBudget = 1e13;
  const p = otherPlayer(state);
  const old = state.clubs[p.clubId];
  old.squad = old.squad.filter((id) => id !== p.id);
  Object.assign(p, { clubId: null, contract: null, freeSince: '2026-06-30' });
  state.date = '2026-10-01';
  const balance = me.finance.balance;
  assert.ok(searchPlayers(state, { freeOnly: true }).some((r) => r.id === p.id && r.value === 0));
  assert.deepEqual(offerTerms(state, p.id, generous), { ok: true, fee: 0, unregistered: [] });
  assert.equal(p.clubId, me.id);
  assert.equal(p.freeSince, undefined);
  assert.equal(me.finance.balance, balance);
});

// 이적 목록에 올린 선수 둘을 두고, 제안이 올 때까지 진행한다
const untilOffer = (state) => {
  for (;;) {
    const res = advance(state);
    if (res.stop === 'transferOffer') return res.offer;
    if ((res.stop !== 'week' && res.stop !== 'decision') || state.date > '2026-08-31') return null;
  }
};
const listed = (seed) => {
  const state = fresh(seed);
  const me = userClub(state);
  for (const id of me.squad.slice(0, 2)) setTransferListed(state, id, true);
  const offer = untilOffer(state);
  return { state, me, offer, p: state.players[offer.playerId], buyer: state.clubs[offer.clubId] };
};

test('AI 제안: 이적시장 중 내 선수에게 제안이 오면 계속 진행이 멈추고 메시지가 온다', () => {
  const { state, me, offer, buyer } = listed('o1');
  assert.ok(offer.fee > 0);
  assert.notEqual(buyer.id, me.id);
  assert.ok(state.transfers.incoming.some((o) => o.id === offer.id));
  assert.ok(state.inbox.some((m) => m.important && m.title.includes('이적 제안')));
});

test('AI 제안 수락: 선수가 떠나고 이적료 전부가 잔고와 이적 예산에 들어온다', () => {
  const { state, me, offer, p, buyer } = listed('o2');
  me.finance.balance = 1e10;
  const budget = me.finance.transferBudget;
  assert.equal(respondToOffer(state, offer.id, 'accept').ok, true);
  assert.equal(p.clubId, buyer.id);
  assert.ok(!me.squad.includes(p.id) && buyer.squad.includes(p.id));
  assert.equal(me.finance.balance, 1e10 + offer.fee);
  assert.equal(me.finance.transferBudget, budget + offer.fee);
  assert.ok(p.contract.wage > 0);
  assert.equal(state.transfers.incoming.length, 0);
});

test('AI 제안 수락: 잔고가 마이너스면 빚을 먼저 갚고 남는 돈만 예산에 더한다', () => {
  const { state, me, offer } = listed('o3');
  me.finance.balance = -offer.fee / 2;
  const budget = me.finance.transferBudget;
  respondToOffer(state, offer.id, 'accept');
  assert.equal(me.finance.transferBudget, budget + offer.fee / 2);
});

test('AI 제안 거절: 선수가 남고 제안이 사라진다', () => {
  const { state, me, offer, p } = listed('o4');
  assert.equal(respondToOffer(state, offer.id, 'reject').ok, true);
  assert.equal(p.clubId, me.id);
  assert.ok(!state.transfers.incoming.some((o) => o.id === offer.id));
});

test('AI 제안 역제안: 조금 올리면 그 금액에 사 가고, 너무 올리면 제안을 거둔다', () => {
  const a = listed('o5');
  const res = respondToOffer(a.state, a.offer.id, { counter: a.offer.fee * 1.1 });
  assert.equal(res.ok, true);
  assert.equal(a.p.clubId, a.buyer.id);
  assert.equal(a.state.transfers.incoming.length, 0);
  const b = listed('o6');
  const res2 = respondToOffer(b.state, b.offer.id, { counter: b.offer.fee * 3 });
  assert.equal(res2.ok, false);
  assert.equal(b.p.clubId, b.me.id);
  assert.ok(!b.state.transfers.incoming.some((o) => o.id === b.offer.id));
});

test('AI 제안: 답하지 않으면 7일 뒤 자동으로 거절된다', () => {
  const { state, offer, p, me } = listed('o7');
  for (const id of me.squad) setTransferListed(state, id, false);
  const until = offer.expires;
  while (state.date <= until) {
    const res = advance(state);
    if (res.stop === 'userMatch') { simulateUserMatch(state); finishUserMatch(state); }
  }
  assert.ok(!state.transfers.incoming.some((o) => o.id === offer.id));
  assert.equal(p.clubId, me.id);
});

test('역제안 추천: 받은 이적료의 115%', () => {
  assert.equal(suggestedCounter({ fee: 10e8 }), 11.5e8);
});
