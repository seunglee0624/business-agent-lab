// SNS·미디어 캠페인: 하나씩 골라 진행한다. 해외 팬·팬층 만족도가 오르고, 참여한 선수는 조금 지친다

import { EUR } from '../data/economy.js';
import { expense } from './finance.js';
import { fansOf, fanEvent } from './fans.js';
import { overall } from './player.js';
import { addDays, daysBetween } from './calendar.js';
import { roundMoney } from './money.js';

// cost: 유로, overseas: 해외 팬 증가 비율, fatigue: 참여 선수 체력 감소, players: 참여 선수 수(능력 순)
export const CAMPAIGNS = {
  liveQA: { name: '선수 라이브 Q&A', cost: 10000, days: 7, overseas: 0.01, fans: { trendy: 1.5, loyal: 0.5 }, fatigue: 2, players: 2 },
  shortForm: { name: '숏폼 챌린지', cost: 25000, days: 14, overseas: 0.02, fans: { trendy: 2.5, family: 0.5 }, fatigue: 2, players: 3 },
  localTV: { name: '지역 방송 출연', cost: 15000, days: 14, overseas: 0, fans: { local: 2, family: 1.5 }, fatigue: 1, players: 2 },
  youtube: { name: '유튜브 시리즈', cost: 60000, days: 30, overseas: 0.04, fans: { trendy: 2, loyal: 1 }, fatigue: 3, players: 4 },
  documentary: { name: '구단 다큐멘터리', cost: 250000, days: 60, overseas: 0.08, fans: { trendy: 3, loyal: 1.5, family: 1 }, fatigue: 4, players: 6 },
};
export const CAMPAIGN_KEYS = Object.keys(CAMPAIGNS);
export const MAX_RUNNING = 2;
const REPEAT_DAYS = 365;
const REPEAT_MULT = 0.6;

export function mediaOf(club) {
  club.media ??= { running: [], history: [] };
  return club.media;
}

export const campaignCost = (club, kind) => roundMoney(CAMPAIGNS[kind].cost * EUR * Math.exp((club.reputation - 55) * 0.04));

// 1년 안에 같은 캠페인을 했으면 효과가 줄어든다
export function repeatFactor(state, club, kind) {
  const m = mediaOf(club);
  const recent = [...m.running, ...m.history].some((c) => c.kind === kind && daysBetween(c.start, state.date) < REPEAT_DAYS);
  return recent ? REPEAT_MULT : 1;
}

export function canStart(state, club, kind) {
  const m = mediaOf(club);
  if (!CAMPAIGNS[kind]) return '없는 캠페인입니다.';
  if (m.running.length >= MAX_RUNNING) return `캠페인은 동시에 ${MAX_RUNNING}개까지 진행할 수 있습니다.`;
  if (m.running.some((c) => c.kind === kind)) return '같은 캠페인이 이미 진행 중입니다.';
  return null;
}

export function startCampaign(state, rng, club, kind) {
  const reason = canStart(state, club, kind);
  if (reason) return { ok: false, reason };
  const def = CAMPAIGNS[kind];
  const cost = campaignCost(club, kind);
  expense(club, 'events', cost);
  // 반응은 운: 0.6~1.4배, 같은 캠페인을 반복하면 줄어든다
  const strength = Math.round((0.6 + rng.next() * 0.8) * repeatFactor(state, club, kind) * 100) / 100;
  const players = club.squad.map((id) => state.players[id]).filter((p) => p && !p.injury)
    .sort((a, b) => overall(b) - overall(a)).slice(0, def.players);
  for (const p of players) p.condition = Math.max(50, p.condition - def.fatigue);
  const c = {
    kind, start: state.date, end: addDays(state.date, def.days), cost, strength,
    gain: Math.round(fansOf(club).overseas * def.overseas * strength), added: 0,
    players: players.map((p) => p.name),
  };
  mediaOf(club).running.push(c);
  return { ok: true, campaign: c };
}

// 날마다: 해외 팬이 기간 동안 나눠서 늘고, 끝나면 팬층 반응을 넣는다
export function mediaDaily(state, club) {
  const m = mediaOf(club);
  const finished = [];
  for (const c of m.running) {
    const def = CAMPAIGNS[c.kind];
    const target = Math.round(c.gain * Math.min(1, daysBetween(c.start, state.date) / def.days));
    fansOf(club).overseas += target - c.added;
    c.added = target;
    if (state.date >= c.end) {
      c.satisfaction = Math.round(fanEvent(club, Object.fromEntries(Object.entries(def.fans).map(([k, d]) => [k, d * c.strength]))) * 10) / 10;
      finished.push(c);
    }
  }
  if (finished.length) {
    m.running = m.running.filter((c) => !finished.includes(c));
    m.history.unshift(...finished);
    m.history.length = Math.min(m.history.length, 20);
  }
  return finished;
}

export const reception = (strength) => (strength >= 1.15 ? '크게 화제가 됐습니다' : strength >= 0.85 ? '반응이 괜찮았습니다' : '반응이 미지근했습니다');
