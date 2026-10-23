// 경기 이벤트를 한국어 문자 중계 문장으로 바꾼다.
// 게임 난수를 쓰지 않도록, 문장 선택은 이벤트 내용으로 정한다 (중계를 보든 안 보든 결과가 같아야 한다).

function choose(templates, event) {
  const key = `${event.minute}|${event.type}|${event.playerId ?? ''}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return templates[h % templates.length];
}

// 받침 여부에 맞춰 조사를 붙인다. {player:가} → '김민준이' / '해리 케인이'
const PARTICLES = { 가: ['이', '가'], 는: ['은', '는'], 를: ['을', '를'], 와: ['과', '와'], 로: ['으로', '로'] };

export function withParticle(word, particle) {
  const pair = PARTICLES[particle];
  if (!pair || !word) return word + (particle ?? '');
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return word + pair[1];
  const jong = code % 28;
  if (particle === '로' && jong === 8) return word + '로'; // ㄹ 받침은 '로'
  return word + (jong ? pair[0] : pair[1]);
}

const fill = (t, vars) => t.replace(/\{(\w+)(?::(\S+?))?\}/g, (_, k, particle) => {
  const v = String(vars[k] ?? '');
  return particle ? withParticle(v, particle) : v;
});

const T = {
  kickoff: ['주심의 휘슬과 함께 경기가 시작됩니다!', '{home}의 킥오프로 경기가 시작됩니다.'],
  halftime: ['전반전이 끝났습니다. {home} {hs} - {as} {away}', '하프타임입니다. 스코어는 {hs} - {as}.'],
  secondHalf: ['후반전이 시작됩니다.', '양 팀 선수들이 다시 그라운드로 나왔습니다. 후반전 시작!'],
  fulltime: ['경기 종료! {home} {hs} - {as} {away}', '주심이 종료 휘슬을 붑니다. 최종 스코어 {hs} - {as}.'],
  goal: {
    big: ['골! {player}, 골키퍼와의 일대일에서 침착하게 마무리합니다!', '골!! {player:가} 결정적인 기회를 놓치지 않습니다!'],
    normal: ['골! {player}의 슈팅이 골망을 흔듭니다!', '골! 박스 안에서 {player:가} 정확하게 밀어 넣습니다!'],
    header: ['골! {player}의 헤더! 크로스를 그대로 머리로 받아 넣습니다!', '골! 높이 뛰어오른 {player}의 헤더가 골문 구석으로!'],
    long: ['골!!! {player}의 환상적인 중거리포! 골키퍼가 손쓸 수 없습니다!', '골! 먼 거리에서 때린 {player}의 슈팅이 그대로 꽂힙니다!'],
    penalty: ['골! {player}, 페널티킥을 성공시킵니다.', '골! {player:가} 골키퍼를 속이고 페널티킥을 넣습니다.'],
  },
  assist: [' {assist}의 도움.', ' {assist}의 패스가 빛났습니다.'],
  save: {
    big: ['{keeper}의 엄청난 선방! {player}의 결정적인 슈팅을 막아냅니다!', '{player}의 일대일 슈팅, {keeper:가} 몸을 날려 막습니다!'],
    normal: ['{player}의 슈팅, {keeper:가} 잡아냅니다.', '{player:가} 때렸지만 {keeper}의 정면입니다.'],
    header: ['{player}의 헤더, {keeper:가} 쳐냅니다.', '{player}의 헤더가 골문으로 향하지만 {keeper:가} 잡습니다.'],
    long: ['{player}의 중거리 슈팅, {keeper:가} 막아냅니다.', '멀리서 때린 {player}의 슈팅을 {keeper:가} 쳐냅니다.'],
    penalty: ['{keeper:가} {player}의 페널티킥을 막아냅니다!!', '페널티킥 선방! {keeper:가} {player}의 킥 방향을 읽었습니다!'],
  },
  miss: {
    big: ['아! {player:가} 결정적인 기회를 날립니다!', '{player}, 이걸 놓치나요! 슈팅이 골문을 벗어납니다.'],
    normal: ['{player}의 슈팅이 골대를 벗어납니다.', '{player:가} 슈팅했지만 수비에 막힙니다.'],
    header: ['{player}의 헤더가 크로스바 위로 넘어갑니다.', '{player:가} 머리를 갖다 댔지만 빗나갑니다.'],
    long: ['{player}의 중거리 슈팅, 하늘 높이 뜹니다.', '{player:가} 멀리서 노려보지만 골문과 거리가 멉니다.'],
    penalty: ['{player}의 페널티킥이 골대를 벗어납니다!', '{player}, 페널티킥 실축!'],
  },
  woodwork: ['{player}의 슈팅이 골대를 강타합니다!', '아! {player}의 슈팅이 골대에 맞고 나옵니다!'],
  attack: ['{player:가} 공격을 전개하지만 {other:가} 끊어냅니다.', '{player}의 패스가 {other}에게 차단됩니다.', '{team:가} 공격을 시도하지만 {other:가} 잘 막아냅니다.'],
  penalty: ['페널티킥! {other}의 반칙으로 {team:가} 페널티킥을 얻습니다. 키커는 {player}.'],
  yellow: ['{player}에게 경고가 주어집니다.', '거친 태클, {player} 옐로카드.'],
  secondYellow: ['{player}, 두 번째 경고로 퇴장당합니다!', '경고 누적! {player:가} 그라운드를 떠납니다.'],
  red: ['레드카드! {player:가} 퇴장당합니다!', '다이렉트 퇴장! {player}의 위험한 반칙입니다.'],
  sub: ['{team} 교체: {other} 나가고 {player} 들어갑니다.'],
  tactics: ['{team:가} 전술을 바꿉니다.'],
};

// names: { home, away } 구단 이름
export function commentary(match, event, names) {
  const team = event.side === 0 ? names.home : event.side === 1 ? names.away : '';
  const name = (id) => (id ? match.players[id]?.name ?? '' : '');
  const keeperId = event.otherId;
  const vars = {
    home: names.home,
    away: names.away,
    hs: match.sides[0].score,
    as: match.sides[1].score,
    team,
    player: name(event.playerId),
    other: name(event.otherId),
    keeper: name(keeperId),
    assist: name(event.assistId),
  };
  const entry = T[event.type];
  if (!entry) return '';
  const templates = Array.isArray(entry) ? entry : entry[event.kind] ?? entry.normal;
  let text = fill(choose(templates, event), vars);
  if (event.type === 'goal') {
    if (event.assistId) text += fill(choose(T.assist, event), vars);
    text += ` [${scoreAt(match, event)}]`;
  }
  return text;
}

// 해당 골 시점의 스코어 "1 - 0"
function scoreAt(match, event) {
  let h = 0;
  let a = 0;
  for (const e of match.events) {
    if (e.type === 'goal') {
      if (e.side === 0) h++;
      else a++;
    }
    if (e === event || (e.minute === event.minute && e.type === event.type && e.playerId === event.playerId)) break;
  }
  return `${h} - ${a}`;
}
