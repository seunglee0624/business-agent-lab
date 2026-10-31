// 화면 표시용 도우미

import { overall, ageOn } from '../core/player.js';
import { POSITIONS } from '../data/positions.js';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const TIER_NAME = { strong: '강팀', mid: '중위권', weak: '약팀' };

export function badge(club, size = '') {
  return `<span class="badge ${size}" style="--c1:${club.colors.primary};--c2:${club.colors.secondary}"></span>`;
}

export function clubLabel(club, isUser = false) {
  return `${badge(club)}<span class="${isUser ? 'me' : ''}">${esc(club.name)}</span>`;
}

// 능력치 1~20 색상 단계
export function attrClass(v) {
  if (v >= 16) return 'a-high';
  if (v >= 12) return 'a-good';
  if (v >= 8) return 'a-mid';
  return 'a-low';
}

// 종합 능력 1~100 색상 단계
export function ovrClass(v) {
  if (v >= 80) return 'a-high';
  if (v >= 70) return 'a-good';
  if (v >= 60) return 'a-mid';
  return 'a-low';
}

export function ovrCell(player) {
  const v = overall(player);
  return `<span class="ovr ${ovrClass(v)}">${v}</span>`;
}

export function posLabel(pos) {
  return `<span class="pos pos-${POSITIONS[pos].line}" title="${esc(POSITIONS[pos].name)}">${pos}</span>`;
}

export function age(player, date) {
  return ageOn(player, date);
}

export function conditionBar(value) {
  const v = Math.round(value);
  const cls = v >= 85 ? 'good' : v >= 65 ? 'mid' : 'low';
  return `<span class="cond ${cls}" title="컨디션 ${v}%"><span style="width:${v}%"></span></span>`;
}

export function formBadges(form) {
  const map = { W: ['승', 'w'], D: ['무', 'd'], L: ['패', 'l'] };
  return form.map((f) => `<span class="form ${map[f][1]}">${map[f][0]}</span>`).join('');
}

export function avgRating(s) {
  return s && s.ratingCount ? (s.ratingSum / s.ratingCount).toFixed(2) : '-';
}

export { won } from '../core/money.js';

// 목록에서 항목을 누르면 여는 가운데 모달. side를 주면 왼쪽(정보)·오른쪽(할 일) 두 칸
// close: 닫을 때 보낼 data-action 속성 문자열 (예: 'data-action="selectPlayer" data-id=""')
export function modal({ title, body, side = '', close }) {
  return `<div class="modal-bg" ${close}>
    <div class="modal ${side ? 'wide' : ''}" data-stop>
      <div class="card-head"><h3>${title}</h3><button class="btn small" ${close}>닫기 ✕</button></div>
      ${side ? `<div class="modal-cols"><div>${body}</div><div class="modal-side">${side}</div></div>` : body}
    </div>
  </div>`;
}

// 화면 강조색: 단장 구단의 유니폼 색 중 채도가 있는 쪽을 어두운 바탕에서 읽히는 밝기로 맞춘다.
// 흑백 유니폼이면 강조색 없이 밝은 회색
export function clubAccent(club) {
  const hsl = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const sat = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, sat, l];
  };
  const pick = [club.colors.primary, club.colors.secondary].map(hsl).find(([, sat]) => sat >= 0.3);
  if (!pick) return '#c9ced6';
  const [h, sat] = pick;
  return `hsl(${Math.round(h)} ${Math.round(Math.min(sat, 0.7) * 100)}% 62%)`;
}
