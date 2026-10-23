// 능력치(1~20)와 포지션 정의

export const ATTRIBUTES = [
  { key: 'finishing', name: '마무리', group: 'technical' },
  { key: 'longShots', name: '중거리', group: 'technical' },
  { key: 'passing', name: '패스', group: 'technical' },
  { key: 'crossing', name: '크로스', group: 'technical' },
  { key: 'dribbling', name: '드리블', group: 'technical' },
  { key: 'heading', name: '헤더', group: 'technical' },
  { key: 'tackling', name: '태클', group: 'technical' },
  { key: 'marking', name: '마킹', group: 'technical' },
  { key: 'vision', name: '시야', group: 'mental' },
  { key: 'positioning', name: '위치 선정', group: 'mental' },
  { key: 'composure', name: '침착성', group: 'mental' },
  { key: 'offTheBall', name: '오프 더 볼', group: 'mental' },
  { key: 'workRate', name: '활동량', group: 'mental' },
  { key: 'leadership', name: '리더십', group: 'mental' },
  { key: 'pace', name: '속도', group: 'physical' },
  { key: 'stamina', name: '체력', group: 'physical' },
  { key: 'strength', name: '몸싸움', group: 'physical' },
  { key: 'reflexes', name: '반응 속도', group: 'goalkeeping' },
  { key: 'handling', name: '핸들링', group: 'goalkeeping' },
  { key: 'oneOnOne', name: '일대일', group: 'goalkeeping' },
];

export const ATTRIBUTE_KEYS = ATTRIBUTES.map((a) => a.key);
export const GK_ATTRIBUTE_KEYS = ['reflexes', 'handling', 'oneOnOne'];

export const POSITIONS = {
  GK: { name: '골키퍼', line: 'gk' },
  CB: { name: '센터백', line: 'def' },
  LB: { name: '왼쪽 풀백', line: 'def' },
  RB: { name: '오른쪽 풀백', line: 'def' },
  DM: { name: '수비형 미드필더', line: 'mid' },
  CM: { name: '중앙 미드필더', line: 'mid' },
  LM: { name: '왼쪽 미드필더', line: 'mid' },
  RM: { name: '오른쪽 미드필더', line: 'mid' },
  AM: { name: '공격형 미드필더', line: 'mid' },
  LW: { name: '왼쪽 윙어', line: 'att' },
  RW: { name: '오른쪽 윙어', line: 'att' },
  ST: { name: '스트라이커', line: 'att' },
};

export const POSITION_KEYS = Object.keys(POSITIONS);

// 포지션별 종합 능력치 계산에 쓰는 가중치. 적지 않은 능력치는 가중치 0.
export const POSITION_WEIGHTS = {
  GK: { reflexes: 5, handling: 4, oneOnOne: 4, positioning: 3, composure: 2, strength: 1 },
  CB: { tackling: 4, marking: 4, heading: 3, positioning: 4, strength: 3, pace: 2, composure: 2, passing: 1 },
  LB: { tackling: 3, marking: 3, pace: 3, crossing: 2, stamina: 3, positioning: 2, workRate: 2, passing: 1 },
  RB: { tackling: 3, marking: 3, pace: 3, crossing: 2, stamina: 3, positioning: 2, workRate: 2, passing: 1 },
  DM: { tackling: 4, marking: 3, positioning: 4, passing: 3, workRate: 3, stamina: 2, strength: 2, composure: 2 },
  CM: { passing: 4, vision: 3, workRate: 3, stamina: 3, composure: 2, tackling: 2, dribbling: 2, longShots: 1 },
  LM: { crossing: 3, pace: 3, dribbling: 3, stamina: 3, workRate: 2, passing: 2, offTheBall: 1 },
  RM: { crossing: 3, pace: 3, dribbling: 3, stamina: 3, workRate: 2, passing: 2, offTheBall: 1 },
  AM: { passing: 4, vision: 4, dribbling: 3, composure: 2, longShots: 2, offTheBall: 2, finishing: 1 },
  LW: { dribbling: 4, pace: 4, crossing: 2, offTheBall: 2, finishing: 2, composure: 1 },
  RW: { dribbling: 4, pace: 4, crossing: 2, offTheBall: 2, finishing: 2, composure: 1 },
  ST: { finishing: 5, offTheBall: 4, composure: 3, heading: 2, pace: 2, strength: 2, dribbling: 1 },
};

// 다른 포지션에서 뛸 때 효율. 표에 없으면 OTHER_FAMILIARITY.
const RELATED = [
  ['LB', 'RB', 0.85], ['LB', 'LM', 0.8], ['RB', 'RM', 0.8], ['CB', 'DM', 0.8],
  ['CB', 'LB', 0.75], ['CB', 'RB', 0.75], ['DM', 'CM', 0.9], ['CM', 'AM', 0.85],
  ['CM', 'LM', 0.75], ['CM', 'RM', 0.75], ['LM', 'RM', 0.85], ['LM', 'LW', 0.85],
  ['RM', 'RW', 0.85], ['LW', 'RW', 0.85], ['AM', 'ST', 0.8], ['AM', 'LW', 0.75],
  ['AM', 'RW', 0.75], ['ST', 'LW', 0.75], ['ST', 'RW', 0.75],
];
export const OTHER_FAMILIARITY = 0.5;
export const SECONDARY_FAMILIARITY = 0.95;

export function positionFamiliarity(from, to) {
  if (from === to) return 1;
  if (from === 'GK' || to === 'GK') return 0.2;
  for (const [a, b, v] of RELATED) {
    if ((a === from && b === to) || (a === to && b === from)) return v;
  }
  return OTHER_FAMILIARITY;
}

// 주 포지션별로 같이 익히기 쉬운 포지션 (세계 생성 시 가능 포지션 후보)
export const SECONDARY_CANDIDATES = {
  GK: [],
  CB: ['DM', 'RB', 'LB'],
  LB: ['LM', 'RB', 'CB'],
  RB: ['RM', 'LB', 'CB'],
  DM: ['CM', 'CB'],
  CM: ['DM', 'AM'],
  LM: ['LW', 'LB', 'RM'],
  RM: ['RW', 'RB', 'LM'],
  AM: ['CM', 'ST', 'LW', 'RW'],
  LW: ['RW', 'LM', 'AM'],
  RW: ['LW', 'RM', 'AM'],
  ST: ['AM', 'LW', 'RW'],
};
