import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHighlight, pauseReason } from '../js/core/match/viewing.js';

const ALL_ON = { halftime: true, conceded: true, ourRed: true, losingAt60: true, drawingAt75: true, theirRed: true, lowEnergy: true };
const match = (phase, minute, my, their, energy = 90) => ({
  phase, minute,
  sides: [
    { score: my, onPitch: [{ sentOff: false, energy }] },
    { score: their, onPitch: [{ sentOff: false, energy: 90 }] },
  ],
});

test('하이라이트: 골·카드·결정적 기회는 보이고, 일반 슈팅과 공격 차단은 안 보인다', () => {
  assert.ok(isHighlight({ type: 'goal' }));
  assert.ok(isHighlight({ type: 'yellow' }));
  assert.ok(isHighlight({ type: 'save', kind: 'big' }));
  assert.ok(!isHighlight({ type: 'save', kind: 'normal' }));
  assert.ok(!isHighlight({ type: 'miss', kind: 'long' }));
  assert.ok(!isHighlight({ type: 'attack' }));
});

test('실점·퇴장·하프타임에 멈춘다', () => {
  const m = match('first', 20, 0, 1);
  assert.equal(pauseReason(m, 0, [{ type: 'goal', side: 1 }], ALL_ON, {}), '실점했습니다');
  assert.equal(pauseReason(m, 0, [{ type: 'goal', side: 0 }], ALL_ON, {}), null);
  assert.equal(pauseReason(m, 0, [{ type: 'red', side: 0 }], ALL_ON, {}), '우리 팀 선수가 퇴장당했습니다');
  assert.equal(pauseReason(m, 0, [{ type: 'halftime' }], ALL_ON, {}), '하프타임');
});

test('꺼둔 조건에서는 멈추지 않는다', () => {
  const off = { ...ALL_ON, conceded: false };
  assert.equal(pauseReason(match('first', 20, 0, 1), 0, [{ type: 'goal', side: 1 }], off, {}), null);
});

test('60분에 지고 있으면 한 번만 멈춘다', () => {
  const flags = {};
  const pauses = { ...ALL_ON, lowEnergy: false };
  assert.equal(pauseReason(match('second', 59, 0, 1), 0, [], pauses, flags), null);
  assert.equal(pauseReason(match('second', 60, 0, 1), 0, [], pauses, flags), '60분, 지고 있습니다');
  assert.equal(pauseReason(match('second', 61, 0, 1), 0, [], pauses, flags), null);
});

test('원정팀(사이드 1)으로 봐도 같은 규칙', () => {
  assert.equal(pauseReason(match('first', 10, 0, 0), 1, [{ type: 'goal', side: 0 }], ALL_ON, {}), '실점했습니다');
});

test('체력 저하는 한 번만 알린다', () => {
  const flags = {};
  const pauses = { ...ALL_ON, losingAt60: false, drawingAt75: false };
  assert.equal(pauseReason(match('second', 70, 1, 0, 50), 0, [], pauses, flags), '체력이 크게 떨어진 선수가 있습니다');
  assert.equal(pauseReason(match('second', 71, 1, 0, 49), 0, [], pauses, flags), null);
});
