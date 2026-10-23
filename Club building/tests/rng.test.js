import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../js/core/rng.js';

test('같은 시드는 같은 수열을 만든다', () => {
  const a = Rng.fromSeed('club');
  const b = Rng.fromSeed('club');
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('다른 시드는 다른 수열을 만든다', () => {
  const a = Rng.fromSeed('club');
  const b = Rng.fromSeed('building');
  assert.notEqual(a.next(), b.next());
});

test('저장한 상태에서 이어서 같은 수열이 나온다', () => {
  const a = Rng.fromSeed(42);
  a.next();
  const saved = a.state;
  const expected = [a.next(), a.next()];
  const b = new Rng(saved);
  assert.deepEqual([b.next(), b.next()], expected);
});

test('int는 범위 안의 모든 값을 낸다', () => {
  const rng = Rng.fromSeed(1);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const v = rng.int(1, 6);
    assert.ok(v >= 1 && v <= 6);
    seen.add(v);
  }
  assert.equal(seen.size, 6);
});

test('weighted는 가중치 비율을 따른다', () => {
  const rng = Rng.fromSeed(7);
  let heavy = 0;
  for (let i = 0; i < 10000; i++) {
    if (rng.weighted(['a', 'b'], (x) => (x === 'a' ? 3 : 1)) === 'a') heavy++;
  }
  assert.ok(heavy > 7200 && heavy < 7800, `a 비율 ${heavy / 10000}`);
});

test('shuffle은 원소를 보존한다', () => {
  const rng = Rng.fromSeed(3);
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(rng.shuffle(arr).sort(), arr);
});

test('normal은 평균과 표준편차를 따른다', () => {
  const rng = Rng.fromSeed(9);
  const xs = Array.from({ length: 20000 }, () => rng.normal(10, 2));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
  assert.ok(Math.abs(mean - 10) < 0.1);
  assert.ok(Math.abs(sd - 2) < 0.1);
});
