import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, chooseClub, advance, simulateUserMatch, finishUserMatch, simulateToSeasonEnd, league } from '../js/core/game.js';
import {
  newGameView, layout, homeView, squadView, tacticsView, scheduleView, tableView, settingsView, fixtureDetail, seasonEndBanner,
} from '../js/ui/views.js';

const BAD = /undefined|NaN|\[object Object\]|null<\/|>null</;

function renderAll(state, ui = {}) {
  const pages = {
    home: homeView(state, ui),
    squad: squadView(state, ui),
    squadDetail: squadView(state, { ...ui, playerId: state.clubs[state.manager.clubId].squad[0] }),
    tactics: tacticsView(state, ui),
    schedule: scheduleView(state, ui),
    table: tableView(state, ui),
    settings: settingsView(state, ui),
  };
  pages.layout = layout(state, { view: 'home' }, pages.home);
  const played = league(state).fixtures.find((f) => f.result);
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

test('새 게임 화면 (세계 생성 전/후)', () => {
  assert.ok(newGameView(null, {}).includes('세계 생성'));
  const preview = createNewGame('v');
  const html = newGameView(null, { preview });
  assert.equal((html.match(/data-action="pickClub"/g) ?? []).length, 20);
  assert.ok(!BAD.test(html));
});

test('시즌 시작, 중간, 종료 시점에 모든 화면을 그릴 수 있다', () => {
  const state = createNewGame('v');
  chooseClub(state, Object.keys(state.clubs)[3], '테스트');
  check(renderAll(state));
  for (let i = 0; i < 12; i++) {
    advance(state);
    simulateUserMatch(state);
    finishUserMatch(state);
  }
  check(renderAll(state));
  simulateToSeasonEnd(state);
  const pages = renderAll(state);
  pages.seasonEnd = seasonEndBanner(state);
  check(pages);
});
