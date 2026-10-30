// AI 감독: 단장이 고용하고 해고한다. 경기 선발·전술은 감독이 맡는다

import { NATIONS, formatName } from '../data/nations.js';
import { COUNTRIES } from '../data/countries/index.js';
import { staffWage, EUR } from '../data/economy.js';
import { expense } from './finance.js';
import { roundMoney } from './money.js';
import { contractEnd } from './contracts.js';
import { daysBetween } from './calendar.js';
import { overall, ageOn } from './player.js';
import { marketValue } from './money.js';

export const COACH_STYLES = {
  attacking: { name: '공격형' },
  defensive: { name: '수비형' },
  youth: { name: '유스 중시' },
  stars: { name: '스타 선호' },
  pragmatic: { name: '실리형' },
};

// 성향별 기본 전술. 실리형은 상대에 따라 바꾼다
const STYLE_TACTICS = {
  attacking: { formation: '4-3-3', mentality: 'attacking', pressing: 'high', tempo: 'fast', line: 'high' },
  defensive: { formation: '5-3-2', mentality: 'defensive', pressing: 'low', tempo: 'slow', line: 'deep' },
  youth: { formation: '4-3-3', mentality: 'balanced', pressing: 'high', tempo: 'normal', line: 'normal' },
  stars: { formation: '4-2-3-1', mentality: 'balanced', pressing: 'normal', tempo: 'normal', line: 'normal' },
  pragmatic: { formation: '4-4-2', mentality: 'balanced', pressing: 'normal', tempo: 'normal', line: 'normal' },
};
const PRAGMATIC_VS = {
  stronger: { formation: '4-5-1', mentality: 'defensive', pressing: 'low', tempo: 'normal', line: 'deep' },
  weaker: { formation: '4-3-3', mentality: 'attacking', pressing: 'high', tempo: 'fast', line: 'high' },
};
const PRAGMATIC_GAP = 2; // 전력 차이가 이만큼 넘으면 실리형이 전술을 바꾼다

// 감독이 정한 전술을 구단에 적용한다. gap: 상대 전력 - 우리 전력 (경기 전에만 준다)
export function applyCoachTactics(club, gap = 0) {
  const coach = club.headCoach;
  if (!coach) return;
  let plan = STYLE_TACTICS[coach.style];
  if (coach.style === 'pragmatic' && gap > PRAGMATIC_GAP) plan = PRAGMATIC_VS.stronger;
  if (coach.style === 'pragmatic' && gap < -PRAGMATIC_GAP) plan = PRAGMATIC_VS.weaker;
  if (plan.formation !== club.tactics.formation) club.tactics.lineup = null;
  Object.assign(club.tactics, plan);
}

// 선발 가중치: 유스 중시 감독은 21세 이하를, 스타 선호 감독은 상위 선수를 조금 더 쓴다
export function selectionBonus(club, age, ovr) {
  const style = club.headCoach?.style;
  if (style === 'youth' && age <= 21) return 1.06;
  if (style === 'stars' && ovr >= 70) return 1.03;
  return 1;
}

// 구단 수준(대략 45~85)에 맞는 감독 능력(1~20)
const abilityFor = (level) => Math.round(Math.max(1, Math.min(20, (level - 45) / 2.2 + 1)));
// 감독 주급: 같은 수준 스태프의 두 배
export const coachWage = (ability) => roundMoney(staffWage(ability) * EUR * 2);

export function generateCoach(rng, state, { country, level }) {
  const mix = COUNTRIES[country].nationalities;
  const nation = rng.weighted(Object.keys(mix), (k) => mix[k]);
  const n = NATIONS[nation];
  const ability = Math.max(1, Math.min(20, abilityFor(level) + Math.round(rng.normal(0, 2))));
  return {
    id: `h${state.ids.coach = (state.ids.coach ?? 0) + 1}`,
    name: formatName(nation, rng.pick(n.first), rng.pick(n.last)),
    nation,
    ability,
    style: rng.pick(Object.keys(COACH_STYLES)),
    wage: coachWage(ability),
    until: contractEnd(state.date, rng.int(1, 3)),
  };
}

// 새 게임: 모든 구단에 감독을 둔다
export function assignInitialCoaches(rng, state) {
  for (const club of Object.values(state.clubs)) {
    if (club.status !== 'active') continue;
    club.headCoach = generateCoach(rng, state, { country: club.country, level: club.level });
    applyCoachTactics(club);
  }
}

// ---- 후보, 고용, 해고 ----

const POOL_SIZE = 6;
const COMPENSATION = 0.5; // 해고 위약금: 남은 계약 주급의 절반
const WILLING_GAP = 3; // 구단에 맞는 수준보다 이만큼 넘게 뛰어난 감독은 오지 않는다

// 후보 명단: 능력이 고르게 퍼지도록 만든다. 해고된 감독도 명단에 들어간다
function refillPool(rng, state, club) {
  state.coachPool ??= [];
  while (state.coachPool.length < POOL_SIZE) {
    const level = club.level - 12 + rng.next() * 30;
    state.coachPool.push(generateCoach(rng, state, { country: club.country, level }));
  }
}

const willing = (club, coach) => coach.ability <= abilityFor(club.reputation) + WILLING_GAP;

export function candidates(rng, state, club) {
  refillPool(rng, state, club);
  return state.coachPool.map((c) => ({ ...c, willing: willing(club, c) }));
}

// 지금 해고하면 낼 위약금
export function firingCost(state, club) {
  const coach = club.headCoach;
  if (!coach) return 0;
  const weeks = Math.max(0, daysBetween(state.date, coach.until) / 7);
  return roundMoney(coach.wage * weeks * COMPENSATION);
}

export function fireCoach(state, club) {
  const coach = club.headCoach;
  if (!coach) return { ok: false, reason: '감독이 없습니다.' };
  const compensation = firingCost(state, club);
  expense(club, 'staff', compensation);
  club.headCoach = null;
  (state.coachPool ??= []).push({ ...coach, until: null });
  return { ok: true, compensation, coach };
}

export function hireCoach(state, club, coachId, years = 2) {
  if (club.headCoach) return { ok: false, reason: '먼저 지금 감독을 해고해야 합니다.' };
  const coach = (state.coachPool ?? []).find((c) => c.id === coachId);
  if (!coach) return { ok: false, reason: '없는 후보입니다.' };
  if (!willing(club, coach)) return { ok: false, reason: `${coach.name} 감독은 우리 구단에 오지 않겠다고 합니다.` };
  state.coachPool = state.coachPool.filter((c) => c !== coach);
  club.headCoach = { ...coach, until: contractEnd(state.date, years) };
  applyCoachTactics(club);
  return { ok: true, coach: club.headCoach };
}

// ---- 감독이 보는 우리 선수 (이적 제안을 받았을 때) ----

// fee: 받은 제안 금액. verdict: keep(팔지 말자) | fair(값만 맞으면) | sell(팔아도 된다)
export function coachComment(state, club, player, fee) {
  const coach = club.headCoach;
  const style = coach?.style;
  const age = ageOn(player, state.date);
  const ovr = overall(player);
  const growth = player.potential - ovr;
  const samePos = club.squad.map((id) => state.players[id]).filter((p) => p.position === player.position)
    .sort((a, b) => overall(b) - overall(a));
  const rank = samePos.indexOf(player);
  const starters = player.position === 'GK' ? 1 : player.position === 'CB' || player.position === 'CM' ? 2 : 1;
  const role = rank < starters ? '주전' : rank < starters * 2 ? '로테이션' : '백업';
  const value = marketValue(player, state.date);

  const lines = [];
  lines.push(age <= 21 ? `${age}세, 아직 성장기입니다.` : age <= 29 ? `${age}세, 전성기입니다.` : age <= 32 ? `${age}세, 곧 내리막에 접어듭니다.` : `${age}세, 하락기입니다.`);
  lines.push(growth >= 8 ? `지금 능력 ${ovr}, 앞으로 크게 성장할 수 있습니다 (잠재 ${player.potential}).`
    : growth >= 3 ? `지금 능력 ${ovr}, 조금 더 성장할 여지가 있습니다 (잠재 ${player.potential}).`
    : `지금 능력 ${ovr}, 더 성장하기는 어렵습니다.`);
  lines.push(`${player.position} 자리에서 ${role}입니다${samePos.length > 1 ? ` (${samePos.length}명 중 ${rank + 1}번째)` : ''}.`);

  // 감독이 아끼는 정도: 주전·성장 가능성·성향
  let keep = role === '주전' ? 2 : role === '로테이션' ? 1 : 0;
  if (age <= 21 && growth >= 8) keep += style === 'youth' ? 2 : 1;
  if (style === 'stars' && ovr >= 70) keep += 1;
  if (age >= 31) keep -= 1;
  const ratio = fee / Math.max(1, value);
  const need = keep >= 3 ? 2 : keep >= 2 ? 1.5 : keep >= 1 ? 1.1 : 0.8; // 이만큼 몸값보다 비싸야 팔자고 한다
  const verdict = ratio >= need ? 'sell' : ratio >= need * 0.8 ? 'fair' : 'keep';
  lines.push(verdict === 'sell' ? '이 금액이면 팔아도 좋다고 봅니다.' : verdict === 'fair' ? '조금만 더 받으면 보내도 괜찮습니다.' : '이 금액으로는 보내고 싶지 않습니다.');
  return { role, verdict, lines, coach: coach?.name ?? null };
}
