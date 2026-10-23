// 선수 관련 계산 (능력치 → 종합 능력, 포지션 적합도, 나이)

import { POSITION_WEIGHTS, positionFamiliarity, SECONDARY_FAMILIARITY } from '../data/positions.js';

// 해당 포지션 기준 종합 능력 (1~100)
export function overallAt(attrs, pos) {
  const weights = POSITION_WEIGHTS[pos];
  let sum = 0;
  let total = 0;
  for (const [key, w] of Object.entries(weights)) {
    sum += attrs[key] * w;
    total += w;
  }
  return Math.round((sum / total) * 5);
}

export function overall(player) {
  return overallAt(player.attrs, player.position);
}

export function familiarity(player, pos) {
  if (player.position === pos) return 1;
  if (player.secondary.includes(pos)) return SECONDARY_FAMILIARITY;
  return positionFamiliarity(player.position, pos);
}

// 그 포지션에 세웠을 때의 실질 능력
export function ratingAt(player, pos) {
  if (player.position === pos) return overall(player);
  return Math.round(Math.max(overallAt(player.attrs, pos), overall(player) * 0.8) * familiarity(player, pos));
}

export function ageOn(player, isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [by, bm, bd] = player.birthDate.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}
