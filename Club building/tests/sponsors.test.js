import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { sponsorDaily, sponsorMonthly, sponsorSeasonEnd, baseValue } from '../js/core/sponsors.js';
import { finishTour } from '../js/core/tour.js';
import { Rng } from '../js/core/rng.js';
import { sponsorsView, fansView } from '../js/ui/views.js';

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
