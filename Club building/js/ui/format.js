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

// 금액(원) 표시: "1,520억 원", "3억 2,000만 원", "4,500만 원"
export function won(amount) {
  const sign = amount < 0 ? '-' : '';
  const a = Math.round(Math.abs(amount));
  const n = (x) => x.toLocaleString('ko-KR');
  if (a >= 1e10) return `${sign}${n(Math.round(a / 1e8))}억 원`;
  if (a >= 1e8) {
    let eok = Math.floor(a / 1e8);
    let man = Math.round((a % 1e8) / 1e6) * 100;
    if (man >= 10000) {
      eok++;
      man = 0;
    }
    return `${sign}${eok}억${man ? ` ${n(man)}만` : ''} 원`;
  }
  if (a >= 1e4) return `${sign}${n(Math.round(a / 1e4))}만 원`;
  return `${sign}${n(a)}원`;
}
