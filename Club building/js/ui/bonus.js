// 협상 화면의 계약금 미리 보기: 입력값이 바뀔 때마다 계약금과 총비용, 남는 돈을 다시 쓴다

import { signingBonus } from '../core/finance.js';
import { transferDemand } from '../core/contracts.js';
import { won } from './format.js';
import { withParticle } from '../core/korean.js';

// 두 번째 줄: 쓰고 남는 돈, 모자라면 빨간 글씨로 얼마가 모자란지
const rest = (budget, total, name) => (total <= budget
  ? `내고 나면 ${withParticle(name, '가')} ${won(budget - total)} 남습니다.`
  : `<span class="error">${name}(${won(budget)})이 ${won(total - budget)} 모자랍니다.</span>`);

// kind: bid(이적료 단계, amount = 이적료) | terms(개인 조건, amount = 주급, fee = 합의 이적료) | renew(재계약, amount = 주급)
export function bonusPreview(state, club, p, kind, amount, fee = 0) {
  const f = club.finance;
  if (kind === 'bid') {
    const bonus = signingBonus(state, club, transferDemand(state, club, p).wage);
    return `이적료에 계약금 약 ${won(bonus)}(선수가 원하는 주급 기준)이 더해져 모두 ${won(amount + bonus)}이 듭니다.<br>${rest(f.transferBudget, amount + bonus, '이적 예산')}`;
  }
  const bonus = signingBonus(state, club, amount);
  if (kind === 'terms') return `이 주급이면 계약금이 ${won(bonus)}(연봉의 20%)이라, 이적료까지 모두 ${won(fee + bonus)}이 듭니다.<br>${rest(f.transferBudget, fee + bonus, '이적 예산')}`;
  return `이 주급이면 계약금 ${won(bonus)}(연봉의 20%)을 잔고에서 바로 냅니다.<br>${rest(Math.max(0, f.balance), bonus, '잔고')}`;
}

// 입력 칸과 미리 보기 줄: 입력 칸에 data-preview="bonus", 줄에 id="bonusPreview"
export const bonusLine = (state, club, p, kind, amount, fee = 0) =>
  `<p class="small" id="bonusPreview" data-kind="${kind}" data-player="${p.id}" data-fee="${fee}">${bonusPreview(state, club, p, kind, amount, fee)}</p>`;
