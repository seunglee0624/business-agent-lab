// 부상 배정과 회복

import { MATCH_INJURIES, TRAINING_INJURIES, TRAINING_INJURY_RATE } from '../data/injuries.js';
import { addDays } from './calendar.js';

// 복귀 직후 컨디션 (경기 감각이 떨어져 있다)
export const RETURN_CONDITION = 75;

// daysFactor: 의료 시설·의료진 보정 (1보다 작으면 빨리 낫는다)
export function assignInjury(rng, player, date, source = 'match', daysFactor = 1) {
  const table = source === 'match' ? MATCH_INJURIES : TRAINING_INJURIES;
  const kind = rng.weighted(table, (k) => k.weight);
  const days = Math.max(1, Math.round(rng.int(kind.min, kind.max) * daysFactor));
  player.injury = { name: kind.name, since: date, until: addDays(date, days), days };
  return player.injury;
}

// 하루 지날 때: 회복이 끝난 선수를 돌려준다
export function healOn(player, date) {
  if (player.injury && date >= player.injury.until) {
    player.injury = null;
    player.condition = Math.min(player.condition, RETURN_CONDITION);
    return true;
  }
  return false;
}

export function trainingInjuryRoll(rng, factor = 1) {
  return rng.chance(TRAINING_INJURY_RATE * factor);
}
