// 수뇌부: 시즌 목표, 신뢰도, 해고. 감독 평판과 AI 구단 감독 교체(빈자리), 실업 중 제의.

import { LEAGUES } from '../data/countries/index.js';
import { addDays } from './calendar.js';
import { addMessage, standings, clubStrength, activeClubs } from './state.js';
import { withParticle } from './korean.js';

export const START_TRUST = 60;
export const FIRE_TRUST = 15; // 11월부터 이 아래면 시즌 중 해고
export const SEASON_END_FIRE_TRUST = 25;
export const OFFER_DAYS = 14;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 예상 순위로 리그 목표를 정한다. target: 이 순위 이내면 달성
export function leagueGoal(rule, expectedRank) {
  const n = rule.teams;
  if (expectedRank === 1) return { type: 'title', target: 1, text: '리그 우승' };
  if (rule.tier > 1 && expectedRank <= rule.promoted + 3) return { type: 'promotion', target: rule.promoted, text: `승격 (${rule.promoted}위 이내)` };
  if (expectedRank <= Math.ceil(n * 0.25)) {
    const t = Math.ceil(n * 0.25);
    return { type: 'top', target: t, text: `상위권 (${t}위 이내)` };
  }
  if (expectedRank <= Math.ceil(n * 0.6)) {
    const t = Math.ceil(n * 0.6);
    return { type: 'mid', target: t, text: `중위권 (${t}위 이내)` };
  }
  const t = n - rule.relegated;
  return { type: 'survive', target: t, text: `잔류 (${t}위 이내)` };
}

// 시즌 시작: 모든 구단의 전력 순위와 목표
export function setSeasonGoals(state) {
  for (const rule of Object.values(LEAGUES)) {
    const clubs = activeClubs(state).filter((c) => c.leagueId === rule.id);
    const strength = new Map(clubs.map((c) => [c.id, clubStrength(state, c)]));
    clubs.sort((a, b) => strength.get(b.id) - strength.get(a.id)).forEach((c, i) => {
      c.goal = leagueGoal(rule, i + 1);
    });
  }
}

export function announceGoal(state) {
  const club = state.clubs[state.manager.clubId];
  addMessage(state, {
    title: '수뇌부의 시즌 목표',
    body: `이번 시즌 ${LEAGUES[club.leagueId].name} 목표는 "${club.goal.text}"입니다. 주급 예산과 이적 예산은 재정 화면에서 확인하세요.`,
    important: true,
  });
}

const positionOf = (state, club) => standings(state, club.leagueId).findIndex((r) => r.clubId === club.id) + 1;

// ---- 매달 ----

// 매달 1일: 내 구단 신뢰도 변화, AI 구단 감독 교체
export function monthlyBoard(state, rng) {
  const month = Number(state.date.slice(5, 7));
  const inSeason = month >= 9 || month <= 5;
  const m = state.manager;
  const club = m?.clubId ? state.clubs[m.clubId] : null;
  if (club && inSeason) {
    const pos = positionOf(state, club);
    let delta = clamp((club.goal.target - pos) * 0.8, -6, 4);
    if (club.finance.balance < 0) delta -= 3;
    m.trust = Math.round(clamp(m.trust + delta, 0, 100));
    const canFire = month >= 11 || month <= 5;
    if (canFire && m.trust < FIRE_TRUST) {
      fireManager(state, `성적 부진으로 수뇌부의 신뢰를 잃었습니다 (${pos}위, 목표 ${club.goal.text}).`);
    } else if (m.trust < 30) {
      addMessage(state, { title: '수뇌부의 경고', body: `수뇌부가 성적에 우려를 나타냈습니다. 지금 ${pos}위, 목표는 ${club.goal.text}입니다. (신뢰도 ${m.trust})`, important: true });
    }
  }
  // 감독 인물은 5단계에서 만든다. 지금은 실업 중일 때 빈자리 제의만 생긴다
  if (m && !m.clubId && (month >= 10 || month <= 4)) aiManagerChanges(state, rng, 0.06, 5);
  expireOffers(state);
}

// 목표보다 한참 처진 AI 구단이 감독을 바꾼다. 실업 중이면 평판이 맞는 구단이 나에게 제의한다
function aiManagerChanges(state, rng, chance, margin) {
  const userId = state.manager?.clubId;
  const pos = new Map();
  for (const leagueId of Object.keys(state.competitions)) {
    standings(state, leagueId).forEach((r, i) => pos.set(r.clubId, i + 1));
  }
  for (const club of activeClubs(state)) {
    if (club.id === userId || !club.goal) continue;
    if (pos.get(club.id) > club.goal.target + margin && rng.chance(chance)) offerJob(state, club);
  }
}

export function fits(state, club) {
  return club.reputation <= state.manager.reputation + 12;
}

function offerJob(state, club) {
  const m = state.manager;
  if (m.clubId || !fits(state, club) || state.offers.some((o) => o.clubId === club.id)) return;
  state.offers.push({ clubId: club.id, until: addDays(state.date, OFFER_DAYS) });
  addMessage(state, {
    title: `${club.name}의 감독 제의`,
    body: `${withParticle(club.name, '가')} 감독을 교체하고 ${m.name} 감독님께 지휘봉을 맡기고 싶어 합니다. (${LEAGUES[club.leagueId].name}, ${OFFER_DAYS}일 안에 답해야 합니다)`,
    important: true,
  });
}

function expireOffers(state) {
  state.offers = state.offers.filter((o) => o.until >= state.date && state.clubs[o.clubId].status === 'active');
}

// ---- 해고와 실업 ----

export function fireManager(state, reason) {
  const m = state.manager;
  const club = state.clubs[m.clubId];
  const pos = positionOf(state, club);
  m.history.push({ season: state.season, clubId: club.id, clubName: club.name, leagueId: club.leagueId, position: pos, fired: true });
  m.reputation = clamp(m.reputation - 6, 0, 100);
  m.clubId = null;
  m.trust = null;
  club.tactics.lineup = null;
  club.tactics.bench = null;
  state.phase = 'unemployed';
  state.liveMatch = null;
  addMessage(state, { title: '해고', body: `${club.name}에서 경질되었습니다. ${reason} 다른 구단의 제의를 기다립니다.`, important: true });
}

// 실업 상태에서 고를 수 있는 구단
export function jobOffers(state) {
  return state.offers.map((o) => state.clubs[o.clubId]).filter((c) => c && c.status === 'active');
}

export function acceptJob(state, clubId) {
  if (!state.offers.some((o) => o.clubId === clubId)) return false;
  const club = state.clubs[clubId];
  state.manager.clubId = clubId;
  state.manager.trust = START_TRUST;
  state.offers = [];
  state.phase = 'season';
  addMessage(state, { title: `${club.name} 감독 부임`, body: `${club.name}의 지휘봉을 잡았습니다. 수뇌부 목표는 "${club.goal.text}"입니다.`, important: true });
  return true;
}

// ---- 시즌 끝 ----

// 시즌 끝 평가 (pos: 최종 순위). 돌려주는 값: { met, fired }
export function seasonEndReview(state, club, pos) {
  const m = state.manager;
  const rule = LEAGUES[club.leagueId];
  const met = pos <= club.goal.target;
  m.trust = Math.round(clamp(m.trust + (met ? 15 + Math.max(0, club.goal.target - pos) * 2 : -10 - 3 * (pos - club.goal.target)), 0, 100));
  let rep = met ? 4 : -4;
  if (pos === 1) rep += 6 * (4 - rule.tier);
  if (rule.tier > 1 && pos <= rule.promoted) rep += 5;
  m.reputation = clamp(m.reputation + rep + Math.max(0, club.reputation - m.reputation) * 0.1, 0, 100);
  m.reputation = Math.round(m.reputation * 10) / 10;
  const fired = m.trust < SEASON_END_FIRE_TRUST;
  return { met, fired };
}

// 시즌 사이 AI 감독 교체 (실업 중이면 제의가 온다). 새 목표가 정해진 뒤에 부른다
export function offseasonManagerChanges(state, rng) {
  if (state.manager.clubId) return;
  for (const club of activeClubs(state)) {
    if (fits(state, club) && rng.chance(0.06)) offerJob(state, club);
  }
}

// 제의가 하나도 없으면 3부 구단 몇 곳이 제의한다 (실업이 끝없이 이어지지 않게)
export function fallbackOffers(state, rng, n = 3) {
  if (state.manager.clubId || state.offers.length) return;
  const pool = activeClubs(state).filter((c) => LEAGUES[c.leagueId].tier === 3);
  for (const club of rng.shuffle(pool).slice(0, n)) {
    state.offers.push({ clubId: club.id, until: addDays(state.date, OFFER_DAYS) });
  }
  addMessage(state, { title: '감독 제의', body: `${n}개 구단이 감독 자리를 제의했습니다.`, important: true });
}

export function initialReputation(club) {
  return clamp(Math.round(25 + (club.reputation - 50) * 0.4), 15, 45);
}
