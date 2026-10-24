// 게임 상태(state)와 진행. 화면은 이 함수들만 호출하고 state를 직접 바꾸지 않는다.

import { Rng, hashSeed } from './rng.js';
import { generateLeague } from './worldgen.js';
import { PREMIER_LEAGUE } from '../data/england.js';
import { leagueMatchDates, seasonStart, daysBetween, formatDate } from './calendar.js';
import { generateLeagueFixtures } from './schedule.js';
import { resolveLineup } from './tactics.js';
import { createMatch, simulateMatch, summarize, isFinished } from './match/engine.js';
import { applyMatchDiscipline, unavailableFor } from './discipline.js';
import { computeStandings } from './standings.js';
import { withParticle } from './korean.js';

export const STATE_VERSION = 1;
export const START_YEAR = 2026;
export const RULES = { ENG1: PREMIER_LEAGUE };

export const DEFAULT_SETTINGS = {
  viewMode: 'highlights', // result | highlights | full
  autoSubs: true, // 경기 중 수석코치가 교체 (직접 교체도 가능)
  pauses: {
    halftime: true,
    conceded: true,
    ourRed: true,
    losingAt60: true,
    drawingAt75: false,
    theirRed: false,
    lowEnergy: false,
  },
};

function withRng(state, fn) {
  const rng = new Rng(state.rngState);
  const result = fn(rng);
  state.rngState = rng.state;
  return result;
}

// 세계를 만들고 구단 선택 단계의 state를 돌려준다
export function createNewGame(seed = String(Date.now())) {
  const rng = Rng.fromSeed(seed);
  const rule = PREMIER_LEAGUE;
  const start = seasonStart(START_YEAR);
  const { clubs, players } = generateLeague(rng, rule, { seasonStart: start });
  const dates = leagueMatchDates(START_YEAR, (rule.teams - 1) * 2);
  const fixtures = generateLeagueFixtures(rng, rule.id, clubs.map((c) => c.id), dates);
  return {
    version: STATE_VERSION,
    seed: String(seed),
    rngState: rng.state,
    season: START_YEAR,
    date: start,
    phase: 'chooseClub', // chooseClub | season | seasonEnd
    manager: null,
    settings: structuredClone(DEFAULT_SETTINGS),
    clubs: Object.fromEntries(clubs.map((c) => [c.id, c])),
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    competitions: {
      [rule.id]: { id: rule.id, ruleId: rule.id, name: rule.name, season: START_YEAR, clubIds: clubs.map((c) => c.id), fixtures },
    },
    discipline: {},
    inbox: [],
    liveMatch: null,
  };
}

export function chooseClub(state, clubId, managerName) {
  state.manager = { name: managerName, clubId };
  state.phase = 'season';
  const club = state.clubs[clubId];
  addMessage(state, {
    title: `${club.name} 감독 부임`,
    body: `${managerName} 감독님, ${club.name}에 오신 것을 환영합니다. 2026-27 시즌 개막은 ${formatDate(firstFixture(state).date)}입니다.`,
  });
}

export function addMessage(state, { title, body, important = false }) {
  state.inbox.unshift({ id: `m${hashSeed(`${state.date}${title}${state.inbox.length}`)}`, date: state.date, title, body, important, read: false });
}

// ---- 조회 ----

export const userClub = (state) => state.clubs[state.manager?.clubId];
export const league = (state) => state.competitions.ENG1;

function firstFixture(state) {
  return league(state).fixtures[0];
}

export function nextUnplayedDate(state) {
  let next = null;
  for (const comp of Object.values(state.competitions)) {
    for (const f of comp.fixtures) {
      if (!f.result && (!next || f.date < next)) next = f.date;
    }
  }
  return next;
}

export function fixturesOn(state, date) {
  return Object.values(state.competitions).flatMap((c) => c.fixtures.filter((f) => f.date === date && !f.result));
}

export function userFixtureOn(state, date) {
  const id = state.manager?.clubId;
  return fixturesOn(state, date).find((f) => f.home === id || f.away === id) ?? null;
}

export function nextUserFixture(state) {
  const id = state.manager?.clubId;
  return Object.values(state.competitions)
    .flatMap((c) => c.fixtures)
    .filter((f) => !f.result && (f.home === id || f.away === id))
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0] ?? null;
}

export function standings(state, compId = 'ENG1') {
  const comp = state.competitions[compId];
  return computeStandings(comp.fixtures, comp.clubIds, RULES[comp.ruleId]);
}

export function seasonStats(player, season, compId) {
  return player.stats[season]?.[compId] ?? null;
}

export function topScorers(state, compId = 'ENG1', n = 10) {
  return Object.values(state.players)
    .map((p) => ({ player: p, s: seasonStats(p, state.season, compId) }))
    .filter((x) => x.s && x.s.goals > 0)
    .sort((a, b) => b.s.goals - a.s.goals || b.s.assists - a.s.assists)
    .slice(0, n);
}

export function isUnavailable(state, compId, playerId) {
  return unavailableFor(state.discipline, compId).has(playerId);
}

// ---- 진행 ----

// 하루 회복: 체력이 좋을수록 빨리 회복한다
function recoverDays(state, days) {
  if (days <= 0) return;
  for (const p of Object.values(state.players)) {
    p.condition = Math.min(100, p.condition + days * (4 + p.attrs.stamina * 0.3));
  }
}

function moveTo(state, date) {
  recoverDays(state, daysBetween(state.date, date));
  state.date = date;
}

// 다음으로 결정이 필요한 순간까지 진행한다.
// 돌려주는 값: { stop: 'userMatch', fixture } | { stop: 'seasonEnd' }
export function advance(state) {
  if (state.phase !== 'season') return { stop: state.phase };
  for (;;) {
    const date = nextUnplayedDate(state);
    if (!date) {
      endSeason(state);
      return { stop: 'seasonEnd' };
    }
    if (date !== state.date) moveTo(state, date);
    const fixture = userFixtureOn(state, date);
    if (fixture) return { stop: 'userMatch', fixture };
    playOtherMatches(state, date);
  }
}

function matchSetup(state, club, compId, auto) {
  const rule = RULES[state.competitions[compId].ruleId];
  const unavailable = unavailableFor(state.discipline, compId);
  const { lineup, bench } = resolveLineup(club, state.players, { unavailable, benchSize: rule.benchSize });
  return { clubId: club.id, tactics: club.tactics, lineup, bench, auto };
}

function buildMatch(state, fixture, userAuto) {
  const userId = state.manager?.clubId;
  const rule = RULES[state.competitions[fixture.competitionId].ruleId];
  const home = state.clubs[fixture.home];
  const away = state.clubs[fixture.away];
  return createMatch({
    id: fixture.id,
    competitionId: fixture.competitionId,
    date: fixture.date,
    home: matchSetup(state, home, fixture.competitionId, home.id === userId ? userAuto : true),
    away: matchSetup(state, away, fixture.competitionId, away.id === userId ? userAuto : true),
    players: state.players,
    maxSubs: rule.maxSubs,
  });
}

// 내 경기를 시작한다. 화면에서 stepMinute로 진행한 뒤 finishUserMatch를 부른다.
export function startUserMatch(state) {
  const fixture = userFixtureOn(state, state.date);
  if (!fixture) throw new Error('오늘은 경기가 없습니다.');
  if (!state.liveMatch || state.liveMatch.id !== fixture.id) {
    state.liveMatch = buildMatch(state, fixture, state.settings.autoSubs);
  }
  return state.liveMatch;
}

export function withMatchRng(state, fn) {
  return withRng(state, fn);
}

// 내 경기를 바로 결과로 처리한다 (결과만 보기, 시즌 끝까지 진행)
export function simulateUserMatch(state) {
  const match = startUserMatch(state);
  for (const side of match.sides) side.auto = true;
  withRng(state, (rng) => simulateMatch(match, rng));
  return match;
}

export function finishUserMatch(state) {
  const match = state.liveMatch;
  if (!match || !isFinished(match)) throw new Error('경기가 끝나지 않았습니다.');
  const fixture = state.competitions[match.competitionId].fixtures.find((f) => f.id === match.id);
  applyResult(state, fixture, match);
  state.liveMatch = null;
  playOtherMatches(state, state.date);
  if (!nextUnplayedDate(state)) endSeason(state);
  return fixture;
}

function playOtherMatches(state, date) {
  for (const fixture of fixturesOn(state, date)) {
    const userId = state.manager?.clubId;
    if (fixture.home === userId || fixture.away === userId) continue;
    const match = buildMatch(state, fixture, true);
    withRng(state, (rng) => simulateMatch(match, rng));
    applyResult(state, fixture, match);
  }
}

function applyResult(state, fixture, match) {
  fixture.result = summarize(match);
  const compId = fixture.competitionId;
  const userId = state.manager?.clubId;

  for (const [pid, st] of Object.entries(match.stats)) {
    if (!st.minutes) continue;
    const p = state.players[pid];
    p.stats[state.season] ??= {};
    const s = (p.stats[state.season][compId] ??= {
      apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, yellows: 0, reds: 0, ratingSum: 0, ratingCount: 0,
    });
    s.apps++;
    if (st.started) s.starts++;
    s.minutes += st.minutes;
    s.goals += st.goals;
    s.assists += st.assists;
    s.yellows += st.yellow;
    if (st.red) s.reds++;
    s.ratingSum += st.rating;
    s.ratingCount++;
    if (st.energyEnd !== null) p.condition = st.energyEnd;
  }
  fixture.result.ratings = Object.fromEntries(
    Object.entries(match.stats).filter(([, st]) => st.minutes > 0).map(([pid, st]) => [pid, st.rating]),
  );

  const squadIds = [...state.clubs[fixture.home].squad, ...state.clubs[fixture.away].squad];
  const bans = applyMatchDiscipline(state.discipline, compId, squadIds, match.stats);
  for (const ban of bans) {
    if (state.players[ban.playerId].clubId !== userId) continue;
    const reason = { secondYellow: '경고 2장 퇴장', red: '레드카드', accumulation: '경고 5장 누적' }[ban.reason];
    addMessage(state, {
      title: `${state.players[ban.playerId].name} 출전 정지`,
      body: `${withParticle(reason, '로')} 다음 ${ban.games}경기에 나설 수 없습니다.`,
    });
  }
}

function endSeason(state) {
  if (state.phase === 'seasonEnd') return;
  state.phase = 'seasonEnd';
  const table = standings(state);
  const pos = table.findIndex((r) => r.clubId === state.manager.clubId) + 1;
  const champion = state.clubs[table[0].clubId];
  addMessage(state, {
    title: '시즌 종료',
    body: `${withParticle(champion.name, '가')} 우승했습니다. 우리 팀은 ${pos}위로 시즌을 마쳤습니다.`,
    important: true,
  });
}

// 시즌이 끝날 때까지 내 경기도 결과만으로 처리하며 진행한다
export function simulateToSeasonEnd(state) {
  for (;;) {
    const res = advance(state);
    if (res.stop !== 'userMatch') return res;
    simulateUserMatch(state);
    finishUserMatch(state);
  }
}
