import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { matchCrowd, matchGrade, seasonTicketDemand, recordHomeGate, forecast, forecastWidth } from '../js/core/tickets.js';
import { fanMonthly } from '../js/core/fans.js';
import { fansView } from '../js/ui/views.js';

function fresh(seed = 'tickets') {
  const state = g.createNewGame(seed);
  g.chooseLeague(state, 'ENG1', '테스트');
  return state;
}

test('티켓: 비쌀수록 관중이 줄고, 가족층이 많을수록 더 민감하다', () => {
  const state = fresh();
  const club = g.userClub(state);
  const ref = g.referencePrice(club, 'normal');
  const cheap = matchCrowd(club, 'normal', ref * 0.7, null, 20, 0).crowd;
  const dear = matchCrowd(club, 'normal', ref * 1.8, null, 20, 0).crowd;
  assert.ok(cheap > dear);
  const fans = g.fansOf(club);
  fans.shares = { loyal: 70, trendy: 10, family: 10, local: 10 };
  const loyalDrop = matchCrowd(club, 'normal', ref * 1.8, null, 20, 0).crowd;
  fans.shares = { loyal: 10, trendy: 10, family: 70, local: 10 };
  const familyDrop = matchCrowd(club, 'normal', ref * 1.8, null, 20, 0).crowd;
  assert.ok(familyDrop < loyalDrop);
  assert.ok(seasonTicketDemand(club, g.referenceSeasonTicket(club) * 0.6) > seasonTicketDemand(club, g.referenceSeasonTicket(club) * 1.6));
});

test('등급: 라이벌전과 빅매치를 가리고, 라이벌은 늘 한 구단', () => {
  const state = fresh();
  const club = g.userClub(state);
  const rival = g.rivalOf(state, club);
  assert.ok(rival && rival.id !== club.id);
  assert.equal(matchGrade(state, club, rival), 'rival');
  const top = Object.values(state.clubs).filter((c) => c.leagueId === club.leagueId && c.id !== club.id && c.id !== rival.id)
    .sort((a, b) => b.reputation - a.reputation)[0];
  assert.equal(matchGrade(state, club, top), 'big');
});

test('시즌권은 첫 리그 홈 경기에 확정되어 수입이 한 번 들어오고, 그 뒤 가격은 못 바꾼다', () => {
  const state = fresh();
  const club = g.userClub(state);
  const opp = Object.values(state.clubs).find((c) => c.leagueId === club.leagueId && c.id !== club.id);
  const before = club.finance.season.income.gate;
  recordHomeGate(state, club, opp, 10, 20, true);
  const t = g.ticketsOf(club);
  assert.ok(t.seasonSold > 0);
  assert.ok(club.finance.season.income.gate - before >= t.seasonSold * t.seasonPrice);
  assert.equal(g.setTicketPrice(state, 'season', 1e6).ok, false);
  assert.ok(g.setTicketPrice(state, 'big', 1e5).ok);
  assert.equal(t.history.length, 1);
});

test('비싼 티켓은 가족층 만족도를 깎고, 마케팅 담당 수준이 높으면 예상 범위가 좁다', () => {
  const state = fresh();
  const club = g.userClub(state);
  const fans = g.fansOf(club);
  fanMonthly(state, club, '2025-09-01', 1.5);
  assert.ok(fans.mood.family < 0);
  club.staff.marketing = 1;
  const wide = forecast(club, 'normal', g.referencePrice(club, 'normal'));
  club.staff.marketing = 20;
  const narrow = forecast(club, 'normal', g.referencePrice(club, 'normal'));
  assert.ok(wide.crowd[1] - wide.crowd[0] > narrow.crowd[1] - narrow.crowd[0]);
  assert.ok(Math.abs(forecastWidth(club) - 0.03) < 1e-9);
});

test('예전 저장 파일에는 마케팅 담당이 채워지고, 팬 탭에 티켓 카드가 보인다', () => {
  const state = fresh();
  for (const c of Object.values(state.clubs)) delete c.staff.marketing;
  g.upgradeState(state);
  assert.ok(Object.values(state.clubs).every((c) => c.staff.marketing >= 1));
  const html = fansView(state);
  for (const s of ['시즌권', '빅매치', '라이벌전', '가격 기록', 'data-change="ticketPrice"']) assert.ok(html.includes(s), s);
});

test('가격 범위: 기본 가격의 50%~200% 밖은 core가 거절하고, 화면 바도 같은 범위를 쓴다', () => {
  const state = fresh();
  const club = g.userClub(state);
  const ref = g.referencePrice(club, 'normal');
  assert.equal(g.setTicketPrice(state, 'normal', ref * 10).ok, false);
  assert.equal(g.setTicketPrice(state, 'normal', ref * 0.2).ok, false);
  assert.ok(g.setTicketPrice(state, 'normal', ref * 1.5).ok);
  const season = g.referenceSeasonTicket(club);
  assert.equal(g.setTicketPrice(state, 'season', season * 3).ok, false);
  const { min, max } = g.priceRange(club, 'normal');
  assert.equal(g.setTicketPrice(state, 'normal', min).ok, true);
  assert.equal(g.setTicketPrice(state, 'normal', max).ok, true);
  const html = fansView(state, {});
  assert.ok(html.includes(`data-grade="normal" min="${min}" max="${max}"`));
});
