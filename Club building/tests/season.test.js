import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { LEAGUES, COUNTRIES } from '../js/data/countries/index.js';
import { overall, ageOn } from '../js/core/player.js';
import { Rng } from '../js/core/rng.js';
import { monthlyDelta, isHomegrownYouth, retirementChance } from '../js/core/development.js';
import { YOUTH_CAP } from '../js/core/season.js';

// 한 시즌을 끝까지 돌린 세계를 테스트끼리 같이 쓴다 (약 10초)
const state = g.createNewGame('season-test');
const userId = Object.values(state.clubs).find((c) => c.leagueId === 'ENG3').id;
g.chooseClub(state, userId, '테스트');
g.simulateToSeasonEnd(state);
const before = structuredClone(state);
const tablesBefore = Object.fromEntries(Object.keys(LEAGUES).map((id) => [id, g.standings(before, id)]));
const summary = g.startNextSeason(state);

test('시즌 중: 3월 유스 입단, 부상 발생, 경기 기록', () => {
  const active = Object.values(before.clubs).filter((c) => c.status === 'active');
  assert.ok(active.every((c) => c.youth.length >= 4), '모든 구단에 유스가 들어왔다');
  const injuredEver = Object.values(before.players).filter((p) => p.injury).length;
  assert.ok(injuredEver > 0, '시즌 끝에 부상자가 있다');
  assert.ok(before.inbox.some((m) => m.title.startsWith('유스 입단')));
});

test('승강: 부마다 3팀씩, 3부 하위 3팀은 보관되고 새 구단이 올라온다', () => {
  for (const country of Object.values(COUNTRIES)) {
    const [t1, t2, t3] = country.leagues.map((l) => l.id);
    for (const r of tablesBefore[t1].slice(-3)) assert.equal(state.clubs[r.clubId].leagueId, t2);
    for (const r of tablesBefore[t2].slice(0, 3)) assert.equal(state.clubs[r.clubId].leagueId, t1);
    for (const r of tablesBefore[t2].slice(-3)) assert.equal(state.clubs[r.clubId].leagueId, t3);
    for (const r of tablesBefore[t3].slice(0, 3)) assert.equal(state.clubs[r.clubId].leagueId, t2);
    for (const r of tablesBefore[t3].slice(-3)) {
      if (r.clubId === userId) continue;
      assert.equal(state.clubs[r.clubId].status, 'archived');
    }
  }
  for (const rule of Object.values(LEAGUES)) {
    const clubs = Object.values(state.clubs).filter((c) => c.status === 'active' && c.leagueId === rule.id);
    assert.equal(clubs.length, rule.teams, rule.id);
    assert.equal(state.competitions[rule.id].clubIds.length, rule.teams);
    assert.equal(state.competitions[rule.id].fixtures.length, rule.teams * (rule.teams - 1));
  }
  assert.equal(new Set(Object.values(state.clubs).map((c) => c.name)).size, Object.keys(state.clubs).length, '구단 이름 중복 없음');
  assert.equal(summary.added.length, 15);
});

test('새 시즌: 날짜·시즌·기록·누적 경고', () => {
  assert.equal(state.season, before.season + 1);
  assert.equal(state.date, `${state.season}-07-01`);
  assert.equal(state.history.length, 1);
  assert.ok(state.history[0].leagues.ENG1.champion);
  assert.ok(Object.values(state.discipline).every((comp) => Object.values(comp).every((r) => r.yellows === 0)));
  assert.ok(state.previousCompetitions.ENG1.fixtures.every((f) => f.result));
});

test('선수단: 모든 구단 25명, 유스는 정원 이하·21세 이하, 은퇴 선수는 구단 없음', () => {
  for (const club of Object.values(state.clubs).filter((c) => c.status === 'active')) {
    assert.equal(club.squad.length, 25, club.name);
    assert.ok(club.youth.length <= YOUTH_CAP);
    for (const id of club.youth) assert.ok(ageOn(state.players[id], state.date) <= 22);
    for (const id of [...club.squad, ...club.youth]) assert.equal(state.players[id].clubId, club.id);
  }
  for (const p of Object.values(state.players).filter((x) => x.retired)) assert.equal(p.clubId, null);
});

test('3부 하위로 끝난 내 구단: 강등이면 새 구단 선택, 아니면 계속', () => {
  const myPos = tablesBefore.ENG3.findIndex((r) => r.clubId === userId);
  if (myPos >= tablesBefore.ENG3.length - 3) {
    assert.equal(state.phase, 'chooseJob');
    const offers = g.jobOffers(state);
    assert.ok(offers.length > 0 && offers.every((c) => LEAGUES[c.leagueId].tier === 3));
    g.chooseNewClub(state, offers[0].id);
    assert.equal(state.phase, 'season');
  } else {
    assert.equal(state.phase, 'season');
  }
  assert.equal(state.manager.history.length, 1);
});

test('성장: 출장하는 어린 선수는 크고, 서른 넘으면 떨어진다', () => {
  const rng = Rng.fromSeed('d');
  const young = { potential: 80, position: 'ST', attrs: Object.fromEntries(Object.keys(before.players[Object.keys(before.players)[0]].attrs).map((k) => [k, 12])) };
  const played = monthlyDelta(rng, young, 19, { minutes: 360 });
  const benched = monthlyDelta(rng, young, 19, { minutes: 0 });
  assert.ok(played > 0 && benched > 0);
  assert.ok(monthlyDelta(Rng.fromSeed('x'), young, 19, { minutes: 360 }) > monthlyDelta(Rng.fromSeed('x'), young, 19, { minutes: 0 }));
  assert.ok(monthlyDelta(rng, young, 33) < 0);
  assert.equal(retirementChance(28, 70), 0);
  assert.equal(retirementChance(39, 70), 1);
});

test('유스 콜업 예외: 21세 이하이고 유스 2년 이상', () => {
  const p = { birthDate: '2010-05-01', youthSince: '2026-03-15' };
  assert.equal(isHomegrownYouth(p, '2027-03-14'), false);
  assert.equal(isHomegrownYouth(p, '2028-03-15'), true);
  assert.equal(isHomegrownYouth(p, '2032-06-01'), false);
  assert.equal(isHomegrownYouth({ birthDate: '2008-01-01', youthSince: null }, '2028-01-01'), false);
});

test('부상 선수는 경기 명단에 없다', () => {
  if (state.phase !== 'season') return;
  const club = g.userClub(state);
  const hurt = club.squad.slice(0, 3);
  for (const id of hurt) state.players[id].injury = { name: '테스트', since: state.date, until: '2099-01-01', days: 999 };
  g.advance(state);
  const match = g.startUserMatch(state);
  const ids = match.sides.flatMap((s) => [...s.onPitch.map((x) => x.playerId), ...s.bench]);
  for (const id of hurt) assert.ok(!ids.includes(id));
});
