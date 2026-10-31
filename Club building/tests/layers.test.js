import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 게임 로직(core, data)은 화면을 모른다: DOM·브라우저 저장소·네트워크를 쓰지 않고, 화면·저장·API 모듈을 불러오지 않는다
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
});

const FORBIDDEN = [/\bdocument\./, /\bwindow\./, /\blocalStorage\b/, /\.innerHTML\b/, /addEventListener\(/, /from ['"][./]*ui\//, /from ['"][./]*save\//, /from ['"][./]*api\//, /\bfetch\(/];

test('core와 data에는 화면 코드가 없다', () => {
  const bad = [];
  for (const f of [...files('js/core'), ...files('js/data')]) {
    const src = readFileSync(f, 'utf8');
    for (const re of FORBIDDEN) if (re.test(src)) bad.push(`${f}: ${re}`);
  }
  assert.deepEqual(bad, []);
});
