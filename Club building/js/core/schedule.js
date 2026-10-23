// 리그 대진 생성 (홈·원정 더블 라운드 로빈)

// 서클 방식으로 한 바퀴 대진을 만든다. 팀 수는 짝수여야 한다.
function singleRoundRobin(teamIds) {
  const n = teamIds.length;
  const fixed = teamIds[0];
  let rotating = teamIds.slice(1);
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const order = [fixed, ...rotating];
    const matches = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      // 고정 팀은 라운드마다 홈·원정을 번갈아 하고, 나머지는 위치로 정한다
      if (i === 0) matches.push(r % 2 === 0 ? [a, b] : [b, a]);
      else matches.push(i % 2 === 1 ? [b, a] : [a, b]);
    }
    rounds.push(matches);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

// dates: 라운드 수(2 × (팀 수 - 1))만큼의 경기일
export function generateLeagueFixtures(rng, competitionId, clubIds, dates) {
  const teams = rng.shuffle(clubIds);
  const firstHalf = singleRoundRobin(teams);
  const secondHalf = firstHalf.map((matches) => matches.map(([h, a]) => [a, h]));
  const rounds = [...firstHalf, ...secondHalf];
  if (dates.length < rounds.length) throw new Error(`경기일이 부족합니다: ${dates.length} < ${rounds.length}`);

  const fixtures = [];
  rounds.forEach((matches, r) => {
    matches.forEach(([home, away], i) => {
      fixtures.push({
        id: `${competitionId}-r${r + 1}-${i + 1}`,
        competitionId,
        round: r + 1,
        date: dates[r],
        home,
        away,
        result: null,
      });
    });
  });
  return fixtures;
}
