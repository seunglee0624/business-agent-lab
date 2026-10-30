// tools/invariants.js 상태 규칙 검사에서 찾은 버그의 회귀 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { setBudgets, emptyLedger } from '../js/core/finance.js';

test('시즌 시작 이적 예산: 반올림 때문에 잔고를 넘지 않는다', () => {
  const state = g.createNewGame('inv-round');
  g.chooseLeague(state, 'ENG1', '테스트');
  const club = g.userClub(state);
  const f = club.finance;
  f.history.unshift({ season: 2025, ...emptyLedger(), balance: 0 });
  f.balance = 330538800000; // 잔고는 반올림 단위(100만 원)에 맞지 않는다
  f.transferBudget = f.balance; // 남은 예산이 잔고만큼이면 min(잔고, …) 뒤 반올림이 잔고를 넘었다
  setBudgets(state, club);
  assert.ok(f.transferBudget <= f.balance, `${f.transferBudget} > ${f.balance}`);
});

test('재정 조정: 반올림 때문에 이적 예산이 잔고 + 당겨 쓴 한도를 넘지 않는다', () => {
  const state = g.createNewGame('inv-round2');
  g.chooseLeague(state, 'ENG1', '테스트');
  const f = g.userClub(state).finance;
  f.balance = f.transferBudget + 4.9e5; // 잔고가 이적 예산보다 반올림 단위 절반만큼만 많다
  const r = g.budgetRange(state);
  g.adjustBudgets(state, r.min);
  assert.ok(f.transferBudget <= f.balance + f.wageCredit, `${f.transferBudget} > ${f.balance} + ${f.wageCredit}`);
  // 오른쪽 끝(남는 잔고까지 주급으로)에서는 이적 예산 0, 당겨 쓴 몫 없음
  g.adjustBudgets(state, g.budgetRange(state).max);
  assert.equal(f.transferBudget, 0);
  assert.equal(f.wageCredit, 0);
});

test('시즌 끝에 지워진 선수(오래된 자유계약)는 협상 목록에서도 빠진다', () => {
  const state = g.createNewGame('inv-deals');
  g.chooseLeague(state, 'ENG1', '테스트');
  const p = Object.values(state.players).find((x) => x.clubId && x.clubId !== state.user.clubId);
  const club = state.clubs[p.clubId];
  club.squad = club.squad.filter((id) => id !== p.id);
  // 34세라 어느 구단도 데려가지 않는다
  Object.assign(p, { clubId: null, contract: null, freeSince: '2020-06-30', birthDate: '1992-01-01' });
  state.transfers.deals[p.id] = { stage: 'terms', tries: 0, fee: 0, until: '9999-12-31' };
  g.simulateToSeasonEnd(state);
  g.startNextSeason(state);
  assert.equal(state.players[p.id], undefined, '1년 넘은 자유계약 선수는 지워진다');
  assert.equal(state.transfers.deals[p.id], undefined);
});
