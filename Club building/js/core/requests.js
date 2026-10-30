// 감독의 영입 요청: 이적시장이 열리면 감독이 약한 자리에 맞는 선수를 올리고, 단장이 승인하거나 거절한다

import { overall, ageOn } from './player.js';
import { SQUAD_TEMPLATE } from './worldgen.js';
import { POSITIONS } from '../data/positions.js';
import { windowEnd, askingPrice, openDeal } from './transfers.js';
import { daysBetween, formatShortDate } from './calendar.js';
import { transferDemand } from './contracts.js';
import { weeklyWageBill, budgetRange } from './finance.js';

const MIN_REQUESTS = 2;
const MAX_REQUESTS = 4;

export const ASK_COOLDOWN_DAYS = 7;

// 포지션 진단: 인원(권장 대비)과 가장 좋은 선수 능력. 인원이 모자라면 '부족', 최고 능력이 팀 주전 평균보다 4 넘게 낮으면 '약함'
export function positionNeeds(state, club) {
  const players = club.squad.map((id) => state.players[id]).filter(Boolean);
  const top = players.map(overall).sort((a, b) => b - a).slice(0, 11);
  const teamAvg = top.reduce((s, x) => s + x, 0) / Math.max(1, top.length);
  return Object.entries(SQUAD_TEMPLATE).map(([pos, want]) => {
    const here = players.filter((p) => p.position === pos);
    const best = Math.max(0, ...here.map(overall));
    const injured = here.filter((p) => p.injury).length;
    const status = here.length < want ? 'short' : best < teamAvg - 4 ? 'weak' : 'ok';
    return { pos, name: POSITIONS[pos].name, count: here.length, want, best, injured, status, gap: Math.round(teamAvg - best) };
  });
}

const FREE_BONUS = 3;

// 보강 순서: 인원 부족 → 능력 약함 → 나머지, 같은 단계면 최고 능력이 낮은 자리부터
function weakPositions(state, club) {
  const order = { short: 0, weak: 1, ok: 2 };
  return positionNeeds(state, club).sort((a, b) => order[a.status] - order[b.status] || a.best - b.best);
}

function reasonFor(n) {
  if (n.status === 'short') return `${n.name} 인원이 모자랍니다 (${n.count}/${n.want}명)`;
  return `${n.name} 자리가 약합니다 (지금 최고 ${n.best})`;
}

// 자리마다 성향에 맞는 선수 한 명씩, n명까지 요청 목록에 올린다
function buildRequests(state, club, n, end, onlyNeeds = false) {
  const t = state.transfers;
  const style = club.headCoach.style;
  const all = Object.values(state.players);
  const taken = new Set(activeRequests(state).map((r) => r.playerId));
  // 이적료 + 주급 여유를 넘는 주급(남은 주 수만큼 이적 예산에서 옮겨야 할 돈)이 이적 예산 안이면 고른다
  const wageRoom = club.finance.wageBudget - weeklyWageBill(state, club);
  const { weeks } = budgetRange(state, club);
  const affordable = (p) => (p.clubId ? askingPrice(state, p) : 0) + Math.max(0, transferDemand(state, club, p).wage - wageRoom) * weeks <= club.finance.transferBudget;
  const made = [];
  for (const need of weakPositions(state, club)) {
    if (made.length >= n) break;
    if (onlyNeeds && need.status === 'ok') break;
    const { pos, best } = need;
    // 자유계약 선수도 후보다 (이적료 없음, 시장이 닫혀 있어도 영입 가능)
    const pool = all.filter((p) => p.clubId !== club.id && p.position === pos && !p.loan && !p.retired && !taken.has(p.id)
      && !(p.clubId && state.clubs[p.clubId].youth.includes(p.id)) && overall(p) > best && overall(p) <= club.level + 8
      && affordable(p));
    if (!pool.length) continue;
    // 비슷하면 자유계약 선수를 먼저 (성향 점수에 3점 가산)
    const score = (p) => styleScore(style, p, ageOn(p, state.date)) + (p.clubId ? 0 : FREE_BONUS);
    const p = pool.sort((a, b) => score(b) - score(a))[0];
    const req = { id: (t.nextRequestId = (t.nextRequestId ?? 0) + 1), playerId: p.id, until: end, reason: reasonFor(need) };
    (t.requests ??= []).push(req);
    made.push(req);
  }
  return made;
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
  return buildRequests(state, club, rng.int(MIN_REQUESTS, MAX_REQUESTS), end);
}

// 지금 열린 시장의 마감일, 닫혀 있으면 다음 시장의 마감일
function nextWindowEnd(date) {
  const open = windowEnd(date);
  if (open) return open;
  const y = Number(date.slice(0, 4));
  return date.slice(5) < '07-01' ? `${y}-08-31` : `${y + 1}-01-31`;
}

// 단장이 감독에게 추천 선수를 요구한다 (일주일에 한 번). 시장이 닫혀 있으면 다음 시장까지 유효한 요청이 된다
export function askCoach(state, club) {
  const end = nextWindowEnd(state.date);
  if (!club.headCoach) return { ok: false, reason: '감독이 없습니다.' };
  const last = state.transfers.lastAsk;
  if (last && daysBetween(last, state.date) < ASK_COOLDOWN_DAYS) return { ok: false, reason: `감독이 지난 ${formatShortDate(last)}에 이미 추천했습니다. 일주일 뒤에 다시 요청하세요.` };
  state.transfers.lastAsk = state.date;
  const made = buildRequests(state, club, 3, end);
  if (!made.length) return { ok: false, reason: '이적 예산과 주급 예산을 합쳐도 감당할 수 있는, 지금 선수보다 나은 후보를 찾지 못했습니다.' };
  return { ok: true, made, open: !!windowEnd(state.date) };
}

export const activeRequests = (state) => (state.transfers.requests ?? []).filter((r) => r.until >= state.date && state.players[r.playerId]);

// answer: 'approve' | 'reject'. 승인하면 이적료 협상 목록에 오른다
export function answerRequest(state, requestId, answer) {
  const t = state.transfers;
  const req = activeRequests(state).find((r) => r.id === requestId);
  if (!req) return { ok: false, reason: '이미 끝난 요청입니다.' };
  t.requests = t.requests.filter((r) => r !== req);
  if (answer === 'approve') openDeal(state, state.players[req.playerId], req.until);
  return { ok: true };
}
