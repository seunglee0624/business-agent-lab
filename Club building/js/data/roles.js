// 포지션별 역할. 경기 엔진은 역할의 기여도로 팀 전력을 계산한다.
//   defend: 수비 기여, control: 중원 장악, create: 기회 창출, finish: 마무리 기여
//   shot: 슈팅을 가져갈 비중, assist: 도움을 줄 비중
// 기여도는 0~1 범위. 같은 포지션 안에서 역할끼리 총합이 비슷하도록 맞춘다.

export const ROLES = {
  goalkeeper: { name: '골키퍼', positions: ['GK'], defend: 1, control: 0.1, create: 0, finish: 0, shot: 0, assist: 0.02 },
  sweeperKeeper: { name: '스위퍼 키퍼', positions: ['GK'], defend: 0.9, control: 0.25, create: 0.05, finish: 0, shot: 0, assist: 0.05 },

  centreBack: { name: '수비수', positions: ['CB'], defend: 1, control: 0.2, create: 0.05, finish: 0.1, shot: 0.15, assist: 0.05 },
  ballPlayingDefender: { name: '볼 플레잉 수비수', positions: ['CB'], defend: 0.85, control: 0.4, create: 0.15, finish: 0.05, shot: 0.1, assist: 0.15 },

  fullBack: { name: '풀백', positions: ['LB', 'RB'], defend: 0.8, control: 0.3, create: 0.3, finish: 0, shot: 0.1, assist: 0.4 },
  wingBack: { name: '윙백', positions: ['LB', 'RB'], defend: 0.55, control: 0.35, create: 0.55, finish: 0.05, shot: 0.15, assist: 0.6 },

  anchor: { name: '홀딩 미드필더', positions: ['DM'], defend: 0.85, control: 0.6, create: 0.1, finish: 0, shot: 0.15, assist: 0.15 },
  deepLyingPlaymaker: { name: '딥라잉 플레이메이커', positions: ['DM', 'CM'], defend: 0.5, control: 0.85, create: 0.45, finish: 0, shot: 0.2, assist: 0.5 },

  boxToBox: { name: '박스투박스', positions: ['CM'], defend: 0.5, control: 0.7, create: 0.35, finish: 0.25, shot: 0.45, assist: 0.35 },
  ballWinner: { name: '볼 위닝 미드필더', positions: ['CM', 'DM'], defend: 0.8, control: 0.6, create: 0.15, finish: 0.05, shot: 0.2, assist: 0.2 },
  playmaker: { name: '플레이메이커', positions: ['CM', 'AM'], defend: 0.25, control: 0.8, create: 0.75, finish: 0.15, shot: 0.35, assist: 0.8 },

  attackingMidfielder: { name: '공격형 미드필더', positions: ['AM'], defend: 0.15, control: 0.55, create: 0.75, finish: 0.4, shot: 0.6, assist: 0.7 },
  shadowStriker: { name: '섀도 스트라이커', positions: ['AM'], defend: 0.1, control: 0.35, create: 0.5, finish: 0.75, shot: 0.9, assist: 0.45 },

  wideMidfielder: { name: '측면 미드필더', positions: ['LM', 'RM'], defend: 0.45, control: 0.45, create: 0.55, finish: 0.2, shot: 0.35, assist: 0.55 },
  winger: { name: '윙어', positions: ['LM', 'RM', 'LW', 'RW'], defend: 0.2, control: 0.3, create: 0.8, finish: 0.3, shot: 0.45, assist: 0.8 },
  insideForward: { name: '인사이드 포워드', positions: ['LW', 'RW'], defend: 0.15, control: 0.3, create: 0.5, finish: 0.7, shot: 0.85, assist: 0.45 },

  targetMan: { name: '타깃맨', positions: ['ST'], defend: 0.1, control: 0.3, create: 0.35, finish: 0.85, shot: 1, assist: 0.4 },
  poacher: { name: '포처', positions: ['ST'], defend: 0.05, control: 0.1, create: 0.15, finish: 1, shot: 1.2, assist: 0.2 },
  advancedForward: { name: '어드밴스드 포워드', positions: ['ST'], defend: 0.1, control: 0.25, create: 0.4, finish: 0.9, shot: 1.05, assist: 0.35 },
};

// 포지션별 기본 역할 (자동 선발 시 사용)
export const DEFAULT_ROLE = {
  GK: 'goalkeeper',
  CB: 'centreBack',
  LB: 'fullBack',
  RB: 'fullBack',
  DM: 'anchor',
  CM: 'boxToBox',
  LM: 'wideMidfielder',
  RM: 'wideMidfielder',
  AM: 'attackingMidfielder',
  LW: 'winger',
  RW: 'winger',
  ST: 'advancedForward',
};

export function rolesForPosition(pos) {
  return Object.entries(ROLES)
    .filter(([, r]) => r.positions.includes(pos))
    .map(([key]) => key);
}
