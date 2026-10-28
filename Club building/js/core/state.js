// state를 읽고 쓰는 공통 도우미 (game.js와 season.js가 함께 쓴다)

import { Rng, hashSeed } from './rng.js';
import { LEAGUES } from '../data/countries/index.js';
import { computeStandings } from './standings.js';
import { unavailableFor } from './discipline.js';
import { ratingAt } from './player.js';

export function withRng(state, fn) {
  const rng = new Rng(state.rngState);
  const result = fn(rng);
  state.rngState = rng.state;
  return result;
}

// view: 메시지를 눌렀을 때 보여 줄 화면 (없으면 홈)
export function addMessage(state, { title, body, important = false, view = null }) {
  state.inbox.unshift({ id: `m${hashSeed(`${state.date}${title}${state.inbox.length}`)}`, date: state.date, title, body, important, view, read: false });
  if (state.inbox.length > 200) state.inbox.length = 200;
}

// 안 읽은 메시지 수. view를 주면 그 화면에 연결된 것만
export const unreadCount = (state, view) => state.inbox.filter((m) => !m.read && (view === undefined || m.view === view)).length;

export function markViewRead(state, view) {
  for (const m of state.inbox) if (m.view === view) m.read = true;
}

// 메시지를 읽음으로 하고 연결된 화면을 돌려준다
export function openMessage(state, id) {
  const m = state.inbox.find((x) => x.id === id);
  if (!m) return null;
  m.read = true;
  return m.view;
}

// 결정이 필요 없는 알림: 바로 메시지함에 넣지 않고 모아 두었다가 월요일 주간 요약에 묶는다
export function addNotice(state, { title, body }) {
  (state.notices ??= []).push({ date: state.date, title, body });
}

export const userClub = (state) => state.clubs[state.user?.clubId];
export const userLeagueId = (state) => userClub(state)?.leagueId ?? 'ENG1';
export const league = (state, compId = userLeagueId(state)) => state.competitions[compId];
export const activeClubs = (state) => Object.values(state.clubs).filter((c) => c.status === 'active');

export function standings(state, compId = userLeagueId(state)) {
  const comp = state.competitions[compId];
  return computeStandings(comp.fixtures, comp.clubIds, LEAGUES[comp.ruleId]);
}

export function seasonStats(player, season, compId) {
  return player.stats[season]?.[compId] ?? null;
}

export function topScorers(state, compId = userLeagueId(state), n = 10) {
  return Object.values(state.players)
    .filter((p) => p.stats[state.season]?.[compId])
    .map((p) => ({ player: p, s: p.stats[state.season][compId] }))
    .filter((x) => x.s.goals > 0)
    .sort((a, b) => b.s.goals - a.s.goals || b.s.assists - a.s.assists)
    .slice(0, n);
}

export function isInjured(player) {
  return !!player.injury;
}

// 이 대회 경기에 나올 수 없는 선수: 출전 정지 + 부상. club을 주면 그 구단 선수만 살핀다
export function unavailableSet(state, compId, club = null) {
  const banned = state.discipline[compId] ?? {};
  const ids = club ? club.squad : Object.keys(state.players);
  const set = new Set();
  for (const id of ids) {
    if (banned[id]?.ban > 0 || state.players[id].injury) set.add(id);
  }
  return set;
}

export function isUnavailable(state, compId, playerId) {
  return unavailableFor(state.discipline, compId).has(playerId) || isInjured(state.players[playerId]);
}

// 구단 수준: 자기 포지션 기준 상위 11명 평균 능력
export function clubStrength(state, club) {
  const xs = club.squad.map((id) => state.players[id]).map((p) => ratingAt(p, p.position)).sort((a, b) => b - a).slice(0, 11);
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
