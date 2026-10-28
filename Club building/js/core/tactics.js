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

function selectionScore(player, pos, bonus) {
  return ratingAt(player, pos) * (0.55 + 0.45 * (player.condition / 100)) * (bonus ? bonus(player) : 1);
}

// 선발 11명과 교체 명단을 자동으로 고른다. unavailable: 출전할 수 없는 선수 id 집합
// lineup은 포메이션 슬롯 순서와 같고, 선수가 모자라면 그 자리는 null
export function autoLineup(squadPlayers, formation, { unavailable = new Set(), benchSize = 9, bonus } = {}) {
  const slots = FORMATIONS[formation];
  const available = squadPlayers.filter((p) => !unavailable.has(p.id));
  const lineup = new Array(slots.length).fill(null);
  const used = new Set();

  const pairs = [];
  slots.forEach((pos, i) => {
    for (const p of available) pairs.push({ i, p, score: selectionScore(p, pos, bonus) });
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
export function resolveLineup(club, playersById, { unavailable = new Set(), benchSize = 9, bonus } = {}) {
  const t = club.tactics;
  const squad = club.squad.map((id) => playersById[id]);
  const slots = FORMATIONS[t.formation];
  if (!t.lineup || t.lineup.length !== slots.length) {
    return { ...autoLineup(squad, t.formation, { unavailable, benchSize, bonus }), replaced: [] };
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
    pool.sort((a, b) => selectionScore(b, slots[i], bonus) - selectionScore(a, slots[i], bonus));
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
