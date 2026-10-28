import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { FORMATIONS } from '../js/data/formations.js';
import { pitchLayout } from '../js/ui/pitch.js';
import { transfersView } from '../js/ui/transfers.js';
import {
  newGameView, layout, homeView, squadView, tacticsView, scheduleView, tableView, settingsView, fixtureDetail,
  seasonEndBanner, youthView, historyView, clubView, financeView,
} from '../js/ui/views.js';
import { managerView } from '../js/ui/manager.js';

// 우리 다음 경기 날까지 주 단위로 진행한다
const toMatch = (s) => {
  let res;
  do res = g.advance(s, { skipOffers: true, watchMatches: true }); while (res.stop === 'week');
  return res;
};


const BAD = /undefined|NaN|\[object Object\]|null<\/|>null</;

function renderAll(state, ui = {}) {
  const club = g.userClub(state);
  const pages = {
    home: homeView(state, ui),
    squad: squadView(state, ui),
    squadDetail: squadView(state, { ...ui, playerId: club.squad[0] }),
    tactics: tacticsView(state, ui),
    youth: youthView(state, ui),
    schedule: scheduleView(state, ui),
    table: tableView(state, ui),
    tableOther: tableView(state, { tableLeague: 'GER3' }),
    history: historyView(state, ui),
    settings: settingsView(state, ui),
    club: clubView(state, ui),
    finance: financeView(state, ui),
    transfers: transfersView(state, ui),
    manager: managerView(state, ui),
  };
  pages.layout = layout(state, { view: 'home' }, pages.home);
  const played = g.league(state).fixtures.find((f) => f.result);
  if (played) pages.fixture = fixtureDetail(state, played.id);
  return pages;
}

function check(pages) {
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(html.length > 50, `${name} 비어 있음`);
    const m = html.match(BAD);
    assert.ok(!m, `${name}에 이상한 값: ...${m && html.slice(Math.max(0, m.index - 80), m.index + 40)}...`);
  }
}

test('새 게임 화면: 리그마다 맡게 될 가장 약한 구단을 보여 주고 리그를 고른다', () => {
  assert.ok(newGameView(null, {}).includes('세계 생성'));
  const preview = g.createNewGame('v');
  const html = newGameView(null, { preview });
  assert.equal((html.match(/data-action="pickLeague"/g) ?? []).length, 15);
  assert.ok(html.includes(g.weakestClub(preview, 'ENG1').name));
  assert.ok(!BAD.test(html));
});

test('시즌 시작·중간·종료·다음 시즌에 모든 화면을 그릴 수 있다', () => {
  const state = g.createNewGame('v');
  g.chooseLeague(state, 'ESP3', '테스트');
  check(renderAll(state));
  for (let i = 0; i < 12; i++) {
    toMatch(state);
    g.simulateUserMatch(state);
    g.finishUserMatch(state);
  }
  check(renderAll(state));
  g.simulateToSeasonEnd(state);
  const end = renderAll(state);
  end.seasonEnd = seasonEndBanner(state);
  check(end);
  g.startNextSeason(state);
  check(renderAll(state));
});

test('포메이션 그림: 모든 포메이션에서 선수 칸이 겹치지 않는다', () => {
  // 칸 너비는 경기장의 18%, 높이 66px. 경기장이 가장 좁을 때(약 350px × 463px) 기준
  for (const [name, slots] of Object.entries(FORMATIONS)) {
    const at = pitchLayout(slots);
    for (let i = 0; i < at.length; i++) {
      for (let j = i + 1; j < at.length; j++) {
        const dx = Math.abs(at[i].x - at[j].x);
        const dy = Math.abs(at[i].y - at[j].y) * 4.63;
        assert.ok(dx >= 18 || dy >= 66, `${name}: ${slots[i]}와 ${slots[j]}가 겹침`);
      }
    }
  }
});

test('전술 화면에 포메이션 그림과 역할이 나온다', () => {
  const state = g.createNewGame('p');
  g.chooseLeague(state, 'ENG1', '테스트');
  const html = tacticsView(state, {});
  assert.equal((html.match(/class="spot /g) ?? []).length, 11);
  assert.ok(html.includes('spot-role'));
});

test('재계약 협상 화면, 구단·재정 화면', () => {
  const state = g.createNewGame('jobs');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  const expiring = club.squad.find((id) => state.players[id].contract.until === '2027-06-30');
  const html = squadView(state, { playerId: expiring });
  assert.ok(html.includes('data-action="offerRenewal"'));
  check({ renew: html, club: clubView(state, { clubMsg: { ok: false, text: '거절' } }), finance: financeView(state) });
});
test('이적 화면: 검색 결과, 다른 구단 선수 상세(이적료·개인 조건), 자유계약 선수, 받은 제안', () => {
  const state = g.createNewGame('view-tr');
  g.chooseLeague(state, 'ENG1', '테스트');
  const me = g.userClub(state);
  me.finance.transferBudget = 1e13;
  me.finance.wageBudget = 1e13;
  me.squad.pop();
  const search = { position: 'ST', maxAge: 25 };
  const [first, second, third] = g.searchPlayers(state, search);
  const feeStage = transfersView(state, { search, targetId: first.id });
  assert.match(feeStage, /1단계: 이적료/);
  assert.match(feeStage, new RegExp(`잠재 ${first.potentialRange[0]}~${first.potentialRange[1]}`));
  assert.match(feeStage, /마무리/); // 협상 중에도 선수 프로필(능력치)을 보여 준다
  const { counter } = g.bidForPlayer(state, second.id, 1e6);
  g.bidForPlayer(state, third.id, 1e6);
  const refused = transfersView(state, { search, targetId: third.id });
  assert.match(refused, /요구 이적료/);
  g.bidForPlayer(state, second.id, counter);
  const termsStage = transfersView(state, { search, targetId: second.id });
  assert.match(termsStage, /2단계: 개인 조건/);
  assert.match(termsStage, /진행 중인 협상/);
  const free = state.players[first.id];
  state.clubs[free.clubId].squad = state.clubs[free.clubId].squad.filter((id) => id !== free.id);
  Object.assign(free, { clubId: null, contract: null, freeSince: '2026-06-30' });
  const freeView = transfersView(state, { search: { freeOnly: true }, targetId: free.id });
  assert.match(freeView, /자유계약: 개인 조건/);
  g.setTransferListed(state, me.squad[0], true);
  state.transfers.incoming.push({ id: 1, playerId: me.squad[0], clubId: second.clubId, fee: 5e9, date: state.date, expires: '2026-07-08' });
  const offerView = transfersView(state, {});
  assert.match(offerView, /수락/);
  assert.match(offerView, /50억 원/);
  check({ feeStage, termsStage, freeView, offerView, squad: squadView(state, { playerId: me.squad[0] }) });
});
