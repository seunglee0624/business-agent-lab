// 감독 화면: 지금 감독, 해고, 후보와 고용

import { userClub, managerCandidates, firingCost } from '../core/game.js';
import { COACH_STYLES } from '../core/coaches.js';
import { NATIONS } from '../data/nations.js';
import { formatDate } from '../core/calendar.js';
import { esc, won } from './format.js';
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
