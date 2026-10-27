// 화면별 HTML. 모든 함수는 (state, ui) → 문자열이고, 상태를 바꾸지 않는다.
// 버튼은 data-action, 입력은 data-change 속성으로 app.js의 처리 함수와 연결된다.

import { FORMATIONS, FORMATION_KEYS } from '../data/formations.js';
import { ROLES, rolesForPosition } from '../data/roles.js';
import { ATTRIBUTES, POSITIONS } from '../data/positions.js';
import { MENTALITIES, PRESSING, TEMPO, LINE, resolveLineup } from '../core/tactics.js';
import { NATIONS } from '../data/nations.js';
import { unavailableSet } from '../core/state.js';
import { LEAGUES, COUNTRIES } from '../data/countries/index.js';
import { isHomegrownYouth } from '../core/development.js';
import { overall, ratingAt } from '../core/player.js';
import { formatDate, formatShortDate } from '../core/calendar.js';
import { standings, topScorers, league, userClub, userLeagueId, nextUserFixture, seasonStats, isUnavailable, findFixture, jobOffers, registeredCount, canCallUp, MAX_SQUAD } from '../core/game.js';
import { FACILITIES, FACILITY_KEYS, STAFF, STAFF_KEYS, MAX_STAFF, PROMISES, staffWage, EUR } from '../data/economy.js';
import { upgradeInfo, capacity } from '../core/facilities.js';
import { weeklyWageBill, playerWageBill, ledgerTotal, monthlyUpkeep, attendanceRate } from '../core/finance.js';
import { marketValue, roundMoney } from '../core/money.js';
import { canRenew, renewalDemand } from '../core/contracts.js';
import { moraleLabel } from '../core/morale.js';
import { pitchHtml, shortName } from './pitch.js';
import { esc, badge, clubLabel, TIER_NAME, ovrCell, posLabel, age, conditionBar, formBadges, avgRating, attrClass, won } from './format.js';

const options = (map, current) =>
  Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === current ? 'selected' : ''}>${esc(v)}</option>`).join('');

// ---- 새 게임 ----

// 구단 고르기 표 (새 게임, 계약 종료 후 새 구단)
function clubPickTable(world, clubs, action, buttonText) {
  return `<table class="table clickable">
    <thead><tr><th>구단</th><th>전력</th><th>주전 평균</th><th>최고 선수</th><th>포메이션</th><th></th></tr></thead>
    <tbody>
      ${clubs.map((c) => {
        const best = c.squad.map((id) => world.players[id]).sort((a, b) => overall(b) - overall(a));
        const xi = best.slice(0, 11).reduce((sum, p) => sum + overall(p), 0) / 11;
        return `<tr>
          <td>${clubLabel(c)}</td>
          <td><span class="tier tier-${c.tier}">${TIER_NAME[c.tier]}</span></td>
          <td>${xi.toFixed(1)}</td>
          <td>${esc(best[0].name)} (${best[0].position} ${overall(best[0])})</td>
          <td>${c.tactics.formation}</td>
          <td><button class="btn primary small" data-action="${action}" data-id="${c.id}">${buttonText}</button></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

// 나라 → 리그 탭
function leagueTabs(selectedLeague, action) {
  const country = LEAGUES[selectedLeague].country;
  return `
    <div class="tabs">${Object.values(COUNTRIES).map((c) => `<button class="tab ${c.code === country ? 'active' : ''}" data-action="${action}" data-league="${c.code}1">${esc(c.name)}</button>`).join('')}</div>
    <div class="tabs sub">${COUNTRIES[country].leagues.map((l) => `<button class="tab ${l.id === selectedLeague ? 'active' : ''}" data-action="${action}" data-league="${l.id}">${l.tier}부 ${esc(l.name)}</button>`).join('')}</div>`;
}

export function newGameView(state, ui) {
  const preview = ui.preview;
  let clubList = '';
  if (preview) {
    const leagueId = ui.previewLeague ?? 'ENG1';
    const clubs = Object.values(preview.clubs).filter((c) => c.leagueId === leagueId).sort((a, b) => b.level - a.level);
    clubList = `
      <h2>구단 선택</h2>
      <p class="muted">5개 나라 1~3부, ${Object.keys(preview.clubs).length}개 구단 중 맡을 구단을 고르세요. 시드: <code>${esc(preview.seed)}</code></p>
      ${leagueTabs(leagueId, 'previewLeague')}
      ${clubPickTable(preview, clubs, 'pickClub', '이 구단 맡기')}`;
  }
  return `
    <div class="newgame">
      <h1>축구구단 키우기</h1>
      <p class="muted">가상의 유럽 5개 리그에서 구단을 맡아 여러 시즌을 치릅니다. 3부 약팀에서 1부 정상까지 올라가 보세요.</p>
      <div class="card form-row">
        <label>감독 이름 <input id="managerName" value="${esc(ui.managerName ?? '')}" placeholder="이름을 입력하세요" maxlength="20"></label>
        <label>세계 시드 (선택) <input id="seed" value="${esc(ui.seedInput ?? '')}" placeholder="비우면 무작위" maxlength="30"></label>
        <button class="btn primary" data-action="generateWorld">세계 생성</button>
        <label class="btn file">세이브 파일 불러오기<input type="file" accept=".json" data-change="importSave" hidden></label>
      </div>
      ${ui.error ? `<p class="error">${esc(ui.error)}</p>` : ''}
      ${clubList}
    </div>`;
}

// 실업 상태: 받은 제의 중에서 고르거나, 제의를 더 기다린다
export function unemployedView(state, ui) {
  const m = state.manager;
  const offers = jobOffers(state).sort((a, b) => LEAGUES[a.leagueId].tier - LEAGUES[b.leagueId].tier || b.level - a.level);
  const last = m.history.at(-1);
  const many = offers.length > 30;
  const leagueId = many ? (ui.jobLeague && offers.some((c) => c.leagueId === ui.jobLeague) ? ui.jobLeague : offers[0].leagueId) : null;
  const shown = many ? offers.filter((c) => c.leagueId === leagueId) : offers;
  const leagues = [...new Set(offers.map((c) => c.leagueId))];
  return `
    <div class="newgame">
      <h1>${esc(m.name)} 감독 · 실업 중</h1>
      <p>${last ? `${esc(last.clubName)}에서 ${last.fired ? '경질되었습니다' : '계약이 끝났습니다'}. ` : ''}${formatDate(state.date)} · 감독 평판 ${m.reputation}</p>
      ${offers.length ? `
        <h2>받은 제의 (${offers.length})</h2>
        ${many ? `<div class="tabs">${leagues.map((id) => `<button class="tab ${id === leagueId ? 'active' : ''}" data-action="jobLeague" data-league="${id}">${esc(COUNTRIES[LEAGUES[id].country].name)} ${esc(LEAGUES[id].name)}</button>`).join('')}</div>` : ''}
        ${jobTable(state, shown)}`
        : '<p class="muted">아직 받은 제의가 없습니다. 시간을 보내며 제의를 기다리세요. 성적이 나쁜 구단이 감독을 바꾸면 평판이 맞는 구단에서 연락이 옵니다.</p>'}
      <p><button class="btn primary" data-action="continue" ${ui.busy ? 'disabled' : ''}>제의 기다리기 ▶</button> <span class="muted small">${ui.busy ? '진행 중...' : '새 제의가 올 때까지 시간이 흐릅니다.'}</span></p>
      <div class="card"><h3>메시지</h3>${inboxList(state)}</div>
    </div>`;
}

function jobTable(state, clubs) {
  const rows = clubs.map((c) => {
    const table = standings(state, c.leagueId);
    const pos = table.findIndex((r) => r.clubId === c.id) + 1;
    const offer = state.offers.find((o) => o.clubId === c.id);
    return `<tr>
      <td>${clubLabel(c)}</td><td>${esc(LEAGUES[c.leagueId].name)}</td><td>${table[0].played ? `${pos}위` : '-'}</td>
      <td><span class="tier tier-${c.tier}">${TIER_NAME[c.tier]}</span></td><td>${esc(c.goal.text)}</td><td>${won(c.finance.balance)}</td>
      <td class="muted small">${formatShortDate(offer.until)}까지</td>
      <td><button class="btn primary small" data-action="takeJob" data-id="${c.id}">수락</button></td>
    </tr>`;
  }).join('');
  return `<table class="table"><thead><tr><th>구단</th><th>리그</th><th>순위</th><th>전력</th><th>수뇌부 목표</th><th>잔고</th><th>답변 기한</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---- 공통 틀 ----

const NAV = [
  ['home', '홈'],
  ['squad', '선수단'],
  ['tactics', '전술'],
  ['youth', '유스'],
  ['schedule', '일정'],
  ['table', '순위표'],
  ['club', '구단'],
  ['finance', '재정'],
  ['transfers', '이적'],
  ['history', '기록'],
  ['settings', '설정'],
];

export function layout(state, ui, content) {
  const club = userClub(state);
  const unread = state.inbox.filter((m) => !m.read).length;
  const inMatch = ui.view === 'match';
  const ended = state.phase === 'seasonEnd';
  return `
    <aside class="side">
      <div class="side-club">${badge(club, 'big')}<div><strong>${esc(club.name)}</strong><div class="muted small">${esc(LEAGUES[club.leagueId].name)}</div><div class="muted small">${esc(state.manager.name)} 감독</div></div></div>
      <nav>
        ${NAV.map(([key, name]) => `<button class="nav ${ui.view === key ? 'active' : ''}" data-action="nav" data-view="${key}" ${inMatch ? 'disabled' : ''}>${name}${key === 'home' && unread ? ` <span class="count">${unread}</span>` : ''}</button>`).join('')}
      </nav>
    </aside>
    <div class="main">
      <header class="top">
        <div class="board">
          <div class="date">${formatDate(state.date)}</div>
          ${boardNext(state, club)}
        </div>
        <div class="top-actions">
          ${ui.busy ? '<span class="muted">진행 중...</span>' : ''}
          ${!inMatch && !ended ? `
            <button class="btn" data-action="toSeasonEnd" ${ui.busy ? 'disabled' : ''} title="내 경기도 결과만으로 처리하며 시즌 끝까지 진행합니다">시즌 끝까지</button>
            <button class="btn primary" data-action="continue" ${ui.busy ? 'disabled' : ''}>${state.liveMatch ? '경기 재개' : '계속'} ▶</button>` : ''}
          ${ended && !inMatch ? '<span class="muted">시즌이 끝났습니다</span>' : ''}
        </div>
      </header>
      <section class="content" id="content">${content}</section>
    </div>`;
}

// 위쪽 전광판 띠에 다음 경기를 짧게 보여 준다
function boardNext(state, club) {
  const next = nextUserFixture(state);
  if (!next) return '';
  const home = next.home === club.id;
  const opp = state.clubs[home ? next.away : next.home];
  return `<div class="board-next"><span class="board-label">다음 경기 ${formatShortDate(next.date)}</span> ${home ? '홈' : '원정'} vs ${clubLabel(opp)}</div>`;
}

// ---- 홈 ----

export function homeView(state) {
  const club = userClub(state);
  const next = nextUserFixture(state);
  const table = standings(state);
  const myPos = table.findIndex((r) => r.clubId === club.id);
  const myRow = table[myPos];

  let nextCard = '<p class="muted">남은 경기가 없습니다.</p>';
  if (next) {
    const home = next.home === club.id;
    const opp = state.clubs[home ? next.away : next.home];
    const oppPos = table.findIndex((r) => r.clubId === opp.id);
    nextCard = `
      <div class="next-match">
        <div>${formatDate(next.date)} · ${esc(league(state).name)} ${next.round}라운드 · ${home ? '홈' : '원정'}</div>
        <div class="vs">${clubLabel(club, true)} <span class="muted">vs</span> ${clubLabel(opp)}</div>
        <div class="muted">상대: ${oppPos + 1}위 · 최근 ${formBadges(table[oppPos].form) || '-'}</div>
      </div>`;
  }

  const last = league(state).fixtures
    .filter((f) => f.result && (f.home === club.id || f.away === club.id))
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const lastCard = last
    ? `<div class="result-line">${clubLabel(state.clubs[last.home], last.home === club.id)} <strong>${last.result.home} - ${last.result.away}</strong> ${clubLabel(state.clubs[last.away], last.away === club.id)}</div>
       <button class="btn small" data-action="showFixture" data-id="${last.id}">경기 기록</button>`
    : '<p class="muted">아직 치른 경기가 없습니다.</p>';

  const mini = table.slice(0, 5).map((r, i) => miniRow(state, r, i, club.id)).join('')
    + (myPos >= 5 ? `<tr class="gap"><td colspan="4">…</td></tr>${miniRow(state, myRow, myPos, club.id)}` : '');

  return `
    <div class="grid two">
      <div class="card"><h3>다음 경기</h3>${nextCard}</div>
      <div class="card"><h3>최근 결과</h3>${lastCard}</div>
      <div class="card">
        <h3>순위</h3>
        <table class="table compact"><thead><tr><th>#</th><th>구단</th><th>경기</th><th>승점</th></tr></thead><tbody>${mini}</tbody></table>
        <button class="btn small" data-action="nav" data-view="table">전체 순위</button>
      </div>
      <div class="card">
        <h3>구단 상황</h3>
        ${boardSummary(state, club, myPos + 1)}
        <button class="btn small" data-action="nav" data-view="club">구단 운영</button> <button class="btn small" data-action="nav" data-view="finance">재정</button>
      </div>
      <div class="card">
        <h3>메시지</h3>
        ${inboxList(state)}
      </div>
    </div>`;
}

function meter(value, label) {
  const cls = value >= 60 ? 'good' : value >= 35 ? 'mid' : 'low';
  return `<span class="meter ${cls}" title="${esc(label)} ${value}"><span style="width:${value}%"></span></span> <strong>${value}</strong>`;
}

function boardSummary(state, club, pos) {
  const m = state.manager;
  const f = club.finance;
  return `<table class="table compact">
    <tr><td>수뇌부 목표</td><td><strong>${esc(club.goal.text)}</strong> <span class="muted small">(지금 ${pos}위)</span></td></tr>
    <tr><td>신뢰도</td><td>${meter(m.trust, '신뢰도')}</td></tr>
    <tr><td>잔고</td><td class="${f.balance < 0 ? 'error' : ''}">${won(f.balance)}</td></tr>
    <tr><td>주급 (예산)</td><td>${won(weeklyWageBill(state, club))} <span class="muted small">/ ${won(f.wageBudget)}</span></td></tr>
  </table>`;
}

function miniRow(state, r, i, myId) {
  return `<tr class="${r.clubId === myId ? 'mine' : ''}"><td>${i + 1}</td><td>${clubLabel(state.clubs[r.clubId], r.clubId === myId)}</td><td>${r.played}</td><td><strong>${r.points}</strong></td></tr>`;
}

function inboxList(state) {
  if (!state.inbox.length) return '<p class="muted">메시지가 없습니다.</p>';
  return `<ul class="inbox">${state.inbox.slice(0, 12).map((m) => `
    <li class="${m.read ? '' : 'unread'} ${m.important ? 'important' : ''}">
      <div class="inbox-head"><strong>${esc(m.title)}</strong><span class="muted small">${formatShortDate(m.date)}</span></div>
      <div>${esc(m.body)}</div>
    </li>`).join('')}</ul>`;
}

// ---- 선수단 ----

const daysLeft = (state, p) => Math.max(1, Math.round((new Date(p.injury.until) - new Date(state.date)) / 86400000));

export function squadView(state, ui) {
  const club = userClub(state);
  const leagueId = userLeagueId(state);
  const players = club.squad.map((id) => state.players[id]);
  const order = Object.keys(POSITIONS);
  const sort = ui.squadSort ?? 'pos';
  const sorted = players.slice().sort((a, b) => {
    if (sort === 'ovr') return overall(b) - overall(a);
    if (sort === 'age') return age(a, state.date) - age(b, state.date);
    return order.indexOf(a.position) - order.indexOf(b.position) || overall(b) - overall(a);
  });
  const selected = ui.playerId ? state.players[ui.playerId] : null;
  const sortBtn = (key, label) => `<button class="btn small ${sort === key ? 'primary' : ''}" data-action="squadSort" data-sort="${key}">${label}</button>`;

  return `
    <div class="squad ${selected ? 'with-detail' : ''}">
      <div class="card">
        <div class="card-head"><h3>선수단 (등록 ${registeredCount(state, club, state.date)}/${MAX_SQUAD}명)</h3><div>${sortBtn('pos', '포지션순')} ${sortBtn('ovr', '능력순')} ${sortBtn('age', '나이순')}</div></div>
        <table class="table clickable">
          <thead><tr><th>포지션</th><th>이름</th><th>나이</th><th>국적</th><th>능력</th><th>잠재</th><th>컨디션</th><th>사기</th><th>주급</th><th>계약</th><th>경기</th><th>골</th><th>도움</th><th>평점</th><th></th></tr></thead>
          <tbody>
            ${sorted.map((p) => {
              const s = seasonStats(p, state.season, leagueId);
              const banned = state.discipline[leagueId]?.[p.id]?.ban > 0;
              return `<tr class="${ui.playerId === p.id ? 'selected' : ''}" data-action="selectPlayer" data-id="${p.id}">
                <td>${posLabel(p.position)}${p.secondary.length ? `<span class="muted small"> ${p.secondary.join(' ')}</span>` : ''}</td>
                <td>${esc(p.name)}</td>
                <td>${age(p, state.date)}</td>
                <td>${esc(nationName(p.nation))}</td>
                <td>${ovrCell(p)}</td>
                <td class="muted">${p.potential}</td>
                <td>${conditionBar(p.condition)}</td>
                <td class="${moraleClass(p.morale)}" title="${moraleLabel(p.morale)}">${p.morale}</td>
                <td class="small">${p.contract ? won(p.contract.wage) : '-'}</td>
                <td class="small ${p.contract && canRenew(state, p) ? 'error' : ''}">${p.contract ? `${p.contract.until.slice(0, 4)}.6` : '-'}</td>
                <td>${s?.apps ?? 0}</td><td>${s?.goals ?? 0}</td><td>${s?.assists ?? 0}</td><td>${avgRating(s)}</td>
                <td>${p.transferRequest ? '<span class="tag red">이적 요청</span>' : ''}${p.transferListed ? '<span class="tag">이적 목록</span>' : ''}${banned ? '<span class="tag red">출전 정지</span>' : ''}${p.injury ? `<span class="tag red" title="${esc(p.injury.name)}, ${formatShortDate(p.injury.until)} 복귀 예정">부상 ${daysLeft(state, p)}일</span>` : ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${selected ? playerDetail(state, selected, ui) : ''}
    </div>`;
}

const nationName = (code) => NATIONS[code]?.name ?? code;
const moraleClass = (m) => (m >= 70 ? 'a-high' : m >= 50 ? 'a-good' : m >= 30 ? 'a-mid' : 'a-low');

export function playerDetail(state, p, ui = {}) {
  const groups = { technical: '기술', mental: '정신', physical: '신체', goalkeeping: '골키퍼' };
  const leagueId = userLeagueId(state);
  const s = seasonStats(p, state.season, leagueId);
  const record = state.discipline[leagueId]?.[p.id];
  const career = Object.entries(p.stats).sort((a, b) => b[0] - a[0]).flatMap(([season, comps]) => Object.entries(comps).map(([comp, x]) => ({ season, comp, x })));
  return `
    <div class="card detail">
      <div class="card-head"><h3>${esc(p.name)}</h3><button class="btn small" data-action="selectPlayer" data-id="">닫기</button></div>
      <p>${posLabel(p.position)} ${esc(POSITIONS[p.position].name)} · ${age(p, state.date)}세 · ${esc(nationName(p.nation))}</p>
      <p>능력 ${ovrCell(p)} · 잠재 ${p.potential} · 컨디션 ${Math.round(p.condition)}%</p>
      ${p.secondary.length ? `<p class="muted">가능 포지션: ${p.secondary.map((x) => `${x} (${ratingAt(p, x)})`).join(', ')}</p>` : ''}
      <div class="attrs">
        ${Object.entries(groups).map(([g, name]) => {
          if (g === 'goalkeeping' && p.position !== 'GK') return '';
          return `<div><h4>${name}</h4>${ATTRIBUTES.filter((a) => a.group === g).map((a) =>
            `<div class="attr"><span>${a.name}</span><span class="${attrClass(p.attrs[a.key])}">${p.attrs[a.key]}</span></div>`).join('')}</div>`;
        }).join('')}
      </div>
      <h4>이번 시즌</h4>
      <p>${s ? `${s.apps}경기 (선발 ${s.starts}) · ${s.minutes}분 · ${s.goals}골 ${s.assists}도움 · 평점 ${avgRating(s)} · 경고 ${s.yellows} 퇴장 ${s.reds}` : '출전 기록이 없습니다.'}</p>
      ${record ? `<p class="muted">리그 누적 경고 ${record.yellows}장${record.ban ? ` · 출전 정지 ${record.ban}경기 남음` : ''}</p>` : ''}
      ${p.injury ? `<p class="error">부상: ${esc(p.injury.name)} · ${formatDate(p.injury.until)} 복귀 예정</p>` : ''}
      ${contractBox(state, p, ui)}
      ${career.length > 1 ? `<h4>통산 기록</h4><table class="table compact">${career.map(({ season, comp, x }) => `<tr><td>${season}-${String(Number(season) + 1).slice(2)}</td><td>${esc(LEAGUES[comp]?.name ?? comp)}</td><td>${x.apps}경기</td><td>${x.goals}골</td><td>${x.assists}도움</td><td>${avgRating(x)}</td></tr>`).join('')}</table>` : ''}
    </div>`;
}

// 계약 정보와 재계약 협상
function contractBox(state, p, ui) {
  if (!p.contract) return '';
  const c = p.contract;
  const club = userClub(state);
  let talk = '';
  if (canRenew(state, p) && club.squad.includes(p.id)) {
    const d = renewalDemand(state, club, p);
    const tries = p.talks?.month === state.date.slice(0, 7) ? p.talks.tries : 0;
    talk = `
      <div class="renew">
        <p><strong>재계약 협상</strong> <span class="muted small">이번 달 ${tries}/3번</span></p>
        <p class="small">선수 요구: 주급 ${won(d.wage)} · ${d.years}년 · ${PROMISES[d.promise].name}</p>
        <div class="form-row">
          <label>주급 (만 원) <input id="offerWage" type="number" min="1" step="10" value="${Math.round(d.wage / 1e4)}"></label>
          <label>기간 <select id="offerYears">${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${y === d.years ? 'selected' : ''}>${y}년</option>`).join('')}</select></label>
          <label>출전 약속 <select id="offerPromise">${Object.entries(PROMISES).map(([k, v]) => `<option value="${k}" ${k === d.promise ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
          <button class="btn primary small" data-action="offerRenewal" data-id="${p.id}">제안</button>
        </div>
        <p class="muted small">약속을 낮추면 주급을 더 원하고, 높여 주면 조금 덜 받아도 됩니다. 주급 예산(${won(club.finance.wageBudget)}) 안에서만 제안할 수 있습니다.</p>
        ${ui.contractMsg ? `<p class="${ui.contractMsg.ok ? 'good' : 'error'} small">${esc(ui.contractMsg.text)}</p>` : ''}
      </div>`;
  }
  return `
    <h4>계약</h4>
    <p>주급 ${won(c.wage)} · ${formatDate(c.until)}까지 · 출전 약속 ${PROMISES[c.promise].name} · 몸값 약 ${won(marketValue(p, state.date))}</p>
    <p class="muted small">사기 ${p.morale} (${moraleLabel(p.morale)})${p.transferRequest ? ' · <span class="error">이적을 요청했습니다</span>' : ''}</p>
    ${club.squad.includes(p.id) ? `<p><button class="btn small" data-action="toggleListed" data-id="${p.id}">${p.transferListed ? '이적 목록에서 내리기' : '이적 목록에 올리기'}</button> <span class="muted small">목록에 올리면 이적시장 동안 다른 구단 제안이 더 자주 옵니다.</span></p>` : ''}
    ${talk}`;
}

// ---- 전술 ----

export function tacticsView(state) {
  const club = userClub(state);
  const t = club.tactics;
  const slots = FORMATIONS[t.formation];
  const leagueId = userLeagueId(state);
  const lineup = resolveLineup(club, state.players, { unavailable: unavailableSet(state, leagueId, club) });
  const squad = club.squad.map((id) => state.players[id]);
  const inLineup = new Set(lineup.lineup.filter(Boolean).map((e) => e.playerId));

  const slotRows = slots.map((pos, i) => {
    const entry = lineup.lineup[i];
    const current = entry ? state.players[entry.playerId] : null;
    const candidates = squad.slice().sort((a, b) => ratingAt(b, pos) - ratingAt(a, pos));
    return `<tr>
      <td>${posLabel(pos)}</td>
      <td><select data-change="setSlotPlayer" data-slot="${i}">
        ${candidates.map((p) => {
          const banned = isUnavailable(state, leagueId, p.id);
          const mark = p.id !== entry?.playerId && inLineup.has(p.id) ? ' (선발)' : '';
          return `<option value="${p.id}" ${p.id === entry?.playerId ? 'selected' : ''} ${banned ? 'disabled' : ''}>${esc(p.name)} · ${p.position} · ${ratingAt(p, pos)}${banned ? (p.injury ? ' · 부상' : ' · 정지') : ''}${mark}</option>`;
        }).join('')}
      </select></td>
      <td><select data-change="setSlotRole" data-slot="${i}">
        ${rolesForPosition(pos).map((r) => `<option value="${r}" ${r === entry?.role ? 'selected' : ''}>${esc(ROLES[r].name)}</option>`).join('')}
      </select></td>
      <td>${current ? conditionBar(current.condition) : ''}</td>
    </tr>`;
  }).join('');

  const spots = slots.map((pos, i) => {
    const entry = lineup.lineup[i];
    const p = entry ? state.players[entry.playerId] : null;
    if (!p) return { pos, cls: 'empty', html: `${posLabel(pos)}<div class="spot-name">비어 있음</div>` };
    return {
      pos,
      cls: p.position === pos || p.secondary?.includes(pos) ? '' : 'offpos',
      html: `${posLabel(pos)}<div class="spot-name" title="${esc(p.name)}">${esc(shortName(p.name))} <b>${ratingAt(p, pos)}</b></div>
        <div class="spot-role">${esc(ROLES[entry.role].name)}</div>${conditionBar(p.condition)}`,
    };
  });

  const bench = lineup.bench.map((id) => state.players[id]);
  const takers = squad.filter((p) => p.position !== 'GK').sort((a, b) => (b.attrs.finishing + b.attrs.composure * 2) - (a.attrs.finishing + a.attrs.composure * 2));

  return `
    <div class="card">
      <h3>팀 전술</h3>
      <div class="form-row tactics-row">
        <label>포메이션 <select data-change="setTactic" data-key="formation">${FORMATION_KEYS.map((f) => `<option ${f === t.formation ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <label>팀 성향 <select data-change="setTactic" data-key="mentality">${options(MENTALITIES, t.mentality)}</select></label>
        <label>압박 강도 <select data-change="setTactic" data-key="pressing">${options(PRESSING, t.pressing)}</select></label>
        <label>템포 <select data-change="setTactic" data-key="tempo">${options(TEMPO, t.tempo)}</select></label>
        <label>수비 라인 <select data-change="setTactic" data-key="line">${options(LINE, t.line)}</select></label>
        <label>페널티킥 키커 <select data-change="setTactic" data-key="setPieceTaker">
          <option value="">자동 (가장 잘 차는 선수)</option>
          ${takers.map((p) => `<option value="${p.id}" ${p.id === t.setPieceTaker ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></label>
      </div>
      <div class="tips small muted">
        <p>공격적: 기회가 늘지만 수비가 약해집니다. 수비적: 그 반대입니다. · 압박 높음: 중원 장악이 좋아지지만 체력 소모와 반칙이 늘어납니다. · 수비 라인 높게: 점유에 유리하지만, 센터백이 느리면 뒷공간을 내줍니다.</p>
      </div>
    </div>
    <div class="grid two pitch-left">
      <div class="card">
        <h3>포메이션 <span class="muted small">${t.formation}</span></h3>
        ${pitchHtml(spots)}
        <p class="muted small">숫자는 그 자리에서의 능력입니다. 주황 테두리는 익숙하지 않은 자리입니다.</p>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>선발 명단</h3>
          <div>
            <label class="check"><input type="checkbox" data-change="toggleAutoLineup" ${t.lineup ? '' : 'checked'}> 매 경기 자동 선발</label>
            <button class="btn small" data-action="autoLineupNow">지금 자동으로 채우기</button>
          </div>
        </div>
        ${t.lineup ? '' : '<p class="muted small">자동 선발이 켜져 있으면 경기마다 컨디션과 출전 정지를 고려해 다시 고릅니다. 선수를 직접 바꾸면 자동 선발이 꺼집니다.</p>'}
        <table class="table"><thead><tr><th>자리</th><th>선수 · 포지션 · 이 자리 능력</th><th>역할</th><th>컨디션</th></tr></thead><tbody>${slotRows}</tbody></table>
        <h4>교체 명단</h4>
        <p class="chips small">${bench.map((p) => `<span class="chip">${posLabel(p.position)} ${esc(p.name)}</span>`).join('')}</p>
      </div>
    </div>`;
}

// ---- 일정 ----

export function scheduleView(state, ui) {
  const club = userClub(state);
  const fixtures = league(state).fixtures;
  const mine = fixtures.filter((f) => f.home === club.id || f.away === club.id);
  const rounds = Math.max(...fixtures.map((f) => f.round));
  const round = Math.min(rounds, ui.round ?? (nextUserFixture(state)?.round ?? rounds));
  const roundFixtures = fixtures.filter((f) => f.round === round);

  const result = (f) => {
    if (!f.result) return '<span class="muted">-</span>';
    const my = f.home === club.id ? f.result.home : f.result.away;
    const their = f.home === club.id ? f.result.away : f.result.home;
    const cls = my > their ? 'w' : my < their ? 'l' : 'd';
    return `<span class="form ${cls}">${my > their ? '승' : my < their ? '패' : '무'}</span> ${f.result.home} - ${f.result.away}`;
  };

  return `
    <div class="grid two">
      <div class="card">
        <h3>우리 경기</h3>
        <table class="table compact clickable">
          <thead><tr><th>R</th><th>날짜</th><th></th><th>상대</th><th>결과</th></tr></thead>
          <tbody>${mine.map((f) => {
            const home = f.home === club.id;
            const opp = state.clubs[home ? f.away : f.home];
            return `<tr ${f.result ? `data-action="showFixture" data-id="${f.id}"` : ''}>
              <td>${f.round}</td><td>${formatShortDate(f.date)}</td><td>${home ? '홈' : '원정'}</td><td>${clubLabel(opp)}</td><td>${result(f)}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>${round}라운드 · ${formatShortDate(roundFixtures[0].date)}</h3>
          <div>
            <button class="btn small" data-action="setRound" data-round="${Math.max(1, round - 1)}" ${round <= 1 ? 'disabled' : ''}>◀</button>
            <button class="btn small" data-action="setRound" data-round="${Math.min(rounds, round + 1)}" ${round >= rounds ? 'disabled' : ''}>▶</button>
          </div>
        </div>
        <table class="table compact clickable">
          <tbody>${roundFixtures.map((f) => `<tr ${f.result ? `data-action="showFixture" data-id="${f.id}"` : ''}>
            <td class="right">${clubLabel(state.clubs[f.home], f.home === club.id)}</td>
            <td class="center"><strong>${f.result ? `${f.result.home} - ${f.result.away}` : 'vs'}</strong></td>
            <td>${clubLabel(state.clubs[f.away], f.away === club.id)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// 끝난 경기 기록 (골, 카드, 평점)
export function fixtureDetail(state, fixtureId) {
  const f = findFixture(state, fixtureId);
  if (!f?.result) return '';
  const name = (id) => esc(state.players[id]?.name ?? '');
  const line = (e) => {
    if (e.type === 'goal') return `⚽ ${e.clock} ${name(e.playerId)}${e.kind === 'penalty' ? ' (PK)' : ''}${e.assistId ? ` <span class="muted">(도움 ${name(e.assistId)})</span>` : ''}`;
    if (e.type === 'yellow') return `<span class="card-y"></span> ${e.clock} ${name(e.playerId)}`;
    if (e.type === 'injury') return `🚑 ${e.clock} ${name(e.playerId)} <span class="muted">(부상)</span>`;
    if (e.type === 'secondYellow' || e.type === 'red') return `<span class="card-r"></span> ${e.clock} ${name(e.playerId)}${e.type === 'secondYellow' ? ' (경고 2회)' : ''}`;
    return '';
  };
  const side = (s) => f.result.events.filter((e) => e.side === s && e.type !== 'sub').map(line).filter(Boolean).map((x) => `<div>${x}</div>`).join('') || '<div class="muted">-</div>';
  const ratings = (clubId) => {
    const club = state.clubs[clubId];
    return Object.entries(f.result.ratings ?? {})
      .filter(([pid]) => state.players[pid]?.clubId === club.id)
      .sort((a, b) => b[1] - a[1])
      .map(([pid, r]) => `<div class="attr"><span>${name(pid)}</span><span class="${r >= 7.5 ? 'a-high' : r >= 6.8 ? 'a-good' : r >= 6 ? 'a-mid' : 'a-low'}">${r.toFixed(1)}</span></div>`)
      .join('');
  };
  const st = f.result.stats;
  const poss = (i) => Math.round((st[i].possession / Math.max(1, st[0].possession + st[1].possession)) * 100);
  return `
    <div class="modal-bg" data-action="closeModal">
      <div class="modal" data-stop>
        <div class="card-head"><h3>${formatShortDate(f.date)} · ${f.round}라운드</h3><button class="btn small" data-action="closeModal">닫기</button></div>
        <div class="score-line">${clubLabel(state.clubs[f.home])} <strong>${f.result.home} - ${f.result.away}</strong> ${clubLabel(state.clubs[f.away])}</div>
        <div class="grid two">${side(0)}${side(1)}</div>
        <table class="table compact stats">
          <tr><td>${st[0].shots} (${st[0].onTarget})</td><th>슈팅 (유효)</th><td>${st[1].shots} (${st[1].onTarget})</td></tr>
          <tr><td>${poss(0)}%</td><th>점유율</th><td>${poss(1)}%</td></tr>
          <tr><td>${st[0].fouls}</td><th>반칙</th><td>${st[1].fouls}</td></tr>
        </table>
        <div class="grid two"><div><h4>평점</h4>${ratings(f.home)}</div><div><h4>평점</h4>${ratings(f.away)}</div></div>
      </div>
    </div>`;
}

// ---- 순위표 ----

export function tableView(state, ui) {
  const club = userClub(state);
  const leagueId = ui.tableLeague ?? userLeagueId(state);
  const rule = LEAGUES[leagueId];
  const table = standings(state, leagueId);
  const scorers = topScorers(state, leagueId, 10);
  const assists = Object.values(state.players)
    .filter((p) => p.stats[state.season]?.[leagueId]?.assists)
    .map((p) => ({ p, s: p.stats[state.season][leagueId] }))
    .sort((a, b) => b.s.assists - a.s.assists || b.s.goals - a.s.goals)
    .slice(0, 10);
  const clubName = (p) => (p.clubId ? state.clubs[p.clubId].name : '');
  const person = (p) => `${esc(p.name)} <span class="muted small">${esc(clubName(p))}</span>`;
  // 구역: 1부는 상위 4팀(유럽 대회 예정)과 강등 3팀, 2·3부는 승격 3팀과 강등 3팀
  const zone = (i) => {
    if (rule.tier === 1 && i < 4) return 'zone-europe';
    if (rule.tier > 1 && i < rule.promoted) return 'zone-up';
    if (i >= table.length - rule.relegated) return 'zone-down';
    return '';
  };
  return `
    ${leagueTabs(leagueId, 'tableLeague')}
    <div class="grid two wide-left">
      <div class="card">
        <h3>${esc(rule.name)} ${state.season}-${String(state.season + 1).slice(2)}</h3>
        <table class="table compact">
          <thead><tr><th>#</th><th>구단</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득</th><th>실</th><th>득실</th><th>승점</th><th>최근</th></tr></thead>
          <tbody>${table.map((r, i) => `<tr class="${r.clubId === club.id ? 'mine' : ''} ${zone(i)}">
            <td>${i + 1}</td><td>${clubLabel(state.clubs[r.clubId], r.clubId === club.id)}</td>
            <td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.goalsFor}</td><td>${r.goalsAgainst}</td>
            <td>${r.goalDiff > 0 ? '+' : ''}${r.goalDiff}</td><td><strong>${r.points}</strong></td><td>${formBadges(r.form)}</td></tr>`).join('')}</tbody>
        </table>
        <p class="muted small">${rule.tier === 1 ? '<span class="legend zone-europe"></span> 상위 4팀' : `<span class="legend zone-up"></span> 승격 ${rule.promoted}팀`} · <span class="legend zone-down"></span> ${rule.tier === 3 ? '하부 리그로 강등' : '강등'} ${rule.relegated}팀</p>
      </div>
      <div>
        <div class="card"><h3>득점 순위</h3><table class="table compact">${scorers.map((x, i) => `<tr><td>${i + 1}</td><td>${person(x.player)}</td><td><strong>${x.s.goals}</strong></td></tr>`).join('') || '<tr><td class="muted">기록 없음</td></tr>'}</table></div>
        <div class="card"><h3>도움 순위</h3><table class="table compact">${assists.map((x, i) => `<tr><td>${i + 1}</td><td>${person(x.p)}</td><td><strong>${x.s.assists}</strong></td></tr>`).join('') || '<tr><td class="muted">기록 없음</td></tr>'}</table></div>
      </div>
    </div>`;
}

// ---- 유스 ----

export function youthView(state) {
  const club = userClub(state);
  const youth = club.youth.map((id) => state.players[id]).sort((a, b) => b.potential - a.potential);
  const registered = registeredCount(state, club, state.date);
  return `
    <div class="card">
      <div class="card-head"><h3>U-21 팀 (${youth.length}명)</h3><span class="muted small">1군 등록 ${registered}/${MAX_SQUAD}명</span></div>
      <p class="muted small">매년 3월 유스가 입단합니다. 21세 이하이고 유스에서 2년 이상 지낸 선수는 1군 등록 인원(25명)에 들어가지 않고 출전할 수 있습니다. 시즌이 끝나면 21세가 넘었거나 정원(14명)을 넘는 유스는 방출됩니다.</p>
      <table class="table">
        <thead><tr><th>포지션</th><th>이름</th><th>나이</th><th>능력</th><th>잠재</th><th>입단</th><th></th></tr></thead>
        <tbody>${youth.map((p) => {
          const homegrown = isHomegrownYouth(p, state.date);
          return `<tr>
            <td>${posLabel(p.position)}</td><td>${esc(p.name)}</td><td>${age(p, state.date)}</td><td>${ovrCell(p)}</td>
            <td><strong>${p.potential}</strong></td><td class="muted small">${formatShortDate(p.youthSince)}${homegrown ? ' · <span class="tag">유스 출신 예외</span>' : ''}</td>
            <td>${canCallUp(state, p.id) ? `<button class="btn small primary" data-action="callUp" data-id="${p.id}">1군 콜업</button>` : '<span class="muted small">1군 정원 초과</span>'}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="7" class="muted">유스 선수가 없습니다. 3월에 입단합니다.</td></tr>'}</tbody>
      </table>
      ${(() => {
        const down = club.squad.map((id) => state.players[id]).filter((p) => p.youthSince && age(p, state.date) <= 21);
        return down.length ? `<h4>U-21 팀으로 내릴 수 있는 1군 선수</h4><p>${down.map((p) => `${posLabel(p.position)} ${esc(p.name)} <button class="btn small" data-action="sendDown" data-id="${p.id}">내리기</button>`).join(' · ')}</p>` : '';
      })()}
    </div>`;
}

// ---- 기록 ----

export function historyView(state, ui) {
  const career = state.manager.history;
  const leagueId = ui.historyLeague ?? userLeagueId(state);
  const club = userClub(state);
  const seasons = state.history.slice().reverse();
  const name = (id) => esc(state.clubs[id]?.name ?? '');
  return `
    <div class="grid two">
      <div class="card">
        <h3>감독 커리어 · ${esc(state.manager.name)}</h3>
        ${career.length ? `<table class="table compact"><thead><tr><th>시즌</th><th>구단</th><th>리그</th><th>순위</th></tr></thead><tbody>
          ${career.slice().reverse().map((h) => `<tr><td>${h.season}-${String(h.season + 1).slice(2)}</td><td>${esc(h.clubName)}</td><td>${esc(LEAGUES[h.leagueId].name)}</td><td><strong>${h.position}위</strong></td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">첫 시즌을 마치면 기록이 쌓입니다.</p>'}
        <h3>${esc(club.name)} 역대 성적</h3>
        ${club.history.length ? `<table class="table compact"><tbody>${club.history.slice().reverse().map((h) => `<tr><td>${h.season}-${String(h.season + 1).slice(2)}</td><td>${esc(LEAGUES[h.leagueId].name)}</td><td>${h.position}위</td><td>${h.points}점</td></tr>`).join('')}</tbody></table>` : '<p class="muted">기록이 없습니다.</p>'}
      </div>
      <div class="card">
        <h3>역대 우승</h3>
        ${leagueTabs(leagueId, 'historyLeague')}
        ${seasons.length ? `<table class="table compact"><thead><tr><th>시즌</th><th>우승</th><th>준우승</th><th>득점왕</th></tr></thead><tbody>
          ${seasons.map((h) => {
            const l = h.leagues[leagueId];
            if (!l) return '';
            const top = l.topScorer;
            return `<tr><td>${h.season}-${String(h.season + 1).slice(2)}</td><td><strong>${name(l.champion)}</strong></td><td>${name(l.table[1]?.clubId)}</td><td>${top ? `${esc(top.name)} ${top.goals}골` : '-'}</td></tr>`;
          }).join('')}
        </tbody></table>` : '<p class="muted">아직 끝난 시즌이 없습니다.</p>'}
      </div>
    </div>`;
}

// ---- 설정 ----

export const PAUSE_NAMES = {
  halftime: '하프타임',
  conceded: '우리 팀 실점 직후',
  ourRed: '우리 팀 선수 퇴장',
  losingAt60: '60분에 지고 있을 때',
  drawingAt75: '75분에 비기고 있을 때',
  theirRed: '상대 팀 퇴장',
  lowEnergy: '주전 체력이 크게 떨어졌을 때',
  injury: '우리 팀 선수 부상 (교체를 맡긴 경우. 직접 교체하면 항상 멈춤)',
};

export const VIEW_MODES = { result: '결과만', highlights: '하이라이트', full: '전체 중계' };

export function settingsView(state) {
  const s = state.settings;
  return `
    <div class="grid two">
      <div class="card">
        <h3>경기 보기</h3>
        <div class="form-col">
          <label>기본 보기 방식 <select data-change="setViewMode">${options(VIEW_MODES, s.viewMode)}</select></label>
          <label class="check"><input type="checkbox" data-change="toggleAutoSubs" ${s.autoSubs ? 'checked' : ''}> 경기 중 교체를 수석코치에게 맡기기 (직접 교체도 가능)</label>
        </div>
        <h4>결정 순간에 멈춤 (하이라이트·전체 중계)</h4>
        <div class="form-col">
          ${Object.entries(PAUSE_NAMES).map(([k, name]) => `<label class="check"><input type="checkbox" data-change="togglePause" data-key="${k}" ${s.pauses[k] ? 'checked' : ''}> ${name}</label>`).join('')}
        </div>
      </div>
      <div class="card">
        <h3>저장</h3>
        <p class="muted small">진행 상황은 이 브라우저에 자동 저장됩니다. 백업하거나 다른 기기에서 이어 하려면 파일로 내보내세요.</p>
        <div class="form-col">
          <button class="btn" data-action="exportSave">세이브 파일 내보내기</button>
          <label class="btn file">세이브 파일 불러오기<input type="file" accept=".json" data-change="importSave" hidden></label>
          <button class="btn danger" data-action="newGame">새 게임 시작 (현재 진행 삭제)</button>
        </div>
        <p class="muted small">세계 시드: <code>${esc(state.seed)}</code></p>
      </div>
    </div>`;
}

// ---- 시즌 종료 ----

export function seasonEndBanner(state, ui = {}) {
  const club = userClub(state);
  const leagueId = userLeagueId(state);
  const rule = LEAGUES[leagueId];
  const table = standings(state, leagueId);
  const pos = table.findIndex((r) => r.clubId === club.id) + 1;
  const [top] = topScorers(state, leagueId, 1);
  const myBest = club.squad.map((id) => state.players[id])
    .map((p) => ({ p, s: seasonStats(p, state.season, leagueId) }))
    .filter((x) => x.s?.ratingCount >= 10)
    .sort((a, b) => b.s.ratingSum / b.s.ratingCount - a.s.ratingSum / a.s.ratingCount)[0];
  let outcome = '잔류';
  if (rule.tier > 1 && pos <= rule.promoted) outcome = '<span class="good">승격!</span>';
  else if (pos > table.length - rule.relegated) outcome = rule.tier === 3 ? '<span class="error">하부 리그로 강등 (감독 계약 종료)</span>' : '<span class="error">강등</span>';
  else if (pos === 1) outcome = '<span class="good">우승!</span>';
  return `
    <div class="card season-end">
      <h2>${state.season}-${String(state.season + 1).slice(2)} 시즌 종료</h2>
      <p>${esc(rule.name)} 우승: ${clubLabel(state.clubs[table[0].clubId])} (승점 ${table[0].points})</p>
      <p>우리 팀: <strong>${pos}위</strong> · 승점 ${table[pos - 1].points} · ${table[pos - 1].won}승 ${table[pos - 1].drawn}무 ${table[pos - 1].lost}패 · ${outcome}</p>
      ${top ? `<p>득점왕: ${esc(top.player.name)} (${esc(top.player.clubId ? state.clubs[top.player.clubId].name : '')}) ${top.s.goals}골</p>` : ''}
      ${myBest ? `<p>우리 팀 최고 평점: ${esc(myBest.p.name)} ${avgRating(myBest.s)}</p>` : ''}
      <p class="muted small">다음 시즌으로 넘어가면 승강, 은퇴, 선수단 정리가 처리되고 7월 1일에 새 시즌이 시작됩니다.</p>
      <button class="btn primary" data-action="nextSeason" ${ui.busy ? 'disabled' : ''}>다음 시즌 시작 ▶</button>
    </div>`;
}

// ---- 구단 운영: 수뇌부, 시설, 스태프 ----

export function clubView(state, ui) {
  const club = userClub(state);
  const m = state.manager;
  const table = standings(state);
  const pos = table.findIndex((r) => r.clubId === club.id) + 1;
  const f = club.finance;

  const facilityRows = FACILITY_KEYS.map((key) => {
    const level = club.facilities[key];
    const building = club.construction.find((c) => c.key === key);
    const info = upgradeInfo(club, key);
    let action = '<span class="muted small">최고 레벨</span>';
    if (building) action = `<span class="tag">공사 중 · ${formatShortDate(building.done)} 완료</span>`;
    else if (info) action = `<button class="btn small" data-action="upgradeFacility" data-key="${key}">업그레이드</button> <span class="muted small">${won(info.cost)} · ${info.months}개월</span>`;
    return `<tr>
      <td>${esc(FACILITIES[key].name)}</td>
      <td>${'★'.repeat(level)}<span class="muted">${'☆'.repeat(5 - level)}</span></td>
      <td class="muted small">${esc(FACILITIES[key].effect)}${key === 'stadium' ? ` · ${capacity(club).toLocaleString('ko-KR')}석` : ''}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');

  const staffRows = STAFF_KEYS.map((key) => {
    const level = club.staff[key];
    const wage = roundMoney(staffWage(level) * EUR);
    return `<tr>
      <td>${esc(STAFF[key].name)}</td>
      <td><button class="btn small" data-action="staffLevel" data-key="${key}" data-level="${level - 1}" ${level <= 1 ? 'disabled' : ''}>−</button>
        <strong class="staff-level">${level}</strong>
        <button class="btn small" data-action="staffLevel" data-key="${key}" data-level="${level + 1}" ${level >= MAX_STAFF ? 'disabled' : ''}>+</button></td>
      <td>${won(wage)}<span class="muted small"> / 주</span>${level < MAX_STAFF ? `<div class="muted small">올리면 +${won(roundMoney(staffWage(level + 1) * EUR) - wage)}</div>` : ''}</td>
      <td class="muted small">${esc(STAFF[key].effect)}</td>
    </tr>`;
  }).join('');

  return `
    ${ui.clubMsg ? `<p class="${ui.clubMsg.ok ? 'good' : 'error'}">${esc(ui.clubMsg.text)}</p>` : ''}
    <div class="grid two">
      <div class="card">
        <h3>수뇌부</h3>
        <table class="table compact">
          <tr><td>시즌 목표</td><td><strong>${esc(club.goal.text)}</strong></td></tr>
          <tr><td>지금 순위</td><td>${table[0].played ? `${pos}위` : '개막 전'}</td></tr>
          <tr><td>신뢰도</td><td>${meter(m.trust, '신뢰도')}</td></tr>
          <tr><td>감독 평판</td><td>${m.reputation}</td></tr>
        </table>
        <p class="muted small">신뢰도는 매달 순위와 목표, 재정(잔고가 마이너스인지)으로 변합니다. 11월부터 15 아래로 떨어지면 시즌 중에도 해고되고, 시즌이 끝나면 목표 달성 여부로 크게 평가합니다.</p>
      </div>
      <div class="card">
        <h3>구단 정보</h3>
        <table class="table compact">
          <tr><td>연고지</td><td>${esc(club.city)}</td></tr>
          <tr><td>구단 평판</td><td>${club.reputation}</td></tr>
          <tr><td>경기장</td><td>${capacity(club).toLocaleString('ko-KR')}석 · 예상 관중 비율 ${Math.round(attendanceRate(club, pos || null, table.length) * 100)}%</td></tr>
          <tr><td>잔고</td><td>${won(f.balance)}</td></tr>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>시설</h3>
      <p class="muted small">업그레이드는 수뇌부 승인이 필요합니다. 잔고가 공사비의 1.3배 이상이고 신뢰도가 40 이상이어야 승인됩니다. 공사비는 바로 나가고, 레벨이 높을수록 매달 유지비가 늘어납니다.</p>
      <table class="table"><thead><tr><th>시설</th><th>레벨</th><th>효과</th><th></th></tr></thead><tbody>${facilityRows}</tbody></table>
    </div>
    <div class="card">
      <h3>스태프</h3>
      <p class="muted small">수준(1~20)을 올리면 스태프 주급이 늘어납니다. 주급 예산(${won(f.wageBudget)}) 안에서만 올릴 수 있습니다.</p>
      <table class="table"><thead><tr><th>분야</th><th>수준</th><th>주급</th><th>효과</th></tr></thead><tbody>${staffRows}</tbody></table>
    </div>`;
}

// ---- 재정 ----

const INCOME_NAMES = { tv: '중계권', prize: '순위 상금', gate: '입장 수입', commercial: '스폰서·상업', transfers: '선수 판매' };
const EXPENSE_NAMES = { wages: '선수 주급', staff: '스태프 주급', facilities: '시설 유지비', construction: '시설 공사', transfers: '선수 영입' };

function ledgerTable(ledger) {
  const rows = (names, part, sign) => Object.entries(names)
    .map(([k, name]) => `<tr><td>${name}</td><td class="num">${part[k] ? `${sign}${won(part[k])}` : '-'}</td></tr>`).join('');
  const net = ledgerTotal(ledger.income) - ledgerTotal(ledger.expense);
  return `<table class="table compact">
    <tr class="line-below"><th>수입</th><th class="num">${won(ledgerTotal(ledger.income))}</th></tr>${rows(INCOME_NAMES, ledger.income, '')}
    <tr class="line-below"><th>지출</th><th class="num">${won(ledgerTotal(ledger.expense))}</th></tr>${rows(EXPENSE_NAMES, ledger.expense, '-')}
    <tr><th>수지</th><th class="num ${net < 0 ? 'error' : 'good'}">${won(net)}</th></tr>
  </table>`;
}

export function financeView(state) {
  const club = userClub(state);
  const f = club.finance;
  const bill = weeklyWageBill(state, club);
  const players = playerWageBill(state, club);
  const top = club.squad.map((id) => state.players[id]).sort((a, b) => b.contract.wage - a.contract.wage).slice(0, 8);
  return `
    <div class="grid two">
      <div class="card">
        <h3>잔고와 예산</h3>
        <table class="table compact">
          <tr><td>잔고</td><td class="num ${f.balance < 0 ? 'error' : ''}"><strong>${won(f.balance)}</strong></td></tr>
          <tr><td>이적 예산</td><td class="num">${won(f.transferBudget)}</td></tr>
          <tr><td>주급 예산 (주)</td><td class="num">${won(f.wageBudget)}</td></tr>
          <tr><td>지금 주급 (주)</td><td class="num ${bill > f.wageBudget ? 'error' : ''}">${won(bill)} <span class="muted small">선수 ${won(players)} + 스태프 ${won(bill - players)}</span></td></tr>
          <tr><td>남은 주급 여유</td><td class="num">${won(f.wageBudget - bill)}</td></tr>
          <tr><td>시설 유지비 (월)</td><td class="num">${won(monthlyUpkeep(club))}</td></tr>
        </table>
        <p class="muted small">예산은 시즌이 시작할 때 수뇌부가 정합니다. 중계권 절반과 스폰서 수입은 매달, 나머지 중계권은 시즌이 끝날 때 순위 상금으로 들어옵니다. 입장 수입은 홈 경기마다 들어옵니다. 재정은 매달 마지막 날 정산합니다.</p>
      </div>
      <div class="card">
        <h3>이번 시즌 장부</h3>
        ${ledgerTable(f.season)}
      </div>
      <div class="card">
        <h3>주급 상위 선수</h3>
        <table class="table compact">${top.map((p) => `<tr><td>${posLabel(p.position)} ${esc(p.name)}</td><td class="num">${won(p.contract.wage)}</td><td class="muted small">${p.contract.until.slice(0, 4)}년 6월까지</td></tr>`).join('')}</table>
      </div>
      <div class="card">
        <h3>지난 시즌</h3>
        ${f.history.length ? `<table class="table compact"><thead><tr><th>시즌</th><th class="num">수입</th><th class="num">지출</th><th class="num">수지</th><th class="num">시즌 끝 잔고</th></tr></thead><tbody>
          ${f.history.map((h) => {
            const net = ledgerTotal(h.income) - ledgerTotal(h.expense);
            return `<tr><td>${h.season}-${String(h.season + 1).slice(2)}</td><td class="num">${won(ledgerTotal(h.income))}</td><td class="num">${won(ledgerTotal(h.expense))}</td><td class="num ${net < 0 ? 'error' : 'good'}">${won(net)}</td><td class="num">${won(h.balance)}</td></tr>`;
          }).join('')}</tbody></table>` : '<p class="muted">아직 지난 시즌 기록이 없습니다.</p>'}
      </div>
    </div>`;
}
