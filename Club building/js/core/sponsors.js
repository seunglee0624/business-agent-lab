// 스폰서: 자리(유니폼 가슴·경기장 이름·소매·훈련장·공식 파트너)마다 업종을 골라 영업하고, 제안을 협상한다

import { commercialPerSeason, income, MERCH_SHARE } from './finance.js';
import { fansOf, overseasFactor, expectedPosition, START_SATISFACTION } from './fans.js';
import { addDays } from './calendar.js';
import { roundMoney } from './money.js';
import { standings } from './state.js';
import { withParticle } from './korean.js';

export const SPONSOR_SHARE = 1 - MERCH_SHARE; // 우리 구단 상업 수입 중 스폰서 몫
export const SLOTS = {
  chest: { name: '유니폼 가슴', weight: 0.35, fan: 1 },
  stadium: { name: '경기장 이름', weight: 0.25, fan: 1 },
  sleeve: { name: '소매', weight: 0.12, fan: 0.6 },
  training: { name: '훈련장', weight: 0.1, fan: 0.4 },
  partner1: { name: '공식 파트너 1', weight: 0.06, fan: 0.3 },
  partner2: { name: '공식 파트너 2', weight: 0.06, fan: 0.3 },
  partner3: { name: '공식 파트너 3', weight: 0.06, fan: 0.3 },
};
export const SLOT_KEYS = Object.keys(SLOTS);
export const INDUSTRIES = {
  betting: { name: '베팅', mult: 1.4, fans: { family: -0.6, local: -0.4 }, companies: ['럭키라인', '골드벳', '윈스타', '하이롤러', '킥오프벳'] },
  finance: { name: '금융·항공', mult: 1.15, fans: {}, companies: ['노스뱅크', '스카이웨이 항공', '퍼스트캐피털', '오로라 에어', '센트럴 보험'] },
  tech: { name: '자동차·전자', mult: 1, fans: { trendy: 0.5 }, companies: ['볼트모터스', '네오일렉트릭', '파이온 전자', '레이스카', '스파크텍'] },
  sport: { name: '스포츠 브랜드', mult: 1, fans: { trendy: 0.4, loyal: 0.4 }, companies: ['스트라이드', '에이펙스 스포츠', '킥라인', '프라임핏', '유나이트웨어'] },
  food: { name: '식음료', mult: 0.85, fans: { family: 0.6 }, companies: ['선데이 주스', '하베스트 푸드', '크런치', '블루밀크', '해피버거'] },
  local: { name: '지역 기업', mult: 0.7, fans: { local: 1.1 }, companies: ['시티 건설', '하버 물류', '타운 베이커리', '리버사이드 병원', '올드브릿지 양조'] },
};
export const INDUSTRY_KEYS = Object.keys(INDUSTRIES);
export const MAX_ASKS = 3;
export const PITCH_DAYS = [7, 14];
export const OFFER_DAYS = 14;
const WALK_AWAY = 1.2; // 최대 금액의 이 배를 넘게 요구하면 협상을 끝낸다

// 구단 id로 정해지는 0~1 값
function hash01(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 0xffffffff;
}

export const seasonEndDate = (season) => `${season + 1}-06-30`;

// 자리 하나의 기본 연 금액: 상업 수입의 스폰서 몫 × 자리 비중 × 업종
export function baseValue(club, slot, industry) {
  return commercialPerSeason(club) * SPONSOR_SHARE * SLOTS[slot].weight * INDUSTRIES[industry].mult;
}

// 지금 구단 가치: 성적(기대 순위 대비), 팬 만족도(아무리 낮아도 0.6배), 해외 팬
export function clubAppeal(state, club) {
  const table = standings(state, club.leagueId);
  const pos = table.findIndex((r) => r.clubId === club.id) + 1;
  const played = table.find((r) => r.clubId === club.id)?.played ?? 0;
  const form = played >= 5 ? Math.max(-0.1, Math.min(0.1, (expectedPosition(state, club) - pos) * 0.015)) : 0;
  const sat = Math.max(0.6, Math.sqrt(fansOf(club).satisfaction / START_SATISFACTION));
  return (1 + form) * sat * overseasFactor(club);
}

// 같은 회사가 두 자리를 맡지 않게 고른다
function pickCompany(names, r, used) {
  const start = Math.floor(r * names.length);
  for (let i = 0; i < names.length; i++) {
    const name = names[(start + i) % names.length];
    if (!used.has(name)) { used.add(name); return name; }
  }
  return names[start];
}

// 저장 파일에 스폰서 정보가 없으면 기존 계약(1~2년 남음)을 깔아 준다. 공식 파트너 3번은 비어 있다
export function sponsorsOf(state, club) {
  if (!club.sponsors) {
    const contracts = {};
    const used = new Set();
    SLOT_KEYS.forEach((slot, i) => {
      if (slot === 'partner3') { contracts[slot] = null; return; }
      const industry = INDUSTRY_KEYS[Math.floor(hash01(`${club.id}:${slot}`) * INDUSTRY_KEYS.length)];
      const names = INDUSTRIES[industry].companies;
      contracts[slot] = {
        company: pickCompany(names, hash01(`${club.id}:${slot}:n`), used),
        industry,
        amount: roundMoney(baseValue(club, slot, industry) * 0.95),
        until: seasonEndDate(state.season + (i % 2)),
        bonus: null,
      };
    });
    club.sponsors = { contracts, pitches: [], offers: [], history: [], nextId: 1 };
  }
  return club.sponsors;
}

// 영업할 수 있는 자리: 비어 있거나 계약이 1년 안에 끝나는 자리
export function canPitch(state, club, slot) {
  const s = sponsorsOf(state, club);
  if (!SLOTS[slot]) return false;
  if (s.pitches.some((p) => p.slot === slot) || s.offers.some((o) => o.slot === slot) || s.pending?.[slot]) return false;
  const c = s.contracts[slot];
  return !c || c.until <= addDays(state.date, 365);
}

export function pitchSponsor(state, rng, club, slot, industry) {
  if (!INDUSTRIES[industry]) return { ok: false, reason: '없는 업종입니다.' };
  if (!canPitch(state, club, slot)) return { ok: false, reason: '이 자리는 지금 영업할 수 없습니다. (계약이 1년 넘게 남았거나 이미 영업·제안 중)' };
  const ready = addDays(state.date, rng.int(PITCH_DAYS[0], PITCH_DAYS[1]));
  sponsorsOf(state, club).pitches.push({ slot, industry, ready });
  return { ok: true, ready };
}

// 영업 결과: 그 업종 회사 1~3곳이 제안을 보낸다
function makeOffers(state, rng, club, pitch) {
  const s = sponsorsOf(state, club);
  const appeal = clubAppeal(state, club);
  const names = rng.shuffle([...INDUSTRIES[pitch.industry].companies]).slice(0, rng.int(1, 3));
  const teams = standings(state, club.leagueId).length;
  return names.map((company) => {
    const amount = roundMoney(baseValue(club, pitch.slot, pitch.industry) * appeal * (0.85 + rng.next() * 0.2));
    const target = Math.max(1, Math.min(teams, expectedPosition(state, club) - rng.int(0, 2)));
    const offer = {
      id: `sp${s.nextId++}`,
      slot: pitch.slot,
      industry: pitch.industry,
      company,
      amount,
      years: rng.int(1, 5),
      bonus: { target, amount: roundMoney(amount * (0.1 + rng.next() * 0.1)) },
      max: roundMoney(amount * (1.05 + rng.next() * 0.2)),
      asks: 0,
      expires: addDays(state.date, OFFER_DAYS),
    };
    s.offers.push(offer);
    return offer;
  });
}

// 끝난 계약이 남아 있으면 정리하고 이어지는 계약을 시작한다 (시즌 끝 처리를 놓친 저장 파일 보정)
export function sponsorCatchUp(state, club) {
  const s = sponsorsOf(state, club);
  for (const slot of SLOT_KEYS) {
    const c = s.contracts[slot];
    if (!c || c.until >= state.date) continue;
    s.history.unshift({ season: Number(c.until.slice(0, 4)) - 1, slot, company: c.company, industry: c.industry, amount: c.amount });
    s.contracts[slot] = s.pending?.[slot] ?? null;
    if (s.contracts[slot]) delete s.contracts[slot].from;
    if (s.pending) delete s.pending[slot];
  }
}

// 날마다: 영업 결과가 나오면 제안을 만들고, 기한 지난 제안은 지운다
export function sponsorDaily(state, rng, club) {
  sponsorCatchUp(state, club);
  const s = sponsorsOf(state, club);
  const arrived = [];
  for (const p of s.pitches.filter((x) => x.ready <= state.date)) {
    s.pitches = s.pitches.filter((x) => x !== p);
    arrived.push({ slot: p.slot, industry: p.industry, offers: makeOffers(state, rng, club, p) });
  }
  s.offers = s.offers.filter((o) => o.expires >= state.date);
  return arrived;
}

// 계약 시작: 지금 계약이 남아 있으면 그 계약이 끝난 다음 날부터
function sign(state, club, offer, amount) {
  const s = sponsorsOf(state, club);
  const cur = s.contracts[offer.slot];
  const startSeason = cur && cur.until > state.date ? Number(cur.until.slice(0, 4)) : state.season;
  const contract = { company: offer.company, industry: offer.industry, amount: roundMoney(amount), until: seasonEndDate(startSeason + offer.years - 1), bonus: offer.bonus };
  if (cur && cur.until > state.date) contract.from = addDays(cur.until, 1);
  s.offers = s.offers.filter((o) => o.slot !== offer.slot);
  if (contract.from) s.pending = { ...(s.pending ?? {}), [offer.slot]: contract };
  else s.contracts[offer.slot] = contract;
  return contract;
}

// 제안 수락 또는 금액 요구
export function answerSponsor(state, club, offerId, { accept = false, ask = null } = {}) {
  const s = sponsorsOf(state, club);
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: '이미 끝난 제안입니다.' };
  if (accept) return { ok: true, contract: sign(state, club, offer, offer.amount) };
  if (!(ask > 0)) return { ok: false, reason: '요구 금액을 확인하세요.' };
  if (ask <= offer.amount) return { ok: true, contract: sign(state, club, offer, offer.amount) };
  if (ask <= offer.max) return { ok: true, contract: sign(state, club, offer, ask) };
  offer.asks++;
  offer.lastAsk = roundMoney(ask);
  if (ask > offer.max * WALK_AWAY || offer.asks >= MAX_ASKS) {
    s.offers = s.offers.filter((o) => o !== offer);
    return { ok: false, collapsed: true, reason: `${withParticle(offer.company, '가')} 협상을 끝냈습니다.` };
  }
  offer.amount = roundMoney((offer.amount + offer.max) / 2);
  return { ok: false, reason: `${withParticle(offer.company, '가')} 거절하고 연 ${offer.amount.toLocaleString()}원으로 올려 다시 제안했습니다. (${MAX_ASKS - offer.asks}번 더 요구할 수 있습니다)`, amount: offer.amount };
}

export function rejectSponsor(state, club, offerId) {
  const s = sponsorsOf(state, club);
  s.offers = s.offers.filter((o) => o.id !== offerId);
  return { ok: true };
}

// 매달 1일: 업종에 따른 팬층 반응 (fanMonthly에 넘길 값). 매달 마지막 날(정산): 계약 금액의 1/12 (pay)
export function sponsorMonthly(state, club, pay = false) {
  const s = sponsorsOf(state, club);
  let total = 0;
  const fans = {};
  for (const slot of SLOT_KEYS) {
    const c = s.contracts[slot];
    if (!c || c.until < state.date) continue;
    total += c.amount / 12;
    for (const [k, d] of Object.entries(INDUSTRIES[c.industry].fans)) fans[k] = (fans[k] ?? 0) + d * SLOTS[slot].fan;
  }
  if (pay && total) income(club, 'commercial', roundMoney(total));
  return fans;
}

// 시즌 끝: 성적 보너스, 끝난 계약 정리, 이어지는 계약 시작
export function sponsorSeasonEnd(state, club, position) {
  const s = sponsorsOf(state, club);
  const end = seasonEndDate(state.season);
  const bonuses = [];
  const ended = [];
  for (const slot of SLOT_KEYS) {
    const c = s.contracts[slot];
    if (!c) continue;
    if (c.bonus && position && position <= c.bonus.target) {
      income(club, 'commercial', c.bonus.amount);
      bonuses.push({ company: c.company, amount: c.bonus.amount });
    }
    if (c.until <= end) {
      s.history.unshift({ season: state.season, slot, company: c.company, industry: c.industry, amount: c.amount });
      s.contracts[slot] = null;
      ended.push({ slot, company: c.company });
    }
    if (s.pending?.[slot]) {
      s.contracts[slot] = s.pending[slot];
      delete s.contracts[slot].from;
      delete s.pending[slot];
    }
  }
  s.history.length = Math.min(s.history.length, 30);
  return { bonuses, ended: ended.filter((e) => !s.contracts[e.slot]) };
}
