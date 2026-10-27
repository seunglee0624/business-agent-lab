// 경기 엔진. 1분씩 진행하며, 경기 상태(match)는 그대로 저장할 수 있는 순수 객체다.
// 내 경기는 화면에서 stepMinute를 반복 호출하고, 다른 경기는 simulateMatch로 한 번에 계산한다.

import { FORMATIONS } from '../../data/formations.js';
import { ROLES, DEFAULT_ROLE } from '../../data/roles.js';
import { ratingAt } from '../player.js';
import { teamStrength, energyFactor, PRESSING_ENERGY, PRESSING_FOULS } from './strength.js';

const HOME_BONUS = 1.06;
const POSSESSION_POWER = 1.6;
const ATTACK_RATE = 0.46;
// 같은 수준의 두 팀이 붙을 때 (창출 / 수비) 비율의 평균. 이 값으로 나눠 1 근처가 되게 한다.
export const BASE_RATIO = 0.49;

const XG = { big: 0.4, normal: 0.102, header: 0.085, long: 0.036 };
const ON_TARGET_IF_MISSED = { big: 0.42, normal: 0.3, header: 0.28, long: 0.24 };
const ASSIST_CHANCE = { big: 0.85, normal: 0.75, header: 0.95, long: 0.3 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function snapshot(p) {
  return { id: p.id, name: p.name, position: p.position, secondary: p.secondary, attrs: p.attrs, morale: p.morale };
}

function buildSide(setup, players, maxSubs) {
  const slots = FORMATIONS[setup.tactics.formation];
  const onPitch = [];
  setup.lineup.forEach((entry, i) => {
    if (!entry) return;
    onPitch.push({
      playerId: entry.playerId,
      pos: slots[i],
      role: entry.role,
      energy: players[entry.playerId].condition,
      yellow: 0,
      sentOff: false,
      injured: false,
    });
  });
  return {
    clubId: setup.clubId,
    tactics: {
      formation: setup.tactics.formation,
      mentality: setup.tactics.mentality,
      pressing: setup.tactics.pressing,
      tempo: setup.tactics.tempo,
      line: setup.tactics.line,
    },
    setPieceTaker: setup.tactics.setPieceTaker ?? null,
    onPitch,
    bench: setup.bench.slice(),
    used: [],
    subsUsed: 0,
    maxSubs,
    auto: setup.auto !== false, // 교체를 자동으로
    aiTactics: setup.aiTactics !== false, // 스코어에 따라 성향을 자동으로 바꿈 (AI 구단만)
    injuryFactor: setup.injuryFactor ?? 1, // 스포츠 과학 센터·의료진 보정
    score: 0,
    shots: 0,
    onTarget: 0,
    fouls: 0,
    possession: 0,
  };
}

function emptyStats(side, started) {
  return {
    side, started, minuteOn: started ? 0 : null, minuteOff: null,
    goals: 0, assists: 0, shots: 0, onTarget: 0, saves: 0, conceded: 0,
    yellow: 0, red: false, secondYellow: false, injured: false, involvement: 0, rating: null, energyEnd: null,
  };
}

// setup: { clubId, tactics, lineup(포메이션 슬롯 순서), bench, auto, aiTactics }
export function createMatch({ id, competitionId, date, home, away, players, maxSubs = 5 }) {
  const snap = {};
  const stats = {};
  const sides = [buildSide(home, players, maxSubs), buildSide(away, players, maxSubs)];
  sides.forEach((side, s) => {
    for (const slot of side.onPitch) stats[slot.playerId] = emptyStats(s, true);
    for (const id of side.bench) stats[id] = emptyStats(s, false);
    for (const pid of [...side.onPitch.map((x) => x.playerId), ...side.bench]) snap[pid] = snapshot(players[pid]);
  });
  return {
    id, competitionId, date,
    phase: 'pre',
    minute: 0,
    added: [0, 0],
    sides,
    players: snap,
    stats,
    events: [],
  };
}

export function clockLabel(match, minute = match.minute) {
  if (match.phase === 'first' && minute > 45) return `45+${minute - 45}'`;
  if ((match.phase === 'second' || match.phase === 'ft') && minute > 90) return `90+${minute - 90}'`;
  return `${minute}'`;
}

function push(match, event) {
  const e = { minute: match.minute, clock: clockLabel(match), ...event };
  match.events.push(e);
  return e;
}

const active = (side) => side.onPitch.filter((s) => !s.sentOff && !s.injured);

function pickPlayer(rng, slots, weightOf) {
  if (slots.length === 0) return null;
  return rng.weighted(slots, weightOf);
}

// ---- 공격과 슈팅 ----

function attack(match, rng, a, d, str, newEvents) {
  const att = match.sides[a];
  const def = match.sides[d];
  // 전력 차가 아주 커도 한쪽이 일방적으로 몰아붙이지 않도록 범위를 제한한다
  const ratio = clamp(str[a].create / Math.max(1, str[d].defend) / BASE_RATIO, 0.55, 1.8);
  const exposure = str[d].exposure;
  const pShot = clamp(0.5 * ratio ** 1.6 + exposure, 0.12, 0.88);
  const outfield = active(att).filter((s) => s.pos !== 'GK');

  if (!rng.chance(pShot)) {
    // 공격이 끊김: 수비수가 막아낸 기록, 공격 전개 기록
    const creator = pickPlayer(rng, outfield, (s) => ROLES[s.role].create + 0.1);
    const defender = pickPlayer(rng, active(def), (s) => ROLES[s.role].defend);
    if (creator) match.stats[creator.playerId].involvement += 0.02;
    if (defender) match.stats[defender.playerId].involvement += 0.03;
    if (creator && rng.chance(0.25)) {
      newEvents.push(push(match, { type: 'attack', side: a, playerId: creator.playerId, otherId: defender?.playerId ?? null }));
    }
    return;
  }

  const pBig = clamp(0.12 * ratio ** 1.8 + exposure, 0.02, 0.4);
  const pLong = clamp(0.22 / ratio, 0.08, 0.4);
  const pHeader = 0.16;
  const r = rng.next();
  const kind = r < pBig ? 'big' : r < pBig + pLong ? 'long' : r < pBig + pLong + pHeader ? 'header' : 'normal';

  const shooter = pickPlayer(rng, outfield, (s) => {
    const role = ROLES[s.role];
    const at = match.players[s.playerId].attrs;
    const skill = kind === 'long' ? at.longShots : kind === 'header' ? at.heading : at.finishing;
    return role.shot * (skill + 8) * energyFactor(s.energy);
  });
  if (!shooter) return;
  const sAttrs = match.players[shooter.playerId].attrs;
  const skill = kind === 'long' ? (sAttrs.longShots * 2 + sAttrs.composure) / 3
    : kind === 'header' ? (sAttrs.heading * 2 + sAttrs.strength) / 3
    : (sAttrs.finishing * 2 + sAttrs.composure) / 3;
  const quality = skill * energyFactor(shooter.energy);

  shot(match, rng, a, d, shooter, kind, quality, str, newEvents, outfield);
}

function shot(match, rng, a, d, shooter, kind, quality, str, newEvents, outfield) {
  const att = match.sides[a];
  const def = match.sides[d];
  const keeperSlot = active(def).find((s) => s.pos === 'GK');
  const keeper = keeperSlot ? str[d].keeper : 4;
  const st = match.stats[shooter.playerId];
  att.shots++;
  st.shots++;

  let assistId = null;
  if (kind !== 'penalty' && rng.chance(ASSIST_CHANCE[kind])) {
    const helper = pickPlayer(rng, outfield.filter((s) => s !== shooter), (s) => {
      const at = match.players[s.playerId].attrs;
      const skill = kind === 'header' ? at.crossing * 1.5 + at.passing * 0.5 : at.passing + at.vision;
      return (ROLES[s.role].assist + 0.05) * skill;
    });
    assistId = helper?.playerId ?? null;
  }

  const xg = kind === 'penalty' ? 0.72 : XG[kind];
  const power = kind === 'penalty' ? 0.3 : 1.2;
  const pGoal = clamp(xg * (quality / keeper) ** power, 0.005, 0.9);

  if (rng.chance(pGoal)) {
    att.score++;
    att.onTarget++;
    st.onTarget++;
    st.goals++;
    if (assistId) match.stats[assistId].assists++;
    for (const s of active(def)) match.stats[s.playerId].conceded++;
    newEvents.push(push(match, { type: 'goal', kind, side: a, playerId: shooter.playerId, assistId: kind === 'penalty' ? null : assistId }));
    return;
  }

  const onTargetP = kind === 'penalty' ? 0.6 : ON_TARGET_IF_MISSED[kind];
  if (rng.chance(onTargetP)) {
    att.onTarget++;
    st.onTarget++;
    if (keeperSlot) match.stats[keeperSlot.playerId].saves++;
    newEvents.push(push(match, { type: 'save', kind, side: a, playerId: shooter.playerId, otherId: keeperSlot?.playerId ?? null }));
  } else if (rng.chance(0.06)) {
    newEvents.push(push(match, { type: 'woodwork', kind, side: a, playerId: shooter.playerId }));
  } else {
    newEvents.push(push(match, { type: 'miss', kind, side: a, playerId: shooter.playerId }));
  }
}

// ---- 반칙과 카드 ----

function fouls(match, rng, attacking, str, newEvents) {
  for (let s = 0; s < 2; s++) {
    const side = match.sides[s];
    const defending = s !== attacking;
    const p = 0.105 * PRESSING_FOULS[side.tactics.pressing] * (defending ? 1.4 : 0.6);
    if (!rng.chance(p)) continue;
    // 경고를 받은 선수는 조심해서 반칙을 덜 한다
    const fouler = pickPlayer(rng, active(side), (slot) => {
      const at = match.players[slot.playerId].attrs;
      return (ROLES[slot.role].defend + 0.15) * (1.4 - at.tackling / 20) * (slot.yellow ? 0.35 : 1);
    });
    if (!fouler) continue;
    side.fouls++;
    const st = match.stats[fouler.playerId];

    if (rng.chance(0.003)) {
      sendOff(match, s, fouler, st, false, newEvents);
    } else if (rng.chance(fouler.yellow ? 0.09 : 0.185)) {
      if (fouler.yellow >= 1) {
        fouler.yellow++;
        st.yellow++;
        sendOff(match, s, fouler, st, true, newEvents);
      } else {
        fouler.yellow++;
        st.yellow++;
        newEvents.push(push(match, { type: 'yellow', side: s, playerId: fouler.playerId }));
      }
    }

    // 수비 중 페널티 박스 안 반칙 → 페널티킥
    if (defending && rng.chance(0.022)) {
      const opp = 1 - s;
      const takers = active(match.sides[opp]).filter((x) => x.pos !== 'GK');
      const chosen = takers.find((x) => x.playerId === match.sides[opp].setPieceTaker)
        ?? takers.slice().sort((x, y) => penaltySkill(match, y) - penaltySkill(match, x))[0];
      if (chosen) {
        newEvents.push(push(match, { type: 'penalty', side: opp, playerId: chosen.playerId, otherId: fouler.playerId }));
        shot(match, rng, opp, s, chosen, 'penalty', penaltySkill(match, chosen), str, newEvents, takers);
      }
    }
  }
}

function penaltySkill(match, slot) {
  const at = match.players[slot.playerId].attrs;
  return (at.finishing + at.composure * 2) / 3;
}

function sendOff(match, s, slot, st, secondYellow, newEvents) {
  slot.sentOff = true;
  st.red = true;
  st.secondYellow = secondYellow;
  st.minuteOff = match.minute;
  newEvents.push(push(match, { type: secondYellow ? 'secondYellow' : 'red', side: s, playerId: slot.playerId }));
}

// ---- 체력과 교체 ----

function drainEnergy(match) {
  for (const side of match.sides) {
    const pressing = PRESSING_ENERGY[side.tactics.pressing];
    for (const slot of side.onPitch) {
      if (slot.sentOff || slot.injured) continue;
      const stamina = match.players[slot.playerId].attrs.stamina;
      slot.energy = Math.max(0, slot.energy - 0.3 * (1.25 - (stamina / 20) * 0.5) * pressing);
    }
  }
}

export function substitute(match, s, outId, inId) {
  const side = match.sides[s];
  if (side.subsUsed >= side.maxSubs) return { ok: false, reason: '교체 횟수를 모두 썼습니다.' };
  const slot = side.onPitch.find((x) => x.playerId === outId && !x.sentOff);
  if (!slot) return { ok: false, reason: '그 선수는 경기장에 없습니다.' };
  if (!side.bench.includes(inId)) return { ok: false, reason: '그 선수는 교체 명단에 없습니다.' };

  side.bench = side.bench.filter((id) => id !== inId);
  side.used.push(outId);
  side.subsUsed++;
  match.stats[outId].minuteOff = match.minute;
  match.stats[outId].energyEnd = Math.round(slot.energy);
  match.stats[inId].minuteOn = match.minute;
  slot.playerId = inId;
  slot.energy = 100;
  slot.yellow = 0;
  slot.injured = false;
  const ev = push(match, { type: 'sub', side: s, playerId: inId, otherId: outId });
  return { ok: true, event: ev };
}

// ---- 부상 ----

// 선수 1명이 1분에 다칠 확률. 지칠수록 높아진다. 팀당 경기당 약 0.1~0.15건
const INJURY_RATE = 1.1e-4;

function injuries(match, rng, newEvents) {
  match.sides.forEach((side, s) => {
    for (const slot of active(side)) {
      const p = INJURY_RATE * side.injuryFactor * (1 + (100 - slot.energy) / 60) * (slot.pos === 'GK' ? 0.3 : 1);
      if (!rng.chance(p)) continue;
      slot.injured = true;
      match.stats[slot.playerId].injured = true;
      match.stats[slot.playerId].minuteOff = match.minute;
      newEvents.push(push(match, { type: 'injury', side: s, playerId: slot.playerId }));
    }
  });
}

// 자동 교체 팀은 다친 선수를 바로 바꾼다
function injurySubs(match, newEvents) {
  match.sides.forEach((side, s) => {
    if (!side.auto) return;
    for (const slot of side.onPitch.filter((x) => x.injured)) {
      if (side.subsUsed >= side.maxSubs) return;
      const pool = side.bench.map((id) => match.players[id]).filter((pl) => (slot.pos === 'GK') === (pl.position === 'GK'));
      const replacement = (pool.length ? pool : side.bench.map((id) => match.players[id]))
        .sort((x, y) => ratingAt(y, slot.pos) - ratingAt(x, slot.pos))[0];
      if (!replacement) return;
      const res = substitute(match, s, slot.playerId, replacement.id);
      if (res.ok) newEvents.push(res.event);
    }
  });
}

function autoSubs(match, rng, newEvents) {
  if (match.minute < 58) return;
  match.sides.forEach((side, s) => {
    if (!side.auto || side.subsUsed >= side.maxSubs || side.bench.length === 0) return;
    // 58분부터 분마다 확률적으로 한 명씩 교체한다. 경기당 평균 3~4명
    const p = match.minute >= 75 ? 0.13 : 0.09;
    if (!rng.chance(p)) return;
    const outfield = active(side).filter((x) => x.pos !== 'GK');
    // 체력이 가장 떨어진 선수, 경고를 받은 수비수를 우선 교체한다
    const tired = outfield
      .map((x) => ({ x, need: (100 - x.energy) + (x.yellow ? 12 : 0) }))
      .sort((u, v) => v.need - u.need)[0]?.x;
    if (!tired) return;
    const replacement = side.bench
      .map((id) => match.players[id])
      .filter((pl) => pl.position !== 'GK')
      .sort((x, y) => ratingAt(y, tired.pos) - ratingAt(x, tired.pos))[0];
    if (!replacement) return;
    const res = substitute(match, s, tired.playerId, replacement.id);
    if (res.ok) newEvents.push(res.event);
  });
}

// AI 팀은 지고 있으면 공격적으로, 리드하면 수비적으로 바꾼다
function autoMentality(match) {
  if (match.minute < 70) return;
  match.sides.forEach((side, s) => {
    if (!side.aiTactics) return;
    const diff = side.score - match.sides[1 - s].score;
    if (diff < 0) side.tactics.mentality = 'attacking';
    else if (diff === 1 && match.minute >= 80) side.tactics.mentality = 'defensive';
  });
}

export function changeTactics(match, s, patch) {
  const side = match.sides[s];
  if (patch.formation && patch.formation !== side.tactics.formation) {
    const slots = FORMATIONS[patch.formation];
    side.onPitch.forEach((slot, i) => {
      slot.pos = slots[i];
      if (!ROLES[slot.role].positions.includes(slot.pos)) slot.role = DEFAULT_ROLE[slot.pos];
    });
  }
  Object.assign(side.tactics, patch);
  push(match, { type: 'tactics', side: s });
}

export function changeRole(match, s, playerId, role) {
  const slot = match.sides[s].onPitch.find((x) => x.playerId === playerId);
  if (slot && ROLES[role]?.positions.includes(slot.pos)) slot.role = role;
}

// ---- 진행 ----

function playMinute(match, rng, newEvents) {
  const str = [
    teamStrength(match.sides[0], match.players, HOME_BONUS),
    teamStrength(match.sides[1], match.players, 1),
  ];
  const c0 = str[0].control ** POSSESSION_POWER;
  const c1 = str[1].control ** POSSESSION_POWER;
  const a = rng.chance(c0 / (c0 + c1)) ? 0 : 1;
  match.sides[a].possession++;

  // 두 골 이상 앞선 팀은 공격을 늦춘다 (대량 득점 방지)
  const lead = match.sides[a].score - match.sides[1 - a].score;
  const ease = lead >= 3 ? 0.65 : lead >= 2 ? 0.8 : 1;
  if (rng.chance(ATTACK_RATE * str[a].rate * ease)) attack(match, rng, a, 1 - a, str, newEvents);
  fouls(match, rng, a, str, newEvents);
  injuries(match, rng, newEvents);
  injurySubs(match, newEvents);
  drainEnergy(match);
  autoSubs(match, rng, newEvents);
  autoMentality(match);
}

export function isFinished(match) {
  return match.phase === 'ft';
}

// 1분 진행하고 그 사이 생긴 이벤트를 돌려준다
export function stepMinute(match, rng) {
  const newEvents = [];
  if (match.phase === 'pre') {
    match.added = [rng.int(0, 4), rng.int(2, 7)];
    match.phase = 'first';
    newEvents.push(push(match, { type: 'kickoff' }));
    return newEvents;
  }
  if (match.phase === 'ht') {
    match.phase = 'second';
    match.minute = 45;
    newEvents.push(push(match, { type: 'secondHalf' }));
    return newEvents;
  }
  if (match.phase === 'ft') return newEvents;

  match.minute++;
  playMinute(match, rng, newEvents);

  if (match.phase === 'first' && match.minute >= 45 + match.added[0]) {
    newEvents.push(push(match, { type: 'halftime' }));
    match.phase = 'ht';
  } else if (match.phase === 'second' && match.minute >= 90 + match.added[1]) {
    match.phase = 'ft';
    finalize(match, rng);
    newEvents.push(push(match, { type: 'fulltime' }));
  }
  return newEvents;
}

export function simulateMatch(match, rng) {
  while (!isFinished(match)) stepMinute(match, rng);
  return match;
}

// ---- 경기 후: 출장 시간과 평점 ----

function finalize(match, rng) {
  const end = match.minute;
  for (const side of match.sides) {
    for (const slot of side.onPitch) match.stats[slot.playerId].energyEnd ??= Math.round(slot.energy);
  }
  for (const [pid, st] of Object.entries(match.stats)) {
    if (st.minuteOn === null) continue;
    if (st.minuteOff === null) st.minuteOff = end;
    const minutes = Math.max(0, st.minuteOff - st.minuteOn);
    st.minutes = minutes;
    st.rating = ratingFrom(match, pid, st, minutes, 6.5 + rng.normal(0, 0.3));
  }
}

// 경기 중 지금까지의 평점 (난수 없이)
export function liveRating(match, pid) {
  const st = match.stats[pid];
  if (!st || st.minuteOn === null) return null;
  if (st.rating !== null) return st.rating;
  const minutes = Math.max(0, (st.minuteOff ?? match.minute) - st.minuteOn);
  return ratingFrom(match, pid, st, minutes, 6.5);
}

function ratingFrom(match, pid, st, minutes, start) {
  const [h, a] = [match.sides[0].score, match.sides[1].score];
  const p = match.players[pid];
  const line = p.position === 'GK' ? 'gk' : ['CB', 'LB', 'RB'].includes(p.position) ? 'def' : ['DM', 'CM', 'LM', 'RM', 'AM'].includes(p.position) ? 'mid' : 'att';
  const scored = st.side === 0 ? h : a;
  const against = st.side === 0 ? a : h;

  let r = start;
  r += st.goals * 1.0 + st.assists * 0.6 + st.onTarget * 0.1 - (st.shots - st.onTarget) * 0.05;
  r += st.involvement;
  r += st.saves * 0.25;
  if (line === 'gk') r -= st.conceded * 0.45;
  else if (line === 'def') r -= st.conceded * 0.25;
  else if (line === 'mid') r -= st.conceded * 0.1;
  if (st.conceded === 0 && minutes >= 60) r += line === 'gk' || line === 'def' ? 0.6 : line === 'mid' ? 0.2 : 0;
  r += scored > against ? 0.35 : scored < against ? -0.35 : 0;
  r -= st.yellow > 0 && !st.secondYellow ? 0.3 : 0;
  if (st.red) r -= st.secondYellow ? 1.2 : 1.5;
  if (minutes < 20) r = 6.5 + (r - 6.5) * 0.6;
  return Math.round(clamp(r, 3, 10) * 10) / 10;
}

const SUMMARY_EVENTS = new Set(['goal', 'yellow', 'secondYellow', 'red', 'injury']);

// 경기 결과 요약 (fixture에 저장할 내용)
export function summarize(match) {
  return {
    home: match.sides[0].score,
    away: match.sides[1].score,
    // 기록에는 골·카드·부상만 남기고, 빈 값은 저장하지 않는다 (시즌마다 수천 경기가 쌓이므로)
    events: match.events
      .filter((e) => SUMMARY_EVENTS.has(e.type))
      .map(({ clock, type, kind, side, playerId, assistId }) => {
        const e = { clock, type, side, playerId };
        if (type === 'goal' && kind === 'penalty') e.kind = kind;
        if (assistId) e.assistId = assistId;
        return e;
      }),
    stats: match.sides.map((s) => ({ shots: s.shots, onTarget: s.onTarget, fouls: s.fouls, possession: s.possession })),
  };
}

