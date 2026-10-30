import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { fitRegistration } from '../js/core/registration.js';
import { unavailableSet } from '../js/core/state.js';
import { generatePlayer } from '../js/core/worldgen.js';
import { Rng } from '../js/core/rng.js';
import { squadView } from '../js/ui/views.js';

function fresh(seed) {
  const state = g.createNewGame(seed);
  g.chooseLeague(state, 'ENG1', '테스트');
  return state;
}

// 내 구단 1군에 선수를 n명 더 넣는다 (계약 포함)
let nextId = 0;
function addPlayers(state, n, pos = 'CM') {
  const club = g.userClub(state);
  const rng = new Rng('add');
  const added = [];
  for (let i = 0; i < n; i++) {
    const p = generatePlayer(rng, { id: `x${nextId++}`, pos, target: 40, age: 25, country: club.country, seasonStart: '2026-07-01' });
    p.clubId = club.id;
    p.contract = { wage: 1e6, until: '2029-06-30', promise: 'backup' };
    state.players[p.id] = p;
    club.squad.push(p.id);
    added.push(p);
  }
  return added;
}

const reg = (state) => g.registeredCount(state, g.userClub(state), state.date);

test('등록: 임대 갔던 선수가 돌아와 25명을 넘으면, 시즌이 바뀔 때 미등록 선수가 생기고 경기 명단에서 빠지며 메시지가 온다', () => {
  const state = fresh('reg-loan');
  const club = g.userClub(state);
  addPlayers(state, g.MAX_SQUAD - reg(state));
  assert.equal(reg(state), g.MAX_SQUAD);
  const out = club.squad.map((id) => state.players[id]).filter((p) => p.contract.promise !== 'starter' && !p.youthSince)[0];
  assert.ok(g.loanOut(state, out.id).ok, '임대 보내기');
  addPlayers(state, 1, 'ST');
  assert.equal(reg(state), g.MAX_SQUAD);
  // 계약 만료·은퇴로 빠지는 선수가 없게 한다
  for (const id of club.squad) Object.assign(state.players[id].contract, { until: '2031-06-30' });
  for (const id of club.squad) state.players[id].birthDate = '2000-01-01';
  Object.assign(state.players[out.id].contract, { until: '2031-06-30' });
  g.simulateToSeasonEnd(state);
  g.startNextSeason(state);
  assert.equal(reg(state), g.MAX_SQUAD, '등록은 25명');
  const unreg = g.unregisteredPlayers(state);
  assert.ok(unreg.length >= 1);
  const banned = unavailableSet(state, g.userLeagueId(state), club);
  for (const p of unreg) assert.ok(banned.has(p.id), '미등록 선수는 경기에 못 나간다');
  assert.ok(state.inbox.some((m) => m.title === '1군 등록 인원 초과'));
});

test('등록: 넘칠 때 포지션과 능력을 본다 (골키퍼 2명·자리마다 1명은 남기고, 나머지는 능력 순)', () => {
  const state = fresh('reg-fit');
  const club = g.userClub(state);
  addPlayers(state, g.MAX_SQUAD - reg(state) + 3, 'CM');
  fitRegistration(state, club);
  assert.equal(reg(state), g.MAX_SQUAD);
  const registered = club.squad.map((id) => state.players[id]).filter((p) => !p.unregistered);
  assert.ok(registered.filter((p) => p.position === 'GK').length >= 2);
  // 새로 넣은 약한 선수(능력 40)들이 미등록이 된다
  assert.ok(g.unregisteredPlayers(state).every((p) => p.id.startsWith('x')));
});

test('등록: 등록 명단은 이적시장 기간에만 바꾸고, 25명을 넘겨 등록할 수 없으며, 선수단은 30명까지', () => {
  const state = fresh('reg-toggle');
  const club = g.userClub(state);
  addPlayers(state, g.MAX_SQUAD - reg(state) + 1);
  fitRegistration(state, club);
  const [u] = g.unregisteredPlayers(state);
  assert.equal(g.setRegistered(state, u.id, true).ok, false, '25명이 꽉 찼다');
  const r = club.squad.map((id) => state.players[id]).find((p) => !p.unregistered && !p.youthSince);
  assert.ok(g.setRegistered(state, r.id, false).ok);
  assert.ok(g.setRegistered(state, u.id, true).ok);
  state.date = '2026-10-01';
  assert.match(g.setRegistered(state, r.id, true).reason, /이적시장/);
  addPlayers(state, g.MAX_TOTAL - g.totalCount(state, club, state.date));
  const [free] = addPlayers(state, 1);
  club.squad.pop();
  Object.assign(free, { id: 'free1', clubId: null, contract: null });
  state.players.free1 = free;
  const res = g.offerTerms(state, 'free1', { wage: 1e9, years: 2, promise: 'backup' });
  assert.equal(res.ok, false);
  assert.match(res.reason, /30명/);
});

test('등록: 선수단 화면에 미등록 표시와 등록 버튼이 보인다', () => {
  const state = fresh('reg-view');
  addPlayers(state, g.MAX_SQUAD - reg(state) + 1);
  fitRegistration(state, g.userClub(state));
  const [u] = g.unregisteredPlayers(state);
  const html = squadView(state, { playerId: u.id });
  assert.match(html, /미등록 1명/);
  assert.match(html, /data-action="setRegistered"/);
});
