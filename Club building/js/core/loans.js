// 임대: 우리 선수 보내기, 다른 구단 선수 데려오기(주급 분담, 완전 이적 옵션), 시즌 끝 복귀

import { overall, ageOn } from './player.js';
import { marketValue, roundMoney } from './money.js';
import { weeklyWageBill, recordTransfer } from './finance.js';
import { registeredCount, MAX_SQUAD } from './season.js';
import { windowEnd, trimSquad } from './transfers.js';
import { withParticle } from './korean.js';

const seasonEnd = (state) => `${state.season + 1}-06-30`;
// 데려오는 쪽이 내야 하는 주급 비율: 로테이션 선수는 전부, 후보 선수는 75%
const REQUIRED_SHARE = { rotation: 1, backup: 0.75 };
const OPTION_MULT = 1.1;

function move(state, p, from, to, loan) {
  from.squad = from.squad.filter((id) => id !== p.id);
  if (from.tactics.lineup?.some((e) => e?.playerId === p.id)) from.tactics.lineup = null;
  to.squad.push(p.id);
  p.clubId = to.id;
  p.transferListed = false;
  if (loan) {
    p.loan = loan;
    (state.clubs[loan.from].loanedOut ??= []).includes(p.id) || state.clubs[loan.from].loanedOut.push(p.id);
  }
}

const unloan = (state, p) => {
  const owner = state.clubs[p.loan.from];
  owner.loanedOut = (owner.loanedOut ?? []).filter((id) => id !== p.id);
  delete p.loan;
};

// 우리 선수를 수준이 맞는 AI 구단으로 보낸다. 주전급이면 상대가 주급 전부, 아니면 절반을 낸다
export function loanOut(state, club, p) {
  if (!windowEnd(state.date)) return { ok: false, reason: '임대는 이적시장이 열려 있을 때만 할 수 있습니다.' };
  if (!club.squad.includes(p.id) || p.loan) return { ok: false, reason: '우리 구단 선수만 임대 보낼 수 있습니다.' };
  const ovr = overall(p);
  const takers = Object.values(state.clubs)
    .filter((c) => c.status === 'active' && c.id !== club.id && c.id !== state.user.clubId
      && c.level >= ovr - 3 && c.level <= ovr + 6)
    .sort((a, b) => Math.abs(a.level - ovr - 1) - Math.abs(b.level - ovr - 1));
  if (!takers.length) return { ok: false, reason: `${withParticle(p.name, '를')} 데려갈 구단이 없습니다.` };
  const to = takers[0];
  const wageShare = ovr >= to.level ? 1 : 0.5;
  move(state, p, club, to, { from: club.id, to: to.id, until: seasonEnd(state), wageShare });
  trimSquad(state, to); // 자리가 없으면 상대 구단이 가장 약한 선수를 내보낸다
  return { ok: true, clubId: to.id, wageShare };
}

// 다른 구단의 주전이 아닌 선수를 이번 시즌 끝까지 데려온다. offer: { wageShare }
export function offerLoan(state, club, p, { wageShare }) {
  if (!windowEnd(state.date)) return { ok: false, reason: '임대는 이적시장이 열려 있을 때만 할 수 있습니다.' };
  const owner = p.clubId ? state.clubs[p.clubId] : null;
  if (!owner || owner.id === club.id || p.loan || owner.youth.includes(p.id)) return { ok: false, reason: '임대로 데려올 수 없는 선수입니다.' };
  const required = REQUIRED_SHARE[p.contract?.promise];
  if (!required) return { ok: false, reason: `${withParticle(owner.name, '는')} 주전 선수를 임대 보내지 않습니다.` };
  if (registeredCount(state, club, state.date) >= MAX_SQUAD) return { ok: false, reason: `1군 등록 인원(${MAX_SQUAD}명)이 꽉 찼습니다.` };
  const share = Math.min(1, Math.max(0, wageShare));
  if (share < required) return { ok: false, reason: `${withParticle(owner.name, '는')} 주급의 ${required * 100}% 이상을 내야 보내 준다고 합니다.` };
  if (weeklyWageBill(state, club) + p.contract.wage * share > club.finance.wageBudget) return { ok: false, reason: '주급 예산을 넘습니다.' };
  const optionFee = loanOptionFee(state, p);
  move(state, p, owner, club, { from: owner.id, to: club.id, until: seasonEnd(state), wageShare: share, optionFee });
  return { ok: true, optionFee };
}

// 임대로 데려올 때 정해지는 완전 이적 옵션 금액
export const loanOptionFee = (state, p) => roundMoney(marketValue(p, state.date) * OPTION_MULT);

// 임대 중인 선수를 옵션 금액에 완전 영입한다 (계약은 그대로)
export function buyLoanedPlayer(state, club, p) {
  if (p.loan?.to !== club.id || !p.loan.optionFee) return { ok: false, reason: '완전 이적 옵션이 있는 임대 선수가 아닙니다.' };
  const fee = p.loan.optionFee;
  if (fee > club.finance.transferBudget) return { ok: false, reason: '이적 예산을 넘습니다.' };
  const owner = state.clubs[p.loan.from];
  recordTransfer(club, owner, fee);
  (p.transfers ??= []).push({ date: state.date, from: owner.id, to: club.id, fee });
  unloan(state, p);
  return { ok: true, fee };
}

// 시즌 끝: 임대 선수를 원래 구단으로 돌려보낸다
export function returnLoans(state) {
  for (const p of Object.values(state.players)) {
    if (!p.loan) continue;
    const owner = state.clubs[p.loan.from];
    const borrower = state.clubs[p.clubId];
    unloan(state, p);
    if (borrower) move(state, p, borrower, owner, null);
  }
  // 임대 중에 선수를 채운 AI 구단은 돌아온 인원만큼 정리한다
  for (const club of Object.values(state.clubs)) {
    if (club.status === 'active' && club.id !== state.user?.clubId) trimSquad(state, club);
  }
}

// ---- AI 구단끼리 임대 ----

const AI_LOANS = { max: 2, chance: 0.02 }; // 여름 시장에서 구단마다 약 1명

// 여름 이적시장 중 매일: AI 구단이 뛸 자리가 없는 어린 선수를 수준 낮은 구단으로 보낸다
export function dailyAiLoans(state, rng, userId) {
  const end = windowEnd(state.date);
  if (!end?.endsWith('08-31')) return;
  const clubs = Object.values(state.clubs).filter((c) => c.status === 'active' && c.id !== userId);
  for (const club of clubs) {
    const sent = club.windowLoans?.until === end ? club.windowLoans : (club.windowLoans = { until: end, n: 0 });
    if (sent.n >= AI_LOANS.max || !rng.chance(AI_LOANS.chance)) continue;
    const young = club.squad.map((id) => state.players[id])
      .filter((p) => !p.loan && !p.injury && ageOn(p, state.date) <= 21 && overall(p) <= club.level - 5);
    if (!young.length) continue;
    const p = rng.pick(young);
    const ovr = overall(p);
    const takers = clubs.filter((c) => c.id !== club.id && c.level <= club.level - 3 && c.level >= ovr - 3
      && registeredCount(state, c, state.date) < MAX_SQUAD);
    if (!takers.length) continue;
    const to = rng.pick(takers);
    move(state, p, club, to, { from: club.id, to: to.id, until: seasonEnd(state), wageShare: 0.5 });
    sent.n++;
  }
}
