import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, chooseLeague, userClub, advance, managerCandidates, hireManager, fireManager, startUserMatch } from '../js/core/game.js';

const fresh = (seed) => {
  const state = createNewGame(seed);
  chooseLeague(state, 'ENG1', '테스트');
  return state;
};

function hireStyle(state, style) {
  fireManager(state);
  const c = managerCandidates(state)[0];
  const pooled = state.coachPool.find((x) => x.id === c.id);
  pooled.style = style;
  pooled.ability = 1;
  assert.ok(hireManager(state, c.id).ok);
}

const toMatch = (s) => {
  for (let i = 0; i < 20; i++) if (advance(s, { skipOffers: true, watchMatches: true }).stop === 'userMatch') return;
  throw new Error('경기가 없다');
};

test('감독 성향: 공격형 감독을 뽑으면 팀 전술이 바로 공격적으로 바뀐다', () => {
  const state = fresh('cs1');
  hireStyle(state, 'attacking');
  const t = userClub(state).tactics;
  assert.equal(t.formation, '4-3-3');
  assert.equal(t.mentality, 'attacking');
  assert.equal(t.pressing, 'high');
});

test('감독 성향: 수비형 감독은 5-3-2 낮은 라인', () => {
  const state = fresh('cs2');
  hireStyle(state, 'defensive');
  const t = userClub(state).tactics;
  assert.equal(t.formation, '5-3-2');
  assert.equal(t.mentality, 'defensive');
  assert.equal(t.line, 'deep');
});

test('감독 성향: 실리형 감독은 더 강한 상대에게 수비적으로 나선다', () => {
  const state = fresh('cs3');
  hireStyle(state, 'pragmatic');
  toMatch(state);
  const m = startUserMatch(state);
  const s = m.sides[0].clubId === state.user.clubId ? 0 : 1;
  // 최약팀이니 상대는 더 강하다
  assert.equal(m.sides[s].tactics.mentality, 'defensive');
});

test('우리 경기도 감독이 교체와 경기 중 전술 변경을 맡는다', () => {
  const state = fresh('cs4');
  state.settings.autoSubs = false;
  toMatch(state);
  const m = startUserMatch(state);
  const s = m.sides[0].clubId === state.user.clubId ? 0 : 1;
  assert.equal(m.sides[s].auto, true);
  assert.equal(m.sides[s].aiTactics, true);
});

test('감독 코멘트: 우리 선수의 나이·잠재력·팀 내 비중과 판매 의견을 말한다', async () => {
  const { coachComment } = await import('../js/core/game.js');
  const { overall, ageOn } = await import('../js/core/player.js');
  const state = fresh('cs5');
  const club = userClub(state);
  const squad = club.squad.map((id) => state.players[id]);
  const best = squad.sort((a, b) => overall(b) - overall(a))[0];
  const c = coachComment(state, best.id, 1);
  assert.equal(c.role, '주전');
  assert.equal(c.verdict, 'keep', '주전을 헐값에 팔지 말자');
  assert.ok(c.lines.length >= 3 && c.lines.every((l) => typeof l === 'string'));
  const rich = coachComment(state, best.id, 1e12);
  assert.equal(rich.verdict, 'sell', '터무니없이 큰 금액이면 팔자');
  const young = squad.find((p) => ageOn(p, state.date) <= 21 && p.potential - overall(p) >= 8);
  if (young) assert.ok(coachComment(state, young.id, 1).lines.some((l) => l.includes('성장')));
});
