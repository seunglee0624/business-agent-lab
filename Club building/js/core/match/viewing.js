// 경기 보기: 하이라이트 장면 판별과 결정 순간 멈춤 판단 (화면과 무관한 로직)

const ALWAYS = new Set(['kickoff', 'halftime', 'secondHalf', 'fulltime', 'goal', 'penalty', 'yellow', 'secondYellow', 'red', 'sub', 'woodwork', 'injury']);

export function isHighlight(event) {
  if (ALWAYS.has(event.type)) return true;
  if (event.type === 'save' || event.type === 'miss') return event.kind === 'big' || event.kind === 'penalty';
  return false;
}

export const LOW_ENERGY = 55;

// 이번 1분 동안 생긴 이벤트를 보고 멈춰야 하면 이유를 돌려준다.
// flags: 한 경기에 한 번만 멈추는 조건을 기록하는 객체 (호출하는 쪽이 경기 내내 들고 있는다)
export function pauseReason(match, userSide, newEvents, pauses, flags) {
  const opp = 1 - userSide;
  const my = match.sides[userSide];
  const their = match.sides[opp];
  for (const e of newEvents) {
    if (e.type === 'halftime' && pauses.halftime) return '하프타임';
    if (e.type === 'goal' && e.side === opp && pauses.conceded) return '실점했습니다';
    if ((e.type === 'red' || e.type === 'secondYellow') && e.side === userSide && pauses.ourRed) return '우리 팀 선수가 퇴장당했습니다';
    if ((e.type === 'red' || e.type === 'secondYellow') && e.side === opp && pauses.theirRed) return '상대 팀 선수가 퇴장당했습니다';
    if (e.type === 'injury' && e.side === userSide && pauses.injury) return '우리 팀 선수가 다쳤습니다';
  }
  if (match.phase !== 'second') return null;
  if (pauses.losingAt60 && !flags.losingAt60 && match.minute >= 60 && my.score < their.score) {
    flags.losingAt60 = true;
    return '60분, 지고 있습니다';
  }
  if (pauses.drawingAt75 && !flags.drawingAt75 && match.minute >= 75 && my.score === their.score) {
    flags.drawingAt75 = true;
    return '75분, 비기고 있습니다';
  }
  if (pauses.lowEnergy && !flags.lowEnergy && my.onPitch.some((s) => !s.sentOff && s.energy < LOW_ENERGY)) {
    flags.lowEnergy = true;
    return '체력이 크게 떨어진 선수가 있습니다';
  }
  return null;
}
