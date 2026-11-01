// 예외 상황 재현: 이적 예산을 넘는 이적료 제안은 거절되고, 협상 횟수·예산·잔고는 바뀌지 않는다.
// 화면이 쓰는 게임 함수(js/core/game.js)를 그대로 부른다. 시드가 같으면 결과도 같다.
// 실행: node tools/edge-case.js

import { createNewGame, chooseClub, bidForPlayer, userClub } from '../js/core/game.js';
import { won, marketValue } from '../js/core/money.js';

const state = createNewGame('guide');
const club = Object.values(state.clubs).find((c) => c.name === '셰필드 레인저스');
chooseClub(state, club.id, '테스트');
const me = userClub(state);
const player = Object.values(state.players).find((p) => p.name === '하이로 로드리게스');

const snapshot = () => {
  const deal = state.transfers.deals[player.id];
  return {
    budget: me.finance.transferBudget,
    balance: me.finance.balance,
    tries: deal ? `${deal.tries}/3` : '협상 기록 없음',
  };
};
const show = (label, s) => console.log(`${label}  이적 예산 ${won(s.budget)} · 잔고 ${won(s.balance)} · 이적료 협상 횟수 ${s.tries}`);
const offer = (fee) => {
  const res = bidForPlayer(state, player.id, fee);
  console.log(`제안: 이적료 ${won(fee)} → ${res.ok ? '합의' : '거절'}: ${res.reason ?? ''}`);
};

console.log(`${state.date} · ${me.name} · 대상 ${player.name} (${state.clubs[player.clubId].name}, 몸값 약 ${won(marketValue(player, state.date))})`);
show('[처음]', snapshot());

console.log('\n1) 터무니없이 큰 금액');
offer(5000e8);
show('[제안 뒤]', snapshot());

console.log('\n2) 이적료만으로는 예산 안이지만, 계약금(이적료의 10%)을 더하면 넘는 금액');
offer(Math.floor(me.finance.transferBudget * 0.95 / 1e7) * 1e7);
show('[제안 뒤]', snapshot());

console.log('\n비교) 예산 안이지만 상대 요구보다 낮은 금액은 협상 1번으로 센다');
offer(5e8);
show('[제안 뒤]', snapshot());
