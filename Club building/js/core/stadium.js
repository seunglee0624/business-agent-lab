// 경기장 행사(홈 경기에 붙이는 하프타임 공연·팬 데이·레전드 경기)와 비경기일 대관(콘서트 등), 잔디 상태

import { EUR } from '../data/economy.js';
import { income, expense, payOptional } from './finance.js';
import { capacity } from './facilities.js';
import { fanEvent } from './fans.js';
import { addDays, addMonths } from './calendar.js';
import { roundMoney } from './money.js';

export const EVENTS = {
  halftime: { name: '하프타임 공연', cost: 40000, demand: 1.03, fans: { trendy: 2, family: 1 } },
  fanDay: { name: '팬 데이', cost: 60000, demand: 1.05, fans: { family: 2.5, local: 1.5, loyal: 0.5 } },
  legends: { name: '레전드 경기', cost: 150000, demand: 1.08, fans: { loyal: 3, local: 1 } },
};
export const EVENT_KEYS = Object.keys(EVENTS);
const EVENT_MEMORY = 4; // 최근 이만큼의 행사 중 같은 행사가 있으면 효과가 절반씩 준다

// 대관: fee는 좌석 하나당 유로, damage는 잔디 손상
export const RENTALS = {
  concert: { name: '콘서트', fee: 8, damage: 30 },
  festival: { name: '음악 페스티벌', fee: 11, damage: 40 },
  otherSport: { name: '다른 종목 경기', fee: 6, damage: 25 },
  expo: { name: '박람회·전시', fee: 3, damage: 12 },
  corporate: { name: '기업 행사', fee: 2, damage: 6 },
};
export const RENTAL_KEYS = Object.keys(RENTALS);
export const RENTAL_OFFER_DAYS = 14;
const PITCH_RECOVERY = 1; // 하루 회복
const PITCH_EFFECT = 0.0008; // 잔디 1 손상당 홈 경기 전력 감소

// 잔디 보호 시스템 (개폐식 잔디): 경기장 3레벨 이상에서 지을 수 있다. 다 지으면 대관해도 잔디가 상하지 않고 대관 제안이 늘어난다
export const PITCH_SYSTEM = { name: '잔디 보호 시스템', cost: 15e6, months: 8, minStadium: 3, feeBonus: 1.2 };

export function stadiumOf(club) {
  const s = club.stadium;
  s.pitch ??= 100;
  s.events ??= { booked: {}, history: [] };
  s.rentals ??= { offers: [], booked: [], history: [], nextId: 1 };
  return s;
}

// ---- 행사 ----

// 경기장 크기에 따라 비용이 달라진다
export const eventCost = (club, kind) => roundMoney(EVENTS[kind].cost * EUR * Math.max(0.3, capacity(club) / 30000));

// 최근 같은 행사를 했으면 효과가 줄어든다
export function eventStrength(club, kind) {
  const recent = stadiumOf(club).events.history.slice(0, EVENT_MEMORY).filter((e) => e.kind === kind).length;
  return 0.5 ** recent;
}

export function bookEvent(state, club, fixture, kind, opts) {
  if (!EVENTS[kind]) return { ok: false, reason: '없는 행사입니다.' };
  if (!fixture || fixture.home !== club.id || fixture.result || fixture.date <= state.date) return { ok: false, reason: '앞으로 열릴 홈 경기에만 행사를 열 수 있습니다.' };
  const s = stadiumOf(club);
  if (s.events.booked[fixture.id]) return { ok: false, reason: '이 경기에는 이미 행사가 잡혀 있습니다.' };
  const cost = eventCost(club, kind);
  const fail = payOptional(state, club, 'events', cost, opts);
  if (fail) return fail;
  s.events.booked[fixture.id] = { kind, cost, date: fixture.date };
  return { ok: true, cost };
}

export function cancelEvent(state, club, fixtureId) {
  const s = stadiumOf(club);
  const b = s.events.booked[fixtureId];
  if (!b) return { ok: false, reason: '잡힌 행사가 없습니다.' };
  // 준비 비용의 절반만 돌려받는다
  const refund = roundMoney(b.cost / 2);
  club.finance.balance += refund;
  club.finance.season.expense.events -= refund;
  delete s.events.booked[fixtureId];
  return { ok: true, refund };
}

// 홈 경기 날: 잡힌 행사가 있으면 관중 수요 배율과 팬 반응 함수를 돌려준다
export function takeEvent(state, club, fixture) {
  if (!club.stadium?.events) return null;
  const s = stadiumOf(club);
  const b = s.events.booked[fixture.id];
  if (!b) return null;
  delete s.events.booked[fixture.id];
  const ev = EVENTS[b.kind];
  const k = eventStrength(club, b.kind);
  const fans = Object.fromEntries(Object.entries(ev.fans).map(([seg, d]) => [seg, d * k]));
  const gain = fanEvent(club, fans);
  s.events.history.unshift({ date: fixture.date, kind: b.kind, opponent: fixture.away, cost: b.cost, strength: k, satisfaction: Math.round(gain * 10) / 10 });
  s.events.history.length = Math.min(s.events.history.length, 20);
  return { kind: b.kind, demand: 1 + (ev.demand - 1) * k, strength: k };
}

// ---- 잔디와 보호 시스템 ----

export const pitchFactor = (club) => 1 - (100 - (club.stadium?.pitch ?? 100)) * PITCH_EFFECT;
export const hasPitchSystem = (state, club) => !!club.stadium.pitchSystem && club.stadium.pitchSystem.done <= state.date;
export const pitchSystemCost = () => roundMoney(PITCH_SYSTEM.cost * EUR);

export function buildPitchSystem(state, club, opts) {
  const s = stadiumOf(club);
  if (s.pitchSystem) return { ok: false, reason: s.pitchSystem.done <= state.date ? '이미 잔디 보호 시스템이 있습니다.' : '이미 공사 중입니다.' };
  if (club.facilities.stadium < PITCH_SYSTEM.minStadium) return { ok: false, reason: `경기장이 ${PITCH_SYSTEM.minStadium}레벨 이상이어야 합니다.` };
  const cost = pitchSystemCost();
  const fail = payOptional(state, club, 'construction', cost, opts);
  if (fail) return fail;
  s.pitchSystem = { start: state.date, done: addMonths(state.date, PITCH_SYSTEM.months) };
  return { ok: true, cost, done: s.pitchSystem.done };
}

// ---- 대관 ----

export function rentalFee(state, club, kind) {
  return roundMoney(capacity(club) * RENTALS[kind].fee * EUR * (hasPitchSystem(state, club) ? PITCH_SYSTEM.feeBonus : 1));
}

// 그날이나 앞뒤 하루에 홈 경기가 있으면 대관할 수 없다
function freeDate(club, homeDates, date) {
  return ![addDays(date, -1), date, addDays(date, 1)].some((d) => homeDates.has(d))
    && !stadiumOf(club).rentals.booked.some((b) => b.date === date);
}

// 매달 1일: 대관 제안 0~2건 (여름엔 하나 더, 보호 시스템이 있으면 하나 더)
export function rentalMonthly(state, rng, club, homeDates) {
  const s = stadiumOf(club);
  const month = Number(state.date.slice(5, 7));
  let n = rng.int(0, 2) + (month >= 5 && month <= 8 ? 1 : 0) + (hasPitchSystem(state, club) ? 1 : 0);
  const made = [];
  while (n-- > 0) {
    const kind = rng.pick(RENTAL_KEYS);
    let date = addDays(state.date, rng.int(18, 45));
    for (let i = 0; i < 10 && !freeDate(club, homeDates, date); i++) date = addDays(date, 1);
    if (!freeDate(club, homeDates, date)) continue;
    const offer = {
      id: `rt${s.rentals.nextId++}`, kind, date,
      fee: roundMoney(rentalFee(state, club, kind) * (0.85 + rng.next() * 0.3)),
      expires: addDays(state.date, RENTAL_OFFER_DAYS),
    };
    s.rentals.offers.push(offer);
    made.push(offer);
  }
  return made;
}

export function answerRental(state, club, offerId, accept, homeDates = new Set()) {
  const s = stadiumOf(club);
  const offer = s.rentals.offers.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: '이미 끝난 제안입니다.' };
  s.rentals.offers = s.rentals.offers.filter((o) => o !== offer);
  if (!accept) return { ok: true };
  if (!freeDate(club, homeDates, offer.date)) return { ok: false, reason: '그날 앞뒤로 홈 경기가 있어 대관할 수 없습니다.' };
  s.rentals.booked.push({ ...offer });
  return { ok: true, offer };
}

// 날마다: 잔디 회복, 기한 지난 제안 정리, 대관 날이면 수입과 잔디 손상
export function stadiumDaily(state, club) {
  const s = stadiumOf(club);
  const done = [];
  s.pitch = Math.min(100, s.pitch + PITCH_RECOVERY);
  if (s.pitchSystem && !s.pitchSystem.ready && s.pitchSystem.done <= state.date) {
    s.pitchSystem.ready = true;
    done.push({ system: true });
  }
  s.rentals.offers = s.rentals.offers.filter((o) => o.expires >= state.date);
  for (const b of s.rentals.booked.filter((x) => x.date === state.date)) {
    income(club, 'rental', b.fee);
    const offSeason = ['06', '07'].includes(state.date.slice(5, 7));
    const damage = hasPitchSystem(state, club) ? 0 : Math.round(RENTALS[b.kind].damage * (offSeason ? 0.5 : 1));
    s.pitch = Math.max(0, s.pitch - damage);
    s.rentals.history.unshift({ date: b.date, kind: b.kind, fee: b.fee, damage });
    s.rentals.history.length = Math.min(s.rentals.history.length, 20);
    done.push({ ...b, damage });
  }
  s.rentals.booked = s.rentals.booked.filter((x) => x.date !== state.date);
  return done;
}
