// 포메이션 그림: 자리(포지션) 목록을 경기장 위 좌표로 바꿔 선수 칸을 배치한다.

// 위(공격)에서 아래(골키퍼)로 0~100
const Y = { ST: 11, LW: 21, RW: 21, AM: 32, LM: 45, RM: 45, CM: 48, DM: 61, LB: 72, RB: 72, CB: 77, GK: 91 };
// 측면 자리는 고정, 가운데 자리는 같은 포지션끼리 고르게 나눈다
const SIDE_X = { LB: 9, LM: 9, LW: 13, RB: 91, RM: 91, RW: 87 };

function spread(n) {
  if (n === 1) return [50];
  if (n === 2) return [34, 66];
  return Array.from({ length: n }, (_, i) => 30 + (40 * i) / (n - 1));
}

export function pitchLayout(positions) {
  const groups = {};
  positions.forEach((pos, i) => {
    if (!(pos in SIDE_X)) (groups[pos] ??= []).push(i);
  });
  const xs = [];
  for (const idx of Object.values(groups)) spread(idx.length).forEach((x, k) => { xs[idx[k]] = x; });
  return positions.map((pos, i) => ({ x: SIDE_X[pos] ?? xs[i], y: Y[pos] }));
}

// spots: [{ pos, html, cls }]
export function pitchHtml(spots) {
  const at = pitchLayout(spots.map((s) => s.pos));
  return `<div class="pitch">
    <div class="pitch-mark half"></div><div class="pitch-mark circle"></div>
    <div class="pitch-mark box top"></div><div class="pitch-mark box bottom"></div>
    ${spots.map((s, i) => `<div class="spot ${s.cls ?? ''}" style="left:${at[i].x}%;top:${at[i].y}%">${s.html}</div>`).join('')}
  </div>`;
}

// 경기장 칸에는 성만 쓴다 ("해리 스미스" → "스미스")
export function shortName(name) {
  const parts = String(name).trim().split(/\s+/);
  return parts[parts.length - 1];
}
