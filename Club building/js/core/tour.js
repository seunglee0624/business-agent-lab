// 프리시즌 투어: 7월 1~15일에 지역을 고르면 7월 말까지 다녀온다. 초청료·해외 팬·피로와 부상 위험

import { EUR } from '../data/economy.js';
import { income } from './finance.js';
import { fansOf } from './fans.js';
import { assignInjury } from './injury.js';
import { roundMoney } from './money.js';

export const TOURS = {
  domestic: { name: '국내', fee: 0.3, gain: 0.02, fatigue: 3, injury: 0.005, nations: [] },
  europe: { name: '유럽', fee: 1, gain: 0.08, fatigue: 6, injury: 0.01, nations: ['ENG', 'SCO', 'IRL', 'ESP', 'FRA', 'GER', 'ITA', 'POR', 'NED', 'BEL', 'SUI', 'AUT', 'POL', 'DEN', 'CRO', 'SRB'] },
  asia: { name: '아시아', fee: 2, gain: 0.2, fatigue: 12, injury: 0.02, nations: ['JPN', 'KOR'] },
  namerica: { name: '북미', fee: 2, gain: 0.2, fatigue: 12, injury: 0.02, nations: ['USA'] },
  mideast: { name: '중동', fee: 2.5, gain: 0.1, fatigue: 7, injury: 0.012, nations: ['TUR', 'MAR', 'ALG'] },
};
export const TOUR_KEYS = Object.keys(TOURS);
export const TOUR_PICK_UNTIL = '07-15';
export const TOUR_END = '07-31';
const STAR_BONUS = 0.5; // 주전 선수의 나라로 가면 해외 팬 증가 +50%

export const canChooseTour = (state, club) => {
  const md = state.date.slice(5);
  return md >= '07-01' && md <= TOUR_PICK_UNTIL && !(club.tour && club.tour.season === state.season);
};

// 초청료: 평판이 높을수록 크다
export const tourFee = (club, region) => roundMoney(0.5e6 * EUR * TOURS[region].fee * Math.exp((club.reputation - 55) * 0.08));

// 주전 11명 중 그 지역 나라 선수
export function tourStars(state, club, region) {
  const nations = region === 'domestic' ? [club.country] : TOURS[region].nations;
  const ids = club.tactics.lineup?.map((e) => e?.playerId).filter(Boolean) ?? club.squad.slice(0, 11);
  return ids.map((id) => state.players[id]).filter((p) => p && nations.includes(p.nation));
}

export function tourGain(state, club, region) {
  const stars = tourStars(state, club, region).length;
  return Math.round(fansOf(club).overseas * TOURS[region].gain * (1 + Math.min(2, stars) * STAR_BONUS));
}

export function chooseTour(state, club, region) {
  if (!canChooseTour(state, club)) return { ok: false, reason: '투어는 7월 1~15일에만 정할 수 있고, 한 시즌에 한 번입니다.' };
  if (region !== 'none' && !TOURS[region]) return { ok: false, reason: '없는 지역입니다.' };
  club.tour = { season: state.season, region, done: region === 'none' };
  return { ok: true };
}

// 7월 31일: 투어를 마치고 초청료·해외 팬·피로·부상을 반영한다
export function finishTour(state, rng, club) {
  const t = club.tour;
  if (!t || t.done || t.season !== state.season || t.region === 'none') return null;
  const tour = TOURS[t.region];
  const fee = tourFee(club, t.region);
  const gain = tourGain(state, club, t.region);
  income(club, 'commercial', fee);
  fansOf(club).overseas += gain;
  const injured = [];
  for (const id of club.squad) {
    const p = state.players[id];
    if (!p) continue;
    p.condition = Math.max(50, p.condition - tour.fatigue);
    if (!p.injury && rng.chance(tour.injury)) {
      const inj = assignInjury(rng, p, state.date, 'training');
      injured.push(`${p.name}(${inj.name}, ${inj.days}일)`);
    }
  }
  Object.assign(t, { done: true, fee, gain, injured });
  return t;
}
