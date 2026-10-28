// 팀 훈련: 중점(어떤 능력치를 더 키울지)과 강도(성장 속도 ↔ 피로·부상)

export const TRAINING_FOCUS = {
  balanced: { name: '균형', keys: [] },
  attack: { name: '공격', keys: ['finishing', 'longShots', 'dribbling', 'offTheBall', 'crossing'] },
  defense: { name: '수비', keys: ['tackling', 'marking', 'positioning', 'heading'] },
  physical: { name: '체력', keys: ['pace', 'stamina', 'strength', 'workRate'] },
  tactical: { name: '전술', keys: ['passing', 'vision', 'composure', 'positioning'] },
  setPieces: { name: '세트피스', keys: ['crossing', 'heading', 'longShots', 'composure'] },
};

// growth: 성장 배율, injury: 훈련 부상 배율, recovery: 하루 컨디션 회복 배율
export const TRAINING_INTENSITY = {
  light: { name: '가볍게', growth: 0.8, injury: 0.6, recovery: 1.15 },
  normal: { name: '보통', growth: 1, injury: 1, recovery: 1 },
  hard: { name: '강하게', growth: 1.3, injury: 1.6, recovery: 0.85 },
};

export const DEFAULT_TRAINING = { focus: 'balanced', intensity: 'normal' };

const FOCUS_BOOST = 1.8;
const OTHER_CUT = 0.8;

export const trainingOf = (club) => club.training ?? DEFAULT_TRAINING;
export const intensityOf = (club) => TRAINING_INTENSITY[trainingOf(club).intensity];

// 성장분을 능력치마다 얼마나 더(덜) 줄지. 균형이면 null
export function focusBoost(club) {
  const keys = TRAINING_FOCUS[trainingOf(club).focus].keys;
  if (!keys.length) return null;
  const set = new Set(keys);
  return (key) => (set.has(key) ? FOCUS_BOOST : OTHER_CUT);
}

export function setTraining(club, { focus, intensity }) {
  if (!TRAINING_FOCUS[focus]) return { ok: false, reason: '없는 훈련 중점입니다.' };
  if (!TRAINING_INTENSITY[intensity]) return { ok: false, reason: '없는 훈련 강도입니다.' };
  club.training = { focus, intensity };
  return { ok: true };
}
