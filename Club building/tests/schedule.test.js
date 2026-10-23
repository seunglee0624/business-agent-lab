import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../js/core/rng.js';
import { leagueMatchDates, internationalBreakSaturdays, dayOfWeek, addDays, daysBetween } from '../js/core/calendar.js';
import { generateLeagueFixtures } from '../js/core/schedule.js';

const clubIds = Array.from({ length: 20 }, (_, i) => `c${i + 1}`);

test('날짜 계산', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(daysBetween('2026-07-01', '2026-08-15'), 45);
  assert.equal(dayOfWeek('2026-08-15'), 6);
});

test('리그 경기일 38개: 8월~5월, A매치 토요일 제외, 겹치지 않음', () => {
  for (const year of [2026, 2027, 2028, 2031]) {
    const dates = leagueMatchDates(year, 38);
    assert.equal(dates.length, 38);
    assert.equal(new Set(dates).size, 38);
    assert.ok(dates[0] >= `${year}-08-15`);
    assert.ok(dates[37] <= `${year + 1}-05-31`);
    const breaks = new Set(internationalBreakSaturdays(year));
    for (const d of dates) assert.ok(!breaks.has(d), d);
    for (let i = 1; i < dates.length; i++) assert.ok(daysBetween(dates[i - 1], dates[i]) >= 3, `${dates[i - 1]} ${dates[i]}`);
  }
});

test('대진: 팀당 38경기, 홈 19경기, 모든 팀과 홈·원정 한 번씩', () => {
  const dates = leagueMatchDates(2026, 38);
  const fixtures = generateLeagueFixtures(Rng.fromSeed('s'), 'ENG1', clubIds, dates);
  assert.equal(fixtures.length, 380);
  for (const id of clubIds) {
    const mine = fixtures.filter((f) => f.home === id || f.away === id);
    assert.equal(mine.length, 38);
    assert.equal(mine.filter((f) => f.home === id).length, 19);
    for (const other of clubIds) {
      if (other === id) continue;
      assert.equal(fixtures.filter((f) => f.home === id && f.away === other).length, 1);
    }
  }
});

test('대진: 한 라운드에 한 팀은 한 경기, 같은 라운드는 같은 날', () => {
  const dates = leagueMatchDates(2026, 38);
  const fixtures = generateLeagueFixtures(Rng.fromSeed('s'), 'ENG1', clubIds, dates);
  for (let r = 1; r <= 38; r++) {
    const round = fixtures.filter((f) => f.round === r);
    assert.equal(round.length, 10);
    const teams = round.flatMap((f) => [f.home, f.away]);
    assert.equal(new Set(teams).size, 20);
    assert.equal(new Set(round.map((f) => f.date)).size, 1);
  }
});

test('대진: 홈 또는 원정 연속은 최대 3경기', () => {
  const dates = leagueMatchDates(2026, 38);
  const fixtures = generateLeagueFixtures(Rng.fromSeed('s'), 'ENG1', clubIds, dates);
  for (const id of clubIds) {
    const seq = fixtures.filter((f) => f.home === id || f.away === id).sort((a, b) => a.round - b.round).map((f) => f.home === id);
    let run = 1;
    for (let i = 1; i < seq.length; i++) {
      run = seq[i] === seq[i - 1] ? run + 1 : 1;
      assert.ok(run <= 3, `${id} 연속 ${run}`);
    }
  }
});
