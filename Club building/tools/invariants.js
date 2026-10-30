// 게임 상태가 늘 지켜야 하는 규칙. 장기 측정(longrun CHECK=1)에서 매주 검사해 깨지는 순간을 잡는다
// check(state) → [{ rule, detail }]
import { overall } from '../js/core/player.js';
import { registeredCount, MAX_SQUAD } from '../js/core/season.js';

const bad = (x) => typeof x !== 'number' || !Number.isFinite(x);

export function check(state) {
  const out = [];
  const v = (rule, detail) => out.push({ rule, detail });
  const owner = new Map();
  const userId = state.user?.clubId;

  for (const c of Object.values(state.clubs)) {
    if (c.status !== 'active') continue;
    const f = c.finance;
    for (const k of ['balance', 'transferBudget', 'wageBudget']) if (bad(f[k])) v(`재정 값이 숫자가 아님: ${k}`, c.name);
    for (const side of ['income', 'expense']) for (const [k, x] of Object.entries(f.season[side])) if (bad(x)) v(`장부 값이 숫자가 아님: ${side}.${k}`, c.name);
    if (f.transferBudget > Math.max(0, f.balance) + 1) v('이적 예산이 잔고보다 큼', `${c.name} ${f.transferBudget} > ${f.balance}`);
    if (f.transferBudget < 0) v('이적 예산이 음수', c.name);
    if (f.wageBudget < 0) v('주급 예산이 음수', c.name);

    for (const [list, ids] of [['squad', c.squad], ['youth', c.youth]]) {
      for (const id of ids) {
        const p = state.players[id];
        if (!p) { v(`없는 선수가 ${list}에 있음`, `${c.name} ${id}`); continue; }
        if (owner.has(id)) v('한 선수가 두 곳에 소속', `${p.name}: ${owner.get(id)} / ${c.name}.${list}`);
        owner.set(id, `${c.name}.${list}`);
        if (p.clubId !== c.id) v('선수 소속(clubId)과 명단이 다름', `${p.name} clubId=${p.clubId} 명단=${c.name}.${list}`);
        if (p.retired) v('은퇴한 선수가 명단에 있음', `${p.name} ${c.name}`);
        if (list === 'squad' && !p.contract) v('1군 선수에게 계약이 없음', `${p.name} ${c.name}`);
        if (p.contract && (bad(p.contract.wage) || p.contract.wage <= 0)) v('계약 주급이 이상함', `${p.name} ${p.contract.wage}`);
        if (p.contract && p.contract.until < state.date) v('만료된 계약으로 뛰는 선수', `${p.name} ${c.name} ${p.contract.until}`);
        if (p.loan && !state.clubs[p.loan.from]) v('임대 원소속 구단이 없음', p.name);
      }
    }
    if (c.id === userId && registeredCount(state, c, state.date) > MAX_SQUAD) v('내 구단 1군 등록 인원 초과', `${registeredCount(state, c, state.date)}명`);
    if (c.squad.length < 11) v('1군이 11명보다 적음', `${c.name} ${c.squad.length}명`);
    for (const id of c.loanedOut ?? []) {
      const p = state.players[id];
      if (!p || p.loan?.from !== c.id) v('임대 보낸 목록과 선수 임대 정보가 다름', `${c.name} ${p?.name ?? id}`);
    }
    if (c.fans) {
      if (bad(c.fans.satisfaction) || c.fans.satisfaction < 0 || c.fans.satisfaction > 100) v('팬 만족도 범위 밖', `${c.name} ${c.fans.satisfaction}`);
      if (bad(c.fans.overseas) || c.fans.overseas < 0) v('해외 팬 수 이상', `${c.name} ${c.fans.overseas}`);
    }
    if (bad(c.reputation) || c.reputation < 1 || c.reputation > 99) v('평판 범위 밖', `${c.name} ${c.reputation}`);
  }

  for (const p of Object.values(state.players)) {
    if (p.retired) continue;
    if (p.clubId && !owner.has(p.id) && state.clubs[p.clubId]?.status === 'active') v('소속 구단 명단에 없는 선수', `${p.name} clubId=${p.clubId}`);
    for (const [k, x] of Object.entries(p.attrs)) if (bad(x) || x < 1 || x > 20) v('능력치 범위 밖', `${p.name} ${k}=${x}`);
    const o = overall(p);
    if (bad(o)) v('종합 능력이 숫자가 아님', p.name);
    if (p.potential < o) v('잠재력이 현재 능력보다 낮음', `${p.name} ${p.potential} < ${o}`);
  }

  for (const comp of Object.values(state.competitions)) {
    const seen = new Map();
    for (const fx of comp.fixtures) {
      if (fx.result && fx.date > state.date) v('미래 경기에 결과가 있음', `${comp.id} ${fx.date}`);
      if (!fx.result && fx.date < state.date) v('지난 경기에 결과가 없음', `${comp.id} ${fx.date} ${fx.id}`);
      for (const id of [fx.home, fx.away]) {
        const key = `${fx.date}|${id}`;
        if (seen.has(key)) v('한 구단이 같은 날 두 경기', key);
        seen.set(key, true);
      }
    }
  }

  for (const id of Object.keys(state.transfers?.deals ?? {})) if (!state.players[id]) v('협상 목록에 없는 선수', id);
  return out;
}
