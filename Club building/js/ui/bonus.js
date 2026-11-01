// 협상 화면의 계약금 미리 보기: 입력값이 바뀔 때마다 계약금과 총비용, 남는 돈을 다시 쓴다

import { signingBonus } from '../core/finance.js';
import { transferDemand } from '../core/contracts.js';
import { won } from './format.js';

const rest = (budget, total, name) => (total <= budget
  ? `${name} ${won(budget)} 중 ${won(budget - total)} 남음`
  : `<span class="error">${name} ${won(budget)}보다 ${won(total - budget)} 모자람</span>`);

// kind: bid(이적료 단계, amount = 이적료) | terms(개인 조건, amount = 주급, fee = 합의 이적료) | renew(재계약, amount = 주급)
export function bonusPreview(state, club, p, kind, amount, fee = 0) {
  const f = club.finance;
  if (kind === 'bid') {
    const bonus = signingBonus(state, club, transferDemand(state, club, p).wage);
    return `예상 계약금 ${won(bonus)} (요구 주급 기준) · 이적료 + 계약금 ${won(amount + bonus)} · ${rest(f.transferBudget, amount + bonus, '이적 예산')}`;
  }
  const bonus = signingBonus(state, club, amount);
  if (kind === 'terms') return `계약금 ${won(bonus)} (연봉의 20%) · 이적료 + 계약금 ${won(fee + bonus)} · ${rest(f.transferBudget, fee + bonus, '이적 예산')}`;
  return `계약금 ${won(bonus)} (연봉의 20%, 잔고에서 냄) · ${rest(Math.max(0, f.balance), bonus, '잔고')}`;
}

// 입력 칸과 미리 보기 줄: 입력 칸에 data-preview="bonus", 줄에 id="bonusPreview"
export const bonusLine = (state, club, p, kind, amount, fee = 0) =>
  `<p class="small" id="bonusPreview" data-kind="${kind}" data-player="${p.id}" data-fee="${fee}">${bonusPreview(state, club, p, kind, amount, fee)}</p>`;
