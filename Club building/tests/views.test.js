import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { FORMATIONS } from '../js/data/formations.js';
import { pitchLayout } from '../js/ui/pitch.js';
import {
  newGameView, layout, homeView, squadView, tacticsView, scheduleView, tableView, settingsView, fixtureDetail,
  seasonEndBanner, youthView, historyView, chooseJobView,
} from '../js/ui/views.js';

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

test('새 게임 화면: 나라·리그를 바꿔 구단을 고른다', () => {
  assert.ok(newGameView(null, {}).includes('세계 생성'));
  const preview = g.createNewGame('v');
  const count = (html) => (html.match(/data-action="pickClub"/g) ?? []).length;
  assert.equal(count(newGameView(null, { preview })), 20);
  assert.equal(count(newGameView(null, { preview, previewLeague: 'ENG2' })), 24);
  assert.equal(count(newGameView(null, { preview, previewLeague: 'GER1' })), 18);
  assert.ok(!BAD.test(newGameView(null, { preview, previewLeague: 'FRA3' })));
});

test('시즌 시작·중간·종료·다음 시즌에 모든 화면을 그릴 수 있다', () => {
  const state = g.createNewGame('v');
  g.chooseClub(state, Object.values(state.clubs).find((c) => c.leagueId === 'ESP3').id, '테스트');
  check(renderAll(state));
  for (let i = 0; i < 12; i++) {
    g.advance(state);
    g.simulateUserMatch(state);
    g.finishUserMatch(state);
  }
  check(renderAll(state));
  g.simulateToSeasonEnd(state);
  const end = renderAll(state);
  end.seasonEnd = seasonEndBanner(state);
  check(end);
  g.startNextSeason(state);
  if (state.phase === 'chooseJob') {
    check({ job: chooseJobView(state, {}) });
    g.chooseNewClub(state, g.jobOffers(state)[0].id);
  }
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
  g.chooseClub(state, Object.keys(state.clubs)[0], '테스트');
  const html = tacticsView(state, {});
  assert.equal((html.match(/class="spot /g) ?? []).length, 11);
  assert.ok(html.includes('spot-role'));
});
