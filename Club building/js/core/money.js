// 선수 몸값과 주급. 금액은 모두 원.

import { EUR } from '../data/economy.js';
import { overall, ageOn } from './player.js';

// 보기 좋은 단위로 반올림: 1억 이상은 100만 원, 그 아래는 1만 원 단위
export function roundMoney(won) {
  const unit = Math.abs(won) >= 1e8 ? 1e6 : 1e4;
  return Math.round(won / unit) * unit;
}

// 시장 가치에 쓰는 실질 능력: 어린 선수는 잠재력 일부를 더한다
function valueAbility(p, age) {
  const gap = Math.max(0, p.potential - overall(p));
  const youth = age <= 21 ? 0.45 : age <= 24 ? 0.25 : 0;
  return overall(p) + gap * youth;
}

export function marketValue(p, date) {
  const age = ageOn(p, date);
  let eur = 1.5e6 * Math.exp((valueAbility(p, age) - 62) * 0.18);
  if (age >= 30) eur *= Math.max(0.15, 1 - (age - 29) * 0.14);
  if (p.contract) {
    const monthsLeft = monthsBetween(date, p.contract.until);
    if (monthsLeft < 12) eur *= 0.4 + 0.6 * (monthsLeft / 12);
  }
  return roundMoney(eur * EUR);
}

// 능력에 맞는 주급 (기준값). 실제 계약 주급은 이 값에 협상 결과가 곱해진다
export function wageFor(ovr) {
  return roundMoney(60000 * Math.exp((ovr - 75) * 0.15) * EUR);
}

export function monthsBetween(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) + (d2 - d1) / 30);
}

// 금액(원) 표시: "1,520억 원", "3억 2,000만 원", "4,500만 원"
export function won(amount) {
  const sign = amount < 0 ? '-' : '';
  const a = Math.round(Math.abs(amount));
  const n = (x) => x.toLocaleString('ko-KR');
  if (a >= 1e10) return `${sign}${n(Math.round(a / 1e8))}억 원`;
  if (a >= 1e8) {
    let eok = Math.floor(a / 1e8);
    let man = Math.round((a % 1e8) / 1e6) * 100;
    if (man >= 10000) {
      eok++;
      man = 0;
    }
    return `${sign}${eok}억${man ? ` ${n(man)}만` : ''} 원`;
  }
  if (a >= 1e4) return `${sign}${n(Math.round(a / 1e4))}만 원`;
  return `${sign}${n(a)}원`;
}
