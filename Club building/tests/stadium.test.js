import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { stadiumDaily, rentalMonthly, takeEvent, eventStrength } from '../js/core/stadium.js';
import { mediaDaily } from '../js/core/media.js';
import { addDays } from '../js/core/calendar.js';
import { Rng } from '../js/core/rng.js';
import { fansView, sponsorsView } from '../js/ui/views.js';

function fresh(seed = 'stadium') {
  const state = g.createNewGame(seed);
  g.chooseLeague(state, 'ENG1', '테스트');
  return state;
}

test('경기장 행사: 홈 경기에 예약하면 비용이 나가고, 그 경기에서 관중과 팬 만족도가 오르며, 같은 행사를 반복하면 효과가 준다', () => {
  const state = fresh();
  const club = g.userClub(state);
  const [f1] = g.upcomingHomeFixtures(state);
  const before = club.finance.balance;
  const res = g.bookEvent(state, f1.id, 'fanDay');
  assert.ok(res.ok);
  assert.equal(club.finance.balance, before - res.cost);
  assert.equal(club.finance.season.expense.events, res.cost);
  assert.equal(g.bookEvent(state, f1.id, 'legends').ok, false, '한 경기에 행사 하나');
  const sat = g.fansOf(club).satisfaction;
  const ev = takeEvent(state, club, f1);
  assert.ok(ev.demand > 1);
  assert.ok(g.fansOf(club).satisfaction > sat);
  assert.equal(eventStrength(club, 'fanDay'), 0.5);
  assert.equal(eventStrength(club, 'legends'), 1);
  // 원정 경기에는 열 수 없다
  const away = Object.values(state.competitions).flatMap((c) => c.fixtures).find((f) => f.away === club.id && !f.result);
  assert.equal(g.bookEvent(state, away.id, 'halftime').ok, false);
});

test('경기장 행사: 진행하면 홈 경기 날 행사가 열리고 기록에 남는다', () => {
  const state = fresh('stadium2');
  const club = g.userClub(state);
  const [f1] = g.upcomingHomeFixtures(state);
  g.bookEvent(state, f1.id, 'halftime');
  while (!f1.result) g.advance(state, { skipOffers: true });
  assert.equal(f1.result.event, 'halftime');
  assert.equal(g.stadiumOf(club).events.history[0].kind, 'halftime');
  assert.deepEqual(g.stadiumOf(club).events.booked, {});
});

test('대관: 제안을 수락하면 그날 대관료가 들어오고 잔디가 상해 홈 전력이 떨어지며, 하루씩 회복한다', () => {
  const state = fresh('rental');
  const club = g.userClub(state);
  const rng = new Rng('r');
  let offers = [];
  for (let i = 0; i < 20 && !offers.length; i++) offers = rentalMonthly(state, rng, club, new Set());
  const offer = offers.find((o) => o.kind !== 'corporate') ?? offers[0];
  assert.ok(g.answerRental(state, offer.id, true).ok);
  state.date = offer.date;
  const income = club.finance.season.income.rental;
  const done = stadiumDaily(state, club);
  assert.equal(done.length, 1);
  assert.equal(club.finance.season.income.rental, income + offer.fee);
  const pitch = club.stadium.pitch;
  assert.ok(pitch < 100);
  assert.ok(g.pitchFactor(club) < 1);
  state.date = addDays(state.date, 1);
  stadiumDaily(state, club);
  assert.equal(club.stadium.pitch, pitch + 1);
});

test('대관: 잔디 보호 시스템은 경기장 3레벨부터 짓고, 다 지으면 대관해도 잔디가 상하지 않고 대관료가 오른다', () => {
  const state = fresh('system');
  const club = g.userClub(state);
  club.facilities.stadium = 2;
  assert.equal(g.buildPitchSystem(state).ok, false);
  club.facilities.stadium = 3;
  const res = g.buildPitchSystem(state);
  assert.ok(res.ok);
  assert.equal(g.buildPitchSystem(state).ok, false, '두 번 지을 수 없다');
  const fee = g.stadiumOf(club).rentals.offers.length;
  state.date = res.done;
  assert.ok(g.hasPitchSystem(state, club));
  const s = g.stadiumOf(club);
  s.rentals.booked.push({ id: 'x', kind: 'festival', date: state.date, fee: 1e8 });
  stadiumDaily(state, club);
  assert.equal(club.stadium.pitch, 100);
  assert.equal(s.rentals.history[0].damage, 0);
  assert.ok(fee >= 0);
});

test('SNS 캠페인: 비용·선수 피로가 들고, 기간 동안 해외 팬이 늘며, 끝나면 팬 반응이 들어오고, 1년 안에 반복하면 효과가 준다', () => {
  const state = fresh('media');
  const club = g.userClub(state);
  const fans = g.fansOf(club);
  const overseas = fans.overseas;
  const res = g.startCampaign(state, 'shortForm');
  assert.ok(res.ok);
  assert.ok(club.finance.season.expense.events > 0);
  assert.equal(g.startCampaign(state, 'shortForm').ok, false, '같은 캠페인은 동시에 못 한다');
  assert.ok(g.startCampaign(state, 'localTV').ok);
  assert.equal(g.startCampaign(state, 'youtube').ok, false, '동시에 2개까지');
  const c = res.campaign;
  state.date = addDays(c.start, 7);
  mediaDaily(state, club);
  assert.ok(fans.overseas > overseas && fans.overseas < overseas + c.gain + 1);
  state.date = c.end;
  const finished = mediaDaily(state, club);
  assert.ok(finished.some((x) => x.kind === 'shortForm'));
  assert.equal(fans.overseas >= overseas + c.gain, true);
  assert.equal(g.repeatFactor(state, club, 'shortForm'), 0.6);
  assert.equal(g.repeatFactor(state, club, 'documentary'), 1);
});

test('화면: 팬 탭에 행사·SNS, 스폰서 탭에 대관과 잔디 상태가 나온다', () => {
  const state = fresh('view');
  const club = g.userClub(state);
  rentalMonthly(state, new Rng('v'), club, new Set());
  const fid = g.upcomingHomeFixtures(state)[0].id;
  const html = fansView(state, { eventFixture: fid });
  assert.match(html, /경기장 행사/);
  assert.match(html, /SNS·미디어/);
  assert.match(html, /레전드 경기/);
  const sp = sponsorsView(state, {});
  assert.match(sp, /경기장 대관/);
  assert.match(sp, /잔디 상태/);
  assert.match(sp, /잔디 보호 시스템/);
});
