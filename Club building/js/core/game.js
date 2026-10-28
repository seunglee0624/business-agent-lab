// 게임 상태(state)와 진행. 화면은 이 함수들만 호출하고 state를 직접 바꾸지 않는다.

import { Rng } from './rng.js';
import { generateWorld, newIds } from './worldgen.js';
import { LEAGUES } from '../data/countries/index.js';
import { seasonStart, addDays, addMonths, formatDate, formatShortDate, daysBetween } from './calendar.js';
import { resolveLineup } from './tactics.js';
import * as transfers from './transfers.js';
import * as loans from './loans.js';
import { intensityOf } from './training.js';
import * as staffwork from './staffwork.js';
import { returnLoans } from './loans.js';
import * as coaches from './coaches.js';
import * as requests from './requests.js';
import { assignInitialCoaches } from './coaches.js';
import { ageOn, overall } from './player.js';
import { createMatch, simulateMatch, summarize, isFinished } from './match/engine.js';
import { applyMatchDiscipline } from './discipline.js';
import { withParticle } from './korean.js';
import { assignInjury, healOn, trainingInjuryRoll } from './injury.js';
import { monthlyDevelopment, youthIntake, isHomegrownYouth } from './development.js';
import { newCompetitions, processSeasonEnd, startSeason, seasonEndMessages, registeredCount, MAX_SQUAD } from './season.js';
import { initFinance, monthlySettlement, recordGate, weeklyWageBill, budgetRange as clubBudgetRange, adjustBudgets as clubAdjustBudgets } from './finance.js';
import { signNew, offerRenewal } from './contracts.js';
import { monthlyMorale } from './morale.js';
import {
  completeConstruction, requestUpgrade, injuryChanceFactor, injuryDaysFactor, recoveryFactor,
} from './facilities.js';
import { FACILITIES, STAFF, MAX_STAFF, staffWage, EUR } from '../data/economy.js';
import { roundMoney, won } from './money.js';
import { addNotice, unreadCount, markViewRead, markAllRead, openMessage,
  withRng, addMessage, userClub, userLeagueId, league, standings, seasonStats, topScorers, isUnavailable,
  unavailableSet, activeClubs, clubStrength,
} from './state.js';

export { userClub, userLeagueId, league, standings, seasonStats, topScorers, isUnavailable, addMessage, unreadCount, markViewRead, markAllRead, openMessage };

export const STATE_VERSION = 5;
export const START_YEAR = 2026;
export const YOUTH_INTAKE_DAY = '03-15';

export const DEFAULT_SETTINGS = {
  viewMode: 'result', // result | highlights | full (단장은 기본으로 결과만, 원하면 중계)
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
    phase: 'chooseClub', // chooseClub | season | seasonEnd
    user: null, // 단장 { name, clubId }
    settings: structuredClone(DEFAULT_SETTINGS),
    ids,
    clubs: Object.fromEntries(clubs.map((c) => [c.id, c])),
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    competitions: {},
    previousCompetitions: null,
    history: [],
    discipline: {},
    inbox: [],
    // 이적: deals[playerId] = 내가 진행 중인 영입 협상, incoming = AI 구단이 내 선수에게 보낸 제안
    transfers: { deals: {}, incoming: [], nextOfferId: 1 },
    liveMatch: null,
  };
  state.competitions = newCompetitions(rng, state, START_YEAR);
  assignInitialCoaches(rng, state); // 감독 주급이 첫 주급 예산에 들어가도록 재정보다 먼저
  for (const club of Object.values(state.clubs)) initFinance(rng, state, club);
  state.rngState = rng.state;
  return state;
}

// 리그에서 가장 약한 구단 (새 게임에서 맡게 될 구단)
export function weakestClub(state, leagueId) {
  return activeClubs(state).filter((c) => c.leagueId === leagueId)
    .sort((a, b) => clubStrength(state, a) - clubStrength(state, b))[0];
}

// 리그를 고르면 그 리그에서 가장 약한 구단의 단장이 된다
export function chooseLeague(state, leagueId, name) {
  chooseClub(state, weakestClub(state, leagueId).id, name);
}

function chooseClub(state, clubId, name) {
  const club = state.clubs[clubId];
  state.user = { name, clubId, history: [] };
  state.phase = 'season';
  addMessage(state, {
    title: `${club.name} 단장 부임`,
    body: `${name} 단장님, ${club.name}에 오신 것을 환영합니다. ${LEAGUES[club.leagueId].name} ${state.season}-${String(state.season + 1).slice(2)} 시즌 개막은 ${formatDate(league(state).fixtures[0].date)}입니다.`,
  });
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
  const id = state.user?.clubId;
  return fixturesOn(state, date).find((f) => f.home === id || f.away === id) ?? null;
}

export function nextUserFixture(state) {
  const id = state.user?.clubId;
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
  const userId = state.user?.clubId;
  const training = !isOffSeason(date);
  const user = userId ? state.clubs[userId] : null;
  if (user) {
    const next = nextUserFixture(state);
    staffwork.coachTraining(state, user, next ? daysBetween(date, next.date) : Infinity);
  }
  if (user && isMonday(date)) {
    const made = requests.makeRequests(state, rng, user);
    if (made.length) addMessage(state, { view: 'transfers', title: '감독의 영입 요청', body: `${user.headCoach.name} 감독이 ${made.length}명의 영입을 요청했습니다. 이적 화면에서 승인하거나 거절하세요.`, important: true });
    weeklyStaffWork(state, user);
    weeklySummary(state, user);
  }
  for (const club of Object.values(state.clubs)) {
    if (club.status !== 'active') continue;
    const recovery = recoveryFactor(club) * intensityOf(club).recovery;
    const injuryChance = injuryChanceFactor(club) * intensityOf(club).injury;
    completeConstruction(state, club, club.id === userId);
    for (const id of club.squad) {
      const p = state.players[id];
      if (healOn(p, date)) {
        if (club.id === userId) addNotice(state, { title: `${p.name} 부상 회복`, body: `${withParticle(p.name, '가')} 부상에서 돌아왔습니다. 경기 감각을 찾는 데 시간이 조금 필요합니다.` });
      } else if (!p.injury) {
        p.condition = Math.min(100, p.condition + (4 + p.attrs.stamina * 0.3) * recovery);
        if (training && trainingInjuryRoll(rng, injuryChance)) {
          const inj = assignInjury(rng, p, date, 'training', injuryDaysFactor(club));
          if (club.id === userId) addNotice(state, { title: `${p.name} 훈련 중 부상`, body: `${inj.name}, 약 ${inj.days}일 결장 예상` });
        }
      }
    }
  }
  if (date.endsWith('-01')) monthlyTick(state, rng, date);
  transfers.dailyAiTransfers(state, rng, userId);
  loans.dailyAiLoans(state, rng, userId);
  const offer = userId ? transfers.dailyOffers(state, rng, state.clubs[userId]) : null;
  // 재정은 매달 마지막 날 정산한다 (6월분이 그 시즌 장부에 들어가도록)
  if (addDays(date, 1).endsWith('-01')) for (const club of activeClubs(state)) monthlySettlement(state, club);
  if (date.slice(5) === YOUTH_INTAKE_DAY) {
    for (const club of activeClubs(state)) {
      const { players, golden } = youthIntake(state, rng, club);
      if (club.id === userId) {
        const best = players.slice().sort((a, b) => b.potential - a.potential)[0];
        addMessage(state, {
          view: 'youth', title: golden ? '유스 입단: 황금 세대!' : '유스 입단',
          body: `${players.length}명이 U-21 팀에 입단했습니다. 가장 기대되는 선수는 ${best.name}(${best.position}, 잠재 ${best.potential})입니다.`,
          important: golden,
        });
      }
    }
  }
  return offer;
}

const isMonday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 1;

// 매주 월요일: 지난주 우리 경기, 순위, 모아 둔 알림을 메시지 하나로 보낸다
function weeklySummary(state, club) {
  const from = addDays(state.date, -7);
  const results = Object.values(state.competitions).flatMap((c) => c.fixtures)
    .filter((f) => f.result && f.date >= from && f.date < state.date && (f.home === club.id || f.away === club.id))
    .map((f) => {
      const home = f.home === club.id;
      const opp = state.clubs[home ? f.away : f.home].name;
      const [mine, theirs] = home ? [f.result.home, f.result.away] : [f.result.away, f.result.home];
      return `${mine > theirs ? '승' : mine < theirs ? '패' : '무'} ${mine}-${theirs} ${home ? 'vs' : '@'} ${opp}`;
    });
  const table = standings(state);
  const row = table.find((r) => r.clubId === club.id);
  const notices = state.notices ?? [];
  if (!results.length && !notices.length) return; // 아무 일 없던 주는 건너뛴다
  const lines = [
    results.length ? `지난주 경기: ${results.join(', ')}` : '지난주 경기 없음',
    ...(row.played ? [`리그 순위 ${table.indexOf(row) + 1}위 (${row.points}점)`] : []),
    ...notices.map((n) => `· ${n.title}: ${n.body}`),
  ];
  addMessage(state, { title: `주간 요약 (${formatShortDate(from)}~)`, body: lines.join('\n') });
  state.notices = [];
}

// 매주 월요일: 유스 콜업과 주전이 아닌 선수 재계약을 스태프가 처리한다
function weeklyStaffWork(state, club) {
  for (const p of staffwork.youthToCallUp(state, club)) {
    if (!callUpYouth(state, p.id)) break;
    addNotice(state, { title: `${p.name} 1군 콜업`, body: `유스 코치가 ${withParticle(p.name, '를')} 1군으로 올렸습니다. (능력 ${overall(p)})` });
  }
  for (const { player: p, renewed } of staffwork.staffRenewals(state, club)) {
    addNotice(state, renewed
      ? { title: `${p.name} 재계약`, body: `스태프가 ${withParticle(p.name, '와')} ${formatDate(p.contract.until)}까지 재계약했습니다. 주급 ${won(p.contract.wage)}.` }
      : { title: `${p.name} 계약 만료 예정`, body: `스태프는 ${withParticle(p.name, '와')} 재계약하지 않기로 했습니다. 계약이 끝나면 팀을 떠납니다. 붙잡으려면 직접 재계약하세요.` });
  }
}

// 매달 1일: 사기 → 성장(출장 시간 초기화)
function monthlyTick(state, rng, date) {
  monthlyMorale(state, addMonths(date, -1));
  monthlyDevelopment(state, rng);
  const month = date.slice(5, 7);
  if ((month === '01' || month === '04') && state.user?.clubId) expiryReminder(state);
}

function expiryReminder(state) {
  const club = userClub(state);
  const end = `${state.season + 1}-06-30`;
  const expiring = club.squad.map((id) => state.players[id]).filter((p) => p.contract && p.contract.until <= end);
  if (!expiring.length) return;
  addMessage(state, {
    view: 'squad', title: '계약 만료 예정',
    body: `이번 시즌이 끝나면 계약이 끝나는 선수: ${expiring.map((p) => p.name).join(', ')}. 재계약하지 않으면 6월 30일에 팀을 떠납니다.`,
    important: true,
  });
}

// date까지 하루씩 진행한다. 내 선수에게 이적 제안이 오면 그날 멈추고 제안을 돌려준다
function moveTo(state, date) {
  return withRng(state, (rng) => {
    while (state.date < date) {
      state.date = addDays(state.date, 1);
      const offer = dailyTick(state, rng, state.date);
      if (offer) return offer;
    }
    return null;
  });
}

// 날짜 다음에 오는 월요일
function nextMonday(date) {
  let d = addDays(date, 1);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  return d;
}

// 다음 월요일까지 한 주를 진행한다. 우리 경기는 결과로 처리한다.
// skipOffers: 내 선수에게 온 이적 제안에서 멈추지 않는다 (답하지 않은 제안은 기한이 지나면 거절된다)
// watchMatches: 우리 경기 날 멈춰 중계로 볼 수 있게 한다
// 돌려주는 값: { stop: 'week' } | { stop: 'userMatch', fixture } | { stop: 'transferOffer', offer } | { stop: 'seasonEnd' } | { stop: 현재 phase }
export function advance(state, { skipOffers = false, watchMatches = false } = {}) {
  if (state.phase !== 'season') return { stop: state.phase };
  const monday = nextMonday(state.date);
  for (;;) {
    const date = nextUnplayedDate(state);
    if (!date) {
      endSeason(state);
      return { stop: 'seasonEnd' };
    }
    const target = date < monday ? date : monday;
    while (state.date < target) {
      const offer = moveTo(state, target);
      if (offer && !skipOffers) return { stop: 'transferOffer', offer };
    }
    if (date === state.date) {
      const fixture = userFixtureOn(state, date);
      if (fixture && watchMatches) return { stop: 'userMatch', fixture };
      if (fixture) {
        simulateUserMatch(state);
        finishUserMatch(state);
        if (state.phase !== 'season') return { stop: 'seasonEnd' };
      } else {
        playOtherMatches(state, date);
      }
    }
    if (state.date >= monday) return { stop: 'week' };
  }
}

// ---- 경기 ----

// 감독이 상대를 보고 전술과 선발을 정한다. 교체와 경기 중 전술 변경도 감독이 맡는다
function matchSetup(state, club, opponent, compId) {
  const rule = LEAGUES[state.competitions[compId].ruleId];
  coaches.applyCoachTactics(club, clubStrength(state, opponent) - clubStrength(state, club));
  const unavailable = unavailableSet(state, compId, club);
  const bonus = (p) => coaches.selectionBonus(club, ageOn(p, state.date), overall(p));
  const { lineup, bench } = resolveLineup(club, state.players, { unavailable, benchSize: rule.benchSize, bonus });
  return { clubId: club.id, tactics: { ...club.tactics }, lineup, bench, auto: true, aiTactics: true, injuryFactor: injuryChanceFactor(club) };
}

function buildMatch(state, fixture) {
  const rule = LEAGUES[state.competitions[fixture.competitionId].ruleId];
  const home = state.clubs[fixture.home];
  const away = state.clubs[fixture.away];
  return createMatch({
    id: fixture.id,
    competitionId: fixture.competitionId,
    date: fixture.date,
    home: matchSetup(state, home, away, fixture.competitionId),
    away: matchSetup(state, away, home, fixture.competitionId),
    players: state.players,
    maxSubs: rule.maxSubs,
  });
}

// 내 경기를 시작한다. 화면에서 stepMinute로 진행한 뒤 finishUserMatch를 부른다.
export function startUserMatch(state) {
  const fixture = userFixtureOn(state, state.date);
  if (!fixture) throw new Error('오늘은 경기가 없습니다.');
  if (!state.liveMatch || state.liveMatch.id !== fixture.id) {
    state.liveMatch = buildMatch(state, fixture);
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
  const userId = state.user?.clubId;
  for (const fixture of fixturesOn(state, date)) {
    if (fixture.home === userId || fixture.away === userId) continue;
    const match = buildMatch(state, fixture);
    withRng(state, (rng) => simulateMatch(match, rng));
    applyResult(state, fixture, match);
  }
}

function applyResult(state, fixture, match) {
  fixture.result = summarize(match);
  const compId = fixture.competitionId;
  const userId = state.user?.clubId;
  const homeClub = state.clubs[fixture.home];
  const table = standings(state, compId);
  fixture.result.crowd = recordGate(state, homeClub, table.findIndex((r) => r.clubId === homeClub.id) + 1, table.length);

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
      const inj = withRng(state, (rng) => assignInjury(rng, p, fixture.date, 'match', injuryDaysFactor(state.clubs[p.clubId])));
      if (p.clubId === userId) addMessage(state, { view: 'squad', title: `${p.name} 부상`, body: `${inj.name}, 약 ${inj.days}일 결장 예상 (복귀 예정 ${formatDate(inj.until)})` });
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
      view: 'squad', title: `${state.players[ban.playerId].name} 출전 정지`,
      body: `${withParticle(reason, '로')} 다음 ${ban.games}경기에 나설 수 없습니다.`,
    });
  }
}

// ---- 시즌 ----

function endSeason(state) {
  if (state.phase === 'seasonEnd') return;
  state.phase = 'seasonEnd';
  const table = standings(state);
  const pos = table.findIndex((r) => r.clubId === state.user.clubId) + 1;
  const champion = state.clubs[table[0].clubId];
  addMessage(state, {
    view: 'table', title: '시즌 종료',
    body: `${LEAGUES[userLeagueId(state)].name}에서 ${withParticle(champion.name, '가')} 우승했습니다. 우리 팀은 ${pos}위로 시즌을 마쳤습니다.`,
    important: true,
  });
}

// 시즌 종료 처리 → 7월 1일 새 시즌. 돌려주는 값: 시즌 요약
function runSeasonTransition(state) {
  moveTo(state, `${state.season + 1}-06-30`);
  returnLoans(state);
  const summary = withRng(state, (rng) => processSeasonEnd(state, rng));
  seasonEndMessages(state, summary);
  // 계약이 끝나는 감독은 2년 연장한다
  for (const club of activeClubs(state)) {
    const c = club.headCoach;
    if (!c || c.until > `${state.season + 1}-06-30`) continue;
    c.until = `${state.season + 3}-06-30`;
    if (club.id === state.user.clubId) addMessage(state, { view: 'manager', title: `${c.name} 감독 재계약`, body: `계약이 끝나 ${formatDate(c.until)}까지 연장했습니다.` });
  }
  withRng(state, (rng) => startSeason(state, rng));
  moveTo(state, seasonStart(state.season));
  state.phase = 'season';
  addMessage(state, {
    view: 'schedule', title: `${state.season}-${String(state.season + 1).slice(2)} 시즌 시작`,
    body: `${LEAGUES[userLeagueId(state)].name} 개막은 ${formatDate(league(state).fixtures[0].date)}입니다.`,
  });
  return summary;
}

// 시즌이 끝난 뒤 "다음 시즌 시작"
export function startNextSeason(state) {
  if (state.phase !== 'seasonEnd') throw new Error('시즌이 아직 끝나지 않았습니다.');
  return runSeasonTransition(state);
}

// 시즌이 끝날 때까지 내 경기도 결과만으로 처리하며 진행한다. 화면에서는 이적 제안에서 멈추게 한다
export function simulateToSeasonEnd(state, { skipOffers = true } = {}) {
  if (state.phase !== 'season') return { stop: state.phase };
  for (;;) {
    const res = advance(state, { skipOffers });
    if (res.stop !== 'week') return res;
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
  withRng(state, (rng) => signNew(rng, state, club, state.players[playerId], { youth: true }));
  return true;
}

export function sendDownToYouth(state, playerId) {
  const club = userClub(state);
  const p = state.players[playerId];
  // 유스 출신 21세 이하만 다시 U-21 팀으로 내릴 수 있다
  if (!club.squad.includes(playerId) || !p.youthSince || ageOn(p, state.date) > 21) return false;
  club.squad = club.squad.filter((id) => id !== playerId);
  club.youth.push(playerId);
  p.contract = null;
  if (club.tactics.lineup?.some((e) => e?.playerId === playerId)) club.tactics.lineup = null;
  return true;
}

export { registeredCount, MAX_SQUAD };

// ---- 전술 (내 구단) ----


// ---- 이적 (내 구단) ----

export const seasonTransfers = (state, season, filter) => transfers.seasonTransfers(state, season, filter);

export function playerInfo(state, playerId) {
  return transfers.playerInfo(state, userClub(state), state.players[playerId]);
}

export function bidForPlayer(state, playerId, fee) {
  return transfers.bidForPlayer(state, userClub(state), state.players[playerId], fee);
}

export function offerTerms(state, playerId, offer) {
  const p = state.players[playerId];
  const from = p.clubId;
  const res = transfers.offerTerms(state, userClub(state), p, offer);
  if (res.ok) {
    const where = from ? `${state.clubs[from].name}에서` : '자유계약으로';
    addMessage(state, { view: 'transfers', title: `${p.name} 영입`, body: `${withParticle(p.name, '가')} ${where} 우리 팀에 왔습니다.${res.fee ? ` 이적료 ${won(res.fee)}.` : ''}` });
  }
  return res;
}

export function respondToOffer(state, offerId, answer) {
  const offer = state.transfers.incoming.find((o) => o.id === offerId);
  const res = withRng(state, (rng) => transfers.respondToOffer(state, rng, userClub(state), offerId, answer));
  if (res.ok && answer !== 'reject') {
    const p = state.players[offer.playerId];
    addMessage(state, { view: 'transfers', title: `${p.name} 이적`, body: `${withParticle(p.name, '가')} ${withParticle(state.clubs[offer.clubId].name, '로')} 떠났습니다. 이적료 ${won(res.fee)}.` });
  }
  return res;
}

export function setTransferListed(state, playerId, listed) {
  if (userClub(state).squad.includes(playerId)) transfers.setTransferListed(state.players[playerId], listed);
}

export function loanOut(state, playerId) {
  const p = state.players[playerId];
  const res = loans.loanOut(state, userClub(state), p);
  if (res.ok) addMessage(state, { view: 'transfers', title: `${p.name} 임대`, body: `${withParticle(p.name, '가')} 시즌 끝까지 ${state.clubs[res.clubId].name}에서 뜁니다. 상대 구단이 주급의 ${res.wageShare * 100}%를 냅니다.` });
  return res;
}

export function offerLoan(state, playerId, offer) {
  const p = state.players[playerId];
  const from = p.clubId;
  const res = loans.offerLoan(state, userClub(state), p, offer);
  if (res.ok) addMessage(state, { view: 'transfers', title: `${p.name} 임대 영입`, body: `${withParticle(p.name, '가')} 시즌 끝까지 ${state.clubs[from].name}에서 임대로 왔습니다. 완전 이적 옵션 ${won(res.optionFee)}.` });
  return res;
}

export function buyLoanedPlayer(state, playerId) {
  return loans.buyLoanedPlayer(state, userClub(state), state.players[playerId]);
}

// ---- 감독 (내 구단) ----

export function managerCandidates(state) {
  return withRng(state, (rng) => coaches.candidates(rng, state, userClub(state)));
}

export const coachComment = (state, playerId, fee) => coaches.coachComment(state, userClub(state), state.players[playerId], fee);

export const firingCost = (state) => coaches.firingCost(state, userClub(state));

export function fireManager(state) {
  const res = coaches.fireCoach(state, userClub(state));
  if (res.ok) addMessage(state, { view: 'manager', title: `${res.coach.name} 감독 해고`, body: `위약금 ${won(res.compensation)}을 냈습니다. 새 감독을 뽑을 때까지 코치가 임시로 팀을 맡습니다.` });
  return res;
}

export function hireManager(state, coachId) {
  const res = coaches.hireCoach(state, userClub(state), coachId);
  if (res.ok) addMessage(state, { view: 'manager', title: `${res.coach.name} 감독 부임`, body: `${formatDate(res.coach.until)}까지 계약했습니다. 주급 ${won(res.coach.wage)}.` });
  return res;
}

export const transferRequests = (state) => requests.activeRequests(state);

export function answerRequest(state, requestId, answer) {
  return requests.answerRequest(state, requestId, answer);
}

export function searchPlayers(state, filters) {
  return transfers.searchPlayers(state, userClub(state), filters);
}

// ---- 계약·시설·스태프 (내 구단) ----

export function renewContract(state, playerId, offer) {
  const club = userClub(state);
  const p = state.players[playerId];
  if (!club.squad.includes(playerId)) return { ok: false, reason: '우리 선수가 아닙니다.' };
  const res = offerRenewal(state, club, p, offer);
  if (res.ok) addMessage(state, { view: 'squad', title: `${p.name} 재계약`, body: `${withParticle(p.name, '가')} ${offer.years}년 재계약에 서명했습니다.` });
  return res;
}

export function upgradeFacility(state, key) {
  const club = userClub(state);
  const res = requestUpgrade(state, club, key);
  if (res.ok) addMessage(state, { view: 'club', title: `${FACILITIES[key].name} 공사 시작`, body: `${res.months}개월 뒤 ${res.level + 1}레벨이 됩니다.` });
  return res;
}

// 스태프 수준을 바꾼다. 올릴 때는 주급 예산 안이어야 한다
export function setStaffLevel(state, key, level) {
  const club = userClub(state);
  if (!STAFF[key] || level < 1 || level > MAX_STAFF) return { ok: false, reason: '잘못된 수준입니다.' };
  const diff = roundMoney((staffWage(level) - staffWage(club.staff[key])) * EUR);
  if (diff > 0 && weeklyWageBill(state, club) + diff > club.finance.wageBudget) return { ok: false, reason: '주급 예산을 넘습니다.' };
  club.staff[key] = level;
  return { ok: true };
}

// 재정 조정 바: 주급 예산을 정하면 이적 예산이 그만큼 바뀐다
export const budgetRange = (state) => clubBudgetRange(state, userClub(state));
export const adjustBudgets = (state, wageBudget) => clubAdjustBudgets(state, userClub(state), wageBudget);
