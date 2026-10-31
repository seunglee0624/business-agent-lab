// 언론: 우리 구단 기사와 팬 댓글.
// 기사는 core가 틀에 맞춰 바로 싣고, AI가 켜져 있으면 화면이 같은 사실로 쓴 글을 받아 바꿔 넣는다(applyAiArticle).
// AI는 글만 쓴다. 팬층별 댓글 수와 분위기, 쓸 수 있는 이름은 core가 정해서 넘긴다
import { FACILITIES, STAFF } from '../data/economy.js';
import { LEAGUES } from '../data/countries/index.js';
import { standings } from './state.js';
import { fansOf, fanReactions, SEGMENTS, SEGMENT_KEYS } from './fans.js';
import { ticketsOf, GRADES, GRADE_KEYS, rivalOf } from './tickets.js';
import { seasonTransfers } from './transfers.js';
import { mediaOf, CAMPAIGNS } from './media.js';
import { stadiumOf, EVENTS } from './stadium.js';
import { TOURS } from './tour.js';
import { formatShortDate } from './calendar.js';
import { withParticle } from './korean.js';
import { won } from './money.js';

export const MAX_ARTICLES = 30;
export const COMMENTS = 6; // 기사 하나에 달리는 댓글 수
const RECENT_MATCHES = 5; // 기사에 자세히 넘기는 최근 경기 수
const LONG_INJURY = 14; // 기사에 실을 부상 (일)

export function pressOf(state) {
  state.press ??= { articles: [], unread: 0, pending: null, hold: false, nextId: 1, snap: null };
  state.press.snap ??= snapshot(state);
  return state.press;
}

export const markPressRead = (state) => { pressOf(state).unread = 0; };

// 지난 기사 때의 모습: 이것과 비교해 바뀐 것을 기사에 싣는다
function snapshot(state, keys = []) {
  const club = state.clubs[state.user?.clubId];
  if (!club) return { date: state.date, keys };
  const t = ticketsOf(club);
  return {
    date: state.date,
    position: userPosition(state),
    prices: { ...t.prices, season: t.seasonPrice },
    facilities: { ...club.facilities },
    staff: { ...club.staff },
    tour: club.tour ? `${club.tour.season}-${club.tour.region}` : null,
    keys, // 지난 기사에 이미 실은 사건 (같은 날 사건이 두 번 실리지 않게)
  };
}

function userPosition(state) {
  const club = state.clubs[state.user?.clubId];
  if (!club || !state.competitions[club.leagueId]) return null;
  const played = state.competitions[club.leagueId].fixtures.some((f) => f.result);
  if (!played) return null;
  return standings(state, club.leagueId).findIndex((r) => r.clubId === club.id) + 1;
}

const name = (state, id) => state.clubs[id]?.name ?? '';

// 지난 기사 이후 우리 구단에 일어난 일
export function collectFacts(state) {
  const press = pressOf(state);
  const snap = press.snap;
  const club = state.clubs[state.user.clubId];
  const since = snap.date;
  const seen = new Set(snap.keys);
  const keys = [];
  const fresh = (key, date) => date >= since && !seen.has(key) && (keys.push(key), true);
  const names = new Set([club.name, state.user.name]);

  // 경기
  const comp = state.competitions[club.leagueId];
  const fixtures = comp.fixtures.filter((f) => f.result && (f.home === club.id || f.away === club.id) && fresh(`m${f.id}`, f.date));
  const record = { won: 0, drawn: 0, lost: 0 };
  const matches = fixtures.map((f) => {
    const home = f.home === club.id;
    const gf = home ? f.result.home : f.result.away;
    const ga = home ? f.result.away : f.result.home;
    const result = gf > ga ? '승' : gf < ga ? '패' : '무';
    record[{ 승: 'won', 무: 'drawn', 패: 'lost' }[result]]++;
    const side = home ? 0 : 1;
    const goals = {};
    for (const e of f.result.events) if (e.type === 'goal' && e.side === side) goals[e.playerId] = (goals[e.playerId] ?? 0) + 1;
    const scorers = Object.entries(goals).map(([id, n]) => ({ name: state.players[id]?.name ?? '', goals: n })).filter((s) => s.name);
    const opponent = name(state, home ? f.away : f.home);
    return { date: f.date, opponent, venue: home ? '홈' : '원정', gf, ga, result, scorers, crowd: home ? f.result.crowd : null };
  });
  for (const m of matches) { names.add(m.opponent); for (const s of m.scorers) names.add(s.name); }

  // 이적
  const events = [];
  const big = [];
  for (const t of seasonTransfers(state, state.season, { clubId: club.id }).reverse()) {
    if (!fresh(`t${t.playerId}${t.date}`, t.date)) continue;
    const p = state.players[t.playerId];
    names.add(p.name);
    const incoming = t.to === club.id;
    const other = name(state, incoming ? t.from : t.to);
    if (other) names.add(other);
    const fee = t.fee ? ` (이적료 ${won(t.fee)})` : '';
    const line = incoming
      ? `${p.name} 영입${other ? `, ${other}에서` : ' (자유 계약)'}${t.type === 'loan' ? ' 임대' : ''}${fee}`
      : `${p.name} ${t.type === 'loan' ? '임대 보냄' : '판매'}${other ? `, ${other}로` : ''}${fee}`;
    events.push(line);
    big.push(line);
  }

  // 오래 빠지는 부상
  for (const id of club.squad) {
    const p = state.players[id];
    if (p.injury && p.injury.days >= LONG_INJURY && fresh(`i${id}${p.injury.since}`, p.injury.since)) {
      names.add(p.name);
      events.push(`${p.name} 부상 (${p.injury.name}, 약 ${Math.round(p.injury.days / 7)}주)`);
    }
  }

  // 티켓값
  const t = ticketsOf(club);
  for (const g of [...GRADE_KEYS, 'season']) {
    const now = g === 'season' ? t.seasonPrice : t.prices[g];
    const before = snap.prices?.[g];
    if (before && now !== before) events.push(`${g === 'season' ? '시즌권' : `${GRADES[g].name} 티켓`} 가격 ${won(before)} → ${won(now)}`);
  }

  // 시설·스태프
  for (const [k, lv] of Object.entries(club.facilities)) {
    const before = snap.facilities?.[k];
    if (before !== undefined && lv !== before && FACILITIES[k]) events.push(`${FACILITIES[k].name} ${before}단계 → ${lv}단계`);
  }
  for (const [k, lv] of Object.entries(club.staff)) {
    const before = snap.staff?.[k];
    if (before !== undefined && lv !== before && STAFF[k]) events.push(`${STAFF[k].name} 수준 ${before} → ${lv}`);
  }

  // 홍보·행사·투어
  const m = mediaOf(club);
  for (const c of [...m.running, ...m.history]) if (fresh(`c${c.kind}${c.start}`, c.start)) events.push(`SNS 캠페인 "${CAMPAIGNS[c.kind].name}" 시작`);
  for (const e of stadiumOf(club).events.history) if (fresh(`e${e.date}`, e.date)) events.push(`홈 경기 행사 "${EVENTS[e.kind].name}" (${name(state, e.opponent)}전)`);
  const tour = club.tour ? `${club.tour.season}-${club.tour.region}` : null;
  if (tour && tour !== snap.tour && club.tour.region !== 'none') {
    const line = `프리시즌 ${TOURS[club.tour.region].name} 투어`;
    events.push(line);
    big.push(line);
  }

  // 라이벌 소식 한 줄
  let rival = null;
  const r = rivalOf(state, club);
  if (r && matches.length) {
    const f = comp.fixtures.filter((x) => x.result && x.date >= since && (x.home === r.id || x.away === r.id) && x.home !== club.id && x.away !== club.id).at(-1);
    if (f) {
      const home = f.home === r.id;
      const gf = home ? f.result.home : f.result.away;
      const ga = home ? f.result.away : f.result.home;
      rival = `라이벌 ${withParticle(r.name, '는')} ${name(state, home ? f.away : f.home)}전 ${gf}-${ga} ${gf > ga ? '승리' : gf < ga ? '패배' : '무승부'}`;
      names.add(r.name);
      names.add(name(state, home ? f.away : f.home));
    }
  }

  return {
    club: club.name,
    manager: state.user.name,
    league: LEAGUES[club.leagueId].name,
    position: userPosition(state),
    previousPosition: snap.position,
    matches,
    record,
    events,
    big,
    rival,
    names: [...names].filter(Boolean),
    keys,
  };
}

// 팬층별 댓글 수(팬층 비율대로)와 분위기(core가 계산한 기분)
export function commentPlan(club, n = COMMENTS) {
  const fans = fansOf(club);
  const moods = Object.fromEntries(fanReactions(club).map((r) => [r.key, r.mood]));
  const exact = SEGMENT_KEYS.map((k) => ({ k, x: (fans.shares[k] / 100) * n }));
  const counts = Object.fromEntries(exact.map(({ k, x }) => [k, Math.floor(x)]));
  let left = n - Object.values(counts).reduce((s, x) => s + x, 0);
  for (const { k } of exact.slice().sort((a, b) => (b.x % 1) - (a.x % 1))) {
    if (left <= 0) break;
    counts[k]++;
    left--;
  }
  return SEGMENT_KEYS.flatMap((k) => Array.from({ length: counts[k] }, () => ({ segment: k, mood: moods[k] })));
}

// 틀 기사: AI가 없어도 언론 탭이 경기 기록 역할을 한다
export function templateArticle(state, facts) {
  const { club, matches, record } = facts;
  const last = matches.at(-1);
  let headline;
  const body = [];
  if (matches.length === 1) {
    headline = `${club}, ${last.opponent}전 ${last.gf}-${last.ga} ${last.result === '승' ? '승리' : last.result === '패' ? '패배' : '무승부'}`;
  } else if (matches.length > 1) {
    headline = `${club}, ${matches.length}경기 ${record.won}승 ${record.drawn}무 ${record.lost}패`;
    body.push(`마지막 경기는 ${last.opponent}전 ${last.gf}-${last.ga} ${last.result}.`);
  } else {
    headline = `${club} 소식: ${facts.big[0] ?? facts.events[0] ?? '조용한 한 주'}`;
  }
  if (last?.scorers.length) {
    const list = last.scorers.map((s) => (s.goals > 1 ? `${s.name} ${s.goals}골` : s.name)).join(', ');
    body.push(`득점: ${list}.`);
  }
  if (facts.position) body.push(`${facts.league} ${facts.position}위${facts.previousPosition && facts.previousPosition !== facts.position ? ` (지난번 ${facts.previousPosition}위)` : ''}.`);
  if (facts.events.length) body.push(facts.events.join(' · ') + '.');
  if (facts.rival) body.push(facts.rival + '.');
  return { headline, body: body.join(' ') };
}

// 댓글 대신 쓰는 팬층별 고정 문장 (같은 팬층은 한 번만)
function templateComments(club, plan) {
  const lines = Object.fromEntries(fanReactions(club).map((r) => [r.key, r.line]));
  return [...new Set(plan.map((c) => c.segment))].map((k) => ({ segment: k, text: lines[k] }));
}

const SYSTEM = [
  '너는 축구 구단 경영 게임에 들어갈 한국어 스포츠 기사와 팬 댓글을 쓴다.',
  '주어진 사실(facts)만 쓴다. 숫자, 점수, 순위, 이름을 바꾸거나 지어내지 않는다.',
  '사람과 구단 이름은 names 목록에 있는 것만 쓴다. 단장은 manager 이름으로 부른다.',
  '기사: headline은 40자 이내, body는 3~4문장의 기사체.',
  'comments: plan 순서대로 하나씩, 각 항목의 segment를 그대로 쓰고 mood(good 좋음, neutral 보통, bad 나쁨)에 맞는 분위기로 쓴다.',
  '댓글은 한국 축구 커뮤니티 말투의 짧은 반말 한두 문장. 팬층 관심사: loyal 충성층은 성적과 구단 역사, trendy 유행층은 스타와 경기 재미, family 가족층은 티켓값과 즐길 거리, local 지역층은 유스 출신과 동네.',
  '화난 댓글도 쓰되 욕설과 비하는 쓰지 않는다.',
].join('\n');

export const PRESS_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    body: { type: 'string' },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        properties: { segment: { type: 'string', enum: SEGMENT_KEYS }, text: { type: 'string' } },
        required: ['segment', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['headline', 'body', 'comments'],
  additionalProperties: false,
};

// AI에 넘길 요청 (화면이 로컬 서버로 보낸다)
function aiRequest(facts, plan) {
  const { keys, big, ...rest } = facts;
  const brief = {
    ...rest,
    matches: facts.matches.slice(-RECENT_MATCHES).map(({ date, scorers, ...m }) => ({ ...m, date: formatShortDate(date), scorers })),
    plan: plan.map((c) => ({ segment: c.segment, segmentName: SEGMENTS[c.segment].name, mood: c.mood })),
  };
  return { system: SYSTEM, user: JSON.stringify(brief), schema: PRESS_SCHEMA };
}

// 기사를 싣는다. 실은 기사 (사실이 없으면 null)
export function publishArticle(state) {
  const press = pressOf(state);
  const club = state.clubs[state.user.clubId];
  const facts = collectFacts(state);
  if (!facts.matches.length && !facts.events.length) return null;
  const plan = commentPlan(club);
  const article = {
    id: press.nextId++,
    date: state.date,
    ...templateArticle(state, facts),
    comments: templateComments(club, plan),
    source: 'template',
  };
  press.articles.unshift(article);
  press.articles.length = Math.min(press.articles.length, MAX_ARTICLES);
  press.unread++;
  press.pending = { id: article.id, names: facts.names, request: aiRequest(facts, plan) };
  press.snap = snapshot(state, facts.keys);
  return article;
}

// 우리 경기가 끝났을 때 ("시즌 끝까지"로 몰아서 진행하는 동안은 끝난 뒤 한 번만)
export function pressAfterMatch(state) {
  if (!pressOf(state).hold) publishArticle(state);
}

// 경기 없이 한 주가 지났을 때: 이적·투어처럼 큰일이 있었으면 월요일 기사
export function pressWeekly(state) {
  if (pressOf(state).hold) return;
  const facts = collectFacts(state);
  if (!facts.matches.length && facts.big.length) publishArticle(state);
}

// 몰아서 진행하기: fn이 끝나면 쌓인 일을 기사 한 편으로
export function pressBatch(state, fn) {
  const press = pressOf(state);
  press.hold = true;
  try {
    return fn();
  } finally {
    press.hold = false;
    if (state.user?.clubId) publishArticle(state);
  }
}

// 화면이 AI에 보낼 요청을 꺼낸다 (한 번만 보낸다: 실패해도 다시 보내지 않음)
export function takePressRequest(state) {
  const press = pressOf(state);
  const job = press.pending;
  press.pending = null;
  return job;
}

const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= max;

// AI가 쓴 글로 틀 기사를 바꾼다. 형식이 틀리면 틀 기사를 그대로 둔다.
// 넘겨준 이름 목록에 없는 이 세계의 선수·구단 이름이 들어간 댓글은 버린다. 돌려주는 값: 바꿨는지
export function applyAiArticle(state, job, data) {
  const article = pressOf(state).articles.find((a) => a.id === job?.id);
  if (!article || !data || !text(data.headline, 80) || !text(data.body, 600) || !Array.isArray(data.comments)) return false;
  const allowed = new Set(job.names);
  const outsiders = [...Object.values(state.players).map((p) => p.name), ...Object.values(state.clubs).map((c) => c.name)]
    .filter((n) => n && n.length >= 3 && !allowed.has(n));
  const foreign = (s) => outsiders.some((n) => s.includes(n));
  if (foreign(data.headline) || foreign(data.body)) return false;
  const comments = data.comments
    .filter((c) => SEGMENT_KEYS.includes(c?.segment) && text(c.text, 200) && !foreign(c.text))
    .slice(0, COMMENTS + 2)
    .map((c) => ({ segment: c.segment, text: c.text.trim() }));
  if (!comments.length) return false;
  Object.assign(article, { headline: data.headline.trim(), body: data.body.trim(), comments, source: 'ai' });
  return true;
}
