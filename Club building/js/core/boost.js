// 구단 키우기 보정: 단장이 맡은 구단에만 늘 적용된다. 다른 구단 규칙과 경기 엔진은 그대로다
// wage: 선수 주급 요구 배율, rep: 기대 이상 성적일 때 평판 추가 상승 배율, youth: 유스 입단 잠재력 보정,
// income: 구단이 직접 버는 수입(입장·스폰서·굿즈·대관) 배율. 중계권·상금은 리그가 나눠 주므로 그대로
export const USER_BOOST = { wage: 0.9, rep: 1, youth: 3, income: 1.1 };
export const BOOSTED_INCOME = new Set(['gate', 'commercial', 'merch', 'rental']);
const NONE = { wage: 1, rep: 0, youth: 0, income: 1 };

export const boostFor = (state, club) => (club && club.id === state.user?.clubId ? USER_BOOST : NONE);

// 기대 순위보다 잘한 만큼 평판이 더 오른다 (3계단 이상 +1, 8계단 이상 +2). 내려가지는 않는다
export function userReputationGain(state, club, expected, position) {
  const d = expected - position;
  const base = d >= 8 ? 2 : d >= 3 ? 1 : 0;
  return Math.round(base * boostFor(state, club).rep);
}
