import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { merchDaily, merchSeasonEnd, seasonDemand, designFit, autoKits } from '../js/core/merch.js';
import { fansView } from '../js/ui/views.js';

function fresh(seed = 'merch') {
  const state = g.createNewGame(seed);
  g.chooseLeague(state, 'ENG1', '테스트');
  return state;
}

test('유니폼 디자인: 팬층이 좋아하는 디자인이 더 팔리고, 마킹 선수가 떠나면 스타 마킹이 덜 팔린다', () => {
  const state = fresh();
  const club = g.userClub(state);
  g.fansOf(club).shares = { loyal: 70, trendy: 10, family: 10, local: 10 };
  assert.ok(designFit(state, club, 'classic') > designFit(state, club, 'modern'));
  const star = g.starPlayer(state, club) ?? state.players[club.squad[0]];
  const fit = designFit(state, club, 'star', star.id);
  star.clubId = 'gone';
  assert.ok(designFit(state, club, 'star', star.id) < fit);
});

test('주문하면 생산비가 나가고, 날마다 팔리며, 홈 경기 날 더 팔린다. 비싸면 덜 팔린다', () => {
  const state = fresh();
  const club = g.userClub(state);
  const cheap = seasonDemand(state, club, 'kitHome', { price: g.basePrice('kitHome') * 0.8 });
  const dear = seasonDemand(state, club, 'kitHome', { price: g.basePrice('kitHome') * 1.5 });
  assert.ok(cheap > dear);
  const bal = club.finance.balance;
  const res = g.orderMerch(state, 'kitHome', { quantity: 5000, price: g.basePrice('kitHome'), design: 'retro' });
  assert.ok(res.ok);
  assert.equal(club.finance.balance, bal - res.cost);
  const it = g.merchOf(club).items.kitHome;
  assert.equal(it.design, 'retro');
  merchDaily(state, club, 19, false);
  const normalDay = it.sold;
  merchDaily(state, club, 19, true);
  assert.ok(it.sold - normalDay > normalDay);
  assert.ok(club.finance.season.income.merch > 0);
  // 두 번째 주문은 추가 생산(30일 뒤), 세 번째는 안 된다
  const re = g.orderMerch(state, 'kitHome', { quantity: 100, price: it.price });
  assert.ok(re.ok && re.arrive > state.date);
  assert.equal(g.orderMerch(state, 'kitHome', { quantity: 100, price: it.price }).ok, false);
});

test('주문 안 한 유니폼은 자동 생산, 시즌 끝엔 재고 정리와 기록, 우승하면 한정판이 열린다', () => {
  const state = fresh();
  const club = g.userClub(state);
  assert.deepEqual(autoKits(state, club), ['홈 유니폼', '원정 유니폼']);
  assert.equal(g.orderMerch(state, 'limited', { quantity: 100, price: 2e5 }).ok, false);
  const before = club.finance.season.income.merch;
  merchSeasonEnd(state, club, state.season, '우승');
  assert.ok(club.finance.season.income.merch > before); // 재고 정리
  const m = g.merchOf(club);
  assert.ok(m.history[0].items.kitHome.leftover > 0);
  assert.equal(m.items.kitHome.ordered, false);
  assert.ok(g.orderMerch(state, 'limited', { quantity: 100, price: 2e5 }).ok);
});

test('한 시즌: 굿즈 수입이 생기고 팬 탭에 굿즈 카드가 보인다', () => {
  const state = fresh('merch-season');
  g.simulateToSeasonEnd(state);
  const f = g.userClub(state).finance;
  const total = f.season.income.merch + (f.history[0]?.income.merch ?? 0);
  assert.ok(total > 0);
  const html = fansView(state, { merchItem: 'kitHome' });
  for (const s of ['굿즈', '홈 유니폼', '머플러', '아동용품', 'merchOrder']) assert.ok(html.includes(s), s);
});

test('품절 임박: 남은 재고가 도착 기간보다 빨리 떨어질 것 같으면 한 번 경고하고, 주문이 도착하면 다시 경고할 수 있다', () => {
  const state = fresh('merch-warn');
  const club = g.userClub(state);
  const it = g.merchOf(club).items.scarf;
  it.stock = 5;
  const w = merchDaily(state, club, 19, false);
  assert.equal(w.length, 1);
  assert.equal(w[0].item, 'scarf');
  assert.equal(w[0].lead, 14);
  assert.equal(merchDaily(state, club, 19, false).filter((x) => x.item === 'scarf').length, 0);
  it.stock = 5;
  it.incoming = { quantity: 10, date: state.date };
  merchDaily(state, club, 19, false);
  assert.equal(it.warned, true); // 도착 후 다시 재고가 적어 새로 경고
});

test('굿즈: 품절 경고는 남은 홈 경기 날짜로 품절 날짜와 시즌 끝까지 예상 판매·주문할 양을 알려 준다', async () => {
  const { projectStock } = await import('../js/core/merch.js');
  const state = g.createNewGame('merch-proj');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  const it = g.merchOf(club).items.scarf;
  it.stock = 200;
  const homeDates = new Set(state.competitions[club.leagueId].fixtures.filter((f) => f.home === club.id).map((f) => f.date));
  const p = projectStock(state, club, 'scarf', homeDates, 19, 14);
  assert.ok(p.outDate && p.outDate > state.date);
  assert.ok(p.total > 200);
  assert.equal(p.shortfall, p.total - 200);
  assert.ok(p.suggest > 0 && p.suggest <= p.total);
  it.stock = 1e6;
  assert.equal(projectStock(state, club, 'scarf', homeDates, 19, 14).outDate, null);
});
