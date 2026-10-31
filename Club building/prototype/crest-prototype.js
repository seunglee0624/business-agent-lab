// PROTOTYPE — 구단 로고 시안. prototype/club-crest 브랜치 전용이며 main에 합치지 않는다.
// 질문: 코드로 자동 생성하는 구단 로고를 어떤 모양으로 할까? 시안 5개를 ?crest=A~E 로 바꿔 본다.
// format.js 의 badge() 가 globalThis.__crestPrototype 이 있으면 이쪽으로 그린다.

const VARIANTS = [
  ['A', '방패 문장'],
  ['B', '원형 엠블럼'],
  ['C', '모노그램'],
  ['D', '현대 추상'],
  ['E', '섞어 쓰기'],
];
const params = new URLSearchParams(location.search);
let variant = VARIANTS.some(([k]) => k === params.get('crest')) ? params.get('crest') : 'A';
const seen = new Map(); // 화면에 한 번이라도 나온 구단 (모아 보기용)
let uid = 0;

// ---------- 도우미 ----------
function hashStr(s) {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
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
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ink = (bg) => (lum(bg) > 0.4 ? '#141414' : '#ffffff');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const METALS = ['#d4af37', '#c9ccd1', '#b87333'];

// 이니셜: 도시 첫 글자 + 나머지 한글 단어 첫 글자. 없으면 도시 두 글자.
function initials(club) {
  const city = club.city?.name ?? club.city ?? club.name.split(' ')[0];
  const rest = club.name.replace(city, '').split(' ').filter((w) => /^[가-힣]/.test(w));
  return rest.length ? city[0] + rest[0][0] : String(city).slice(0, 2);
}
function foundedYear(r) { return 1870 + Math.floor(r() * 90); }

// ---------- 바탕 무늬 (W×H 영역, 바깥에서 잘라 쓴다) ----------
const FIELDS = ['plain', 'stripes', 'hoops', 'half', 'bend', 'sash', 'chevron', 'quarter', 'cross'];
function field(kind, W, H, c1, c2, r) {
  const base = `<rect width="${W}" height="${H}" fill="${c1}"/>`;
  switch (kind) {
    case 'stripes': {
      const n = pick(r, [3, 5, 7]); const w = W / n; let s = base;
      for (let i = 1; i < n; i += 2) s += `<rect x="${i * w}" width="${w}" height="${H}" fill="${c2}"/>`;
      return s;
    }
    case 'hoops': {
      const n = pick(r, [5, 7]); const h = H / n; let s = base;
      for (let i = 1; i < n; i += 2) s += `<rect y="${i * h}" width="${W}" height="${h}" fill="${c2}"/>`;
      return s;
    }
    case 'half': return base + `<rect x="${W / 2}" width="${W / 2}" height="${H}" fill="${c2}"/>`;
    case 'bend': return base + `<polygon points="0,0 ${W},0 ${W},${H}" fill="${c2}"/>`;
    case 'sash': return base + `<rect x="${-W}" y="${H / 2 - W * 0.11}" width="${W * 3}" height="${W * 0.22}" fill="${c2}" transform="rotate(-40 ${W / 2} ${H / 2})"/>`;
    case 'chevron': return base + `<path d="M-5,${H * 0.8} L${W / 2},${H * 0.42} L${W + 5},${H * 0.8}" stroke="${c2}" stroke-width="${W * 0.18}" fill="none"/>`;
    case 'quarter': return base + `<rect x="${W / 2}" width="${W / 2}" height="${H / 2}" fill="${c2}"/><rect y="${H / 2}" width="${W / 2}" height="${H / 2}" fill="${c2}"/>`;
    case 'cross': return base + `<rect x="${W * 0.4}" width="${W * 0.2}" height="${H}" fill="${c2}"/><rect y="${H * 0.42}" width="${W}" height="${W * 0.2}" fill="${c2}"/>`;
    default: return base;
  }
}

// ---------- 상징 (100×100 기준) ----------
function starPoints(cx, cy, R, ri, n = 5) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n; const rad = i % 2 ? ri : R;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}
const CHARGES = {
  star: (f) => `<polygon points="${starPoints(50, 54, 46, 19)}" fill="${f}"/>`,
  ball: (f, o) => `<circle cx="50" cy="50" r="42" fill="${f}"/><polygon points="${starPoints(50, 50, 15, 15, 5).split(' ').filter((_, i) => i % 2 === 0).join(' ')}" fill="${o}"/>
    ${[0, 1, 2, 3, 4].map((i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; return `<line x1="${50 + 15 * Math.cos(a)}" y1="${50 + 15 * Math.sin(a)}" x2="${50 + 42 * Math.cos(a)}" y2="${50 + 42 * Math.sin(a)}" stroke="${o}" stroke-width="5"/>`; }).join('')}`,
  crown: (f) => `<path d="M8,78 L8,30 L30,52 L50,18 L70,52 L92,30 L92,78 Z" fill="${f}"/><rect x="8" y="82" width="84" height="10" fill="${f}"/>`,
  tower: (f) => `<path d="M18,94 V38 H30 V24 H42 V38 H58 V24 H70 V38 H82 V94 H60 V72 A10,10 0 0 0 40,72 V94 Z" fill="${f}"/>`,
  bolt: (f) => `<path d="M60,4 L20,56 H46 L36,96 L80,40 H54 Z" fill="${f}"/>`,
  wing: (f) => `<path d="M8,30 C40,30 60,40 92,20 C80,46 66,52 52,54 C70,56 74,66 70,80 C56,66 38,62 20,64 C30,56 32,48 8,30 Z" fill="${f}"/>`,
};
function charge(kind, cx, cy, size, fill, other, outline) {
  const s = size / 100;
  const stroke = outline ? `stroke="${outline}" stroke-width="${(8 / s) * 0.5}" paint-order="stroke" stroke-linejoin="round"` : '';
  return `<g transform="translate(${cx - size / 2},${cy - size / 2}) scale(${s})" ${stroke}>${CHARGES[kind](fill, other)}</g>`;
}

// ---------- 시안 A: 방패 문장 ----------
const SHIELDS = [
  'M6,6 H94 V52 C94,86 72,104 50,116 C28,104 6,86 6,52 Z',
  'M8,6 H92 V72 A42,42 0 0 1 8,72 Z',
  'M6,14 Q28,4 50,12 Q72,4 94,14 V60 C94,90 70,106 50,116 C30,106 6,90 6,60 Z',
  'M6,6 H94 V84 L50,116 L6,84 Z',
];
function shield(club, r, px) {
  const { primary: c1, secondary: c2 } = club.colors;
  const id = `cp${uid++}`; const shape = pick(r, SHIELDS);
  const kind = pick(r, FIELDS); const ch = pick(r, Object.keys(CHARGES));
  const edge = r() < 0.4 ? pick(r, METALS) : c2;
  const chief = px >= 30 && r() < 0.55;
  const busy = kind !== 'plain';
  let body = field(kind, 100, 120, c1, c2, r);
  let cy = 62;
  if (chief) {
    body += `<rect width="100" height="32" fill="${c2}"/><text x="50" y="24" text-anchor="middle" font-size="19" font-weight="800" fill="${ink(c2)}">${esc(initials(club))}</text>`;
    cy = 74;
  }
  const chargeFill = busy ? '#ffffff' : ink(c1);
  const out = busy ? '#141414' : null;
  return `<svg viewBox="0 0 100 120"><defs><clipPath id="${id}"><path d="${shape}"/></clipPath></defs>
    <g clip-path="url(#${id})">${body}${px >= 24 ? charge(ch, 50, cy, chief ? 40 : 50, chargeFill, c1, out) : ''}</g>
    <path d="${shape}" fill="none" stroke="${edge}" stroke-width="7"/>
    ${edge !== c2 ? `<path d="${shape}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/>` : ''}</svg>`;
}

// ---------- 시안 B: 원형 엠블럼 ----------
function roundel(club, r, px) {
  const { primary: c1, secondary: c2 } = club.colors;
  const id = `cp${uid++}`; const kind = pick(r, FIELDS); const ch = pick(r, Object.keys(CHARGES));
  const t = ink(c1); const year = foundedYear(r);
  const center = r() < 0.5
    ? `<text x="50" y="${50 + 8}" text-anchor="middle" font-size="24" font-weight="800" fill="#fff" stroke="#141414" stroke-width="3" paint-order="stroke">${esc(initials(club))}</text>`
    : charge(ch, 50, 50, 34, '#ffffff', c2, '#141414');
  let ring = '';
  if (px >= 56) {
    ring = `<path id="${id}t" d="M14,50 A36,36 0 0 1 86,50" fill="none"/><path id="${id}b" d="M7,50 A43,43 0 0 0 93,50" fill="none"/>
      <text font-size="10" font-weight="700" fill="${t}" letter-spacing="1"><textPath href="#${id}t" startOffset="50%" text-anchor="middle">${esc(club.name)}</textPath></text>
      <text font-size="8" font-weight="700" fill="${t}"><textPath href="#${id}b" startOffset="50%" text-anchor="middle">${year}</textPath></text>`;
  } else if (px >= 30) {
    ring = `<polygon points="${starPoints(9.5, 50, 4.5, 2)}" fill="${t}"/><polygon points="${starPoints(90.5, 50, 4.5, 2)}" fill="${t}"/>`;
  }
  return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="${c1}" stroke="${c2}" stroke-width="3"/>${ring}
    <defs><clipPath id="${id}"><circle cx="50" cy="50" r="33"/></clipPath></defs>
    <g clip-path="url(#${id})">${field(kind, 100, 100, c2, c1, r)}${px >= 24 ? center : ''}</g>
    <circle cx="50" cy="50" r="33" fill="none" stroke="${t}" stroke-width="2"/></svg>`;
}

// ---------- 시안 C: 모노그램 ----------
function monogram(club, r) {
  const { primary: c1, secondary: c2 } = club.colors;
  const id = `cp${uid++}`; const text = initials(club);
  const shape = pick(r, ['<rect x="4" y="4" width="92" height="92" rx="24"/>', '<polygon points="30,4 70,4 96,30 96,70 70,96 30,96 4,70 4,30"/>', '<circle cx="50" cy="50" r="46"/>']);
  const accent = pick(r, [
    `<rect y="74" width="100" height="26" fill="${c2}"/>`,
    `<polygon points="60,100 100,60 100,100" fill="${c2}"/>`,
    `<rect x="0" width="14" height="100" fill="${c2}"/><rect x="86" width="14" height="100" fill="${c2}"/>`,
  ]);
  return `<svg viewBox="0 0 100 100"><defs><clipPath id="${id}">${shape}</clipPath></defs>
    <g clip-path="url(#${id})"><rect width="100" height="100" fill="${c1}"/>${accent}</g>
    <text x="50" y="${text.length > 1 ? 63 : 67}" text-anchor="middle" font-size="${text.length > 1 ? 40 : 52}" font-weight="900" letter-spacing="-2" fill="${ink(c1)}">${esc(text)}</text>
    <g fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2">${shape}</g></svg>`;
}

// ---------- 시안 D: 현대 추상 ----------
function abstractMark(club, r) {
  const { primary: c1, secondary: c2 } = club.colors;
  const line = 'stroke="rgba(255,255,255,.3)" stroke-width="2"';
  const marks = [
    () => `<polygon points="50,4 96,50 50,96 4,50" fill="${c1}" ${line}/><polygon points="50,4 96,50 50,96" fill="${c2}"/><polygon points="50,28 72,50 50,72 28,50" fill="none" stroke="${ink(c1)}" stroke-width="5"/>`,
    () => `<path d="M10,40 L50,10 L90,40" stroke="${c1}" stroke-width="18" fill="none" stroke-linejoin="miter"/><path d="M10,70 L50,40 L90,70" stroke="${c2}" stroke-width="18" fill="none"/><path d="M22,92 L50,72 L78,92" stroke="${c1}" stroke-width="12" fill="none"/>`,
    () => `<polygon points="50,3 91,26 91,74 50,97 9,74 9,26" fill="${c1}" ${line}/><polygon points="62,3 91,20 91,40 38,97 9,80 9,60" fill="${c2}" opacity=".95"/>`,
    () => `<circle cx="50" cy="50" r="45" fill="${c1}" ${line}/><circle cx="64" cy="42" r="30" fill="${c2}"/><polygon points="${starPoints(30, 64, 13, 5)}" fill="${ink(c1)}"/>`,
    () => `<polygon points="50,6 94,92 6,92" fill="${c1}" ${line}/><polygon points="50,40 74,86 26,86" fill="${c2}"/>`,
  ];
  return `<svg viewBox="0 0 100 100">${pick(r, marks)()}</svg>`;
}

// ---------- 그리기 ----------
const DRAW = { A: shield, B: roundel, C: monogram, D: abstractMark };
function svgFor(club, px, v = variant) {
  const r = rngOf(hashStr(`${club.id}|${club.name}`));
  let key = v;
  if (v === 'E') { const x = r(); key = x < 0.45 ? 'A' : x < 0.75 ? 'B' : x < 0.85 ? 'C' : 'D'; }
  return DRAW[key](club, r, px);
}
const PX = { '': 18, big: 40 };
function crestHtml(club, size, px = PX[size] ?? 18) {
  seen.set(club.id, club);
  return `<span class="crest ${size}" data-club="${club.id}" data-px="${px}" style="width:${px}px;height:${px}px">${svgFor(club, px)}</span>`;
}
globalThis.__crestPrototype = (club, size = '') => crestHtml(club, size);

function redraw() {
  for (const el of document.querySelectorAll('.crest[data-club]')) {
    const club = seen.get(Number(el.dataset.club)) ?? seen.get(el.dataset.club);
    if (club) el.innerHTML = svgFor(club, Number(el.dataset.px));
  }
  label.textContent = `로고 시안 ${variant} · ${VARIANTS.find(([k]) => k === variant)[1]}`;
  if (gallery.isConnected) fillGallery();
}

// ---------- 스타일 ----------
const style = document.createElement('style');
style.textContent = `
.crest { display: inline-block; vertical-align: middle; margin-right: 6px; flex-shrink: 0; }
.crest.big { margin: 0; }
.crest svg { width: 100%; height: 100%; display: block; overflow: visible; font-family: inherit; }
.proto-bar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 9999; display: flex; gap: 6px; align-items: center;
  background: #fff; color: #111; border-radius: 999px; padding: 6px 8px; box-shadow: 0 6px 24px rgba(0,0,0,.5); font: 600 13px/1 system-ui, sans-serif; }
.proto-bar button { border: 0; background: #eee; color: #111; border-radius: 999px; padding: 7px 12px; cursor: pointer; font: inherit; }
.proto-bar button:hover { background: #ddd; }
.proto-bar .lbl { padding: 0 8px; min-width: 150px; text-align: center; }
.proto-gallery { position: fixed; inset: 0; z-index: 9998; background: rgba(0,0,0,.75); overflow: auto; padding: 32px 16px 90px; }
.proto-gallery .inner { max-width: 1100px; margin: 0 auto; background: var(--panel, #181b1f); border-radius: 12px; padding: 20px; }
.proto-gallery h2 { margin: 0 0 4px; font-size: 18px; }
.proto-gallery .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 16px; }
.proto-gallery .cell { display: flex; gap: 10px; align-items: flex-end; padding: 10px; border-radius: 8px; background: rgba(255,255,255,.04); }
.proto-gallery .cell .nm { font-size: 12px; color: var(--muted, #aaa); margin-top: 6px; }
`;
document.head.append(style);

// ---------- 아래쪽 전환 막대 ----------
const bar = document.createElement('div');
bar.className = 'proto-bar';
const prev = Object.assign(document.createElement('button'), { textContent: '←', title: '이전 시안 (←)' });
const next = Object.assign(document.createElement('button'), { textContent: '→', title: '다음 시안 (→)' });
const label = Object.assign(document.createElement('span'), { className: 'lbl' });
const galleryBtn = Object.assign(document.createElement('button'), { textContent: '모아 보기', title: '지금까지 화면에 나온 구단 로고를 크기별로 봅니다 (G)' });
bar.append(prev, label, next, galleryBtn);

function setVariant(step) {
  const i = VARIANTS.findIndex(([k]) => k === variant);
  variant = VARIANTS[(i + step + VARIANTS.length) % VARIANTS.length][0];
  const url = new URL(location.href); url.searchParams.set('crest', variant);
  history.replaceState(null, '', url);
  redraw();
}
prev.onclick = () => setVariant(-1);
next.onclick = () => setVariant(1);

const gallery = document.createElement('div');
gallery.className = 'proto-gallery';
gallery.onclick = (e) => { if (e.target === gallery) gallery.remove(); };
function fillGallery() {
  const clubs = [...seen.values()].slice(0, 60);
  gallery.innerHTML = `<div class="inner"><h2>로고 모아 보기 · 시안 ${variant}</h2>
    <div class="muted small">지금까지 화면에 나온 구단 ${seen.size}개 (최대 60개). 표 크기 18px · 사이드바 40px · 상세 96px. 순위 탭을 열어 두면 리그 전체가 모입니다. 바깥을 누르면 닫힙니다.</div>
    <div class="grid">${clubs.map((c) => `<div class="cell">${crestHtml(c, '', 18)}${crestHtml(c, '', 40)}${crestHtml(c, '', 96)}<div><div>${esc(c.name)}</div><div class="nm">${initials(c)}</div></div></div>`).join('')}</div></div>`;
}
galleryBtn.onclick = () => { if (gallery.isConnected) gallery.remove(); else { fillGallery(); document.body.append(gallery); } };

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'ArrowLeft') setVariant(-1);
  else if (e.key === 'ArrowRight') setVariant(1);
  else if (e.key === 'g' || e.key === 'G') galleryBtn.onclick();
  else if (e.key === 'Escape') gallery.remove();
});

const mount = () => { document.body.append(bar); redraw(); };
if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);
