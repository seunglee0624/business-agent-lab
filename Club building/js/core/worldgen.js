// 세계 생성: 리그 규칙에 맞춰 가상 구단과 선수를 만든다.

import { ATTRIBUTE_KEYS, GK_ATTRIBUTE_KEYS, POSITION_WEIGHTS, SECONDARY_CANDIDATES } from '../data/positions.js';
import { NATIONS, NATIONALITY_MIX, formatName } from '../data/nations.js';
import { ENGLAND_CITIES, ENGLAND_SUFFIXES, ENGLAND_DISTRICTS } from '../data/england.js';
import { overallAt } from './player.js';
import { defaultTactics } from './tactics.js';

// 구단당 25명 구성
export const SQUAD_TEMPLATE = {
  GK: 3, CB: 4, LB: 2, RB: 2, DM: 2, CM: 3, LM: 1, RM: 1, AM: 2, LW: 1, RW: 1, ST: 3,
};

const CLUB_COLORS = ['#c8102e', '#034694', '#6cabdd', '#fdb913', '#132257', '#ffffff', '#000000', '#7a263a',
  '#00a650', '#ef0107', '#1b458f', '#f78f1e', '#670e36', '#95bfe5', '#ee2737', '#241f20'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function cityPool() {
  const pool = [];
  for (const city of ENGLAND_CITIES) {
    const districts = ENGLAND_DISTRICTS[city.name];
    if (districts) {
      for (const d of districts) pool.push({ ...city, name: d, base: city.name });
    } else {
      pool.push({ ...city, base: city.name });
    }
  }
  return pool;
}

function clubName(rng, city, used) {
  const options = rng.shuffle(ENGLAND_SUFFIXES.filter((s) => !city.avoid.includes(s)));
  for (const suffix of options) {
    const name = `${city.name} ${suffix}`;
    if (!used.has(name)) return name;
  }
  return `${city.name} FC`;
}

function generateClubs(rng, rule, startId) {
  const pool = cityPool();
  const picked = [];
  const remaining = pool.slice();
  while (picked.length < rule.teams) {
    // 같은 도시의 구단이 이미 있으면 확률을 크게 낮춘다 (런던 지역 구단이 몰리지 않게)
    const city = rng.weighted(remaining, (c) => c.size ** 1.5 * 0.3 ** picked.filter((p) => p.base === c.base).length);
    picked.push(city);
    remaining.splice(remaining.indexOf(city), 1);
  }

  // 도시 규모 + 운으로 순서를 매겨 강팀/중위권/약팀을 나눈다
  const ranked = picked
    .map((city) => ({ city, score: city.size + rng.normal(0, 1.2) }))
    .sort((a, b) => b.score - a.score);

  const used = new Set();
  const clubs = [];
  ranked.forEach(({ city }, i) => {
    const tier = i < rule.tiers.strong ? 'strong' : i < rule.tiers.strong + rule.tiers.mid ? 'mid' : 'weak';
    const name = clubName(rng, city, used);
    used.add(name);
    const [primary, secondary] = rng.shuffle(CLUB_COLORS);
    clubs.push({
      id: `c${startId + i}`,
      name,
      city: city.name,
      country: rule.country,
      leagueId: rule.id,
      tier,
      level: rule.tierLevel[tier] + rng.normal(0, 1.5),
      reputation: 0,
      colors: { primary, secondary },
      squad: [],
      tactics: null,
    });
  });
  return clubs;
}

function randomNation(rng, country) {
  const mix = NATIONALITY_MIX[country];
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

function generatePlayer(rng, { id, pos, target, age, country, seasonStart }) {
  const nation = randomNation(rng, country);
  const attrs = generateAttributes(rng, pos, target);
  const current = overallAt(attrs, pos);
  const growth = age < 24 ? (24 - age) * rng.float(1, 3.5) : 0;
  const potential = clamp(Math.round(current + growth + rng.float(0, 3)), current, 96);

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

export function generateLeague(rng, rule, { seasonStart, clubStartId = 1, playerStartId = 1 }) {
  const clubs = generateClubs(rng, rule, clubStartId);
  const players = [];
  let pid = playerStartId;
  for (const club of clubs) {
    for (const { pos, depth } of squadSlots()) {
      const { offset, age } = depthProfile(rng, pos, depth, SQUAD_TEMPLATE[pos]);
      const target = clamp(club.level + offset, 30, 95);
      const player = generatePlayer(rng, { id: `p${pid++}`, pos, target, age, country: rule.country, seasonStart });
      player.clubId = club.id;
      club.squad.push(player.id);
      players.push(player);
    }
    club.reputation = Math.round(club.level);
    club.tactics = defaultTactics();
  }
  return { clubs, players };
}
