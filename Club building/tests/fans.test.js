import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { fanMatchResult, fanMonthly, fanSeasonEnd, fanFactor } from '../js/core/fans.js';
import { attendanceRate } from '../js/core/finance.js';
import { fansView } from '../js/ui/views.js';

function fresh(seed = 'fans') {
  const state = g.createNewGame(seed);
  g.chooseLeague(state, 'ENG1', '테스트');
  return state;
}

test('팬층: 네 팬층 비율 합은 100, 평판 높은 구단일수록 유행층이 많다', () => {
  const state = fresh();
  const clubs = Object.values(state.clubs).filter((c) => c.leagueId === 'ENG1').sort((a, b) => b.reputation - a.reputation);
  for (const c of clubs) assert.equal(Object.values(g.fansOf(c).shares).reduce((s, x) => s + x, 0), 100);
  const top = g.fansOf(clubs[0]).shares;
  const bottom = g.fansOf(clubs[clubs.length - 1]).shares;
  assert.ok(top.trendy > bottom.trendy);
  assert.ok(top.local < bottom.local);
  assert.equal(g.fansOf(clubs[0]).satisfaction, 60);
});

test('만족도: 이기면 오르고 지면 내리며(강팀에게 진 경기는 조금씩), 만족도가 관중 비율을 바꾼다', () => {
  const state = fresh();
  const club = g.userClub(state);
  const opp = Object.values(state.clubs).find((c) => c.leagueId === club.leagueId && c.id !== club.id);
  const base = attendanceRate(club, null, 20);
  fanMatchResult(state, club, { goalsFor: 3, goalsAgainst: 0, opponent: opp });
  assert.ok(g.fansOf(club).satisfaction > 60);
  for (let i = 0; i < 100; i++) fanMatchResult(state, club, { goalsFor: 0, goalsAgainst: 2, opponent: opp });
  assert.ok(g.fansOf(club).satisfaction < 30);
  assert.ok(fanFactor(club) < 1);
  assert.ok(attendanceRate(club, null, 20) < base);
  assert.ok(fanMonthly(state, club, '2025-09-01').protest);
});

test('스타 영입은 유행층 만족도를 올리고, 시즌 끝에 유행층 비율이 늘어난다', () => {
  const state = fresh();
  const club = g.userClub(state);
  const f = g.fansOf(club);
  f.month.stars = 2; f.season.stars = 2;
  const before = f.shares.trendy;
  fanMonthly(state, club, '2025-09-01');
  assert.ok(f.mood.trendy > 0);
  fanSeasonEnd(state, club, 10);
  assert.ok(f.shares.trendy > before);
  assert.equal(Object.values(f.shares).reduce((s, x) => s + x, 0), 100);
});

test('팬 탭과 한 시즌 진행: 만족도 기록이 쌓이고 화면에 팬층이 보인다', () => {
  const state = fresh('fans-season');
  g.simulateToSeasonEnd(state);
  const f = g.fansOf(g.userClub(state));
  assert.ok(f.history.length > 0);
  assert.ok(f.satisfaction >= 0 && f.satisfaction <= 100);
  const html = fansView(state);
  for (const name of ['충성층', '유행층', '가족층', '지역층', '팬 만족도']) assert.ok(html.includes(name));
});

test('만족도: 약팀에게 지면 강팀에게 질 때보다 많이 내려가고, 매달 시작값 쪽으로 10% 돌아간다', () => {
  const state = fresh('fan-tier');
  const club = g.userClub(state);
  const peers = Object.values(state.clubs).filter((c) => c.leagueId === club.leagueId && c.id !== club.id);
  const strong = peers.sort((a, b) => b.reputation - a.reputation)[0];
  const f = g.fansOf(club);
  fanMatchResult(state, club, { goalsFor: 0, goalsAgainst: 1, opponent: strong });
  const afterStrong = 60 - f.satisfaction;
  f.satisfaction = 60; f.streak = 0;
  const weak = { reputation: club.reputation - 10 };
  fanMatchResult(state, club, { goalsFor: 0, goalsAgainst: 1, opponent: weak });
  assert.ok(60 - f.satisfaction > afterStrong * 3);
  f.satisfaction = 20;
  fanMonthly(state, club, '2026-08-01');
  assert.ok(f.satisfaction > 23);
});

test('새 시즌: 만족도가 시작값(60) 쪽으로 33% 돌아간다', async () => {
  const { fanSeasonEnd, fansOf, SEASON_RESET } = await import('../js/core/fans.js');
  const state = g.createNewGame('fan-reset');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  assert.equal(SEASON_RESET.ratio, 0.33);
  fansOf(club).satisfaction = 20;
  fanSeasonEnd(state, club, 10);
  assert.equal(fansOf(club).satisfaction, 33.2);
  fansOf(club).satisfaction = 90;
  fanSeasonEnd(state, club, 10);
  assert.equal(fansOf(club).satisfaction, 80.1);
});
