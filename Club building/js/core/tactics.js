// 전술 설정과 자동 선발

import { FORMATIONS } from '../data/formations.js';
import { DEFAULT_ROLE, ROLES } from '../data/roles.js';
import { ratingAt, overall } from './player.js';

export const MENTALITIES = { defensive: '수비적', balanced: '균형', attacking: '공격적' };
export const PRESSING = { low: '낮음', normal: '보통', high: '높음' };
export const TEMPO = { slow: '느리게', normal: '보통', fast: '빠르게' };
export const LINE = { deep: '낮게', normal: '보통', high: '높게' };

export function defaultTactics() {
  return {
    formation: '4-4-2',
    mentality: 'balanced',
    pressing: 'normal',
    tempo: 'normal',
    line: 'normal',
    // lineup[i]: { playerId, role } — 포메이션 슬롯 i에 대응. null이면 자동 선발
    lineup: null,
    bench: null,
    setPieceTaker: null,
  };
}

function selectionScore(player, pos) {
  return ratingAt(player, pos) * (0.55 + 0.45 * (player.condition / 100));
}

// 선발 11명과 교체 명단을 자동으로 고른다. unavailable: 출전할 수 없는 선수 id 집합
// lineup은 포메이션 슬롯 순서와 같고, 선수가 모자라면 그 자리는 null
export function autoLineup(squadPlayers, formation, { unavailable = new Set(), benchSize = 9 } = {}) {
  const slots = FORMATIONS[formation];
  const available = squadPlayers.filter((p) => !unavailable.has(p.id));
  const lineup = new Array(slots.length).fill(null);
  const used = new Set();

  const pairs = [];
  slots.forEach((pos, i) => {
    for (const p of available) pairs.push({ i, p, score: selectionScore(p, pos) });
  });
  pairs.sort((a, b) => b.score - a.score);
  for (const { i, p } of pairs) {
    if (lineup[i] || used.has(p.id)) continue;
    lineup[i] = { playerId: p.id, role: DEFAULT_ROLE[slots[i]] };
    used.add(p.id);
  }

  const rest = available.filter((p) => !used.has(p.id));
  const bench = [];
  const keeper = rest.filter((p) => p.position === 'GK').sort((a, b) => overall(b) - overall(a))[0];
  if (keeper) bench.push(keeper.id);
  for (const p of rest.filter((x) => x !== keeper).sort((a, b) => overall(b) - overall(a))) {
    if (bench.length >= benchSize) break;
    bench.push(p.id);
  }
  return { lineup, bench };
}

// 저장된 선발이 유효하면 그대로, 아니면 빈자리를 자동으로 채운다
export function resolveLineup(club, playersById, { unavailable = new Set(), benchSize = 9 } = {}) {
  const t = club.tactics;
  const squad = club.squad.map((id) => playersById[id]);
  const slots = FORMATIONS[t.formation];
  if (!t.lineup || t.lineup.length !== slots.length) {
    return { ...autoLineup(squad, t.formation, { unavailable, benchSize }), replaced: [] };
  }

  const replaced = [];
  const lineup = t.lineup.map((entry) => {
    if (entry && club.squad.includes(entry.playerId) && !unavailable.has(entry.playerId)) return { ...entry };
    if (entry) replaced.push(entry.playerId);
    return null;
  });
  const used = new Set(lineup.filter(Boolean).map((e) => e.playerId));
  const pool = squad.filter((p) => !used.has(p.id) && !unavailable.has(p.id));
  lineup.forEach((entry, i) => {
    if (entry) {
      if (!ROLES[entry.role]?.positions.includes(slots[i])) entry.role = DEFAULT_ROLE[slots[i]];
      return;
    }
    pool.sort((a, b) => selectionScore(b, slots[i]) - selectionScore(a, slots[i]));
    const pick = pool.shift();
    if (pick) {
      lineup[i] = { playerId: pick.id, role: DEFAULT_ROLE[slots[i]] };
      used.add(pick.id);
    }
  });

  let bench = (t.bench || []).filter((id) => !used.has(id) && club.squad.includes(id) && !unavailable.has(id));
  if (bench.length < benchSize) {
    const extra = squad
      .filter((p) => !used.has(p.id) && !bench.includes(p.id) && !unavailable.has(p.id))
      .sort((a, b) => overall(b) - overall(a));
    bench = bench.concat(extra.slice(0, benchSize - bench.length).map((p) => p.id));
  }
  return { lineup, bench: bench.slice(0, benchSize), replaced };
}

// 감독이 전술을 바꾼다. change 하나만 적용한다:
// { formation } | { key, value } | { slot, playerId } | { slot, role } | { manual: true } | { auto: true } | { autoPick: true }
export function applyTacticsChange(club, playersById, change, { unavailable = new Set() } = {}) {
  const t = club.tactics;
  // 지금 보이는 선발을 그대로 고정한다
  const freeze = () => {
    t.lineup = resolveLineup(club, playersById, { unavailable }).lineup.map((e) => (e ? { ...e } : null));
    t.bench = null;
  };
  if (change.manual) {
    freeze();
  } else if (change.auto) {
    t.lineup = null;
    t.bench = null;
  } else if (change.autoPick) {
    const squad = club.squad.map((id) => playersById[id]);
    Object.assign(t, autoLineup(squad, t.formation, { unavailable }));
  } else if ('role' in change) {
    freeze();
    t.lineup[change.slot].role = change.role;
  } else if ('key' in change) {
    t[change.key] = change.value || null;
  } else if ('playerId' in change) {
    freeze();
    const i = change.slot;
    const other = t.lineup.findIndex((e) => e?.playerId === change.playerId);
    // 이미 선발인 선수를 고르면 두 자리를 맞바꾼다
    if (other >= 0) t.lineup[other] = t.lineup[i] && { ...t.lineup[i], role: t.lineup[other].role };
    t.lineup[i] = { playerId: change.playerId, role: t.lineup[i]?.role ?? DEFAULT_ROLE[FORMATIONS[t.formation][i]] };
  } else if ('formation' in change) {
    t.formation = change.formation;
    if (t.lineup) {
      // 같은 선수들을 새 포메이션 자리에 다시 배치한다
      const slots = FORMATIONS[change.formation];
      t.lineup = t.lineup.map((e, i) => e && {
        playerId: e.playerId,
        role: ROLES[e.role]?.positions.includes(slots[i]) ? e.role : DEFAULT_ROLE[slots[i]],
      });
    }
  }
}
