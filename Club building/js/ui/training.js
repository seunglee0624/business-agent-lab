// 훈련·위임 화면

import { userClub } from '../core/game.js';
import { TRAINING_FOCUS, TRAINING_INTENSITY, trainingOf } from '../core/training.js';
import { DELEGATION_AREAS, delegationOf } from '../core/delegation.js';
import { esc } from './format.js';

const STAFF_NAME = { coach: '코치', youthCoach: '유스 코치' };

export function trainingView(state) {
  const club = userClub(state);
  const t = trainingOf(club);
  const del = delegationOf(club);
  const byCoach = del.training === 'staff';
  const options = (table, current) => Object.entries(table).map(([k, v]) => `<option value="${k}" ${k === current ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  return `
    <div class="grid two">
      <div class="card">
        <h3>팀 훈련</h3>
        <div class="form-row">
          <label>중점 <select data-change="setTraining" data-key="focus">${options(TRAINING_FOCUS, t.focus)}</select></label>
          <label>강도 <select data-change="setTraining" data-key="intensity">${options(TRAINING_INTENSITY, t.intensity)}</select></label>
        </div>
        <p class="muted small">중점으로 고른 능력치가 더 빨리 큽니다. 강하게 하면 성장이 빠르지만 회복이 느리고 훈련 중 부상이 늘어납니다.</p>
        ${byCoach ? `<p class="small">지금은 코치(수준 ${club.staff.coach})가 정하고 있습니다. 직접 고르면 훈련 위임이 꺼집니다.</p>` : ''}
      </div>
      <div class="card">
        <h3>위임</h3>
        <table class="table compact"><tbody>${Object.entries(DELEGATION_AREAS).map(([area, a]) => `<tr>
          <td>${esc(a.name)}</td>
          <td><select data-change="setDelegation" data-area="${area}">
            <option value="staff" ${del[area] === 'staff' ? 'selected' : ''}>${STAFF_NAME[a.staff]}에게 맡김 (수준 ${club.staff[a.staff]})</option>
            <option value="manager" ${del[area] === 'manager' ? 'selected' : ''}>직접</option>
          </select></td></tr>`).join('')}</tbody></table>
        <p class="muted small">맡긴 분야는 스태프가 매주 처리하고, 결과는 월요일 주간 요약으로 알려 줍니다. 스태프 수준이 높을수록 판단이 정확합니다.</p>
      </div>
    </div>`;
}
