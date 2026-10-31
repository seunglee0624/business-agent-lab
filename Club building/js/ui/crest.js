// 구단 로고(SVG). 구단 번호와 이름으로 모양을 정하므로 같은 구단은 늘 같은 로고가 나오고 저장할 것이 없다.
// 종류는 방패 문장 50% · 원형 엠블럼 33% · 추상 도형 17%. 작게 그릴수록 글자와 상징을 뺀다.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const CREST_STYLES = ['shield', 'roundel', 'abstract'];
const METALS = ['#d4af37', '#c9ccd1', '#b87333'];
const DARK = '#141414';
let uid = 0;

function hashStr(s) {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 화면용 난수(mulberry32). 게임 진행 난수와 따로 써서 로고가 경기 결과에 영향을 주지 않는다.
function rngOf(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ink = (bg) => (luminance(bg) > 0.4 ? DARK : '#ffffff');

// 이니셜: 도시 첫 글자 + 나머지 한글 단어 첫 글자(리버풀 유나이티드 → 리유). 한글 단어가 없으면 도시 두 글자(FC 바르셀로나 → 바르).
export function crestInitials(club) {
  const city = club.city ?? club.name.split(' ')[0];
  const rest = club.name.replace(city, '').split(' ').filter((w) => /^[가-힣]/.test(w));
  return rest.length ? city[0] + rest[0][0] : city.slice(0, 2);
}

// 바탕 무늬: W×H 사각형을 그리고 바깥(방패·원)에서 잘라 쓴다.
const FIELDS = ['plain', 'stripes', 'hoops', 'half', 'bend', 'sash', 'chevron', 'quarter', 'cross'];
function field(kind, W, H, c1, c2, r) {
  const base = `<rect width="${W}" height="${H}" fill="${c1}"/>`;
  const bars = (n, vertical) => {
    let s = base;
    const step = (vertical ? W : H) / n;
    for (let i = 1; i < n; i += 2) {
      s += vertical
        ? `<rect x="${i * step}" width="${step}" height="${H}" fill="${c2}"/>`
        : `<rect y="${i * step}" width="${W}" height="${step}" fill="${c2}"/>`;
    }
    return s;
  };
  switch (kind) {
    case 'stripes': return bars(pick(r, [3, 5, 7]), true);
    case 'hoops': return bars(pick(r, [5, 7]), false);
    case 'half': return `${base}<rect x="${W / 2}" width="${W / 2}" height="${H}" fill="${c2}"/>`;
    case 'bend': return `${base}<polygon points="0,0 ${W},0 ${W},${H}" fill="${c2}"/>`;
    case 'sash': return `${base}<rect x="${-W}" y="${H / 2 - W * 0.11}" width="${W * 3}" height="${W * 0.22}" fill="${c2}" transform="rotate(-40 ${W / 2} ${H / 2})"/>`;
    case 'chevron': return `${base}<path d="M-5,${H * 0.8} L${W / 2},${H * 0.42} L${W + 5},${H * 0.8}" stroke="${c2}" stroke-width="${W * 0.18}" fill="none"/>`;
    case 'quarter': return `${base}<rect x="${W / 2}" width="${W / 2}" height="${H / 2}" fill="${c2}"/><rect y="${H / 2}" width="${W / 2}" height="${H / 2}" fill="${c2}"/>`;
    case 'cross': return `${base}<rect x="${W * 0.4}" width="${W * 0.2}" height="${H}" fill="${c2}"/><rect y="${H * 0.42}" width="${W}" height="${W * 0.2}" fill="${c2}"/>`;
    default: return base;
  }
}

function starPoints(cx, cy, outer, inner, n = 5) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rad = i % 2 ? inner : outer;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

// 상징: 100×100 칸 기준.
const CHARGES = {
  star: (f) => `<polygon points="${starPoints(50, 54, 46, 19)}" fill="${f}"/>`,
  ball: (f, o) => {
    const corner = (i, rad) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      return [(50 + rad * Math.cos(a)).toFixed(1), (50 + rad * Math.sin(a)).toFixed(1)];
    };
    const pentagon = [0, 1, 2, 3, 4].map((i) => corner(i, 15).join(',')).join(' ');
    const seams = [0, 1, 2, 3, 4].map((i) => {
      const [x1, y1] = corner(i, 15);
      const [x2, y2] = corner(i, 42);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o}" stroke-width="5"/>`;
    }).join('');
    return `<circle cx="50" cy="50" r="42" fill="${f}"/><polygon points="${pentagon}" fill="${o}"/>${seams}`;
  },
  crown: (f) => `<path d="M8,78 L8,30 L30,52 L50,18 L70,52 L92,30 L92,78 Z" fill="${f}"/><rect x="8" y="82" width="84" height="10" fill="${f}"/>`,
  tower: (f) => `<path d="M18,94 V38 H30 V24 H42 V38 H58 V24 H70 V38 H82 V94 H60 V72 A10,10 0 0 0 40,72 V94 Z" fill="${f}"/>`,
  bolt: (f) => `<path d="M60,4 L20,56 H46 L36,96 L80,40 H54 Z" fill="${f}"/>`,
  wing: (f) => `<path d="M8,30 C40,30 60,40 92,20 C80,46 66,52 52,54 C70,56 74,66 70,80 C56,66 38,62 20,64 C30,56 32,48 8,30 Z" fill="${f}"/>`,
};
function charge(kind, cx, cy, size, fill, other, outline) {
  const s = size / 100;
  const stroke = outline ? ` stroke="${outline}" stroke-width="${(4 / s).toFixed(1)}" paint-order="stroke" stroke-linejoin="round"` : '';
  return `<g transform="translate(${cx - size / 2},${cy - size / 2}) scale(${s})"${stroke}>${CHARGES[kind](fill, other)}</g>`;
}

const SHIELDS = [
  'M6,6 H94 V52 C94,86 72,104 50,116 C28,104 6,86 6,52 Z',
  'M8,6 H92 V72 A42,42 0 0 1 8,72 Z',
  'M6,14 Q28,4 50,12 Q72,4 94,14 V60 C94,90 70,106 50,116 C30,106 6,90 6,60 Z',
  'M6,6 H94 V84 L50,116 L6,84 Z',
];

// 방패 문장: 방패 모양 + 바탕 무늬 + 상징. 30px 이상이면 위쪽 띠에 이니셜이 들어갈 수 있다.
function shield(club, r, px) {
  const { primary: c1, secondary: c2 } = club.colors;
  const id = `crest${uid++}`;
  const shape = pick(r, SHIELDS);
  const kind = pick(r, FIELDS);
  const symbol = pick(r, Object.keys(CHARGES));
  const edge = r() < 0.4 ? pick(r, METALS) : c2;
  const chief = r() < 0.55 && px >= 30;
  const busy = kind !== 'plain';
  let body = field(kind, 100, 120, c1, c2, r);
  if (chief) body += `<rect width="100" height="32" fill="${c2}"/><text x="50" y="24" text-anchor="middle" font-size="19" font-weight="800" fill="${ink(c2)}">${esc(crestInitials(club))}</text>`;
  if (px >= 24) body += charge(symbol, 50, chief ? 74 : 62, chief ? 40 : 50, busy ? '#ffffff' : ink(c1), c1, busy ? DARK : null);
  const shade = edge === c2 ? '' : `<path d="${shape}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/>`;
  return `<svg viewBox="0 0 100 120" aria-hidden="true"><defs><clipPath id="${id}"><path d="${shape}"/></clipPath></defs>`
    + `<g clip-path="url(#${id})">${body}</g><path d="${shape}" fill="none" stroke="${edge}" stroke-width="7"/>${shade}</svg>`;
}

// 원형 엠블럼: 바깥 고리 + 무늬 원 + 이니셜이나 상징. 56px 이상이면 고리에 구단 이름과 창단 연도.
function roundel(club, r, px) {
  const { primary: c1, secondary: c2 } = club.colors;
  const id = `crest${uid++}`;
  const kind = pick(r, FIELDS);
  const symbol = pick(r, Object.keys(CHARGES));
  const t = ink(c1);
  const year = 1870 + Math.floor(r() * 90);
  const center = r() < 0.5
    ? `<text x="50" y="58" text-anchor="middle" font-size="24" font-weight="800" fill="#ffffff" stroke="${DARK}" stroke-width="3" paint-order="stroke">${esc(crestInitials(club))}</text>`
    : charge(symbol, 50, 50, 34, '#ffffff', c2, DARK);
  let ring = '';
  if (px >= 56) {
    ring = `<path id="${id}t" d="M14,50 A36,36 0 0 1 86,50" fill="none"/><path id="${id}b" d="M7,50 A43,43 0 0 0 93,50" fill="none"/>`
      + `<text font-size="10" font-weight="700" fill="${t}" letter-spacing="1"><textPath href="#${id}t" startOffset="50%" text-anchor="middle">${esc(club.name)}</textPath></text>`
      + `<text font-size="8" font-weight="700" fill="${t}"><textPath href="#${id}b" startOffset="50%" text-anchor="middle">${year}</textPath></text>`;
  } else if (px >= 30) {
    ring = `<polygon points="${starPoints(9.5, 50, 4.5, 2)}" fill="${t}"/><polygon points="${starPoints(90.5, 50, 4.5, 2)}" fill="${t}"/>`;
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" fill="${c1}" stroke="${c2}" stroke-width="3"/>${ring}`
    + `<defs><clipPath id="${id}"><circle cx="50" cy="50" r="33"/></clipPath></defs>`
    + `<g clip-path="url(#${id})">${field(kind, 100, 100, c2, c1, r)}${px >= 24 ? center : ''}</g>`
    + `<circle cx="50" cy="50" r="33" fill="none" stroke="${t}" stroke-width="2"/></svg>`;
}

// 추상 도형: 글자 없이 두 색 도형만.
function abstractMark(club, r) {
  const { primary: c1, secondary: c2 } = club.colors;
  const line = 'stroke="rgba(255,255,255,.3)" stroke-width="2"';
  const marks = [
    () => `<polygon points="50,4 96,50 50,96 4,50" fill="${c1}" ${line}/><polygon points="50,4 96,50 50,96" fill="${c2}"/><polygon points="50,28 72,50 50,72 28,50" fill="none" stroke="${ink(c1)}" stroke-width="5"/>`,
    () => `<path d="M10,40 L50,10 L90,40" stroke="${c1}" stroke-width="18" fill="none"/><path d="M10,70 L50,40 L90,70" stroke="${c2}" stroke-width="18" fill="none"/><path d="M22,92 L50,72 L78,92" stroke="${c1}" stroke-width="12" fill="none"/>`,
    () => `<polygon points="50,3 91,26 91,74 50,97 9,74 9,26" fill="${c1}" ${line}/><polygon points="62,3 91,20 91,40 38,97 9,80 9,60" fill="${c2}" opacity=".95"/>`,
    () => `<circle cx="50" cy="50" r="45" fill="${c1}" ${line}/><circle cx="64" cy="42" r="30" fill="${c2}"/><polygon points="${starPoints(30, 64, 13, 5)}" fill="${ink(c1)}"/>`,
    () => `<polygon points="50,6 94,92 6,92" fill="${c1}" ${line}/><polygon points="50,40 74,86 26,86" fill="${c2}"/>`,
  ];
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${pick(r, marks)()}</svg>`;
}

const DRAW = { shield, roundel, abstract: abstractMark };

function crestRng(club) {
  const r = rngOf(hashStr(`${club.id}|${club.name}`));
  const x = r();
  return { r, style: x < 0.5 ? 'shield' : x < 0.83 ? 'roundel' : 'abstract' };
}

export function crestStyle(club) {
  return crestRng(club).style;
}

// px: 그릴 크기. 표 18px, 사이드바 40px.
export function crestSvg(club, px) {
  const { r, style } = crestRng(club);
  return DRAW[style](club, r, px);
}
