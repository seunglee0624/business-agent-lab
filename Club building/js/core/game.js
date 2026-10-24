// 게임 상태(state)와 진행. 화면은 이 함수들만 호출하고 state를 직접 바꾸지 않는다.

import { Rng } from './rng.js';
import { generateWorld, newIds } from './worldgen.js';
import { LEAGUES } from '../data/countries/index.js';
import { seasonStart, addDays, formatDate } from './calendar.js';
import { resolveLineup } from './tactics.js';
import { ageOn } from './player.js';
import { createMatch, simulateMatch, summarize, isFinished } from './match/engine.js';
import { applyMatchDiscipline } from './discipline.js';
import { withParticle } from './korean.js';
import { assignInjury, healOn, trainingInjuryRoll } from './injury.js';
import { monthlyDevelopment, youthIntake, isHomegrownYouth } from './development.js';
import { newCompetitions, processSeasonEnd, startSeason, seasonEndMessages, registeredCount } from './season.js';
import {
  withRng, addMessage, userClub, userLeagueId, league, standings, seasonStats, topScorers, isUnavailable,
  unavailableSet, activeClubs,
} from './state.js';

export { userClub, userLeagueId, league, standings, seasonStats, topScorers, isUnavailable, addMessage };

export const STATE_VERSION = 2;
export const START_YEAR = 2026;
export const MAX_SQUAD = 25;
export const YOUTH_INTAKE_DAY = '03-15';

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
    injury: false,
  },
};

// 세계를 만들고 구단 선택 단계의 state를 돌려준다
export function createNewGame(seed = String(Date.now())) {
  const rng = Rng.fromSeed(seed);
  const start = seasonStart(START_YEAR);
  const ids = newIds();
  const { clubs, players } = generateWorld(rng, { seasonStart: start, ids });
  const state = {
    version: STATE_VERSION,
    seed: String(seed),
    rngState: 0,
    season: START_YEAR,
    date: start,
    phase: 'chooseClub', // chooseClub | season | seasonEnd | chooseJob
    manager: null,
    settings: structuredClone(DEFAULT_SETTINGS),
    ids,
    clubs: Object.fromEntries(clubs.map((c) => [c.id, c])),
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    competitions: {},
    previousCompetitions: null,
    history: [],
    discipline: {},
    inbox: [],
    liveMatch: null,
  };
  state.competitions = newCompetitions(rng, state, START_YEAR);
  state.rngState = rng.state;
  return state;
}

export function chooseClub(state, clubId, managerName) {
  state.manager = { name: managerName, clubId, history: [] };
  state.phase = 'season';
  const club = state.clubs[clubId];
  addMessage(state, {
    title: `${club.name} 감독 부임`,
    body: `${managerName} 감독님, ${club.name}에 오신 것을 환영합니다. ${LEAGUES[club.leagueId].name} ${state.season}-${String(state.season + 1).slice(2)} 시즌 개막은 ${formatDate(league(state).fixtures[0].date)}입니다.`,
  });
}

// 3부에서 강등되어 계약이 끝난 뒤 새 구단을 고른다
export function chooseNewClub(state, clubId) {
  state.manager.clubId = clubId;
  state.phase = 'season';
  const club = state.clubs[clubId];
  addMessage(state, { title: `${club.name} 감독 부임`, body: `새 시즌을 ${club.name}에서 시작합니다.` });
}

// 강등으로 계약이 끝났을 때 고를 수 있는 구단: 모든 나라의 3부 구단
export function jobOffers(state) {
  return activeClubs(state).filter((c) => LEAGUES[c.leagueId].tier === 3);
}

// ---- 조회 ----

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

export function findFixture(state, fixtureId) {
  for (const comps of [state.competitions, state.previousCompetitions ?? {}]) {
    for (const comp of Object.values(comps)) {
      const f = comp.fixtures.find((x) => x.id === fixtureId);
      if (f) return f;
    }
  }
  return null;
}

// ---- 하루 진행 ----

function isOffSeason(date) {
  return date.slice(5, 7) === '06';
}

function dailyTick(state, rng, date) {
  const userId = state.manager?.clubId;
  const training = !isOffSeason(date);
  for (const club of Object.values(state.clubs)) {
    if (club.status !== 'active') continue;
    for (const id of club.squad) {
      const p = state.players[id];
      if (healOn(p, date)) {
        if (club.id === userId) addMessage(state, { title: `${p.name} 부상 회복`, body: `${withParticle(p.name, '가')} 부상에서 돌아왔습니다. 경기 감각을 찾는 데 시간이 조금 필요합니다.` });
      } else if (!p.injury) {
        p.condition = Math.min(100, p.condition + 4 + p.attrs.stamina * 0.3);
        if (training && trainingInjuryRoll(rng)) {
          const inj = assignInjury(rng, p, date, 'training');
          if (club.id === userId) addMessage(state, { title: `${p.name} 훈련 중 부상`, body: `${inj.name}, 약 ${inj.days}일 결장 예상` });
        }
      }
    }
  }
  if (date.endsWith('-01')) monthlyDevelopment(state, rng);
  if (date.slice(5) === YOUTH_INTAKE_DAY) {
    for (const club of activeClubs(state)) {
      const { players, golden } = youthIntake(state, rng, club);
      if (club.id === userId) {
        const best = players.slice().sort((a, b) => b.potential - a.potential)[0];
        addMessage(state, {
          title: golden ? '유스 입단: 황금 세대!' : '유스 입단',
          body: `${players.length}명이 U-21 팀에 입단했습니다. 가장 기대되는 선수는 ${best.name}(${best.position}, 잠재 ${best.potential})입니다.`,
          important: golden,
        });
      }
    }
  }
}

function moveTo(state, date) {
  withRng(state, (rng) => {
    while (state.date < date) {
      state.date = addDays(state.date, 1);
      dailyTick(state, rng, state.date);
    }
  });
}

// 다음으로 결정이 필요한 순간까지 진행한다.
// 돌려주는 값: { stop: 'userMatch', fixture } | { stop: 'seasonEnd' } | { stop: 현재 phase }
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

// ---- 경기 ----

function matchSetup(state, club, compId, auto, aiTactics) {
  const rule = LEAGUES[state.competitions[compId].ruleId];
  const unavailable = unavailableSet(state, compId, club);
  const { lineup, bench } = resolveLineup(club, state.players, { unavailable, benchSize: rule.benchSize });
  return { clubId: club.id, tactics: club.tactics, lineup, bench, auto, aiTactics };
}

function buildMatch(state, fixture, userAuto) {
  const userId = state.manager?.clubId;
  const rule = LEAGUES[state.competitions[fixture.competitionId].ruleId];
  const home = state.clubs[fixture.home];
  const away = state.clubs[fixture.away];
  return createMatch({
    id: fixture.id,
    competitionId: fixture.competitionId,
    date: fixture.date,
    home: matchSetup(state, home, fixture.competitionId, home.id === userId ? userAuto : true, home.id !== userId),
    away: matchSetup(state, away, fixture.competitionId, away.id === userId ? userAuto : true, away.id !== userId),
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
  const userId = state.manager?.clubId;
  for (const fixture of fixturesOn(state, date)) {
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
    if (!st.minutes && !st.injured) continue;
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
    p.minutesMonth = (p.minutesMonth ?? 0) + st.minutes;
    if (st.energyEnd !== null) p.condition = st.energyEnd;
    if (st.injured) {
      const inj = withRng(state, (rng) => assignInjury(rng, p, fixture.date, 'match'));
      if (p.clubId === userId) addMessage(state, { title: `${p.name} 부상`, body: `${inj.name}, 약 ${inj.days}일 결장 예상 (복귀 예정 ${formatDate(inj.until)})` });
    }
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

// ---- 시즌 ----

function endSeason(state) {
  if (state.phase === 'seasonEnd') return;
  state.phase = 'seasonEnd';
  const table = standings(state);
  const pos = table.findIndex((r) => r.clubId === state.manager.clubId) + 1;
  const champion = state.clubs[table[0].clubId];
  addMessage(state, {
    title: '시즌 종료',
    body: `${LEAGUES[userLeagueId(state)].name}에서 ${withParticle(champion.name, '가')} 우승했습니다. 우리 팀은 ${pos}위로 시즌을 마쳤습니다.`,
    important: true,
  });
}

// 시즌 종료 처리 후 7월 1일 새 시즌을 시작한다.
// 돌려주는 값: 시즌 요약. 내 구단이 리그를 떠났으면 phase가 'chooseJob'이 된다.
export function startNextSeason(state) {
  if (state.phase !== 'seasonEnd') throw new Error('시즌이 아직 끝나지 않았습니다.');
  moveTo(state, `${state.season + 1}-06-30`);
  const summary = withRng(state, (rng) => processSeasonEnd(state, rng));
  seasonEndMessages(state, summary);
  withRng(state, (rng) => startSeason(state, rng));
  moveTo(state, seasonStart(state.season));
  const lost = summary.move && summary.move.to === null;
  state.phase = lost ? 'chooseJob' : 'season';
  if (!lost) {
    addMessage(state, {
      title: `${state.season}-${String(state.season + 1).slice(2)} 시즌 시작`,
      body: `${LEAGUES[userLeagueId(state)].name} 개막은 ${formatDate(league(state).fixtures[0].date)}입니다.`,
    });
  }
  return summary;
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

// ---- 유스 ----

export function canCallUp(state, playerId) {
  const club = userClub(state);
  const p = state.players[playerId];
  if (!club.youth.includes(playerId)) return false;
  return isHomegrownYouth(p, state.date) || registeredCount(state, club, state.date) < MAX_SQUAD;
}

export function callUpYouth(state, playerId) {
  if (!canCallUp(state, playerId)) return false;
  const club = userClub(state);
  club.youth = club.youth.filter((id) => id !== playerId);
  club.squad.push(playerId);
  return true;
}

export function sendDownToYouth(state, playerId) {
  const club = userClub(state);
  const p = state.players[playerId];
  // 유스 출신 21세 이하만 다시 U-21 팀으로 내릴 수 있다
  if (!club.squad.includes(playerId) || !p.youthSince || ageOn(p, state.date) > 21) return false;
  club.squad = club.squad.filter((id) => id !== playerId);
  club.youth.push(playerId);
  if (club.tactics.lineup?.some((e) => e?.playerId === playerId)) club.tactics.lineup = null;
  return true;
}

export { registeredCount };
