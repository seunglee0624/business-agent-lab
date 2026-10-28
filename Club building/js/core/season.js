// 시즌 종료 처리와 새 시즌 준비:
// 기록 보관 → 승강 → 은퇴 → 유스 정리 → 선수단 채우기 → 새 일정

import { COUNTRIES, LEAGUES, BOTTOM_TIER } from '../data/countries/index.js';
import { leagueMatchDates, seasonStart } from './calendar.js';
import { generateLeagueFixtures } from './schedule.js';
import { generatePromotedClub, generatePlayer, SQUAD_TEMPLATE } from './worldgen.js';
import { overall, ageOn } from './player.js';
import { resetSeasonYellows } from './discipline.js';
import { retirementChance, isHomegrownYouth } from './development.js';
import { withParticle } from './korean.js';
import { addMessage, standings, topScorers, clubStrength } from './state.js';
import { initFinance, payPrizeMoney, closeLedger, setBudgets } from './finance.js';
import { signNew, expiringContracts } from './contracts.js';
import { upgradeInfo, requestUpgrade, isBuilding } from './facilities.js';
import { FACILITY_KEYS } from '../data/economy.js';
import { fanSeasonEnd } from './fans.js';
import { won } from './money.js';

export const RETURN_CHANCE = 0.3;
export const RETURN_AFTER_SEASONS = 2;
const POSITIONS = Object.keys(SQUAD_TEMPLATE);

export function newCompetitions(rng, state, season) {
  const competitions = {};
  for (const rule of Object.values(LEAGUES)) {
    const clubIds = Object.values(state.clubs).filter((c) => c.status === 'active' && c.leagueId === rule.id).map((c) => c.id);
    const dates = leagueMatchDates(season, (rule.teams - 1) * 2);
    competitions[rule.id] = {
      id: rule.id,
      ruleId: rule.id,
      name: rule.name,
      season,
      clubIds,
      fixtures: generateLeagueFixtures(rng, rule.id, clubIds, dates),
    };
  }
  return competitions;
}

// 1. 지난 시즌 요약을 history에 남긴다
function recordHistory(state) {
  const entry = { season: state.season, leagues: {} };
  for (const comp of Object.values(state.competitions)) {
    const table = standings(state, comp.id);
    const [top] = topScorers(state, comp.id, 1);
    entry.leagues[comp.id] = {
      table: table.map((r) => ({ ...r, name: state.clubs[r.clubId].name })),
      champion: table[0].clubId,
      topScorer: top ? { playerId: top.player.id, name: top.player.name, clubId: top.player.clubId, goals: top.s.goals } : null,
    };
    table.forEach((r, i) => {
      state.clubs[r.clubId].history.push({ season: state.season, leagueId: comp.id, position: i + 1, points: r.points });
    });
  }
  state.history.push(entry);
  return entry;
}

// 2. 승강. 돌려주는 값: 이동 목록 [{ clubId, from, to }] (to가 null이면 보관)
function promoteAndRelegate(state, rng) {
  const moves = [];
  for (const country of Object.values(COUNTRIES)) {
    const tables = Object.fromEntries(country.leagues.map((l) => [l.tier, standings(state, l.id)]));
    for (const rule of country.leagues) {
      const table = tables[rule.tier];
      const below = country.leagues.find((l) => l.tier === rule.tier + 1);
      if (below) {
        for (const r of table.slice(-rule.relegated)) moves.push({ clubId: r.clubId, from: rule.id, to: below.id });
        for (const r of tables[below.tier].slice(0, below.promoted)) moves.push({ clubId: r.clubId, from: below.id, to: rule.id });
      } else if (rule.tier === BOTTOM_TIER) {
        // 맨 아래 리그에서 떨어지는 구단은 보관된다. 단장의 구단은 보관하지 않고 그 위 구단이 대신 빠진다
        const out = table.filter((r) => r.clubId !== state.user?.clubId).slice(-rule.relegated);
        for (const r of out) moves.push({ clubId: r.clubId, from: rule.id, to: null });
      }
    }
  }
  for (const m of moves) {
    const club = state.clubs[m.clubId];
    if (m.to) {
      club.leagueId = m.to;
    } else {
      club.status = 'archived';
      club.leagueId = null;
      club.archivedSeason = state.season;
    }
  }
  return moves;
}

// 3. 3부 빈자리를 보관 구단(30%) 또는 새 구단으로 채운다
function fillBottomTier(state, rng, moves) {
  const added = [];
  const usedNames = new Set(Object.values(state.clubs).map((c) => c.name));
  for (const country of Object.values(COUNTRIES)) {
    const rule = country.leagues.find((l) => l.tier === BOTTOM_TIER);
    const needed = moves.filter((m) => m.from === rule.id && m.to === null).length;
    const takenCities = new Map();
    for (const c of Object.values(state.clubs)) {
      if (c.country === country.code && c.status === 'active') takenCities.set(c.city, (takenCities.get(c.city) ?? 0) + 1);
    }
    for (let i = 0; i < needed; i++) {
      const eligible = Object.values(state.clubs).filter((c) => c.status === 'archived' && c.country === country.code
        && state.season - c.archivedSeason >= RETURN_AFTER_SEASONS);
      if (eligible.length && rng.chance(RETURN_CHANCE)) {
        const club = rng.pick(eligible);
        club.status = 'active';
        club.leagueId = rule.id;
        club.archivedSeason = null;
        club.tier = 'weak';
        club.level = rule.tierLevel.weak;
        refreshReturningSquad(state, rng, club);
        added.push({ club, returned: true });
      } else {
        const { club, players } = generatePromotedClub(rng, country, rule, {
          ids: state.ids, usedNames, takenCities, seasonStart: seasonStart(state.season + 1),
        });
        state.clubs[club.id] = club;
        for (const p of players) state.players[p.id] = p;
        initFinance(rng, state, club);
        added.push({ club, returned: false });
      }
    }
  }
  return added;
}

// 돌아오는 보관 구단: 3부 약팀 기준보다 크게 약한 선수는 내보낸다 (빈자리는 fillSquads가 채운다)
function refreshReturningSquad(state, rng, club) {
  const floor = club.level - 10;
  for (const id of club.squad.slice()) {
    const p = state.players[id];
    if (overall(p) < floor) release(state, club, p);
  }
}

function release(state, club, p) {
  club.squad = club.squad.filter((id) => id !== p.id);
  club.youth = club.youth.filter((id) => id !== p.id);
  p.lastClubId = club.id;
  p.clubId = null;
  p.contract = null;
  p.transferRequest = false;
  if (club.tactics.lineup) club.tactics.lineup = null;
}

// 4. 은퇴: 시즌 끝 기준 나이로 판정
function retirements(state, rng, date) {
  const retired = [];
  for (const club of Object.values(state.clubs)) {
    for (const id of club.squad.slice()) {
      const p = state.players[id];
      if (rng.chance(retirementChance(ageOn(p, date), overall(p)))) {
        release(state, club, p);
        p.retired = true;
        // 은퇴한 선수는 기록만 남긴다
        delete p.attrs;
        delete p.progress;
        delete p.secondary;
        delete p.injury;
        retired.push(p);
      }
    }
  }
  return retired;
}

export const YOUTH_CAP = 14;
export const MAX_SQUAD = 25; // 1군 등록 인원 (홈그로운 유스 제외)

// 5. 21세가 넘었는데 1군에 못 올라간 유스, 그리고 정원(14명)을 넘는 유스는 잠재력 낮은 순으로 방출한다
// (1군 경기 기록이 없으므로 지운다). 선수단 채우기가 끝난 뒤에 부른다.
function releaseYouth(state, date) {
  const released = [];
  for (const club of Object.values(state.clubs)) {
    const youth = club.youth.map((id) => state.players[id]);
    const keep = youth
      .filter((p) => ageOn(p, date) <= 21)
      .sort((a, b) => b.potential - a.potential)
      .slice(0, YOUTH_CAP);
    for (const p of youth) {
      if (keep.includes(p)) continue;
      release(state, club, p);
      delete state.players[p.id];
      released.push(p);
    }
  }
  return released;
}

// 6. 포지션별 빈자리를 채운다. AI 구단: 유스 → 자유계약 선수 → 새 선수 순으로 25명.
// 내 구단은 직접 영입하므로 18명·골키퍼 2명에 못 미칠 때만 그만큼 채운다
export const USER_MIN_SQUAD = 18;
export const USER_MIN_GK = 2;

export function fillSquads(state, rng, clubs, date) {
  const report = new Map();
  const userId = state.user?.clubId;
  for (const club of clubs) {
    const log = { promoted: [], signed: [] };
    const counts = Object.fromEntries(POSITIONS.map((p) => [p, 0]));
    for (const id of club.squad) counts[state.players[id].position]++;
    const user = club.id === userId;
    const wants = (pos) => (user
      ? (pos === 'GK' ? counts.GK < USER_MIN_GK : club.squad.length < USER_MIN_SQUAD && counts[pos] < SQUAD_TEMPLATE[pos])
      : counts[pos] < SQUAD_TEMPLATE[pos] && registeredCount(state, club, date) < 25);
    // 내 구단은 한 바퀴에 자리마다 한 명씩, 18명이 될 때까지 템플릿 부족분을 돌아가며 채운다
    for (let round = 0; round < (user ? 5 : 1); round++) {
      for (const pos of POSITIONS) {
        while (wants(pos)) {
          signForPosition(state, rng, club, pos, date, log, !user);
          counts[pos]++;
          if (user) break;
        }
      }
    }
    // 이적으로 자리 구성이 템플릿과 달라졌으면, 남는 등록 자리를 가장 약한 자리부터 채운다
    while (!user && registeredCount(state, club, date) < 25) {
      const pos = POSITIONS.slice().sort((a, b) => counts[a] / SQUAD_TEMPLATE[a] - counts[b] / SQUAD_TEMPLATE[b])[0];
      signForPosition(state, rng, club, pos, date, log, true);
      counts[pos]++;
    }
    report.set(club.id, log);
  }
  return report;
}

function signForPosition(state, rng, club, pos, date, log, useYouth) {
  const youth = useYouth && club.youth
    .map((id) => state.players[id])
    .filter((p) => p.position === pos)
    .sort((a, b) => overall(b) - overall(a))[0];
  if (youth && overall(youth) >= club.level - 18) {
    club.youth = club.youth.filter((id) => id !== youth.id);
    club.squad.push(youth.id);
    signNew(rng, state, club, youth, { youth: true });
    log.promoted.push(youth);
    return;
  }
  const free = Object.values(state.players)
    .filter((p) => !p.clubId && !p.retired && p.position === pos && ageOn(p, date) <= 32 && overall(p) >= club.level - 8)
    .sort((a, b) => overall(b) - overall(a))[0];
  let p = free;
  if (p) {
    (p.transfers ??= []).push({ date: state.date, from: null, to: club.id, fee: 0 });
    delete p.freeSince;
  } else {
    const age = Math.max(19, Math.min(31, Math.round(rng.normal(24, 3))));
    p = generatePlayer(rng, {
      id: `p${state.ids.player++}`, pos, target: club.level - 4 + rng.normal(0, 3), age,
      country: club.country, seasonStart: seasonStart(state.season + 1),
    });
    state.players[p.id] = p;
  }
  p.clubId = club.id;
  club.squad.push(p.id);
  signNew(rng, state, club, p);
  log.signed.push(p);
}

export function registeredCount(state, club, date) {
  return club.squad.filter((id) => !isHomegrownYouth(state.players[id], date)).length;
}

// 7. 구단 수준과 강팀/중위권/약팀 구분을 새 리그 기준으로 다시 매긴다
function rerateClubs(state) {
  for (const rule of Object.values(LEAGUES)) {
    const clubs = Object.values(state.clubs).filter((c) => c.status === 'active' && c.leagueId === rule.id);
    const strength = new Map(clubs.map((c) => [c.id, clubStrength(state, c)]));
    clubs.sort((a, b) => strength.get(b.id) - strength.get(a.id)).forEach((c, i) => {
      c.tier = i < rule.tiers.strong ? 'strong' : i < rule.tiers.strong + rule.tiers.mid ? 'mid' : 'weak';
      // 실제 전력과 리그 기준값을 반씩 섞는다. 보강 선수·유스 수준이 시즌마다 한쪽으로 흘러가지 않게 고정하는 역할
      c.level = (strength.get(c.id) + rule.tierLevel[c.tier]) / 2;
      c.reputation = Math.round((c.reputation * 2 + c.level) / 3);
    });
  }
}

// 지난 시즌 경기 기록은 한 시즌만 더 보관하고, 그 전 시즌 선수 기록 외 세부 기록은 버린다
function rotateCompetitions(state) {
  state.previousCompetitions = state.competitions;
}

// 시즌 종료 처리 전체. 돌려주는 값: 내 구단 관련 요약 (실업 중이면 userPos 등은 null)
export function processSeasonEnd(state, rng) {
  const endDate = `${state.season + 1}-06-30`;
  const userId = state.user.clubId;
  const userLeague = userId ? state.clubs[userId].leagueId : null;
  const userPos = userId ? standings(state, userLeague).findIndex((r) => r.clubId === userId) + 1 : null;

  recordHistory(state);
  for (const comp of Object.values(state.competitions)) {
    const table = standings(state, comp.id);
    table.forEach((r, i) => payPrizeMoney(state, state.clubs[r.clubId], i + 1, table.length));
  }
  if (userId) fanSeasonEnd(state, state.clubs[userId], userPos);
  if (userId) state.user.history.push({ season: state.season, clubId: userId, clubName: state.clubs[userId].name, leagueId: userLeague, position: userPos });

  const moves = promoteAndRelegate(state, rng);
  const added = fillBottomTier(state, rng, moves);
  const retired = retirements(state, rng, endDate);
  const leaving = expiringContracts(state, rng, endDate, userId);
  // 자유계약 1년이 지난 선수는 은퇴한 것으로 보고 지운다 (저장 크기)
  const expired = `${state.season}-06-30`;
  for (const p of Object.values(state.players)) {
    if (!p.clubId && !p.retired && p.freeSince <= expired) delete state.players[p.id];
  }
  for (const { club, player } of leaving) {
    release(state, club, player);
    player.freeSince = endDate;
  }
  const active = Object.values(state.clubs).filter((c) => c.status === 'active');
  const fill = fillSquads(state, rng, active, endDate);
  releaseYouth(state, endDate);
  rerateClubs(state);
  resetSeasonYellows(state.discipline);
  rotateCompetitions(state);
  for (const club of Object.values(state.clubs)) if (club.finance) closeLedger(club, state.season);

  // 내 구단 메시지
  const myMove = moves.find((m) => m.clubId === userId);
  const myRetired = retired.filter((p) => p.lastClubId === userId);
  const myLeaving = leaving.filter((x) => x.club.id === userId).map((x) => x.player);
  const myFill = fill.get(userId);
  return { userPos, userLeague, move: myMove ?? null, retired: myRetired, leaving: myLeaving, fill: myFill, added, moves };
}

// 새 시즌을 시작한다 (7월 1일, 일정 생성, 목표와 예산)
export function startSeason(state, rng) {
  state.season++;
  state.competitions = newCompetitions(rng, state, state.season);
  for (const p of Object.values(state.players)) p.condition = 100;
  for (const club of Object.values(state.clubs)) {
    if (club.status !== 'active') continue;
    if (club.id !== state.user.clubId) aiFacilityUpgrade(state, rng, club);
    const b = setBudgets(state, club);
    if (b && club.id === state.user.clubId) {
      addMessage(state, {
        view: 'finance',
        title: `${state.season}-${String(state.season + 1).slice(2)} 시즌 예산`,
        body: `이적 예산: 남은 예산 ${won(b.carried)} ${b.added >= 0 ? '+' : '-'} 지난 시즌 ${b.added >= 0 ? '수익' : '적자'} 반영 ${won(Math.abs(b.added))} = ${won(b.total)}${b.total < b.carried + b.added ? ' (잔고까지만)' : ''}. 주급 예산: 주 ${won(club.finance.wageBudget)}.`,
      });
    }
  }
}

// AI 구단은 돈이 넉넉하면 가끔 시설 하나를 올린다
function aiFacilityUpgrade(state, rng, club) {
  if (!rng.chance(0.25)) return;
  const options = FACILITY_KEYS.filter((k) => upgradeInfo(club, k) && !isBuilding(club, k));
  if (!options.length) return;
  const key = options.sort((a, b) => club.facilities[a] - club.facilities[b])[0];
  if (club.finance.balance >= upgradeInfo(club, key).cost * 2) requestUpgrade(state, club, key);
}

export function seasonEndMessages(state, summary) {
  if (!summary.userLeague) return;
  const last = state.user.history.at(-1);
  const club = state.clubs[last.clubId];
  const leagueName = LEAGUES[summary.userLeague].name;
  addMessage(state, { view: 'table', title: '시즌 결과', body: `${leagueName} ${summary.userPos}위로 시즌을 마쳤습니다.`, important: true });
  if (summary.move) {
    const up = LEAGUES[summary.move.to].tier < LEAGUES[summary.move.from].tier;
    addMessage(state, {
      view: 'table', title: up ? '승격!' : '강등',
      body: up ? `${withParticle(club.name, '가')} ${withParticle(LEAGUES[summary.move.to].name, '로')} 승격했습니다!` : `${withParticle(club.name, '가')} ${withParticle(LEAGUES[summary.move.to].name, '로')} 강등되었습니다.`,
      important: true,
    });
  }
  const f = summary.fill;
  if (summary.retired.length || summary.leaving.length || f?.promoted.length || f?.signed.length) {
    const parts = [];
    if (summary.retired.length) parts.push(`은퇴: ${summary.retired.map((p) => p.name).join(', ')}`);
    if (summary.leaving.length) parts.push(`계약 만료로 떠남: ${summary.leaving.map((p) => p.name).join(', ')}`);
    if (f?.promoted.length) parts.push(`유스에서 1군 승격: ${f.promoted.map((p) => p.name).join(', ')}`);
    if (f?.signed.length) parts.push(`빈자리 보강(자유계약): ${f.signed.map((p) => `${p.name}(${p.position})`).join(', ')}`);
    addMessage(state, { view: 'squad', title: '선수단 정리', body: parts.join(' / ') });
  }
}
