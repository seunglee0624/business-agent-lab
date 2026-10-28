// 위임: 분야별로 감독이 직접 할지(manager) 스태프에게 맡길지(staff). 맡긴 결과의 품질은 스태프 수준을 따른다

import { TRAINING_FOCUS } from './training.js';
import { overall, ageOn } from './player.js';
import { monthsBetween } from './money.js';
import { renewalDemand, offerRenewal } from './contracts.js';

export const DELEGATION_AREAS = {
  training: { name: '주간 훈련', staff: 'coach' },
  youth: { name: '유스 관리 (콜업)', staff: 'youthCoach' },
  renewals: { name: '주전이 아닌 선수 재계약', staff: 'coach' },
};
export const DEFAULT_DELEGATION = { training: 'staff', youth: 'staff', renewals: 'staff' };

export const delegationOf = (club) => club.delegation ?? DEFAULT_DELEGATION;
export const delegated = (club, area) => delegationOf(club)[area] === 'staff';

export function setDelegation(club, changes) {
  const next = { ...delegationOf(club) };
  for (const [area, who] of Object.entries(changes)) {
    if (!DELEGATION_AREAS[area] || !['staff', 'manager'].includes(who)) return { ok: false, reason: '알 수 없는 위임 설정입니다.' };
    next[area] = who;
  }
  club.delegation = next;
  return { ok: true };
}

// ---- 훈련을 맡겼을 때 코치의 판단 ----

const TIRED = 85; // 선수단 평균 컨디션이 이보다 낮으면 가볍게

// daysToMatch: 다음 경기까지 남은 날 (없으면 Infinity)
export function coachTraining(state, club, daysToMatch) {
  const squad = club.squad.map((id) => state.players[id]).filter((p) => !p.injury);
  const avg = squad.reduce((s, p) => s + p.condition, 0) / Math.max(1, squad.length);
  const coach = club.staff.coach;
  // 강하게는 경기까지 여유가 많고 코치 수준이 높을 때만 (부상 위험 때문에)
  const intensity = avg < TIRED ? 'light' : coach >= 15 && daysToMatch >= 5 ? 'hard' : 'normal';
  // 수준 높은 코치는 선수단이 상대적으로 약한 쪽을 골라 키운다
  let focus = 'balanced';
  if (coach >= 8) {
    const groupAvg = (keys) => squad.reduce((s, p) => s + keys.reduce((t, k) => t + p.attrs[k], 0) / keys.length, 0) / Math.max(1, squad.length);
    focus = ['attack', 'defense', 'physical', 'tactical'].sort((a, b) => groupAvg(TRAINING_FOCUS[a].keys) - groupAvg(TRAINING_FOCUS[b].keys))[0];
  }
  club.training = { focus, intensity };
}

// ---- 유스를 맡겼을 때 유스 코치의 판단 ----

// 1군에 올릴 만한 유스. 수준 낮은 코치는 기준이 느슨해 덜 자란 선수도 올린다
export function youthToCallUp(state, club) {
  const bar = club.level - 4 - (20 - club.staff.youthCoach) / 4;
  return club.youth.map((id) => state.players[id])
    .filter((p) => overall(p) >= bar)
    .sort((a, b) => overall(b) - overall(a));
}

// ---- 재계약을 맡겼을 때 ----

const RENEW_BEFORE = 3; // 계약이 이만큼(개월) 남으면 처리한다

// 주전이 아닌 선수: 쓸 만하면 선수 요구대로 재계약, 아니면 내보낸다고 알린다 (한 번만).
// 수준 높은 코치일수록 기준이 정확하다(구단 수준에 가깝다). 돌려주는 값: [{ player, renewed }]
export function staffRenewals(state, club) {
  const bar = club.level - 6 - (20 - club.staff.coach) / 4;
  const done = [];
  for (const id of club.squad) {
    const p = state.players[id];
    if (!p.contract || p.contract.promise === 'starter' || p.renewalDecided) continue;
    if (monthsBetween(state.date, p.contract.until) > RENEW_BEFORE) continue;
    const worth = overall(p) >= bar && ageOn(p, state.date) <= 31;
    const renewed = worth && offerRenewal(state, club, p, renewalDemand(state, club, p)).ok;
    if (!renewed) p.renewalDecided = true;
    done.push({ player: p, renewed });
  }
  return done;
}
