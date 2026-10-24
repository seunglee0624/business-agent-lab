// 리그 규칙 만들기. 팀 수에 맞춰 강팀/중위권/약팀 수를 정한다.

const TIER_SPLIT = {
  18: { strong: 3, mid: 9, weak: 6 },
  20: { strong: 3, mid: 10, weak: 7 },
  22: { strong: 4, mid: 11, weak: 7 },
  24: { strong: 4, mid: 12, weak: 8 },
};

// levels: [강팀, 중위권, 약팀] 주전 평균 능력(1~100)
export function leagueRule({ id, country, tier, name, teams, levels }) {
  return {
    id,
    country,
    tier,
    name,
    teams,
    tiers: TIER_SPLIT[teams],
    tierLevel: { strong: levels[0], mid: levels[1], weak: levels[2] },
    points: { win: 3, draw: 1, loss: 0 },
    tiebreakers: ['points', 'goalDiff', 'goalsFor'],
    maxSubs: 5,
    benchSize: 9,
    promoted: 3,
    relegated: 3,
  };
}
