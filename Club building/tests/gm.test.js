import { test } from 'node:test';
import { overall } from '../js/core/player.js';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { managerView } from '../js/ui/manager.js';
import { settingsView } from '../js/ui/views.js';
import { createNewGame, chooseLeague, userClub, STATE_VERSION, advance, league, simulateToSeasonEnd, startNextSeason,
  managerCandidates, hireManager, fireManager, transferRequests, answerRequest } from '../js/core/game.js';
import { weeklyWageBill } from '../js/core/finance.js';
import { clubStrength } from '../js/core/state.js';

test('새 게임: 리그를 고르면 그 리그의 가장 약한 구단의 단장이 되고, 구단에는 AI 감독이 있다', () => {
  const state = createNewGame('gm1');
  chooseLeague(state, 'ENG1', '테스트');
  const club = userClub(state);
  assert.equal(club.leagueId, 'ENG1');
  const rivals = Object.values(state.clubs).filter((c) => c.status === 'active' && c.leagueId === 'ENG1');
  assert.ok(rivals.every((c) => clubStrength(state, c) >= clubStrength(state, club)));
  assert.equal(state.phase, 'season');
  assert.equal(state.user.name, '테스트');
  assert.equal(state.user.trust, undefined, '수뇌부 신뢰도는 없다');
  const coach = club.headCoach;
  assert.ok(coach.name && coach.ability >= 1 && coach.ability <= 20 && coach.wage > 0 && coach.until > state.date);
  assert.equal(STATE_VERSION, 5);
});

const fresh = (seed, leagueId = 'ENG1') => {
  const state = createNewGame(seed);
  chooseLeague(state, leagueId, '테스트');
  return state;
};
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

test('한 주 진행: "계속"은 다음 월요일에 멈춘다', () => {
  const state = fresh('gm2');
  assert.equal(advance(state, { skipOffers: true }).stop, 'week');
  assert.equal(state.date, '2026-07-06');
  assert.equal(weekday(state.date), 1);
  advance(state, { skipOffers: true });
  assert.equal(state.date, '2026-07-13');
});

test('한 주 진행: 그 사이 우리 경기는 결과로 처리되고, 경기 보기를 켜면 우리 경기 날 멈춘다', () => {
  const state = fresh('gm3');
  const me = userClub(state).id;
  while (state.date < '2026-09-01') advance(state, { skipOffers: true });
  const mine = league(state).fixtures.filter((f) => (f.home === me || f.away === me) && f.date < state.date);
  assert.ok(mine.length >= 2 && mine.every((f) => f.result));
  const res = advance(state, { skipOffers: true, watchMatches: true });
  assert.equal(res.stop, 'userMatch');
  assert.ok(res.fixture.home === me || res.fixture.away === me);
});

test('단장은 해고되지 않는다: 최하위로 시즌을 끝내도 구단을 계속 맡고, 수뇌부 메시지가 없다', () => {
  const state = fresh('gm4', 'ENG3');
  const club = userClub(state);
  for (const id of club.squad) for (const k of Object.keys(state.players[id].attrs)) state.players[id].attrs[k] = 2;
  simulateToSeasonEnd(state);
  startNextSeason(state);
  assert.equal(state.phase, 'season');
  assert.equal(userClub(state).id, club.id);
  assert.equal(club.status, 'active');
  assert.ok(!state.inbox.some((m) => /해고|수뇌부|감독 제의/.test(m.title)));
});

test('감독 후보: 6명쯤 있고, 능력이 높을수록 비싸다', () => {
  const state = fresh('gm5');
  const list = managerCandidates(state);
  assert.ok(list.length >= 5);
  const sorted = list.slice().sort((a, b) => a.ability - b.ability);
  assert.ok(sorted.at(-1).wage > sorted[0].wage);
  for (const c of list) assert.ok(typeof c.willing === 'boolean' && c.style);
});

test('감독 해고: 남은 계약 주급의 절반을 위약금으로 내고, 감독 없이도 진행된다 (코치가 임시로 맡는다)', () => {
  const state = fresh('gm6');
  const club = userClub(state);
  const coach = club.headCoach;
  coach.until = '2028-06-30';
  const balance = club.finance.balance;
  const res = fireManager(state);
  assert.equal(res.ok, true);
  assert.equal(club.headCoach, null);
  // 2026-07-01 → 2028-06-30 은 104주쯤: 위약금은 주급 × 남은 주 × 0.5
  assert.ok(res.compensation > coach.wage * 50 && res.compensation < coach.wage * 54, `${res.compensation / coach.wage}주치`);
  assert.equal(club.finance.balance, balance - res.compensation);
  assert.equal(advance(state, { skipOffers: true }).stop, 'week');
});

test('감독 고용: 감독 자리가 비어 있어야 하고, 오려는 후보만 데려올 수 있으며, 주급이 지출에 잡힌다', () => {
  const state = fresh('gm7');
  const club = userClub(state);
  const willing = managerCandidates(state).find((c) => c.willing);
  assert.equal(hireManager(state, willing.id).ok, false, '감독이 있으면 먼저 해고');
  fireManager(state);
  const bill = weeklyWageBill(state, club);
  const unwilling = managerCandidates(state).find((c) => !c.willing);
  if (unwilling) assert.equal(hireManager(state, unwilling.id).ok, false);
  assert.equal(hireManager(state, willing.id).ok, true);
  assert.equal(club.headCoach.id, willing.id);
  assert.ok(club.headCoach.until > state.date);
  assert.equal(weeklyWageBill(state, club), bill + willing.wage);
  assert.ok(!managerCandidates(state).some((c) => c.id === willing.id));
});

test('영입 요청: 이적시장이 열리면 감독이 2~4명을 요청하고, 승인하면 협상 목록에 오르고 거절하면 사라진다', () => {
  const state = fresh('gm8');
  const club = userClub(state);
  club.finance.transferBudget = 1e12;
  advance(state, { skipOffers: true });
  const list = transferRequests(state);
  assert.ok(list.length >= 2 && list.length <= 4, `${list.length}명`);
  for (const r of list) {
    const p = state.players[r.playerId];
    assert.ok(p.clubId && p.clubId !== club.id);
    assert.ok(r.reason);
  }
  const [a, b] = list;
  assert.equal(answerRequest(state, a.id, 'approve').ok, true);
  assert.equal(state.transfers.deals[a.playerId].stage, 'fee');
  assert.equal(answerRequest(state, b.id, 'reject').ok, true);
  assert.equal(state.transfers.deals[b.playerId], undefined);
  assert.equal(transferRequests(state).length, list.length - 2);
});

test('영입 요청: 이적시장이 닫혀 있거나 감독이 없으면 요청이 없다', () => {
  const state = fresh('gm9');
  fireManager(state);
  advance(state, { skipOffers: true });
  assert.equal(transferRequests(state).length, 0);
  const s2 = fresh('gm10');
  while (s2.date < '2026-09-07') advance(s2, { skipOffers: true });
  for (const r of transferRequests(s2)) answerRequest(s2, r.id, 'reject');
  advance(s2, { skipOffers: true });
  assert.equal(transferRequests(s2).length, 0);
});

test('메시지: 연결된 화면이 있고, 그 화면의 안 읽은 메시지를 셀 수 있으며, 열면 읽음 처리된다', async () => {
  const { unreadCount, openMessage, markViewRead } = await import('../js/core/game.js');
  const state = fresh('gm-msg');
  fireManager(state);
  const msg = state.inbox.find((m) => m.title.endsWith('감독 해고'));
  assert.equal(msg.view, 'manager');
  assert.equal(unreadCount(state, 'manager'), 1);
  assert.ok(unreadCount(state) >= 2, '전체 안 읽은 수');
  assert.equal(openMessage(state, msg.id), 'manager');
  assert.equal(msg.read, true);
  assert.equal(unreadCount(state, 'manager'), 0);
  const c = managerCandidates(state).find((x) => x.willing);
  hireManager(state, c.id);
  markViewRead(state, 'manager');
  assert.equal(unreadCount(state, 'manager'), 0);
});

test('메시지: 전체 읽음', async () => {
  const { unreadCount, markAllRead } = await import('../js/core/game.js');
  const state = fresh('gm-allread');
  fireManager(state);
  assert.ok(unreadCount(state) >= 2);
  markAllRead(state);
  assert.equal(unreadCount(state), 0);
});

test('진행 멈춤: 스폰서 제안·투어 선택처럼 단장이 답할 일이 생기면 그날 멈추고 해당 화면을 알려 준다', () => {
  const state = g.createNewGame('decide');
  g.chooseLeague(state, 'ENG1', '테스트');
  g.pitchSponsor(state, 'partner3', 'local');
  const ready = g.sponsorsOf(state, g.userClub(state)).pitches[0].ready;
  let res;
  do res = advance(state, { watchMatches: true }); while (res.stop === 'week' || res.stop === 'transferOffer');
  assert.equal(res.stop, 'decision');
  assert.ok(state.date <= ready);
  // skipOffers면 멈추지 않는다
  const s2 = g.createNewGame('decide');
  g.chooseLeague(s2, 'ENG1', '테스트');
  g.pitchSponsor(s2, 'partner3', 'local');
  assert.notEqual(advance(s2, { skipOffers: true }).stop, 'decision');
});

test('진행 멈춤: 이적시장 마감 1주 전·첫 홈 경기 1주 전에 멈추고, 설정에서 끄면 멈추지 않는다', () => {
  const run = (off = []) => {
    const state = g.createNewGame('decide-cal');
    g.chooseLeague(state, 'ENG1', '테스트');
    for (const k of off) state.settings.decisions[k] = false;
    const stops = [];
    while (state.date < '2026-09-01') {
      const res = advance(state, {});
      if (res.stop === 'decision') stops.push(...res.titles);
      if (res.stop === 'seasonEnd') break;
    }
    return stops;
  };
  const all = run();
  assert.ok(all.some((t) => t.startsWith('이적시장 마감 1주 전')));
  assert.ok(all.some((t) => t.startsWith('첫 리그 홈 경기')));
  assert.ok(all.some((t) => t.startsWith('여름 이적시장')));
  const some = run(['windowClose', 'firstHome', 'windowOpen']);
  assert.ok(!some.some((t) => t.startsWith('이적시장 마감') || t.startsWith('첫 리그 홈 경기') || t.startsWith('여름 이적시장')));
  assert.match(settingsView(g.createNewGame('x')), /toggleDecision/);
});

test('주간 요약: 잔고와 지난주 대비 변화, 수입·지출 항목, 팬 만족도가 나온다', () => {
  const state = g.createNewGame('weekly-money');
  g.chooseLeague(state, 'ENG1', '테스트');
  for (let i = 0; i < 9; i++) advance(state, { skipOffers: true });
  const weekly = state.inbox.filter((m) => m.title.startsWith('주간 요약'));
  assert.ok(weekly.length >= 2);
  const body = weekly[0].body;
  assert.match(body, /재정: 잔고 .+ \([+-]/);
  assert.ok(!body.includes("수입:"));
  assert.match(body, /팬: 만족도 \d+ \([+-]/);
});

test('감독: 포지션 진단으로 부족한 자리를 알려 주고, 추천 선수를 요구하면 약한 자리부터 요청에 올리며 일주일에 한 번만 된다', () => {
  const state = g.createNewGame('ask-coach');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  // 왼쪽 수비수를 모두 내보낸다
  const lbs = club.squad.filter((id) => state.players[id].position === 'LB');
  club.squad = club.squad.filter((id) => !lbs.includes(id));
  const lb = g.positionNeeds(state).find((n) => n.pos === 'LB');
  assert.equal(lb.status, 'short');
  const res = g.askCoach(state);
  assert.ok(res.ok, res.reason);
  assert.equal(state.players[res.made[0].playerId].position, 'LB');
  assert.equal(g.askCoach(state).ok, false, '일주일에 한 번');
  const html = managerView(state, {});
  assert.match(html, /선수단 진단/);
  assert.match(html, /data-action="askCoach"/);
  state.date = '2026-10-01';
  const closed = g.askCoach(state);
  assert.ok(closed.ok && !closed.open, closed.reason);
  assert.ok(closed.made.every((r) => r.until === '2027-01-31'));
});

test('계약 해지: 남은 주급의 절반을 위약금으로 내고 자유계약 선수가 되며, 1군 자리가 빈다', () => {
  const state = g.createNewGame('release');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  const p = state.players[club.squad[club.squad.length - 1]];
  const cost = g.releaseCost(state, p);
  assert.ok(cost > 0);
  const before = club.finance.balance;
  const reg = g.registeredCount(state, club, state.date);
  assert.ok(g.releasePlayer(state, p.id).ok);
  assert.equal(club.finance.balance, before - cost);
  assert.equal(p.clubId, null);
  assert.equal(g.registeredCount(state, club, state.date), reg - 1);
});

test('감독 추천: 이적료와 주급 여유를 넘는 주급(이적 예산에서 옮길 돈)을 합쳐 이적 예산 안인 선수만 추천한다', () => {
  const state = g.createNewGame('ask-wage');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  club.finance.wageBudget = weeklyWageBill(state, club);
  // 주급 여유가 없어도 이적 예산이 넉넉하면 추천한다
  assert.ok(g.askCoach(state).ok);
  state.transfers.lastAsk = null;
  state.transfers.requests = [];
  club.finance.transferBudget = 0;
  const res = g.askCoach(state);
  assert.equal(res.ok, false);
  assert.match(res.reason, /주급 예산/);
});

test('감독 추천: 이적 예산이 없어도 주급 여유가 있으면 자유계약 선수를 추천하고, 승인하면 바로 개인 조건 협상으로 간다', () => {
  const state = g.createNewGame('ask-free');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  club.finance.transferBudget = 0;
  club.finance.wageBudget = weeklyWageBill(state, club) * 2;
  // 자유계약 선수 한 명을 왼쪽 수비 보강 후보로 만든다
  const lbs = club.squad.filter((id) => state.players[id].position === 'LB');
  club.squad = club.squad.filter((id) => !lbs.includes(id));
  const free = Object.values(state.players).find((p) => p.clubId && p.clubId !== club.id && p.position === 'LB' && overall(p) <= club.level + 8 && !state.clubs[p.clubId].youth.includes(p.id));
  state.clubs[free.clubId].squad = state.clubs[free.clubId].squad.filter((id) => id !== free.id);
  Object.assign(free, { clubId: null, contract: null });
  const res = g.askCoach(state);
  assert.ok(res.ok, res.reason);
  const req = res.made.find((r) => !state.players[r.playerId].clubId);
  assert.ok(req, '자유계약 선수가 추천에 든다');
  assert.ok(g.answerRequest(state, req.id, 'approve').ok);
  assert.equal(state.transfers.deals[req.playerId].stage, 'terms');
});
