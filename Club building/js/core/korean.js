// 한국어 조사 처리

// 받침 여부에 맞춰 조사를 붙인다. withParticle('김민준', '가') → '김민준이'
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
