// 1군 등록: 내 구단은 25명까지 등록하고(홈그로운 유스 제외), 넘는 선수는 미등록으로 선수단에 둔다.
// 미등록 선수는 훈련·성장은 하지만 경기 명단에 들 수 없다. 등록 명단은 이적시장 기간에만 바꿀 수 있다.
// 선수단 전체(홈그로운 유스 제외)는 30명까지
import { isHomegrownYouth } from './development.js';
import { overall } from './player.js';
import { SQUAD_TEMPLATE } from './worldgen.js';

export const MAX_SQUAD = 25;
export const MAX_TOTAL = 30;

const counted = (state, club, date) => club.squad.map((id) => state.players[id]).filter((p) => !isHomegrownYouth(p, date));
export const registeredCount = (state, club, date) => counted(state, club, date).filter((p) => !p.unregistered).length;
export const totalCount = (state, club, date) => counted(state, club, date).length;
export const unregisteredPlayers = (state, club) => club.squad.map((id) => state.players[id]).filter((p) => p.unregistered);

// 25명을 넘으면 포지션과 능력을 보고 등록할 25명을 고른다: 자리마다 최소 인원(골키퍼 2, 나머지 1)을 먼저, 남은 자리는 능력 순.
// keep: 이미 등록된 선수를 우선 지킬지 (이적시장 밖에서는 등록 명단을 바꿀 수 없으므로 새로 온 선수만 미등록)
// 돌려주는 값: 이번에 미등록이 된 선수 목록
export function fitRegistration(state, club, { keep = false } = {}) {
  const pool = counted(state, club, state.date);
  if (pool.filter((p) => !p.unregistered).length <= MAX_SQUAD) return [];
  const before = new Set(pool.filter((p) => p.unregistered).map((p) => p.id));
  let chosen;
  if (keep) {
    // 등록돼 있던 선수 먼저, 그다음 새로 온 선수를 능력 순으로
    chosen = pool.slice().sort((a, b) => Number(!!a.unregistered) - Number(!!b.unregistered) || Number(!!a.newcomer) - Number(!!b.newcomer) || overall(b) - overall(a)).slice(0, MAX_SQUAD);
  } else {
    const byAbility = pool.slice().sort((a, b) => overall(b) - overall(a));
    chosen = [];
    for (const pos of Object.keys(SQUAD_TEMPLATE)) {
      chosen.push(...byAbility.filter((p) => p.position === pos).slice(0, pos === 'GK' ? 2 : 1));
    }
    for (const p of byAbility) if (chosen.length < MAX_SQUAD && !chosen.includes(p)) chosen.push(p);
  }
  const ids = new Set(chosen.map((p) => p.id));
  for (const p of pool) {
    if (ids.has(p.id)) delete p.unregistered;
    else p.unregistered = true;
    delete p.newcomer;
  }
  return pool.filter((p) => p.unregistered && !before.has(p.id));
}

export function setRegistered(state, club, p, registered, windowOpen) {
  if (!club.squad.includes(p.id)) return { ok: false, reason: '우리 1군 선수가 아닙니다.' };
  if (!windowOpen) return { ok: false, reason: '등록 명단은 이적시장 기간에만 바꿀 수 있습니다.' };
  if (isHomegrownYouth(p, state.date)) return { ok: false, reason: '홈그로운 유스는 등록 없이 뛸 수 있습니다.' };
  if (registered) {
    if (!p.unregistered) return { ok: false, reason: '이미 등록된 선수입니다.' };
    if (registeredCount(state, club, state.date) >= MAX_SQUAD) return { ok: false, reason: `등록 인원(${MAX_SQUAD}명)이 꽉 찼습니다. 먼저 다른 선수의 등록을 해제하세요.` };
    delete p.unregistered;
  } else {
    if (p.unregistered) return { ok: false, reason: '이미 미등록 선수입니다.' };
    p.unregistered = true;
  }
  return { ok: true };
}
