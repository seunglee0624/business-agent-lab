// 날짜 계산과 시즌 달력. 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다.

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);

export function addDays(iso, days) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

// 몇 달 뒤 1일 (공사 완료일 등)
export function addMonths(iso, months) {
  const [y, m] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

// 날짜가 속한 시즌 (7월에 시작)
export function seasonOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  return m >= 7 ? y : y - 1;
}

export function daysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

// 0 = 일요일 ... 6 = 토요일
export function dayOfWeek(iso) {
  return toDate(iso).getUTCDay();
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일 (${WEEKDAYS[dayOfWeek(iso)]})`;
}

export function formatShortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d} (${WEEKDAYS[dayOfWeek(iso)]})`;
}

const pad = (n) => String(n).padStart(2, '0');

// iso 날짜 이후(포함) 처음 오는 해당 요일
export function nextWeekday(iso, weekday) {
  const diff = (weekday - dayOfWeek(iso) + 7) % 7;
  return addDays(iso, diff);
}

function nthWeekdayOfMonth(year, month, weekday, n) {
  return addDays(nextWeekday(`${year}-${pad(month)}-01`, weekday), 7 * (n - 1));
}

function lastWeekdayOfMonth(year, month, weekday) {
  const lastDay = addDays(month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`, -1);
  const diff = (dayOfWeek(lastDay) - weekday + 7) % 7;
  return addDays(lastDay, -diff);
}

export function seasonStart(startYear) {
  return `${startYear}-07-01`;
}

// A매치 기간의 토요일 (리그 경기를 쉰다)
export function internationalBreakSaturdays(startYear) {
  return [
    nthWeekdayOfMonth(startYear, 9, 6, 1),
    nthWeekdayOfMonth(startYear, 10, 6, 2),
    nthWeekdayOfMonth(startYear, 11, 6, 2),
    lastWeekdayOfMonth(startYear + 1, 3, 6),
  ];
}

// 고르게 흩어진 k개를 고른다 (처음과 끝 포함)
function spread(list, k) {
  if (k >= list.length) return list.slice();
  if (k <= 1) return list.slice(0, k);
  const out = [];
  for (let i = 0; i < k; i++) out.push(list[Math.round((i * (list.length - 1)) / (k - 1))]);
  return out;
}

// 리그 경기일 count개. 토요일 위주로 배치하고, 모자라면 A매치 주간이 아닌 화요일을 고르게 더한다.
// 토요일이 남으면 고르게 비운다 (18팀 리그 등)
export function leagueMatchDates(startYear, count) {
  const first = nextWeekday(`${startYear}-08-15`, 6);
  const last = nextWeekday(`${startYear + 1}-05-17`, 6);
  const breaks = internationalBreakSaturdays(startYear);
  const breakSet = new Set(breaks);

  const saturdays = [];
  for (let d = first; d <= last; d = addDays(d, 7)) {
    if (!breakSet.has(d)) saturdays.push(d);
  }
  if (count <= saturdays.length) return spread(saturdays, count);

  const tuesdays = [];
  for (let d = nextWeekday(addDays(first, 1), 2); d < last; d = addDays(d, 7)) {
    if (!breaks.some((b) => Math.abs(daysBetween(b, d)) <= 4)) tuesdays.push(d);
  }
  return [...saturdays, ...spread(tuesdays, count - saturdays.length)].sort();
}
