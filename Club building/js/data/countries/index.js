// 나라와 리그 목록

import { ENGLAND } from './england.js';
import { GERMANY } from './germany.js';
import { SPAIN } from './spain.js';
import { ITALY } from './italy.js';
import { FRANCE } from './france.js';

export const COUNTRIES = { ENG: ENGLAND, ESP: SPAIN, GER: GERMANY, ITA: ITALY, FRA: FRANCE };
export const COUNTRY_KEYS = Object.keys(COUNTRIES);

export const LEAGUES = Object.fromEntries(
  Object.values(COUNTRIES).flatMap((c) => c.leagues.map((l) => [l.id, l])),
);

// 같은 나라의 한 단계 위·아래 리그
export function leagueAbove(leagueId) {
  const l = LEAGUES[leagueId];
  return COUNTRIES[l.country].leagues.find((x) => x.tier === l.tier - 1) ?? null;
}

export function leagueBelow(leagueId) {
  const l = LEAGUES[leagueId];
  return COUNTRIES[l.country].leagues.find((x) => x.tier === l.tier + 1) ?? null;
}

export const BOTTOM_TIER = 3;
