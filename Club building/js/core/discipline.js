// 카드 누적과 출전 정지. 대회별로 따로 센다.
// discipline[competitionId][playerId] = { yellows, ban }

export const YELLOW_LIMIT = 5;
export const BAN = { secondYellow: 1, red: 2, accumulation: 1 };

function record(discipline, compId, playerId) {
  discipline[compId] ??= {};
  return (discipline[compId][playerId] ??= { yellows: 0, ban: 0 });
}

export function unavailableFor(discipline, compId) {
  const set = new Set();
  for (const [pid, r] of Object.entries(discipline[compId] ?? {})) if (r.ban > 0) set.add(pid);
  return set;
}

// 경기가 끝난 뒤 호출한다.
// squadIds: 두 구단의 전체 선수. 이 경기를 징계로 쉰 선수는 정지가 1경기 줄어든다.
// 돌려주는 값: 새로 생긴 출전 정지 목록 [{ playerId, games, reason }]
export function applyMatchDiscipline(discipline, compId, squadIds, matchStats) {
  for (const pid of squadIds) {
    const r = discipline[compId]?.[pid];
    if (r && r.ban > 0 && !matchStats[pid]?.minutes) r.ban--;
  }

  const newBans = [];
  for (const [pid, st] of Object.entries(matchStats)) {
    if (!st.yellow && !st.red) continue;
    const r = record(discipline, compId, pid);
    if (st.secondYellow) {
      r.ban += BAN.secondYellow;
      newBans.push({ playerId: pid, games: BAN.secondYellow, reason: 'secondYellow' });
      continue;
    }
    if (st.yellow) {
      r.yellows += st.yellow;
      if (r.yellows >= YELLOW_LIMIT) {
        r.yellows -= YELLOW_LIMIT;
        r.ban += BAN.accumulation;
        newBans.push({ playerId: pid, games: BAN.accumulation, reason: 'accumulation' });
      }
    }
    if (st.red) {
      r.ban += BAN.red;
      newBans.push({ playerId: pid, games: BAN.red, reason: 'red' });
    }
  }
  return newBans;
}

// 시즌이 끝나면 누적 경고를 초기화한다 (남은 출전 정지는 유지)
export function resetSeasonYellows(discipline) {
  for (const comp of Object.values(discipline)) {
    for (const r of Object.values(comp)) r.yellows = 0;
  }
}
