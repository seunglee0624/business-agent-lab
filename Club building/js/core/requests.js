// 감독의 영입 요청: 이적시장이 열리면 감독이 약한 자리에 맞는 선수를 올리고, 단장이 승인하거나 거절한다

import { overall, ageOn } from './player.js';
import { SQUAD_TEMPLATE } from './worldgen.js';
import { POSITIONS } from '../data/positions.js';
import { windowEnd, askingPrice, openDeal } from './transfers.js';

const MIN_REQUESTS = 2;
const MAX_REQUESTS = 4;

// 자리마다 가장 좋은 선수 능력. 낮은 자리부터 보강을 원한다
function weakPositions(state, club) {
  const best = Object.fromEntries(Object.keys(SQUAD_TEMPLATE).map((pos) => [pos, 0]));
  for (const id of club.squad) {
    const p = state.players[id];
    best[p.position] = Math.max(best[p.position], overall(p));
  }
  return Object.keys(best).sort((a, b) => best[a] - best[b]).map((pos) => ({ pos, best: best[pos] }));
}

// 감독 성향에 맞는 후보 점수 (높을수록 먼저)
function styleScore(style, p, age) {
  if (style === 'youth') return -age * 2 + overall(p);
  if (style === 'stars') return overall(p) * 2;
  if (style === 'pragmatic') return overall(p) - age * 0.5;
  return overall(p);
}

// 시장마다 한 번, 감독이 요청 목록을 만든다
export function makeRequests(state, rng, club) {
  const t = state.transfers;
  const end = windowEnd(state.date);
  if (!end || !club.headCoach || t.requestWindow === end) return [];
  t.requestWindow = end;
  const style = club.headCoach.style;
  const n = rng.int(MIN_REQUESTS, MAX_REQUESTS);
  const all = Object.values(state.players);
  const made = [];
  for (const { pos, best } of weakPositions(state, club)) {
    if (made.length >= n) break;
    const pool = all.filter((p) => p.clubId && p.clubId !== club.id && p.position === pos && !p.loan && !p.retired
      && !state.clubs[p.clubId].youth.includes(p.id) && overall(p) > best && overall(p) <= club.level + 8
      && askingPrice(state, p) <= club.finance.transferBudget);
    if (!pool.length) continue;
    const p = pool.sort((a, b) => styleScore(style, b, ageOn(b, state.date)) - styleScore(style, a, ageOn(a, state.date)))[0];
    const req = { id: (t.nextRequestId = (t.nextRequestId ?? 0) + 1), playerId: p.id, until: end, reason: `${POSITIONS[pos].name} 자리가 약합니다 (지금 최고 ${best})` };
    (t.requests ??= []).push(req);
    made.push(req);
  }
  return made;
}

export const activeRequests = (state) => (state.transfers.requests ?? []).filter((r) => r.until >= state.date && state.players[r.playerId]);

// answer: 'approve' | 'reject'. 승인하면 이적료 협상 목록에 오른다
export function answerRequest(state, requestId, answer) {
  const t = state.transfers;
  const req = activeRequests(state).find((r) => r.id === requestId);
  if (!req) return { ok: false, reason: '이미 끝난 요청입니다.' };
  t.requests = t.requests.filter((r) => r !== req);
  if (answer === 'approve') openDeal(state, state.players[req.playerId]);
  return { ok: true };
}
