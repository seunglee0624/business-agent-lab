import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { LEAGUES, COUNTRIES } from '../js/data/countries/index.js';
import { overall, ageOn } from '../js/core/player.js';
import { Rng } from '../js/core/rng.js';
import { monthlyDelta, isHomegrownYouth, retirementChance } from '../js/core/development.js';
import { YOUTH_CAP } from '../js/core/season.js';

// 우리 다음 경기 날까지 주 단위로 진행한다
const toMatch = (s) => {
  let res;
  do res = g.advance(s, { skipOffers: true, watchMatches: true }); while (res.stop === 'week');
  return res;
};


// 한 시즌을 끝까지 돌린 세계를 테스트끼리 같이 쓴다 (약 10초)
const state = g.createNewGame('season-test');
g.chooseLeague(state, 'ENG3', '테스트');
const userId = state.user.clubId;
g.simulateToSeasonEnd(state);
// 1년 전에 풀린 자유계약 선수 (이번 시즌 끝에 은퇴 처리돼야 한다)
const someone = state.players[state.clubs[userId].squad[0]];
state.players.oldFree = { ...structuredClone(someone), id: 'oldFree', clubId: null, contract: null, freeSince: '2026-06-30' };
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

test('선수단: AI 구단 25명, 내 구단 18명 이상, 유스는 정원 이하·21세 이하, 은퇴 선수는 구단 없음', () => {
  for (const club of Object.values(state.clubs).filter((c) => c.status === 'active')) {
    if (club.id === state.user.clubId) assert.ok(club.squad.length >= 18 && club.squad.length <= 25, club.name);
    // 7월 1일 이적시장이 열리자마자 AI끼리 사고팔 수 있어 한두 명 차이는 있다
    else assert.ok(club.squad.length >= 23 && club.squad.length <= 25, `${club.name} ${club.squad.length}`);
    assert.ok(club.youth.length <= YOUTH_CAP);
    for (const id of club.youth) assert.ok(ageOn(state.players[id], state.date) <= 22);
    for (const id of [...club.squad, ...club.youth]) assert.equal(state.players[id].clubId, club.id);
  }
  for (const p of Object.values(state.players).filter((x) => x.retired)) assert.equal(p.clubId, null);
});

test('3부 하위로 끝나도 단장의 구단은 보관되지 않고 계속 맡는다', () => {
  assert.equal(state.phase, 'season');
  assert.equal(state.user.clubId, userId);
  assert.equal(state.clubs[userId].status, 'active');
  assert.equal(state.user.history.length, 1);
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
  toMatch(state);
  const match = g.startUserMatch(state);
  const ids = match.sides.flatMap((s) => [...s.onPitch.map((x) => x.playerId), ...s.bench]);
  for (const id of hurt) assert.ok(!ids.includes(id));
});

test('계약 만료 선수는 자유계약 선수로 남고, 자유계약 1년이 지나면 사라진다', () => {
  const free = Object.values(state.players).filter((p) => !p.clubId && !p.retired);
  assert.ok(free.length > 50, `자유계약 ${free.length}명`);
  // 시즌 끝 만료 선수, 또는 시즌 중 AI 구단이 정리한 선수
  assert.ok(free.every((p) => p.freeSince > `${before.season}-06-30` && p.freeSince <= state.date && !p.contract));
  // 떠난 선수는 자유계약으로 남거나, 다른 구단이 자유계약으로 데려갔다
  assert.ok(summary.leaving.every((p) => state.players[p.id]?.freeSince || state.players[p.id]?.clubId));
  assert.equal(state.players.oldFree, undefined);
});
