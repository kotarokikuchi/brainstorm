// Lógica pura da lousa (sem DOM): elementos, traço "à mão" com semente, limites.

export const DEFAULTS = {
  strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'hachure',
  strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
};

const POINT_TYPES = new Set(['line', 'arrow', 'freedraw']);
const starts = new WeakMap();  // ponto onde o arrasto começou (só durante o desenho)

const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const f = (n) => Math.round(n * 100) / 100;

// gerador pseudoaleatório (mulberry32): o mesmo elemento sempre "treme" igual
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createElement(type, [x, y], opts = {}) {
  const el = { id: uid(), type, x, y, w: 0, h: 0, ...DEFAULTS, seed: Math.floor(Math.random() * 2 ** 31), ...opts };
  if (type === 'freedraw') el.points = [[0, 0]];
  else if (POINT_TYPES.has(type)) el.points = [[0, 0], [0, 0]];
  starts.set(el, [x, y]);
  return el;
}

// atualiza o elemento enquanto o ponteiro arrasta até [px, py]
export function resizeTo(el, [px, py]) {
  if (el.type === 'freedraw') el.points.push([px - el.x, py - el.y]);
  else if (POINT_TYPES.has(el.type)) el.points[el.points.length - 1] = [px - el.x, py - el.y];
  else {
    const [sx, sy] = starts.get(el) ?? [el.x, el.y];
    Object.assign(el, { x: Math.min(sx, px), y: Math.min(sy, py), w: Math.abs(px - sx), h: Math.abs(py - sy) });
  }
  return el;
}

export function elementBounds(el) {
  if (!el.points) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const xs = el.points.map(p => p[0]), ys = el.points.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x: el.x + x, y: el.y + y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// segmento levemente curvo e deslocado; desleixo 0 = reto
export function roughLine(x1, y1, x2, y2, r, roughness) {
  if (!roughness) return `M${f(x1)},${f(y1)} Q${f((x1 + x2) / 2)},${f((y1 + y2) / 2)} ${f(x2)},${f(y2)}`;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const off = Math.min(len * 0.08, 2.5) * roughness, j = () => (r() * 2 - 1) * off;
  const bow = (r() * 2 - 1) * len * 0.015 * roughness;
  const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
  const mx = (x1 + x2) / 2 + nx * bow, my = (y1 + y2) / 2 + ny * bow;
  return `M${f(x1 + j())},${f(y1 + j())} Q${f(mx + j())},${f(my + j())} ${f(x2 + j())},${f(y2 + j())}`;
}

const polyline = (pts, r, roughness) =>
  pts.slice(1).map((p, i) => roughLine(pts[i][0], pts[i][1], p[0], p[1], r, roughness)).join(' ');

function ellipsePath(el, r, roughness) {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2, n = 32;
  const start = roughness ? r() * Math.PI * 2 : 0, wob = () => 1 + (roughness ? (r() * 2 - 1) * 0.015 * roughness : 0);
  const pts = [];
  // um pouco além da volta completa quando "à mão", como um traço que não fecha perfeito
  for (let i = 0; i <= n + (roughness ? 2 : 0); i++) {
    const a = start + (i / n) * Math.PI * 2, k = wob();
    pts.push(`${f(cx + Math.cos(a) * el.w / 2 * k)},${f(cy + Math.sin(a) * el.h / 2 * k)}`);
  }
  return `M${pts[0]} L${pts.slice(1).join(' ')}${roughness ? '' : ' Z'}`;
}

function freedrawPath(el) {
  const p = el.points.map(([x, y]) => [el.x + x, el.y + y]);
  if (p.length < 3) return `M${p.map(q => `${f(q[0])},${f(q[1])}`).join(' L')}`;
  let d = `M${f(p[0][0])},${f(p[0][1])} `;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
    d += `Q${f(p[i][0])},${f(p[i][1])} ${f(mx)},${f(my)} `;
  }
  const last = p[p.length - 1];
  return d + `L${f(last[0])},${f(last[1])}`;
}

function arrowHead(pts, r, roughness) {
  const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, size = Math.min(20, len * 0.3);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return [-1, 1].map(s => {
    const t = ang + Math.PI - s * Math.PI / 7;
    return roughLine(b[0], b[1], b[0] + Math.cos(t) * size, b[1] + Math.sin(t) * size, r, roughness);
  }).join(' ');
}

// atributos "d" do traço; duas passadas quando há desleixo (efeito de esboço)
export function elementPaths(el) {
  if (el.type === 'freedraw') return [freedrawPath(el)];
  const passes = el.roughness ? 2 : 1, out = [];
  const abs = el.points?.map(([x, y]) => [el.x + x, el.y + y]);
  for (let pass = 0; pass < passes; pass++) {
    const r = rng(el.seed + pass), rough = el.roughness;
    const { x, y, w, h } = el;
    if (el.type === 'rectangle') out.push(polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], r, rough));
    else if (el.type === 'diamond') out.push(polyline([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2], [x + w / 2, y]], r, rough));
    else if (el.type === 'ellipse') out.push(ellipsePath(el, r, rough));
    else if (el.type === 'line' || el.type === 'arrow') out.push(polyline(abs, r, rough));
  }
  if (el.type === 'arrow') out.push(arrowHead(abs, rng(el.seed + 7), el.roughness));
  return out;
}

// contorno liso para o preenchimento (sólido ou hachurado) das formas fechadas
export function fillPath(el) {
  const { x, y, w, h } = el;
  if (el.type === 'rectangle') return `M${f(x)},${f(y)} H${f(x + w)} V${f(y + h)} H${f(x)} Z`;
  if (el.type === 'diamond') return `M${f(x + w / 2)},${f(y)} L${f(x + w)},${f(y + h / 2)} L${f(x + w / 2)},${f(y + h)} L${f(x)},${f(y + h / 2)} Z`;
  if (el.type === 'ellipse') return ellipsePath({ ...el, roughness: 0 }, null, 0);
  return null;
}
