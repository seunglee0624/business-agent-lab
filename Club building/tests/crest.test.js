import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';
import { crestSvg, crestStyle, crestInitials, CREST_STYLES } from '../js/ui/crest.js';
import { badge } from '../js/ui/format.js';

const clubs = () => Object.values(g.createNewGame('crest').clubs);

test('같은 구단은 늘 같은 종류의 로고, 세 종류가 대략 50·33·17% 비율로 나온다', () => {
  const all = clubs();
  const count = Object.fromEntries(CREST_STYLES.map((s) => [s, 0]));
  for (const c of all) {
    assert.equal(crestStyle(c), crestStyle({ ...c }));
    count[crestStyle(c)]++;
  }
  const share = (s) => count[s] / all.length;
  assert.ok(share('shield') > 0.38 && share('shield') < 0.62, JSON.stringify(count));
  assert.ok(share('roundel') > 0.22 && share('roundel') < 0.44, JSON.stringify(count));
  assert.ok(share('abstract') > 0.08 && share('abstract') < 0.27, JSON.stringify(count));
});

test('모든 구단 로고가 크기마다 깨진 값 없이 그려지고, 작은 로고에는 글자가 없다', () => {
  for (const c of clubs()) {
    for (const px of [18, 40, 96]) {
      const svg = crestSvg(c, px);
      assert.match(svg, /^<svg viewBox="0 0 100 1[02]0" aria-hidden="true">/);
      assert.doesNotMatch(svg, /undefined|NaN|null/, `${c.name} ${px}px`);
      if (px === 18) assert.doesNotMatch(svg, /<text/, `${c.name} 18px`);
    }
  }
});

test('이니셜은 도시 첫 글자 + 한글 단어 첫 글자, 한글 단어가 없으면 도시 두 글자', () => {
  assert.equal(crestInitials({ name: '리버풀 유나이티드', city: '리버풀' }), '리유');
  assert.equal(crestInitials({ name: 'FC 바르셀로나', city: '바르셀로나' }), '바르');
  assert.equal(crestInitials({ name: '뮌헨 04', city: '뮌헨' }), '뮌헨');
});

test('badge()는 표 18px·사이드바 40px 로고를 감싼다', () => {
  const c = clubs()[0];
  assert.match(badge(c), /^<span class="badge "><svg /);
  assert.match(badge(c, 'big'), /^<span class="badge big"><svg /);
});
