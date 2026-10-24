// 리그 순위표

function emptyRow(clubId) {
  return { clubId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0, form: [] };
}

// 끝난 경기들로 순위표를 만든다. 동률이면 rule.tiebreakers 순서, 그래도 같으면 구단 id 순
export function computeStandings(fixtures, clubIds, rule) {
  const rows = Object.fromEntries(clubIds.map((id) => [id, emptyRow(id)]));
  const played = fixtures.filter((f) => f.result).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const f of played) {
    const h = rows[f.home];
    const a = rows[f.away];
    const { home: hg, away: ag } = f.result;
    h.played++;
    a.played++;
    h.goalsFor += hg;
    h.goalsAgainst += ag;
    a.goalsFor += ag;
    a.goalsAgainst += hg;
    if (hg > ag) {
      h.won++; a.lost++;
      h.form.push('W'); a.form.push('L');
    } else if (hg < ag) {
      a.won++; h.lost++;
      a.form.push('W'); h.form.push('L');
    } else {
      h.drawn++; a.drawn++;
      h.form.push('D'); a.form.push('D');
    }
  }

  for (const r of Object.values(rows)) {
    r.goalDiff = r.goalsFor - r.goalsAgainst;
    r.points = r.won * rule.points.win + r.drawn * rule.points.draw + r.lost * rule.points.loss;
    r.form = r.form.slice(-5);
  }

  return Object.values(rows).sort((x, y) => {
    for (const key of rule.tiebreakers) {
      if (x[key] !== y[key]) return y[key] - x[key];
    }
    return x.clubId < y.clubId ? -1 : 1;
  });
}
