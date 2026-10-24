// 선수와 팀의 경기 중 전력 계산

import { ROLES } from '../../data/roles.js';
import { familiarity } from '../player.js';

// 단위 능력(1~20): 수비, 중원, 창출, 마무리
const UNIT_ATTRS = {
  defend: { tackling: 3, marking: 3, positioning: 3, strength: 2, heading: 1, pace: 1 },
  control: { passing: 3, vision: 2, composure: 2, workRate: 2, dribbling: 1 },
  create: { passing: 2, vision: 3, crossing: 2, dribbling: 2, offTheBall: 1 },
  finish: { finishing: 4, composure: 2, offTheBall: 2, heading: 1, longShots: 1 },
};

const KEEPER_ATTRS = { reflexes: 3, handling: 2, oneOnOne: 2, positioning: 2 };

// 가중치 표를 [키, 가중치] 배열과 합계로 미리 펴 둔다 (경기 중 매 분 계산하므로)
const flat = (weights) => {
  const entries = Object.entries(weights);
  return { entries, total: entries.reduce((s, [, w]) => s + w, 0) };
};
const FLAT = {
  defend: flat(UNIT_ATTRS.defend),
  control: flat(UNIT_ATTRS.control),
  create: flat(UNIT_ATTRS.create),
  finish: flat(UNIT_ATTRS.finish),
  keeper: flat(KEEPER_ATTRS),
};

function weighted(attrs, { entries, total }) {
  let s = 0;
  for (const [k, w] of entries) s += attrs[k] * w;
  return s / total;
}

export function unitScores(attrs) {
  return {
    defend: weighted(attrs, FLAT.defend),
    control: weighted(attrs, FLAT.control),
    create: weighted(attrs, FLAT.create),
    finish: weighted(attrs, FLAT.finish),
  };
}

export function keeperScore(attrs) {
  return weighted(attrs, FLAT.keeper);
}

// 체력이 떨어질수록 능력이 떨어진다 (100 → 1.0, 50 → 0.85)
export function energyFactor(energy) {
  return 0.7 + 0.3 * Math.min(100, Math.max(0, energy)) / 100;
}

// 선수 한 명의 경기 중 효율 (체력 × 포지션 적합도)
export function playerEfficiency(slot, player) {
  if (slot.famKey !== `${slot.playerId}|${slot.pos}`) {
    slot.famKey = `${slot.playerId}|${slot.pos}`;
    slot.fam = familiarity(player, slot.pos);
  }
  return energyFactor(slot.energy) * slot.fam;
}

const MENTALITY = {
  defensive: { defend: 1.1, control: 1.0, create: 0.88, finish: 0.96 },
  balanced: { defend: 1, control: 1, create: 1, finish: 1 },
  attacking: { defend: 0.9, control: 1.0, create: 1.12, finish: 1.04 },
};
const PRESSING = {
  low: { defend: 1.04, control: 0.95 },
  normal: { defend: 1, control: 1 },
  high: { defend: 0.98, control: 1.08 },
};
const TEMPO = {
  slow: { control: 1.04, rate: 0.88 },
  normal: { control: 1, rate: 1 },
  fast: { control: 0.97, rate: 1.12 },
};
const LINE = {
  deep: { defend: 1.05, control: 0.95 },
  normal: { defend: 1, control: 1 },
  high: { defend: 0.97, control: 1.05 },
};

export const PRESSING_ENERGY = { low: 0.85, normal: 1, high: 1.25 };
export const PRESSING_FOULS = { low: 0.85, normal: 1, high: 1.2 };

// 팀 전력: 역할 기여도 × 선수 단위 능력 × 효율의 합에 전술 보정
export function teamStrength(side, players, homeBonus) {
  const units = { defend: 0, control: 0, create: 0, finish: 0 };
  let keeper = 5;
  let backlinePace = 0;
  let backlineCount = 0;
  for (const slot of side.onPitch) {
    if (slot.sentOff || slot.injured) continue;
    const p = players[slot.playerId];
    const role = ROLES[slot.role];
    const eff = playerEfficiency(slot, p);
    const s = (p.units ??= unitScores(p.attrs));
    units.defend += role.defend * s.defend * eff;
    units.control += role.control * s.control * eff;
    units.create += role.create * s.create * eff;
    units.finish += role.finish * s.finish * eff;
    if (slot.pos === 'GK') keeper = (p.keeper ??= keeperScore(p.attrs)) * eff;
    if (slot.pos === 'CB') {
      backlinePace += p.attrs.pace;
      backlineCount++;
    }
  }
  const t = side.tactics;
  const m = MENTALITY[t.mentality];
  const pr = PRESSING[t.pressing];
  const te = TEMPO[t.tempo];
  const li = LINE[t.line];
  return {
    defend: units.defend * m.defend * pr.defend * li.defend * homeBonus,
    control: units.control * m.control * pr.control * te.control * li.control * homeBonus,
    create: units.create * m.create * homeBonus,
    finish: units.finish * m.finish * homeBonus,
    keeper,
    rate: te.rate,
    // 수비 라인을 높게 올렸는데 센터백이 느리면 뒷공간을 내준다
    exposure: t.line === 'high' ? Math.max(0, (14 - backlinePace / Math.max(1, backlineCount)) * 0.04) : 0,
  };
}
