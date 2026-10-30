// 시설(1~5)과 스태프(1~20): 처음 수준, 효과, 업그레이드와 공사

import {
  EUR, FACILITY_KEYS, FACILITIES, MAX_FACILITY, STAFF_KEYS, MAX_STAFF, STADIUM_BASE, STADIUM_LEVELS, STADIUM_TARGET,
  upgradeCost, upgradeMonths,
} from '../data/economy.js';
import { LEAGUES } from '../data/countries/index.js';
import { expense, spendCheck } from './finance.js';
import { addMonths } from './calendar.js';
import { roundMoney } from './money.js';
import { addMessage } from './state.js';
import { withParticle } from './korean.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function stadiumLevel(capacity) {
  let level = 1;
  STADIUM_LEVELS.forEach((min, i) => { if (capacity >= min) level = i + 1; });
  return level;
}

// 구단을 만들 때 시설·스태프·경기장을 정한다 (리그 단계와 구단 수준 기준)
export function initClubOps(rng, club) {
  const tier = LEAGUES[club.leagueId].tier;
  const base = { 1: 4, 2: 3, 3: 2 }[tier] + { strong: 1, mid: 0, weak: -1 }[club.tier];
  const capacity = Math.round((STADIUM_BASE[tier][club.tier] * (0.75 + 0.1 * (club.citySize ?? 3)) * rng.float(0.85, 1.15)) / 100) * 100;
  club.stadium = { capacity };
  club.facilities = {};
  for (const key of FACILITY_KEYS) {
    club.facilities[key] = key === 'stadium' ? stadiumLevel(capacity) : clamp(base + (rng.chance(0.3) ? rng.pick([-1, 1]) : 0), 1, MAX_FACILITY);
  }
  club.staff = {};
  for (const key of STAFF_KEYS) club.staff[key] = clamp(Math.round((club.level - 40) / 2.6 + rng.normal(0, 2)), 1, MAX_STAFF);
  club.construction = [];
}

// ---- 효과 (평균적인 구단이 1.0 근처가 되도록) ----

// 감독이 없으면 코치가 임시로 맡아 능력이 절반으로 친다
const headCoachAbility = (club) => club.headCoach?.ability ?? club.staff.coach / 2;
export const growthFactor = (club) => 0.71 + 0.05 * club.facilities.training + 0.01 * club.staff.coach + 0.006 * (headCoachAbility(club) - 10);
export const injuryChanceFactor = (club) => 1.2 - 0.06 * club.facilities.sportsScience - 0.008 * club.staff.medical;
export const injuryDaysFactor = (club) => 1.15 - 0.05 * club.facilities.medical - 0.005 * club.staff.medical;
export const recoveryFactor = (club) => 0.85 + 0.05 * club.facilities.recovery;
// 유스 입단: 아카데미 → 현재 능력, 유스 코치 → 잠재력. 구단 수준·평판과는 상관없다
// (구단 전력을 따라가면 강해진 구단이 더 강한 유스를 받아 리그 능력이 해마다 계단식으로 오른다)
export const youthIntakeAbility = (club) => 24 + club.facilities.academy * 3;
export const youthPotentialBoost = (club) => (club.staff.youthCoach - 10) * 0.8;

export function capacity(club) {
  const building = club.construction.some((c) => c.key === 'stadium');
  return Math.round(club.stadium.capacity * (building ? 0.8 : 1));
}

// ---- 업그레이드 ----

export function upgradeInfo(club, key) {
  const level = club.facilities[key];
  if (level >= MAX_FACILITY) return null;
  return { level, cost: roundMoney(upgradeCost(key, level) * EUR), months: upgradeMonths(key, level) };
}

export const isBuilding = (club, key) => club.construction.some((c) => c.key === key);

// 업그레이드 요청. 수뇌부는 잔고가 비용의 1.3배 이상이고, (내 구단이면) 신뢰도가 40 이상일 때 승인한다
export function requestUpgrade(state, club, key) {
  const info = upgradeInfo(club, key);
  if (!info) return { ok: false, reason: '이미 최고 레벨입니다.' };
  if (isBuilding(club, key)) return { ok: false, reason: '이미 공사 중입니다.' };
  const short = spendCheck(club, info.cost);
  if (short) return { ok: false, reason: short };
  expense(club, 'construction', info.cost);
  club.construction.push({ key, toLevel: info.level + 1, start: state.date, done: addMonths(state.date, info.months) });
  return { ok: true, ...info };
}

// 매일: 끝난 공사를 반영한다
export function completeConstruction(state, club, isUser) {
  if (!club.construction.length) return;
  for (const c of club.construction.filter((x) => state.date >= x.done)) {
    club.facilities[c.key] = c.toLevel;
    if (c.key === 'stadium') club.stadium.capacity = Math.max(Math.round(club.stadium.capacity * 1.2), STADIUM_TARGET[c.toLevel]);
    if (isUser) addMessage(state, { view: 'club', title: `${FACILITIES[c.key].name} 공사 완료`, body: `${withParticle(FACILITIES[c.key].name, '가')} ${c.toLevel}레벨이 되었습니다.` });
  }
  club.construction = club.construction.filter((x) => state.date < x.done);
}
