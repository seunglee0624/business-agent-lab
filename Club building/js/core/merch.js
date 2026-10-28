// 굿즈: 홈·원정 유니폼(디자인·가격·수량), 머플러·아동용품, 우승·승격 때만 내는 한정판

import { EUR } from '../data/economy.js';
import { commercialPerSeason, income, expense, MERCH_SHARE } from './finance.js';
import { fansOf, SEGMENT_KEYS } from './fans.js';
import { overall } from './player.js';
import { addDays } from './calendar.js';
import { roundMoney } from './money.js';

export { MERCH_SHARE };
export const DESIGNS = {
  classic: { name: '클래식' },
  modern: { name: '모던' },
  retro: { name: '레트로' },
  star: { name: '스타 마킹' },
};
export const DESIGN_KEYS = Object.keys(DESIGNS);
// 팬층별 좋아하는 디자인
const LIKES = {
  loyal: ['classic', 'retro'],
  trendy: ['modern', 'star'],
  family: ['star'],
  local: ['retro'],
};
// 품목: 원가·기본 가격(유로), 시즌 수요 비중, 주 고객
export const ITEMS = {
  kitHome: { name: '홈 유니폼', cost: 22, price: 80, weight: 0.35, kit: true },
  kitAway: { name: '원정 유니폼', cost: 22, price: 75, weight: 0.2, kit: true },
  scarf: { name: '머플러', cost: 4, price: 18, weight: 0.2, segment: 'loyal', leadDays: 14 },
  kids: { name: '아동용품', cost: 10, price: 30, weight: 0.25, segment: 'family', leadDays: 14 },
  limited: { name: '한정판', cost: 35, price: 130, weight: 0.15, limited: true },
};
export const ITEM_KEYS = Object.keys(ITEMS);
export const REORDER_COST = 1.3;
export const REORDER_DAYS = 30;
export const CLEARANCE = 0.3;
export const LIMITED_DAYS = 14;
const HOME_SHARE = 0.6; // 시즌 판매 중 홈 경기 날 몫 (나머지는 날마다 조금씩)
const HISTORY_SEASONS = 5;

export const unitCost = (item) => roundMoney(ITEMS[item].cost * EUR);
export const basePrice = (item) => roundMoney(ITEMS[item].price * EUR);

const emptyItem = (item, design = null) => ({ design, price: basePrice(item), stock: 0, sold: 0, revenue: 0, ordered: false, reordered: false, incoming: null, carry: 0 });

export function merchOf(club) {
  club.merch ??= {
    items: {
      kitHome: emptyItem('kitHome', 'classic'),
      kitAway: emptyItem('kitAway', 'modern'),
      scarf: emptyItem('scarf'),
      kids: emptyItem('kids'),
      limited: emptyItem('limited'),
    },
    limited: null, // { reason, orderBy, until }
    history: [],
  };
  // 처음에는 머플러·아동용품 반 시즌 치 재고가 있다
  const items = club.merch.items;
  if (items.scarf.stock === 0 && items.scarf.sold === 0 && !club.merch.started) {
    club.merch.started = true;
    for (const item of ['scarf', 'kids']) items[item].stock = Math.round(seasonDemand(null, club, item) / 2);
  }
  return club.merch;
}

// 스타 마킹이 될 선수: 능력 75 이상 중 가장 높은 선수
export function starPlayer(state, club) {
  const best = club.squad.map((id) => state.players[id]).filter(Boolean).sort((a, b) => overall(b) - overall(a))[0];
  return best && overall(best) >= 75 ? best : null;
}

// 디자인이 팬층과 맞는 정도 (0.75~1.3)
export function designFit(state, club, design, starId = undefined) {
  const shares = fansOf(club).shares;
  let fit = 0;
  for (const k of SEGMENT_KEYS) fit += (shares[k] / 100) * (LIKES[k].includes(design) ? 1.3 : 0.85);
  if (design === 'star') {
    const id = starId === undefined ? starPlayer(state, club)?.id : starId;
    if (!id) fit *= 0.7;
    else if (state.players[id]?.clubId !== club.id) fit *= 0.4; // 마킹한 선수가 떠났다
  }
  return fit;
}

const elasticity = (club) => 0.6 + fansOf(club).shares.family / 100 + fansOf(club).shares.local / 200;

// 한 시즌 수요 (개), 지금 가격·디자인 기준
export function seasonDemand(state, club, item, { price, design, starId } = {}) {
  const it = merchOf(club).items[item];
  const def = ITEMS[item];
  const margin = (def.price - def.cost) * EUR;
  let units = (def.weight * MERCH_SHARE * commercialPerSeason(club)) / margin;
  units *= Math.pow(Math.max(0.2, (price ?? it.price) / basePrice(item)), -elasticity(club));
  units *= Math.pow(fansOf(club).satisfaction / 60, 0.8);
  if (def.kit) units *= designFit(state, club, design ?? it.design, starId ?? it.starId);
  if (def.segment) units *= Math.sqrt(fansOf(club).shares[def.segment] / 25);
  return Math.max(0, Math.round(units));
}

// 예상 판매 범위 (마케팅 담당 수준에 따라 폭이 다르다)
export function merchForecast(state, club, item, opts) {
  const w = 0.25 - ((Math.min(20, club.staff.marketing ?? 1) - 1) / 19) * 0.22;
  const n = seasonDemand(state, club, item, opts);
  return [Math.round(n * (1 - w)), Math.round(n * (1 + w))];
}

// 주문: 유니폼은 시즌에 한 번 + 추가 생산 한 번(원가 1.3배, 30일 뒤), 머플러·아동용품은 언제든(14일 뒤), 한정판은 열렸을 때만
export function orderMerch(state, club, item, { quantity, price, design }) {
  const m = merchOf(club);
  const it = m.items[item];
  const def = ITEMS[item];
  quantity = Math.round(quantity);
  if (!def || !(quantity > 0)) return { ok: false, reason: '수량을 확인하세요.' };
  if (!(price > 0)) return { ok: false, reason: '가격을 확인하세요.' };
  if (it.incoming) return { ok: false, reason: '이미 주문한 물량이 오는 중입니다.' };
  let unit = unitCost(item);
  let arrive = state.date;
  if (def.kit) {
    if (it.ordered && it.reordered) return { ok: false, reason: '이번 시즌 유니폼 추가 생산은 이미 했습니다.' };
    if (it.ordered) {
      unit = roundMoney(unit * REORDER_COST);
      arrive = addDays(state.date, REORDER_DAYS);
      it.reordered = true;
    } else {
      if (design && !DESIGNS[design]) return { ok: false, reason: '없는 디자인입니다.' };
      if (design) it.design = design;
      it.starId = it.design === 'star' ? starPlayer(state, club)?.id ?? null : null;
      it.ordered = true;
    }
  } else if (def.limited) {
    if (!m.limited || state.date > m.limited.orderBy) return { ok: false, reason: '한정판은 우승·승격 때만 낼 수 있습니다.' };
    if (it.ordered) return { ok: false, reason: '한정판은 한 번만 낼 수 있습니다.' };
    it.ordered = true;
    m.limited.until = addDays(state.date, LIMITED_DAYS);
  } else {
    arrive = addDays(state.date, def.leadDays);
  }
  const cost = roundMoney(unit * quantity);
  if (club.finance.balance < cost) return { ok: false, reason: '잔고가 부족합니다.' };
  expense(club, 'merch', cost);
  it.price = roundMoney(price);
  if (arrive === state.date) it.stock += quantity;
  else it.incoming = { quantity, date: arrive };
  return { ok: true, cost, arrive };
}

export function setMerchPrice(club, item, price) {
  if (!(price > 0)) return { ok: false, reason: '가격을 확인하세요.' };
  merchOf(club).items[item].price = roundMoney(price);
  return { ok: true };
}

function sell(state, club, item, units) {
  const it = merchOf(club).items[item];
  it.carry += units;
  const n = Math.min(it.stock, Math.floor(it.carry));
  if (n <= 0) return 0;
  it.carry -= n;
  it.stock -= n;
  it.sold += n;
  const amount = roundMoney(n * it.price);
  it.revenue += amount;
  income(club, 'merch', amount);
  return n;
}

// 남은 재고가 며칠 치인지 (시즌 수요를 약 300일에 나눠 판다고 본다)
export const stockDays = (state, club, item) => {
  const demand = seasonDemand(state, club, item);
  return demand > 0 ? merchOf(club).items[item].stock / (demand / 300) : Infinity;
};

// 지금 주문하면 며칠 뒤 오는지 (더 주문할 수 없으면 null)
function leadTime(m, item) {
  const def = ITEMS[item];
  const it = m.items[item];
  if (def.limited || it.incoming) return null;
  if (def.kit) return it.ordered && !it.reordered ? REORDER_DAYS : null;
  return def.leadDays;
}

// 날마다: 도착한 물량을 받고, 조금씩 판다. 홈 경기 날은 더 많이 판다. 지금 주문해도 늦을 것 같은 품목을 돌려준다
export function merchDaily(state, club, homeGames, homeMatch) {
  const m = merchOf(club);
  const warnings = [];
  for (const item of ITEM_KEYS) {
    const it = m.items[item];
    if (it.incoming && it.incoming.date <= state.date) {
      it.stock += it.incoming.quantity;
      it.incoming = null;
      it.warned = false;
    }
    const lead = leadTime(m, item);
    if (lead !== null && it.stock > 0 && !it.warned) {
      const days = stockDays(state, club, item);
      if (days < lead) {
        it.warned = true;
        warnings.push({ item, name: ITEMS[item].name, days: Math.max(1, Math.round(days)), lead });
      }
    }
    if (!it.stock) continue;
    const demand = seasonDemand(state, club, item);
    if (ITEMS[item].limited) {
      if (m.limited?.until && state.date <= m.limited.until) sell(state, club, item, demand / LIMITED_DAYS);
      continue;
    }
    sell(state, club, item, (demand * (1 - HOME_SHARE)) / 365 + (homeMatch ? (demand * HOME_SHARE) / homeGames : 0));
  }
  return warnings;
}

// 첫 리그 홈 경기 날: 주문하지 않은 유니폼은 지난 디자인으로 예상 판매만큼 자동 생산
export function autoKits(state, club) {
  const done = [];
  for (const item of ['kitHome', 'kitAway']) {
    const it = merchOf(club).items[item];
    if (it.ordered) continue;
    const q = seasonDemand(state, club, item);
    if (q > 0 && orderMerch(state, club, item, { quantity: q, price: it.price }).ok) done.push(ITEMS[item].name);
  }
  return done;
}

// 시즌 끝: 남은 재고는 원가의 30%에 정리, 기록을 남기고 새 시즌 주문을 연다. 우승·승격이면 한정판이 열린다
export function merchSeasonEnd(state, club, season, unlock = null) {
  const m = merchOf(club);
  const row = { season, items: {} };
  for (const item of ITEM_KEYS) {
    const it = m.items[item];
    const leftover = it.stock + (it.incoming?.quantity ?? 0);
    const clearance = roundMoney(leftover * unitCost(item) * CLEARANCE);
    if (clearance) income(club, 'merch', clearance);
    if (it.sold || leftover) row.items[item] = { sold: it.sold, revenue: it.revenue, leftover, clearance };
    m.items[item] = { ...emptyItem(item, it.design), price: it.price };
  }
  m.history.unshift(row);
  m.history.length = Math.min(m.history.length, HISTORY_SEASONS);
  m.limited = unlock ? { reason: unlock, orderBy: addDays(state.date, 30), until: null } : null;
}
