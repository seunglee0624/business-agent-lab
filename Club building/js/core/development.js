// 선수 성장·노화·은퇴와 유스 입단

import { ATTRIBUTE_KEYS, POSITION_WEIGHTS } from '../data/positions.js';
import { overall, ageOn } from './player.js';
import { generatePlayer, SQUAD_TEMPLATE } from './worldgen.js';
import { boostFor } from './boost.js';
import { growthFactor, youthIntakeAbility, youthPotentialBoost } from './facilities.js';
import { intensityOf, focusBoost } from './training.js';

const PHYSICAL = new Set(['pace', 'stamina', 'strength']);

// 한 달 동안의 종합 능력 변화량 (소수). growth: 훈련장·코치 보정 (성장에만 곱한다)
export function monthlyDelta(rng, player, age, { minutes = 0, youth = false, growth = 1 } = {}) {
  const gap = Math.max(0, player.potential - overall(player));
  const play = Math.min(1, minutes / 360);
  let delta;
  if (age <= 23) delta = gap * (youth ? 0.03 : 0.03 + 0.04 * play);
  else if (age <= 27) delta = gap * (0.015 + 0.025 * play);
  else if (age <= 29) delta = gap * 0.005;
  else delta = -((age - 29) * 0.12 + (age >= 33 ? 0.2 : 0));
  if (delta > 0) delta *= growth;
  return delta * (0.7 + rng.next() * 0.6);
}

// 종합 능력 변화량을 능력치로 나눠 준다. 소수 부분은 progress에 쌓였다가 1이 넘으면 반영된다.
// boost: 성장할 때 능력치별 배율 (훈련 중점)
export function applyDelta(player, delta, boost = null) {
  const weights = POSITION_WEIGHTS[player.position];
  player.progress ??= {};
  for (const key of ATTRIBUTE_KEYS) {
    let d = weights[key] ? delta / 5 : delta / 10;
    if (delta < 0 && PHYSICAL.has(key)) d *= 1.6;
    if (delta > 0 && boost) d *= boost(key);
    const v = (player.progress[key] ?? 0) + d;
    const whole = v >= 1 ? Math.floor(v) : v <= -1 ? Math.ceil(v) : 0;
    player.progress[key] = Math.round((v - whole) * 1000) / 1000;
    if (whole) player.attrs[key] = Math.max(1, Math.min(20, player.attrs[key] + whole));
  }
  const now = overall(player);
  if (now > player.potential) player.potential = now;
}

// 매달 1일: active 구단과 유스는 성장/노화, 보관 구단 선수는 노화만
export function monthlyDevelopment(state, rng) {
  const youthIds = new Set();
  const archivedIds = new Set();
  for (const club of Object.values(state.clubs)) {
    if (club.status === 'archived') for (const id of club.squad) archivedIds.add(id);
    else for (const id of club.youth) youthIds.add(id);
  }
  const growth = new Map(Object.values(state.clubs).map((c) => [c.id, growthFactor(c) * intensityOf(c).growth]));
  const boosts = new Map(Object.values(state.clubs).map((c) => [c.id, focusBoost(c)]));
  for (const p of Object.values(state.players)) {
    if (p.retired || !p.clubId) continue;
    const age = ageOn(p, state.date);
    if (archivedIds.has(p.id) && age < 31) continue;
    const delta = monthlyDelta(rng, p, age, { minutes: p.minutesMonth ?? 0, youth: youthIds.has(p.id), growth: growth.get(p.clubId) });
    applyDelta(p, delta, youthIds.has(p.id) ? null : boosts.get(p.clubId));
    p.minutesMonth = 0;
  }
}

// 은퇴 확률 (시즌 종료 시)
export function retirementChance(age, ovr) {
  if (age >= 39) return 1;
  if (age < 32) return 0;
  return Math.min(1, (age - 31) * 0.15 + (ovr < 55 ? 0.1 : 0));
}

const POSITION_POOL = Object.entries(SQUAD_TEMPLATE);

// 유스 입단: 아카데미가 높을수록 현재 능력, 유스 코치가 높을수록 잠재력이 높다
export function youthIntake(state, rng, club) {
  const n = rng.int(4, 8);
  const golden = rng.chance(0.05);
  const players = [];
  for (let i = 0; i < n; i++) {
    const pos = rng.weighted(POSITION_POOL, ([, count]) => count)[0];
    const age = rng.int(15, 16);
    const target = Math.max(28, youthIntakeAbility(club) + rng.normal(0, 4));
    const boost = youthPotentialBoost(club) + boostFor(state, club).youth + (golden ? 8 : 0) + rng.normal(0, 3);
    const p = generatePlayer(rng, {
      id: `p${state.ids.player++}`, pos, target, age, country: club.country,
      seasonStart: `${state.season}-07-01`, potentialBoost: boost,
    });
    p.clubId = club.id;
    p.youthSince = state.date;
    // 시즌 시작일 기준으로 만든 생일을 입단일 기준 나이에 맞춘다
    if (ageOn(p, state.date) > age) {
      const [y, m, d] = p.birthDate.split('-');
      p.birthDate = `${Number(y) + 1}-${m}-${d}`;
    }
    state.players[p.id] = p;
    club.youth.push(p.id);
    players.push(p);
  }
  return { players, golden };
}

// 유스 콜업 예외 대상: 21세 이하이고 유스에서 2년 이상
export function isHomegrownYouth(player, date) {
  if (!player.youthSince) return false;
  const [y, m, d] = player.youthSince.split('-').map(Number);
  const twoYears = `${y + 2}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return ageOn(player, date) <= 21 && date >= twoYears;
}
