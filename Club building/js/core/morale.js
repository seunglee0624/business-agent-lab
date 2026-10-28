// 간단한 사기 (0~100): 매달 출전 시간(계약 약속 대비), 주급 비교, 숙소·전용기, 팀 성적으로 변한다.
// 면담과 성격은 5단계에서 넣는다.

import { PROMISES } from '../data/economy.js';
import { overall } from './player.js';
import { addMessage } from './state.js';
import { withParticle } from './korean.js';

export const UNHAPPY = 25; // 이보다 낮은 달이 3번 이어지면 이적을 요청한다
export const CONTENT = 45; // 이 이상으로 회복하면 요청을 거둔다

// 경기력 보정: 사기 0 → 0.97, 60 → 1.0, 100 → 1.02
export const moraleFactor = (morale = 60) => 0.97 + morale * 0.0005;

// 지난달 구단별 경기 수와 승점
function monthTally(state, from, to) {
  const tally = new Map();
  const add = (id, pts) => {
    const t = tally.get(id) ?? { games: 0, points: 0 };
    t.games++;
    t.points += pts;
    tally.set(id, t);
  };
  for (const comp of Object.values(state.competitions)) {
    for (const f of comp.fixtures) {
      if (!f.result || f.date < from || f.date >= to) continue;
      const { home, away } = f.result;
      add(f.home, home > away ? 3 : home === away ? 1 : 0);
      add(f.away, away > home ? 3 : home === away ? 1 : 0);
    }
  }
  return tally;
}

// 매달 1일, 성장 계산(출장 시간 초기화) 전에 부른다
export function monthlyMorale(state, prevMonthStart) {
  const tally = monthTally(state, prevMonthStart, state.date);
  const userId = state.user?.clubId;
  for (const club of Object.values(state.clubs)) {
    if (club.status !== 'active') continue;
    const t = tally.get(club.id);
    const squad = club.squad.map((id) => state.players[id]);
    const facilities = (club.facilities.housing + club.facilities.jet - 6) * 2;
    const form = t ? (t.points / t.games - 1.4) * 6 : 0;
    for (const p of squad) {
      let target = 60 + facilities + form;
      if (t && !p.injury) {
        const expected = PROMISES[p.contract?.promise ?? 'backup'].share * t.games * 90;
        const played = p.minutesMonth ?? 0;
        target += played >= expected * 0.7 ? 8 : -Math.min(25, ((expected - played) / Math.max(1, expected)) * 30);
      }
      const peers = squad.filter((q) => q !== p && q.contract && Math.abs(overall(q) - overall(p)) <= 3);
      if (p.contract && peers.length) {
        const ratio = p.contract.wage / (peers.reduce((s, q) => s + q.contract.wage, 0) / peers.length);
        target += ratio < 0.7 ? -8 : ratio > 1.3 ? 3 : 0;
      }
      p.morale = Math.round(Math.max(0, Math.min(100, p.morale + (target - p.morale) * 0.4)));
      updateRequest(state, p, club.id === userId);
    }
  }
}

function updateRequest(state, p, isUser) {
  p.unhappyMonths = p.morale < UNHAPPY ? (p.unhappyMonths ?? 0) + 1 : 0;
  if (!p.transferRequest && p.unhappyMonths >= 3) {
    p.transferRequest = true;
    if (isUser) addMessage(state, { title: `${p.name} 이적 요청`, body: `${withParticle(p.name, '가')} 출전 시간과 대우에 불만을 품고 이적을 요청했습니다. (사기 ${p.morale})`, important: true });
  } else if (p.transferRequest && p.morale >= CONTENT) {
    p.transferRequest = false;
    if (isUser) addMessage(state, { title: `${p.name} 이적 요청 철회`, body: `${withParticle(p.name, '가')} 마음을 돌려 팀에 남겠다고 합니다.` });
  }
}

export function moraleLabel(m) {
  return m >= 80 ? '최고' : m >= 60 ? '좋음' : m >= 40 ? '보통' : m >= UNHAPPY ? '나쁨' : '최악';
}
