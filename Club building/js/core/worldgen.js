// 세계 생성: 나라별 리그 규칙에 맞춰 가상 구단과 선수를 만든다.

import { ATTRIBUTE_KEYS, GK_ATTRIBUTE_KEYS, POSITION_WEIGHTS, SECONDARY_CANDIDATES } from '../data/positions.js';
import { NATIONS, formatName } from '../data/nations.js';
import { COUNTRIES } from '../data/countries/index.js';
import { overallAt } from './player.js';
import { defaultTactics } from './tactics.js';

// 구단당 25명 구성
export const SQUAD_TEMPLATE = {
  GK: 3, CB: 4, LB: 2, RB: 2, DM: 2, CM: 3, LM: 1, RM: 1, AM: 2, LW: 1, RW: 1, ST: 3,
};

// AI 구단 포메이션 선택 비율
const FORMATION_POPULARITY = {
  '4-2-3-1': 6, '4-3-3': 6, '4-4-2': 4, '3-5-2': 2, '3-4-3': 2, '4-1-4-1': 2, '5-3-2': 1, '4-1-2-1-2': 1, '4-5-1': 1,
};

const CLUB_COLORS = ['#c8102e', '#034694', '#6cabdd', '#fdb913', '#132257', '#ffffff', '#000000', '#7a263a',
  '#00a650', '#ef0107', '#1b458f', '#f78f1e', '#670e36', '#95bfe5', '#ee2737', '#241f20'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ids: { club, player } 다음에 쓸 번호. 여러 번 생성해도 겹치지 않도록 호출하는 쪽이 들고 있는다.
export function newIds() {
  return { club: 1, player: 1 };
}

function cityPool(country) {
  const pool = [];
  for (const city of country.cities) {
    const districts = country.districts?.[city.name];
    if (districts) {
      for (const d of districts) pool.push({ ...city, name: d, base: city.name });
    } else {
      pool.push({ ...city, base: city.name });
    }
  }
  return pool;
}

// 도시를 하나 고른다. 같은 도시의 구단이 이미 있으면 확률을 크게 낮춘다 (한 도시에 몰리지 않게)
function pickCity(rng, pool, takenBases) {
  return rng.weighted(pool, (c) => c.size ** 1.5 * 0.3 ** (takenBases.get(c.base) ?? 0));
}

// 패턴에 도시를 넣어 이름을 만든다. 실제 구단 이름과 이미 쓴 이름은 피한다.
export function clubName(rng, country, cityName, usedNames) {
  const real = new Set(country.realNames);
  for (const pattern of rng.shuffle(country.patterns)) {
    const name = pattern.replace('{c}', cityName);
    if (!real.has(name) && !usedNames.has(name)) return name;
  }
  return null;
}

function makeClub(rng, { id, name, city, country, rule, tier }) {
  const [primary, secondary] = rng.shuffle(CLUB_COLORS);
  const level = rule.tierLevel[tier] + rng.normal(0, 1.5);
  return {
    id,
    name,
    city,
    country: country.code,
    leagueId: rule.id,
    status: 'active', // active | archived(3부에서 강등되어 보관 중)
    tier,
    level,
    reputation: Math.round(level),
    colors: { primary, secondary },
    squad: [],
    youth: [],
    history: [],
    tactics: { ...defaultTactics(), formation: rng.weighted(Object.keys(FORMATION_POPULARITY), (f) => FORMATION_POPULARITY[f]) },
  };
}

// 한 나라의 1~3부 구단을 한꺼번에 만든다. 큰 도시일수록 윗 리그, 강팀이 될 확률이 높다.
function generateCountryClubs(rng, country, ids, usedNames) {
  const total = country.leagues.reduce((s, l) => s + l.teams, 0);
  const pool = cityPool(country);
  const taken = new Map();
  const picked = [];
  while (picked.length < total) {
    const city = pickCity(rng, pool.filter((c) => !picked.includes(c)), taken);
    picked.push(city);
    taken.set(city.base, (taken.get(city.base) ?? 0) + 1);
  }
  const ranked = picked
    .map((city) => ({ city, score: city.size + rng.normal(0, 1.2) }))
    .sort((a, b) => b.score - a.score);

  const clubs = [];
  let offset = 0;
  for (const rule of country.leagues) {
    ranked.slice(offset, offset + rule.teams).forEach(({ city }, i) => {
      const tier = i < rule.tiers.strong ? 'strong' : i < rule.tiers.strong + rule.tiers.mid ? 'mid' : 'weak';
      const name = clubName(rng, country, city.name, usedNames) ?? `${city.name} ${ids.club}`;
      usedNames.add(name);
      clubs.push(makeClub(rng, { id: `c${ids.club++}`, name, city: city.name, country, rule, tier }));
    });
    offset += rule.teams;
  }
  return clubs;
}

// 하부 리그에서 새로 올라오는 구단 하나 (3부 약팀 수준)
export function generatePromotedClub(rng, country, rule, { ids, usedNames, takenCities, seasonStart }) {
  const pool = cityPool(country);
  let name = null;
  let city = null;
  for (let tries = 0; tries < 50 && !name; tries++) {
    city = pickCity(rng, pool, takenCities);
    name = clubName(rng, country, city.name, usedNames);
  }
  if (!name) name = `${city.name} ${ids.club}`;
  usedNames.add(name);
  const club = makeClub(rng, { id: `c${ids.club++}`, name, city: city.name, country, rule, tier: 'weak' });
  const players = generateSquad(rng, club, { ids, seasonStart });
  return { club, players };
}

function randomNation(rng, countryCode) {
  const mix = COUNTRIES[countryCode].nationalities;
  return rng.weighted(Object.keys(mix), (k) => mix[k]);
}

function randomName(rng, nation) {
  const n = NATIONS[nation];
  return formatName(nation, rng.pick(n.first), rng.pick(n.last));
}

// 목표 종합 능력(1~100)에 맞춰 능력치를 만든다
export function generateAttributes(rng, pos, target) {
  const base = target / 5;
  const weights = POSITION_WEIGHTS[pos];
  const attrs = {};
  for (const key of ATTRIBUTE_KEYS) {
    const isGkAttr = GK_ATTRIBUTE_KEYS.includes(key);
    let v;
    if (pos === 'GK') {
      v = weights[key] ? base + rng.normal(0, 1.2) : isGkAttr ? base : base * 0.45 + rng.normal(0, 2);
    } else if (isGkAttr) {
      v = rng.int(1, 4);
    } else if (weights[key]) {
      v = base + (weights[key] - 2.5) * 0.4 + rng.normal(0, 1.3);
    } else {
      v = base * 0.7 + rng.normal(0, 2.2);
    }
    attrs[key] = v;
  }
  // 종합 능력이 목표에 맞도록 주요 능력치를 한 번 보정한다
  const clampAll = () => {
    for (const key of ATTRIBUTE_KEYS) attrs[key] = clamp(Math.round(attrs[key]), 1, 20);
  };
  clampAll();
  for (let pass = 0; pass < 3; pass++) {
    const diff = (target - overallAt(attrs, pos)) / 5;
    if (Math.abs(diff) < 0.2) break;
    for (const key of Object.keys(weights)) attrs[key] += diff;
    clampAll();
  }
  return attrs;
}

function birthDateFor(rng, age, seasonStart) {
  const year = Number(seasonStart.slice(0, 4)) - age - 1;
  const month = rng.int(1, 12);
  const day = rng.int(1, 28);
  // 시즌 시작일(7월 1일) 기준 나이가 age가 되도록, 생일이 7월 1일 이전이면 한 해 늦게 태어난 것으로 한다
  const afterStart = month > 7 || (month === 7 && day > 1);
  const y = afterStart ? year : year + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function generatePlayer(rng, { id, pos, target, age, country, seasonStart, potentialBoost = 0 }) {
  const nation = randomNation(rng, country);
  const attrs = generateAttributes(rng, pos, target);
  const current = overallAt(attrs, pos);
  const growth = age < 24 ? (24 - age) * rng.float(1, 3.5) : 0;
  const potential = clamp(Math.round(current + growth + rng.float(0, 3) + potentialBoost), current, 96);

  const secondary = [];
  for (const cand of rng.shuffle(SECONDARY_CANDIDATES[pos])) {
    if (secondary.length < 2 && rng.chance(0.35)) secondary.push(cand);
  }

  return {
    id,
    name: randomName(rng, nation),
    nation,
    birthDate: birthDateFor(rng, age, seasonStart),
    position: pos,
    secondary,
    attrs,
    potential,
    condition: 100,
    morale: 70,
    clubId: null,
    injury: null,
    youthSince: null,
    retired: false,
    stats: {},
  };
}

function squadSlots() {
  const slots = [];
  for (const [pos, count] of Object.entries(SQUAD_TEMPLATE)) {
    for (let depth = 0; depth < count; depth++) slots.push({ pos, depth });
  }
  return slots;
}

// 포지션 내 순번(depth)에 따른 능력 차이와 나이
function depthProfile(rng, pos, depth, count) {
  // 주전 경쟁 자리 수: 센터백 2, 스트라이커 1~2 등 포지션 깊이에 비례
  const starters = { GK: 1, CB: 2, LB: 1, RB: 1, DM: 1, CM: 2, LM: 1, RM: 1, AM: 1, LW: 1, RW: 1, ST: 2 }[pos];
  if (depth < starters) return { offset: rng.normal(0, 3), age: clamp(Math.round(rng.normal(27, 3.5)), 19, 35) };
  if (depth === count - 1 && count >= 3) return { offset: -11 + rng.normal(0, 3), age: rng.int(17, 20) };
  return { offset: -5 + rng.normal(0, 3), age: clamp(Math.round(rng.normal(26, 4.5)), 18, 35) };
}

// 구단 수준에 맞춰 25명을 만든다
export function generateSquad(rng, club, { ids, seasonStart }) {
  const players = [];
  for (const { pos, depth } of squadSlots()) {
    const { offset, age } = depthProfile(rng, pos, depth, SQUAD_TEMPLATE[pos]);
    const target = clamp(club.level + offset, 30, 95);
    const player = generatePlayer(rng, { id: `p${ids.player++}`, pos, target, age, country: club.country, seasonStart });
    player.clubId = club.id;
    club.squad.push(player.id);
    players.push(player);
  }
  return players;
}

// 5개 나라 1~3부 전체
export function generateWorld(rng, { seasonStart, ids = newIds() }) {
  const usedNames = new Set();
  const clubs = [];
  const players = [];
  for (const country of Object.values(COUNTRIES)) {
    for (const club of generateCountryClubs(rng, country, ids, usedNames)) {
      clubs.push(club);
      players.push(...generateSquad(rng, club, { ids, seasonStart }));
    }
  }
  return { clubs, players, ids };
}

// 리그 하나만 (테스트·측정용)
export function generateLeague(rng, rule, { seasonStart, ids = newIds() }) {
  const country = { ...COUNTRIES[rule.country], leagues: [rule] };
  const clubs = generateCountryClubs(rng, country, ids, new Set());
  const players = clubs.flatMap((club) => generateSquad(rng, club, { ids, seasonStart }));
  return { clubs, players };
}
