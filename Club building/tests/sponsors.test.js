import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { sponsorDaily, sponsorMonthly, sponsorSeasonEnd, baseValue } from '../js/core/sponsors.js';
import { finishTour } from '../js/core/tour.js';
import { Rng } from '../js/core/rng.js';
import { sponsorsView, fansView } from '../js/ui/views.js';
import { won } from '../js/ui/format.js';

function fresh(seed = 'sponsor') {
  const state = g.createNewGame(seed);
  g.chooseLeague(state, 'ENG1', '테스트');
  return state;
}

test('스폰서: 새 게임은 기존 계약으로 시작하고, 매달 계약 금액이 들어오며, 베팅 업종은 가족층이 싫어한다', () => {
  const state = fresh();
  const club = g.userClub(state);
  const s = g.sponsorsOf(state, club);
  assert.equal(s.contracts.partner3, null);
  assert.ok(g.SLOT_KEYS.filter((k) => s.contracts[k]).length === 6);
  const before = club.finance.season.income.commercial;
  for (const k of g.SLOT_KEYS) if (s.contracts[k]) s.contracts[k].industry = 'betting';
  const fans = sponsorMonthly(state, club, true);
  assert.ok(club.finance.season.income.commercial > before);
  assert.ok(fans.family < 0);
  assert.ok(baseValue(club, 'chest', 'betting') > baseValue(club, 'chest', 'local'));
});

test('영업 → 1~2주 뒤 제안 → 금액 요구: 최대 안이면 계약, 넘으면 올려 다시 제안, 너무 많으면 결렬', () => {
  const state = fresh();
  const club = g.userClub(state);
  assert.equal(g.pitchSponsor(state, 'stadium', 'betting').ok, false); // 계약이 1년 넘게 남은 자리는 영업 불가
  const res = g.pitchSponsor(state, 'partner3', 'local');
  assert.ok(res.ok);
  const rng = new Rng('t');
  state.date = res.ready;
  const arrived = sponsorDaily(state, rng, club);
  assert.equal(arrived.length, 1);
  const [o1, o2] = arrived[0].offers;
  const s = g.sponsorsOf(state, club);
  const max = o1.max;
  const r1 = g.answerSponsor(state, o1.id, { ask: max * 1.1 });
  assert.equal(r1.ok, false);
  assert.ok(o1.amount > 0 && !r1.collapsed);
  const r2 = g.answerSponsor(state, o1.id, { ask: max });
  assert.ok(r2.ok);
  assert.equal(s.contracts.partner3.amount, max);
  assert.equal(s.offers.length, 0); // 같은 자리의 다른 제안도 정리
  if (o2) assert.equal(g.answerSponsor(state, o2.id, { accept: true }).ok, false);
});

test('시즌 끝: 성적 보너스, 끝난 계약은 빈자리, 1년 안에 끝나면 미리 다음 계약', () => {
  const state = fresh();
  const club = g.userClub(state);
  const s = g.sponsorsOf(state, club);
  const ending = g.SLOT_KEYS.find((k) => s.contracts[k]?.until === `${state.season + 1}-06-30`);
  s.contracts[ending].bonus = { target: 20, amount: 1e8 };
  const before = club.finance.season.income.commercial;
  const r = sponsorSeasonEnd(state, club, 10);
  assert.ok(club.finance.season.income.commercial >= before + 1e8);
  assert.ok(r.ended.some((e) => e.slot === ending));
  assert.equal(s.contracts[ending], null);
});

test('투어: 7월 1~15일에만 고르고, 7월 31일에 초청료·해외 팬·피로가 반영된다', () => {
  const state = fresh('tour');
  const club = g.userClub(state);
  state.date = `${state.season}-07-05`;
  const fans = g.fansOf(club);
  const before = fans.overseas;
  assert.ok(g.tourGain(state, club, 'asia') > g.tourGain(state, club, 'domestic'));
  assert.ok(g.chooseTour(state, 'asia').ok);
  assert.equal(g.chooseTour(state, 'europe').ok, false);
  state.date = `${state.season}-07-31`;
  const cond = state.players[club.squad[0]].condition;
  const t = finishTour(state, new Rng('x'), club);
  assert.ok(t.fee > 0 && fans.overseas > before);
  assert.ok(state.players[club.squad[0]].condition <= cond);
  state.date = `${state.season}-07-20`;
  assert.equal(g.canChooseTour(state, club), false);
});

test('한 시즌 진행: 스폰서 수입이 들어오고, 스폰서 탭과 해외 팬이 보인다', () => {
  const state = fresh('sponsor-season');
  g.simulateToSeasonEnd(state);
  const f = g.userClub(state).finance;
  assert.ok((f.history[0] ?? f.season).income.commercial > 0 || f.season.income.commercial > 0);
  const html = sponsorsView(state, { pitchSlot: 'partner3' });
  for (const s of ['스폰서 계약', '유니폼 가슴', '받은 제안', '프리시즌 투어', '베팅', 'pitchSponsor']) assert.ok(html.includes(s), s);
  assert.ok(fansView(state).includes('해외 팬'));
});

test('처음 스폰서 회사는 자리마다 다르다', () => {
  const state = fresh('sponsor-unique');
  for (const c of Object.values(state.clubs).slice(0, 30)) {
    const names = Object.values(g.sponsorsOf(state, c).contracts).filter(Boolean).map((x) => x.company);
    assert.equal(new Set(names).size, names.length);
  }
});

test('스폰서: 팬 만족도가 바닥이어도 제안 금액이 0이 되지 않고, 거절당하면 요구 칸이 새 제안과 지난 요구 사이로 바뀐다', () => {
  const state = fresh('sponsor-low');
  const club = g.userClub(state);
  g.fansOf(club).satisfaction = 0;
  g.pitchSponsor(state, 'partner3', 'betting');
  state.date = g.sponsorsOf(state, club).pitches[0].ready;
  const [{ offers }] = sponsorDaily(state, new Rng('low'), club);
  assert.ok(offers.every((o) => o.amount > 0 && o.bonus.amount > 0));
  const o = offers[0];
  const ask = Math.round(o.max * 1.1);
  const res = g.answerSponsor(state, o.id, { ask });
  assert.equal(res.ok, false);
  const html = sponsorsView(state, {});
  const val = Number(html.match(new RegExp(`id="ask-${o.id}"[^>]*value="([0-9.]+)"`))[1]) * 1e8;
  assert.ok(val > o.amount * 0.99 && val < ask, `${val} 은 ${o.amount}~${ask} 사이`);
});

test('스폰서: 시즌이 끝나면 끝난 계약이 정리되고 이어지는 계약이 시작되며, 놓친 저장 파일도 보정된다', () => {
  const state = fresh('sponsor-end');
  const club = g.userClub(state);
  const s = g.sponsorsOf(state, club);
  const expiring = g.SLOT_KEYS.filter((k) => s.contracts[k]?.until === '2027-06-30');
  assert.ok(expiring.length);
  g.simulateToSeasonEnd(state);
  g.startNextSeason(state);
  for (const k of expiring) assert.ok(!s.contracts[k] || s.contracts[k].until > '2027-06-30', k);
  assert.ok(state.inbox.some((m) => m.title === '스폰서 시즌 정리'));
  // 예전 저장 파일: 끝난 계약과 다음 계약이 그대로 남아 있는 경우
  s.contracts.chest = { company: '옛회사', industry: 'food', amount: 1e8, until: '2027-06-30', bonus: null };
  s.pending = { chest: { company: '새회사', industry: 'tech', amount: 2e8, until: '2029-06-30', bonus: null, from: '2027-07-01' } };
  g.upgradeState(state);
  assert.equal(s.contracts.chest.company, '새회사');
  assert.equal(s.contracts.chest.from, undefined);
});

test('투어: 다녀오면 지역별 실적이 남고, 지역을 누르면 지난 실적 창이 열린다', () => {
  const state = fresh('tour-hist');
  const club = g.userClub(state);
  state.date = '2026-07-02';
  assert.ok(g.chooseTour(state, 'asia').ok);
  state.date = '2026-07-31';
  finishTour(state, new Rng('t'), club);
  assert.equal(club.tourHistory[0].region, 'asia');
  const html = sponsorsView(state, { tourRegion: 'asia' });
  assert.match(html, /아시아 투어 실적/);
  assert.match(html, /2026-27/);
  assert.match(sponsorsView(state, {}), /data-action="openTour" data-region="asia"/);
});

test('스폰서: 다음 계약을 이미 맺은 자리에는 다시 영업할 수 없다', () => {
  const state = fresh('sponsor-pending');
  const club = g.userClub(state);
  const s = g.sponsorsOf(state, club);
  const slot = g.SLOT_KEYS.find((k) => s.contracts[k]?.until === '2027-06-30');
  assert.ok(g.canPitch(state, club, slot));
  s.pending = { [slot]: { company: 'x', industry: 'food', amount: 1e8, until: '2029-06-30', bonus: null, from: '2027-07-01' } };
  assert.equal(g.canPitch(state, club, slot), false);
});

test('해외 팬: 투어로 느는 해외 팬은 처음 해외 팬 기준이라, 해외 팬이 많아져도 투어 증가량이 커지지 않는다', async () => {
  const { tourGain } = await import('../js/core/tour.js');
  const state = fresh('overseas-linear');
  const club = g.userClub(state);
  const first = tourGain(state, club, 'asia');
  g.fansOf(club).overseas *= 5;
  assert.equal(tourGain(state, club, 'asia'), first);
});

test('영업 창의 기준 금액은 core의 baseValue와 같다', () => {
  const state = fresh();
  const club = g.userClub(state);
  const html = sponsorsView(state, { pitchSlot: 'chest' });
  const shown = [...html.matchAll(/약 ([^<]+)\/년/g)].map((m) => m[1]);
  assert.equal(shown.length, g.INDUSTRY_KEYS.length);
  // 화면은 백만 원 단위로 반올림해 보여 준다
  g.INDUSTRY_KEYS.forEach((ind, i) => assert.equal(shown[i], won(Math.round(baseValue(club, 'chest', ind) / 1e6) * 1e6)));
});

test('요구 금액 추천: 처음엔 제안의 115%, 한 번 요구한 뒤엔 제안과 지난 요구의 중간', () => {
  assert.equal(g.suggestedAsk({ amount: 10e8 }), 11.5e8);
  assert.equal(g.suggestedAsk({ amount: 10e8, lastAsk: 14e8 }), 12e8);
});
