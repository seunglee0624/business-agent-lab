// 감독 화면: 지금 감독, 해고, 후보와 고용

import { userClub, managerCandidates, firingCost, positionNeeds, transferRequests } from '../core/game.js';
import { COACH_STYLES } from '../core/coaches.js';
import { NATIONS } from '../data/nations.js';
import { formatDate } from '../core/calendar.js';
import { esc, won, modal } from './format.js';
import { teamTacticsCard } from './views.js';

export function managerView(state, ui) {
  const club = userClub(state);
  const coach = club.headCoach;
  const list = managerCandidates(state).sort((a, b) => b.ability - a.ability);
  return `
    ${ui.managerMsg ? `<p class="${ui.managerMsg.ok ? 'good' : 'error'}">${esc(ui.managerMsg.text)}</p>` : ''}
    <div class="card">
      <h3>지금 감독</h3>
      ${coach ? `
        <table class="table compact"><tbody>
          <tr><td>이름</td><td><strong>${esc(coach.name)}</strong> <span class="muted small">${esc(NATIONS[coach.nation]?.name ?? '')}</span></td></tr>
          <tr><td>능력</td><td>${coach.ability} / 20</td></tr>
          <tr><td>성향</td><td>${esc(COACH_STYLES[coach.style].name)}</td></tr>
          <tr><td>주급</td><td>${won(coach.wage)}</td></tr>
          <tr><td>계약</td><td>${formatDate(coach.until)}까지</td></tr>
        </tbody></table>
        <p><button class="btn danger small" data-action="fireManager">해고하기 (위약금 ${won(firingCost(state))})</button></p>
        <p class="muted small">해고하면 남은 계약 주급의 절반을 위약금으로 냅니다. 새 감독을 뽑을 때까지는 코치가 임시로 팀을 맡습니다.</p>`
      : '<p class="error">감독 자리가 비어 있습니다. 아래 후보 중에서 고르세요. 그동안 코치가 임시로 팀을 맡습니다.</p>'}
    </div>
    ${teamTacticsCard(state)}
    ${needsCard(state, ui)}
    <div class="card">
      <h3>감독 후보</h3>
      <p class="muted small">능력이 높을수록 선수 성장과 경기 운영이 좋아지고 주급이 비쌉니다. 구단 평판보다 너무 뛰어난 감독은 오지 않습니다.</p>
      <table class="table"><thead><tr><th>이름</th><th>능력</th><th>성향</th><th class="num">주급</th><th></th></tr></thead><tbody>
        ${list.map((c) => `<tr><td>${esc(c.name)} <span class="muted small">${esc(NATIONS[c.nation]?.name ?? '')}</span></td><td>${c.ability}</td><td>${esc(COACH_STYLES[c.style].name)}</td>
          <td class="num">${won(c.wage)}</td>
          <td>${c.willing ? `<button class="btn primary small" data-action="hireManager" data-id="${c.id}" ${coach ? 'disabled title="먼저 지금 감독을 해고해야 합니다"' : ''}>2년 계약</button>` : '<span class="muted small">오지 않음</span>'}</td></tr>`).join('')}
      </tbody></table>
    </div>`;
}

// 포지션 진단과 추천 선수 요구: 문제 있는 자리만 칸으로 보여 주고, 칸을 누르면 전체 진단을 연다
const NEED_LABEL = { short: ['error', '인원 부족'], weak: ['error', '보강 필요'], ok: ['good', '괜찮음'] };
function needsCard(state, ui) {
  const club = userClub(state);
  const needs = positionNeeds(state);
  const lacking = needs.filter((n) => n.status !== 'ok');
  const tile = (n) => {
    const [cls, label] = NEED_LABEL[n.status];
    return `<button class="need-tile" data-action="openNeeds" data-open="1"><strong>${esc(n.name)}</strong><span class="${cls}">${label}</span><span class="muted small">${n.count}/${n.want}명 · 최고 ${n.best || '-'}</span></button>`;
  };
  const tiles = lacking.length ? lacking.map(tile).join('') : '<button class="need-tile" data-action="openNeeds" data-open="1"><strong>모든 자리</strong><span class="good">괜찮음</span><span class="muted small">전체 진단 보기</span></button>';
  const reqs = transferRequests(state).length;
  return `
    <div class="card">
      <h3>선수단 진단</h3>
      <p>${club.headCoach ? `${esc(club.headCoach.name)} 감독` : '임시 코치'}: ${lacking.length ? `${lacking.map((n) => esc(n.name)).join(', ')} 자리를 보강하고 싶습니다.` : '지금 선수단으로 충분합니다.'}</p>
      <div class="need-tiles">${tiles}</div>
      <p><button class="btn primary small" data-action="askCoach" ${club.headCoach ? '' : 'disabled'}>추천 선수 요구</button>
        ${reqs ? `<span class="small">지금 감독의 영입 요청 ${reqs}명 · <button class="link" data-action="nav" data-view="transfers">이적 탭에서 승인</button></span>` : ''}</p>
    </div>
    ${ui.needsOpen ? needsModal(needs) : ''}`;
}

function needsModal(needs) {
  const rows = needs.map((n) => {
    const [cls, label] = NEED_LABEL[n.status];
    return `<tr><td>${esc(n.name)}</td><td class="num ${n.count < n.want ? 'error' : ''}">${n.count}/${n.want}</td><td class="num">${n.best || '-'}</td><td class="num">${n.injured || ''}</td><td class="${cls}">${label}</td></tr>`;
  }).join('');
  const body = `
    <table class="table compact"><thead><tr><th>포지션</th><th class="num">인원/권장</th><th class="num">최고 능력</th><th class="num">부상</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">추천 선수 요구는 일주일에 한 번 할 수 있습니다. 이적시장이 닫혀 있을 때는 다음 시장까지 유효한 요청으로 올라갑니다. 감독이 약한 자리부터, 이적 예산 안에서 지금 선수보다 나은 후보를 최대 3명 골라 영입 요청에 올립니다. 자유계약 선수도 후보에 들고, 비슷하면 이적료가 없는 자유계약 선수를 먼저 고릅니다.</p>`;
  return modal({ title: '선수단 전체 진단', body, close: 'data-action="openNeeds" data-open=""' });
}
