import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/core/game.js';

function fresh(seed = 'press') {
  const state = g.createNewGame(seed);
  g.chooseLeague(state, 'ENG1', '테스트');
  return state;
}

// 우리 팀 경기를 하나 치를 때까지 진행한다
function playUserMatch(state) {
  for (let i = 0; i < 20; i++) {
    const before = g.pressOf(state).articles.length;
    g.advance(state, { skipOffers: true });
    if (g.pressOf(state).articles.length > before) return;
  }
  throw new Error('우리 경기가 없었습니다');
}

test('우리 팀 경기가 끝나면 상대와 점수가 담긴 기사가 실리고, 읽지 않은 기사로 센다', () => {
  const state = fresh();
  assert.equal(g.pressOf(state).articles.length, 0);
  playUserMatch(state);
  const press = g.pressOf(state);
  const [a] = press.articles;
  const club = g.userClub(state);
  const fixture = state.competitions[club.leagueId].fixtures.find((f) => f.result && (f.home === club.id || f.away === club.id));
  const opponent = state.clubs[fixture.home === club.id ? fixture.away : fixture.home];
  assert.ok(a.headline.includes(opponent.name));
  assert.ok(a.headline.includes(`${fixture.result.home}-${fixture.result.away}`) || a.headline.includes(`${fixture.result.away}-${fixture.result.home}`));
  assert.equal(a.source, 'template');
  assert.ok(a.comments.length >= 1);
  assert.equal(press.unread, 1);
  g.markPressRead(state);
  assert.equal(press.unread, 0);
});

test('댓글 계획: 팬층 비율대로 6개를 나누고, 분위기는 그 팬층의 기분을 따른다', () => {
  const state = fresh();
  const club = g.userClub(state);
  const fans = g.fansOf(club);
  fans.shares = { loyal: 50, trendy: 17, family: 17, local: 16 };
  fans.mood.family = -10; // 가족층은 화남
  const plan = g.commentPlan(club);
  assert.equal(plan.length, 6);
  assert.equal(plan.filter((c) => c.segment === 'loyal').length, 3);
  assert.ok(plan.filter((c) => c.segment === 'family').every((c) => c.mood === 'bad'));
});

test('시즌 끝까지 몰아서 진행하면 기사는 끝난 뒤 한 편만 실린다', () => {
  const state = fresh('press-batch');
  g.simulateToSeasonEnd(state);
  const press = g.pressOf(state);
  assert.equal(press.articles.length, 1);
  assert.match(press.articles[0].headline, /\d+경기 \d+승 \d+무 \d+패/);
  assert.equal(press.hold, false);
});

test('경기 없이 지난 주에 이적이 있으면 월요일에 기사가 실리고, 아무 일 없는 주에는 없다', () => {
  const state = fresh('press-week');
  const club = g.userClub(state);
  // 첫 경기 전 여름: 조용한 한 주
  g.advance(state, { skipOffers: true });
  assert.equal(g.pressOf(state).articles.length, 0);
  // 자유 계약 선수를 데려온 것으로 기록
  const p = Object.values(state.players).find((x) => !x.clubId && !x.retired);
  (p.transfers ??= []).push({ date: state.date, from: null, to: club.id, fee: 0 });
  g.advance(state, { skipOffers: true });
  const [a] = g.pressOf(state).articles;
  assert.ok(a, '기사가 있어야 합니다');
  assert.ok(a.body.includes(p.name) || a.headline.includes(p.name));
});

test('AI 응답: 맞는 형식이면 기사를 바꾸고, 형식이 틀리거나 다른 세계 이름이 들어가면 버린다', () => {
  const state = fresh('press-ai');
  playUserMatch(state);
  const job = g.takePressRequest(state);
  assert.ok(job.request.system && job.request.user && job.request.schema);
  assert.equal(g.takePressRequest(state), null, '요청은 한 번만 꺼낸다');
  const facts = JSON.parse(job.request.user);
  assert.equal(facts.plan.length, 6);
  const club = g.userClub(state);
  const [article] = g.pressOf(state).articles;
  const before = article.headline;
  assert.equal(g.applyAiArticle(state, job, { headline: '' , body: 'x', comments: [] }), false);
  assert.equal(article.headline, before);
  const stranger = Object.values(state.players).find((p) => p.clubId && p.clubId !== club.id && !job.names.includes(p.name));
  const ok = g.applyAiArticle(state, job, {
    headline: `${club.name} 기사`,
    body: '본문입니다.',
    comments: [{ segment: 'loyal', text: '좋다 좋아' }, { segment: 'family', text: `${stranger.name} 데려와라` }, { segment: 'nope', text: '틀린 팬층' }],
  });
  assert.equal(ok, true);
  assert.equal(article.source, 'ai');
  assert.equal(article.headline, `${club.name} 기사`);
  assert.deepEqual(article.comments, [{ segment: 'loyal', text: '좋다 좋아' }]);
});

test('기사는 최근 30편까지만 남는다 (한 시즌을 주마다 진행하면 경기 기사가 30편을 넘는다)', () => {
  const state = fresh('press-cap');
  let published = 0;
  while (state.phase === 'season') {
    const before = g.pressOf(state).nextId;
    g.advance(state, { skipOffers: true });
    published += g.pressOf(state).nextId - before;
  }
  assert.ok(published > 30, `실린 기사 ${published}편`);
  assert.equal(g.pressOf(state).articles.length, 30);
});

test('화면: 메뉴의 언론 탭에 읽지 않은 기사 수가 붙고, 언론 탭에 기사·댓글과 SNS 캠페인이 있다', async () => {
  const { layout, pressView, fansView, settingsView } = await import('../js/ui/views.js');
  const state = fresh('press-view');
  playUserMatch(state);
  const nav = layout(state, { view: 'home' }, '');
  assert.match(nav, /data-view="press" >언론 <span class="count">1<\/span>/);
  const [a] = g.pressOf(state).articles;
  const html = pressView(state, {});
  assert.ok(html.includes(a.headline));
  assert.ok(html.includes(a.comments[0].text));
  assert.match(html, /SNS·미디어/);
  const fans = fansView(state, {});
  assert.doesNotMatch(fans, /SNS·미디어/);
  assert.ok(!a.comments.some((c) => fans.includes(c.text)), '팬 탭에는 팬층 반응 문장이 없다');
  assert.match(settingsView(state, {}), /data-change="togglePressAi"[^>]*checked/);
});

test('예전 저장 파일: 언론 기록이 없으면 빈 피드로 시작하고 AI 설정은 켜짐', () => {
  const state = fresh('press-old');
  delete state.press;
  delete state.settings.pressAi;
  g.upgradeState(state);
  assert.deepEqual(g.pressOf(state).articles, []);
  assert.equal(state.settings.pressAi, true);
});
