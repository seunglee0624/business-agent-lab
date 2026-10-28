// 이적 화면: 받은 제안, 진행 중인 협상, 이적 목록, 선수 찾기와 영입 협상.
// views.js와 같이 (state, ui) → 문자열이고 상태를 바꾸지 않는다.

import { POSITIONS, POSITION_WEIGHTS, ATTRIBUTES } from '../data/positions.js';
import { overall } from '../core/player.js';
import { LEAGUES } from '../data/countries/index.js';
import { PROMISES } from '../data/economy.js';
import { userClub, searchPlayers, playerInfo, registeredCount, MAX_SQUAD, transferRequests } from '../core/game.js';
import { windowEnd, MAX_FEE_TRIES, MAX_TERM_TRIES } from '../core/transfers.js';
import { transferDemand } from '../core/contracts.js';
import { loanOptionFee } from '../core/loans.js';
import { weeklyWageBill } from '../core/finance.js';
import { formatDate } from '../core/calendar.js';
import { marketValue } from '../core/money.js';
import { esc, posLabel, won, age, attrClass, modal } from './format.js';
import { playerProfile } from './views.js';

const eok = (amount) => Math.round(amount / 1e6) / 100; // 원 → 억 (소수 둘째 자리)

const options = (pairs, current) =>
  pairs.map(([k, v]) => `<option value="${k}" ${String(k) === String(current ?? '') ? 'selected' : ''}>${esc(v)}</option>`).join('');

const potentialText = (info) => (info.own ? String(info.potential) : `${info.potentialRange[0]}~${info.potentialRange[1]}`);
const clubName = (state, id) => (id ? state.clubs[id].name : '자유계약');

export function transfersView(state, ui) {
  const club = userClub(state);
  const f = club.finance;
  const end = windowEnd(state.date);
  const nextOpen = state.date.slice(5) < '07-01' ? '7월 1일' : '1월 1일';
  const target = ui.targetId ? state.players[ui.targetId] : null;
  return `
    <div class="card transfer-head">
      <div><strong>${end ? `이적시장 열림 · ${formatDate(end)} 마감` : `이적시장 닫힘 · 다음 시장 ${nextOpen}`}</strong>
        <span class="muted small">${end ? '' : '자유계약 선수는 언제든 영입할 수 있습니다.'}</span></div>
      <div class="small">이적 예산 <strong>${won(f.transferBudget)}</strong> · 주급 여유 <strong>${won(f.wageBudget - weeklyWageBill(state, club))}</strong>/주 · 1군 등록 ${registeredCount(state, club, state.date)}/${MAX_SQUAD}명</div>
    </div>
    ${ui.transferMsg ? `<p class="${ui.transferMsg.ok ? 'good' : 'error'}">${esc(ui.transferMsg.text)}</p>` : ''}
    ${requestsCard(state)}
    <div class="grid two">
      ${incomingCard(state)}
      ${dealsCard(state)}
    </div>
    ${searchCard(state, ui)}
    ${target ? targetDetail(state, target) : ''}
    ${listedCard(state, club)}
    ${loanedOutCard(state, club)}`;
}

// 감독의 영입 요청: 승인하면 이적료 협상 목록에 오른다
const ATTR_NAME = Object.fromEntries(ATTRIBUTES.map((a) => [a.key, a.name]));

// 그 포지션에서 중요한 능력치 (가중치 높은 순 6개)
function keyAttributes(p) {
  return Object.entries(POSITION_WEIGHTS[p.position]).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k]) => `<span class="chip">${esc(ATTR_NAME[k])} <b class="${attrClass(p.attrs[k])}">${p.attrs[k]}</b></span>`).join('');
}

function requestsCard(state) {
  const list = transferRequests(state);
  if (!list.length) return '';
  const coach = userClub(state).headCoach;
  return `
    <div class="card">
      <h3>${esc(coach?.name ?? '감독')}의 영입 요청</h3>
      <table class="table compact clickable"><tbody>${list.map((r) => {
        const p = state.players[r.playerId];
        return `<tr data-action="selectTarget" data-id="${p.id}"><td>${posLabel(p.position)} ${esc(p.name)}<div class="muted small">${esc(clubName(state, p.clubId))} · ${age(p, state.date)}세 · 능력 ${overall(p)}</div>
            <div class="chips small">${keyAttributes(p)}</div></td>
          <td class="small">${esc(r.reason)}</td><td class="num">${won(marketValue(p, state.date))}</td>
          <td class="offer-actions"><button class="btn primary small" data-action="answerRequest" data-id="${r.id}" data-answer="approve">승인</button>
            <button class="btn small" data-action="answerRequest" data-id="${r.id}" data-answer="reject">거절</button></td></tr>`;
      }).join('')}</tbody></table>
      <p class="muted small">선수를 누르면 자세한 정보를 볼 수 있습니다. 승인하면 아래 "진행 중인 협상"에 올라가고, 이적료와 개인 조건은 단장이 직접 협상합니다.</p>
    </div>`;
}

function incomingCard(state) {
  const offers = state.transfers.incoming;
  return `
    <div class="card">
      <h3>받은 제안</h3>
      ${offers.length ? `<table class="table compact clickable"><tbody>${offers.map((o) => {
        const p = state.players[o.playerId];
        return `<tr data-action="selectTarget" data-id="${p.id}">
          <td>${posLabel(p.position)} ${esc(p.name)}<div class="muted small">${esc(state.clubs[o.clubId].name)} · ${formatDate(o.expires)}까지</div></td>
          <td class="num"><strong>${won(o.fee)}</strong></td>
          <td class="offer-actions">
            <button class="btn small primary" data-action="respondOffer" data-id="${o.id}" data-answer="accept">수락</button>
            <button class="btn small" data-action="respondOffer" data-id="${o.id}" data-answer="reject">거절</button>
            <input id="counter-${o.id}" type="number" min="0" step="0.1" value="${Math.round(o.fee * 1.15 / 1e7) / 10}" title="역제안 금액 (억 원)"><span class="small">억</span>
            <button class="btn small" data-action="respondOffer" data-id="${o.id}" data-answer="counter">역제안</button>
          </td></tr>`;
      }).join('')}</tbody></table>
      <p class="muted small">역제안은 한 번만 할 수 있고, 너무 높으면 상대가 제안을 거둡니다.</p>` : '<p class="muted">받은 제안이 없습니다. 팔고 싶은 선수는 선수단 화면에서 이적 목록에 올리면 제안이 더 자주 옵니다.</p>'}
    </div>`;
}

const STAGE = { fee: '이적료 협상 중', terms: '이적료 합의 · 개인 조건 협상', collapsed: '결렬' };

function dealsCard(state) {
  const deals = Object.entries(state.transfers.deals).filter(([id, d]) => d.until >= state.date && state.players[id]);
  return `
    <div class="card">
      <h3>진행 중인 협상</h3>
      ${deals.length ? `<table class="table compact clickable"><tbody>${deals.map(([id, d]) => {
        const p = state.players[id];
        return `<tr data-action="selectTarget" data-id="${id}"><td>${posLabel(p.position)} ${esc(p.name)}<div class="muted small">${esc(clubName(state, p.clubId))}</div></td>
          <td class="${d.stage === 'collapsed' ? 'error' : ''}">${STAGE[d.stage]}</td><td class="num">${d.fee ? won(d.fee) : ''}</td></tr>`;
      }).join('')}</tbody></table>` : '<p class="muted">아래에서 선수를 찾아 이적료를 제안하세요.</p>'}
    </div>`;
}

function searchCard(state, ui) {
  const q = ui.search ?? {};
  const rows = ui.search ? searchPlayers(state, q) : [];
  const leagues = [['', '모든 리그'], ...Object.values(LEAGUES).map((l) => [l.id, l.name])];
  const positions = [['', '모든 포지션'], ...Object.entries(POSITIONS).map(([k, v]) => [k, `${k} ${v.name}`])];
  return `
    <div class="card">
      <h3>선수 찾기</h3>
      <div class="form-row search-form">
        <label>포지션 <select id="sPosition">${options(positions, q.position)}</select></label>
        <label>리그 <select id="sLeague">${options(leagues, q.leagueId)}</select></label>
        <label>나이 <span class="inline"><input id="sMinAge" type="number" min="15" max="40" value="${q.minAge ?? ''}" placeholder="최소"> ~ <input id="sMaxAge" type="number" min="15" max="40" value="${q.maxAge ?? ''}" placeholder="최대"></span></label>
        <label>몸값 최대 (억 원) <input id="sMaxValue" type="number" min="0" step="1" value="${q.maxValue ? eok(q.maxValue) : ''}" placeholder="제한 없음"></label>
        <label class="check"><input id="sFree" type="checkbox" ${q.freeOnly ? 'checked' : ''}> 자유계약만</label>
        <button class="btn primary" data-action="searchPlayers">검색</button>
      </div>
      ${!ui.search ? '<p class="muted">조건을 정하고 검색하세요. 다른 구단 선수의 잠재력은 스카우트 수준에 따라 범위로 보입니다.</p>'
        : rows.length ? `<table class="table clickable"><thead><tr><th>포지션</th><th>이름</th><th>나이</th><th>구단</th><th>능력</th><th>잠재</th><th class="num">몸값</th><th class="num">주급</th><th>계약</th><th></th></tr></thead><tbody>
          ${rows.map((r) => `<tr class="${ui.targetId === r.id ? 'selected' : ''}" data-action="selectTarget" data-id="${r.id}">
            <td>${posLabel(r.position)}</td><td>${esc(r.name)}</td><td>${r.age}</td><td class="small">${esc(clubName(state, r.clubId))}</td>
            <td><strong>${r.overall}</strong></td><td class="muted">${potentialText(r)}</td>
            <td class="num small">${r.clubId ? won(r.value) : '-'}</td><td class="num small">${r.wage ? won(r.wage) : '-'}</td>
            <td class="small">${r.until ? `${r.until.slice(0, 4)}.6` : '-'}</td>
            <td>${r.transferRequest ? '<span class="tag red">이적 요청</span>' : ''}${r.injured ? '<span class="tag red">부상</span>' : ''}</td></tr>`).join('')}
          </tbody></table>${rows.length >= 100 ? '<p class="muted small">능력 순 상위 100명만 보여 줍니다. 조건을 좁혀 보세요.</p>' : ''}`
        : '<p class="muted">조건에 맞는 선수가 없습니다.</p>'}
    </div>`;
}

function targetDetail(state, p) {
  const club = userClub(state);
  const info = playerInfo(state, p.id);
  const deal = state.transfers.deals[p.id];
  const live = deal && deal.until >= state.date ? deal : null;
  const stage = !p.clubId ? 'terms' : live?.stage ?? 'fee';
  const value = p.clubId ? marketValue(p, state.date) : 0;
  let box;
  if (p.clubId === club.id) {
    const offers = state.transfers.incoming.filter((o) => o.playerId === p.id);
    box = offers.length
      ? offers.map((o) => `<p>${esc(state.clubs[o.clubId].name)}의 제안 <strong>${won(o.fee)}</strong> <span class="muted small">${formatDate(o.expires)}까지</span>
          <button class="btn small primary" data-action="respondOffer" data-id="${o.id}" data-answer="accept">수락</button>
          <button class="btn small" data-action="respondOffer" data-id="${o.id}" data-answer="reject">거절</button></p>`).join('')
      : '<p class="muted">우리 선수입니다.</p>';
  } else if (stage === 'collapsed') {
    box = '<p class="error">협상이 결렬되었습니다. 다음 이적시장에 다시 시도하세요.</p>';
  } else if (stage === 'fee') {
    box = `
      <p><strong>1단계: 이적료</strong> <span class="muted small">${live?.tries ?? 0}/${MAX_FEE_TRIES}번 실패하면 결렬</span></p>
      <div class="form-row">
        <label>이적료 (억 원) <input id="bidFee" type="number" min="0" step="0.1" value="${eok(value)}"></label>
        <button class="btn primary small" data-action="bidForPlayer" data-id="${p.id}">제안</button>
      </div>`;
  } else {
    const d = transferDemand(state, club, p);
    box = `
      <p><strong>${p.clubId ? `2단계: 개인 조건 (이적료 ${won(live.fee)} 합의)` : '자유계약: 개인 조건'}</strong> <span class="muted small">${live?.termTries ?? 0}/${MAX_TERM_TRIES}번 실패하면 결렬</span></p>
      <p class="small">선수 요구: 주급 ${won(d.wage)} · ${PROMISES[d.promise].name}</p>
      <div class="form-row">
        <label>주급 (만 원) <input id="termWage" type="number" min="1" step="10" value="${Math.round(d.wage / 1e4)}"></label>
        <label>기간 <select id="termYears">${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${y === 3 ? 'selected' : ''}>${y}년</option>`).join('')}</select></label>
        <label>출전 약속 <select id="termPromise">${Object.entries(PROMISES).map(([k, v]) => `<option value="${k}" ${k === d.promise ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
        <button class="btn primary small" data-action="offerTerms" data-id="${p.id}">제안</button>
      </div>`;
  }
  const body = `
      <p>${posLabel(p.position)} ${esc(POSITIONS[p.position].name)} · ${info.age}세 · ${esc(clubName(state, p.clubId))}</p>
      <p>능력 <strong>${info.overall}</strong> · 잠재 ${potentialText(info)}</p>
      <p class="muted">자리별 능력: ${info.ratings.map((r) => `${r.pos} ${r.rating}`).join(' · ')}</p>
      ${p.contract ? `<p class="small">몸값 약 ${won(value)} · 주급 ${won(p.contract.wage)} · ${formatDate(p.contract.until)}까지</p>` : '<p class="small">소속 구단이 없어 이적료 없이 영입할 수 있습니다.</p>'}
      ${p.transferRequest ? '<p class="error small">이적을 요청한 선수라 조금 싸게 살 수 있습니다.</p>' : ''}
      ${p.injury ? `<p class="error small">부상: ${esc(p.injury.name)} · ${formatDate(p.injury.until)} 복귀 예정</p>` : ''}
      ${playerProfile(state, p)}`;
  const side = `<h4>${p.clubId === club.id ? '받은 제안' : '협상'}</h4><div class="renew">${box}</div>${p.clubId === club.id ? '' : loanBox(state, p)}`;
  return modal({ title: esc(p.name), body, side, close: 'data-action="selectTarget" data-id=""' });
}

// 주전이 아닌 다른 구단 선수는 시즌 끝까지 임대로 데려올 수 있다
function loanBox(state, p) {
  if (!p.clubId || p.loan || !['rotation', 'backup'].includes(p.contract?.promise)) return '';
  return `
    <div class="renew">
      <p><strong>임대로 데려오기</strong> <span class="muted small">시즌 끝까지 · 완전 이적 옵션 약 ${won(loanOptionFee(state, p))}</span></p>
      <div class="form-row">
        <label>우리가 낼 주급 비율 <select id="loanShare">${[0.5, 0.75, 1].map((v) => `<option value="${v}" ${v === 1 ? 'selected' : ''}>${v * 100}%</option>`).join('')}</select></label>
        <button class="btn small" data-action="offerLoan" data-id="${p.id}">임대 제안</button>
      </div>
    </div>`;
}

function loanedOutCard(state, club) {
  const out = (club.loanedOut ?? []).map((id) => state.players[id]).filter(Boolean);
  if (!out.length) return '';
  return `
    <div class="card">
      <h3>임대 보낸 선수</h3>
      <table class="table compact"><tbody>${out.map((p) => `<tr><td>${posLabel(p.position)} ${esc(p.name)}</td>
        <td>${esc(clubName(state, p.clubId))}</td><td class="small">상대 구단이 주급 ${p.loan.wageShare * 100}% 부담</td></tr>`).join('')}</tbody></table>
    </div>`;
}

function listedCard(state, club) {
  const listed = club.squad.map((id) => state.players[id]).filter((p) => p.transferListed || p.transferRequest);
  if (!listed.length) return '';
  return `
    <div class="card">
      <h3>이적 목록 · 이적 요청</h3>
      <table class="table compact"><tbody>${listed.map((p) => `<tr><td>${posLabel(p.position)} ${esc(p.name)}</td>
        <td>${p.transferRequest ? '<span class="tag red">이적 요청</span>' : '<span class="tag">이적 목록</span>'}</td>
        <td>${p.transferListed ? `<button class="btn small" data-action="toggleListed" data-id="${p.id}">목록에서 내리기</button>` : ''}</td></tr>`).join('')}</tbody></table>
    </div>`;
}
