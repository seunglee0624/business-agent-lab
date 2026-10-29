// 팬층과 팬 만족도: 충성층·유행층·가족층·지역층 비율과 구단 전체 만족도(0~100)

import { overall } from './player.js';
import { standings } from './state.js';

export const SEGMENTS = {
  loyal: { name: '충성층' },
  trendy: { name: '유행층' },
  family: { name: '가족층' },
  local: { name: '지역층' },
};
export const SEGMENT_KEYS = Object.keys(SEGMENTS);
export const START_SATISFACTION = 60;
export const PROTEST_LINE = 30;
export const STAR_OVR = 75;
const MAX_EFFECT = 0.1;
const HISTORY_MONTHS = 12;

// 구단 id로 정해지는 작은 흔들림 (-1~1), 같은 구단은 늘 같은 값
function jitter(id, salt) {
  let h = 2166136261;
  for (const ch of `${id}:${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

// 처음 비율: 평판이 높을수록 유행층, 낮을수록 지역층·충성층이 많다
function initialShares(club) {
  const rep = (club.reputation - 55) / 30;
  const raw = {
    loyal: 30 - rep * 3 + jitter(club.id, 'loyal') * 5,
    trendy: 20 + rep * 12 + jitter(club.id, 'trendy') * 5,
    family: 25 + jitter(club.id, 'family') * 5,
    local: 25 - rep * 9 + jitter(club.id, 'local') * 5,
  };
  return normalize(raw);
}

function normalize(raw) {
  const clamped = Object.fromEntries(SEGMENT_KEYS.map((k) => [k, Math.max(5, raw[k])]));
  const sum = Object.values(clamped).reduce((s, x) => s + x, 0);
  const out = Object.fromEntries(SEGMENT_KEYS.map((k) => [k, Math.round((clamped[k] / sum) * 100)]));
  out.loyal += 100 - Object.values(out).reduce((s, x) => s + x, 0);
  return out;
}

// 저장 파일에 팬 정보가 없으면 그 자리에서 만든다
export function fansOf(club) {
  club.fans ??= {
    shares: initialShares(club),
    satisfaction: START_SATISFACTION,
    mood: Object.fromEntries(SEGMENT_KEYS.map((k) => [k, 0])),
    month: { stars: 0, soldStarters: 0 },
    season: { stars: 0, youthMinutes: 0, minutes: 0 },
    history: [],
    protestMonths: 0,
    streak: 0,
  };
  // 해외 팬 (명): 평판이 높을수록 많다. 처음 값을 기준으로 늘어난 만큼 스폰서·굿즈가 늘어난다
  if (club.fans.overseas === undefined) {
    club.fans.overseas = Math.round(50000 * Math.exp((club.reputation - 55) * 0.08));
    club.fans.overseasBase = club.fans.overseas;
  }
  return club.fans;
}

// 만족도 변화: 팬층별 변화에 비율을 곱해 더한다
function applyMood(fans, deltas) {
  let total = 0;
  for (const k of SEGMENT_KEYS) {
    const d = deltas[k] ?? 0;
    fans.mood[k] = Math.max(-20, Math.min(20, fans.mood[k] * 0.9 + d));
    total += (fans.shares[k] / 100) * d;
  }
  fans.satisfaction = Math.max(0, Math.min(100, Math.round((fans.satisfaction + total) * 10) / 10));
  return total;
}

const all = (d) => Object.fromEntries(SEGMENT_KEYS.map((k) => [k, d]));
const add = (a, b) => Object.fromEntries(SEGMENT_KEYS.map((k) => [k, (a[k] ?? 0) + (b[k] ?? 0)]));

// 평판 순위 = 시즌 전 기대 순위
export function expectedPosition(state, club) {
  const ids = standings(state, club.leagueId).map((r) => r.clubId);
  const sorted = ids.slice().sort((a, b) => state.clubs[b].reputation - state.clubs[a].reputation);
  return sorted.indexOf(club.id) + 1;
}

// 경기 결과 반영 (우리 구단만)
export function fanMatchResult(state, club, { goalsFor, goalsAgainst, opponent }) {
  const fans = fansOf(club);
  const won = goalsFor > goalsAgainst;
  const lost = goalsFor < goalsAgainst;
  fans.streak = won ? Math.max(1, fans.streak + 1) : lost ? Math.min(-1, fans.streak - 1) : 0;
  const stronger = opponent.reputation - club.reputation;
  let base = won ? 1.5 : lost ? -1.5 : 0;
  if (won && stronger > 3) base += 1;
  if (lost && stronger < -3) base -= 1;
  let d = all(base);
  if (fans.streak >= 3) d = add(d, { loyal: 1 });
  if (fans.streak <= -3) d = add(d, { loyal: -1 });
  if (goalsFor >= 3) d = add(d, { trendy: 1 });
  // 유스 출신 출전 시간은 달마다 모아 지역층에 반영한다
  return applyMood(fans, d);
}

// 이적: 스타 영입·주전 판매를 이번 달에 모아 둔다
export function fanTransfer(state, p, from, to) {
  const userId = state.user?.clubId;
  if (to?.id === userId && overall(p) >= STAR_OVR) {
    const f = fansOf(to);
    f.month.stars++;
    f.season.stars++;
  }
  if (from?.id === userId) {
    const top = from.squad.map((id) => state.players[id]).filter(Boolean).map(overall).sort((a, b) => b - a);
    if (overall(p) >= (top[10] ?? 0)) fansOf(from).month.soldStarters++;
  }
}

const isHomegrown = (p) => !!p.youthSince && !(p.transfers ?? []).some((t) => t.from);

// 매달 1일 (출전 시간 초기화 전에 부른다)
export function fanMonthly(state, club, date, priceLevel = 1, extra = {}) {
  const fans = fansOf(club);
  const table = standings(state, club.leagueId);
  const played = table.find((r) => r.clubId === club.id)?.played ?? 0;
  let d = all(0);
  if (played >= 3) {
    const pos = table.findIndex((r) => r.clubId === club.id) + 1;
    d = add(d, all(Math.max(-4, Math.min(4, (expectedPosition(state, club) - pos) * 0.5))));
  }
  const players = club.squad.map((id) => state.players[id]).filter(Boolean);
  const minutes = players.reduce((s, p) => s + (p.minutesMonth ?? 0), 0);
  const youth = players.filter(isHomegrown).reduce((s, p) => s + (p.minutesMonth ?? 0), 0);
  fans.season.minutes += minutes;
  fans.season.youthMinutes += youth;
  if (minutes > 0) d = add(d, { local: Math.max(-1.5, Math.min(3, (youth / minutes) * 20 - 1.5)) });
  d = add(d, { trendy: Math.min(4, fans.month.stars * 2) });
  if (fans.month.soldStarters) d = add(d, all(-1.5 * fans.month.soldStarters));
  if (club.finance.balance < 0) d = add(d, all(-2));
  d = add(d, extra); // 스폰서 업종 반응
  // 티켓값: 기본보다 10% 넘게 비싸면 가족층·지역층이 불만, 10% 넘게 싸면 좋아한다
  if (Math.abs(priceLevel - 1) > 0.1) {
    const over = priceLevel - 1;
    d = add(d, { family: Math.max(-4, Math.min(3, -over * 12)), local: Math.max(-3, Math.min(2, -over * 7)) });
  }
  applyMood(fans, d);
  fans.month = { stars: 0, soldStarters: 0 };
  fans.protestMonths = fans.satisfaction < PROTEST_LINE ? fans.protestMonths + 1 : 0;
  fans.history.push({ date, satisfaction: fans.satisfaction });
  if (fans.history.length > HISTORY_MONTHS) fans.history.shift();
  return { protest: fans.protestMonths > 0 };
}

// 시즌 끝: 그 시즌 행보에 따라 비율이 조금씩 바뀐다
export function fanSeasonEnd(state, club, position) {
  const fans = fansOf(club);
  const teams = standings(state, club.leagueId).length;
  const raw = { ...fans.shares };
  if (fans.season.stars) raw.trendy += Math.min(3, fans.season.stars);
  if (fans.season.minutes && fans.season.youthMinutes / fans.season.minutes > 0.1) raw.local += 2;
  if (position && position <= Math.ceil(teams / 4)) { raw.loyal += 1; raw.trendy += 1; }
  if (position && position > teams - 3) raw.trendy -= 2;
  fans.shares = normalize(raw);
  fans.season = { stars: 0, youthMinutes: 0, minutes: 0 };
}

// 해외 팬 배율: 처음보다 늘어난 비율의 15%, 최대 1.25
export function overseasFactor(club) {
  const f = fansOf(club);
  return Math.min(1.25, Math.max(1, 1 + (f.overseas / f.overseasBase - 1) * 0.15));
}

// 관중·상업 수입 배율: 시작값(60)이면 1, 0~100에서 ±10%. 항의가 이어지면 관중이 더 준다
export function fanFactor(club) {
  if (!club.fans) return 1;
  const s = club.fans.satisfaction;
  const base = 1 + (s >= START_SATISFACTION ? (s - START_SATISFACTION) / 40 : (s - START_SATISFACTION) / 60) * MAX_EFFECT;
  return base;
}

export function protestPenalty(club) {
  return 1 - Math.min(0.1, (club.fans?.protestMonths ?? 0) * 0.02);
}

// 팬층별 한 줄 반응
export function fanReactions(club) {
  const fans = fansOf(club);
  const LINES = {
    loyal: ['요즘 경기력이면 믿고 따라갈 만하다.', '그럭저럭 지켜보는 중이다.', '이 구단의 역사가 부끄럽다. 이기는 경기를 보고 싶다.'],
    trendy: ['요즘 이 팀 보는 재미가 있다!', '눈에 띄는 스타가 한 명쯤 더 있었으면.', '재미가 없다. 스타도 골도 안 보인다.'],
    family: ['아이들과 경기장 가는 날이 즐겁다.', '나쁘지 않지만 좀 더 즐길 거리가 있으면 좋겠다.', '돈 내고 갈 만한 구단인지 모르겠다.'],
    local: ['우리 동네 아이들이 뛰는 걸 보니 뿌듯하다.', '유스 출신 선수가 더 뛰었으면 한다.', '우리 동네 구단 같지 않다. 유스 선수를 써라.'],
  };
  return SEGMENT_KEYS.map((k) => {
    const m = fans.mood[k] + (fans.satisfaction - START_SATISFACTION) / 10;
    const line = LINES[k][m > 2 ? 0 : m < -2 ? 2 : 1];
    return { key: k, name: SEGMENTS[k].name, share: fans.shares[k], mood: m > 2 ? 'good' : m < -2 ? 'bad' : 'neutral', line };
  });
}
