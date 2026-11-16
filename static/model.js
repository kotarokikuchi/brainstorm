// Lógica pura do editor: árvore, layouts, navegação e histórico (sem DOM).

export const PALETTE = [
  '#2f5bea', '#f2b705', '#8b3fd9', '#f97316', '#e43fa4', '#e5383b',
  '#5cb85c', '#14b8a6', '#3b9cf5', '#12a150', '#a16207', '#6b7280',
];

export const uid = () =>
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

// ---- Estilo ----

// forma desenhada: a escolhida; senão o padrão do nível (raiz sem caixa, 1º nível pílula,
// demais sublinhado) — mas qualquer cor/borda/"sem preenchimento" num nó sem forma vira caixa
export function effectiveShape(n, depth) {
  if (n.shape) return n.shape;
  if (depth === 1) return 'pill';
  if (n.color || n.fillNone || n.borderColor || n.borderWidth || n.borderStyle || n.image) return 'rounded';
  return depth === 0 ? 'none' : 'underline';
}

export const MARKERS = ['none', 'arrow', 'open', 'triangle', 'triangle-open', 'diamond', 'diamond-open', 'dot', 'dot-open'];
// formas no espaço 10×10 do marcador, ponta em (10, 5); C = cor
const MARKER_SHAPES = {
  arrow: '<path d="M0,0 L10,5 L0,10 L3,5 z" fill="C"/>',
  open: '<path d="M1,1 L9,5 L1,9" fill="none" stroke="C" stroke-width="1.6"/>',
  triangle: '<path d="M0,0 L10,5 L0,10 z" fill="C"/>',
  'triangle-open': '<path d="M1,1 L9,5 L1,9 z" fill="#fff" stroke="C" stroke-width="1.4"/>',
  diamond: '<path d="M0,5 L5,1 L10,5 L5,9 z" fill="C"/>',
  'diamond-open': '<path d="M1,5 L5,1.5 L9,5 L5,8.5 z" fill="#fff" stroke="C" stroke-width="1.4"/>',
  dot: '<circle cx="5" cy="5" r="4" fill="C"/>',
  'dot-open': '<circle cx="5" cy="5" r="3.5" fill="#fff" stroke="C" stroke-width="1.4"/>',
};

// cor vinda do arquivo do mapa só entra em marcação se for hexadecimal (ou currentColor)
export const safeColor = (c) => (c === 'currentColor' || /^#[0-9a-fA-F]{3,8}$/.test(c ?? '') ? c : '#22a559');

// marcação SVG da ponta; null para "nenhuma" ou tipo desconhecido
export function markerShape(type, color) {
  if (!Object.hasOwn(MARKER_SHAPES, type)) return null;
  return MARKER_SHAPES[type].replaceAll('C', safeColor(color));
}

const node = (text = '') => ({
  id: uid(), text, color: null, shape: null, collapsed: false, side: null, children: [],
});

export function newMap(id) {
  return { id, version: 0, layout: 'map', root: node('Mapa central'), links: [] };
}

export function findNode(root, id, parent = null, depth = 0) {
  if (root.id === id) return { node: root, parent, depth };
  for (const c of root.children) {
    const hit = findNode(c, id, root, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// lado da raiz com menos filhos (empate → direita)
function balancedSide(root) {
  const right = root.children.filter(c => c.side === 'right').length;
  return root.children.length - right < right ? 'left' : 'right';
}

export function addChild(map, parentId) {
  const parent = findNode(map.root, parentId).node;
  const n = node();
  if (parent === map.root) {
    n.side = balancedSide(parent);
    n.color = PALETTE[parent.children.length % PALETTE.length];
  }
  parent.collapsed = false;
  parent.children.push(n);
  return n;
}

export function addSibling(map, nodeId) {
  const hit = findNode(map.root, nodeId);
  if (!hit.parent) return addChild(map, nodeId);
  const n = node();
  n.side = hit.node.side;
  if (hit.parent === map.root) n.color = PALETTE[map.root.children.length % PALETTE.length];
  const kids = hit.parent.children;
  kids.splice(kids.indexOf(hit.node) + 1, 0, n);
  return n;
}

export function removeNode(map, nodeId) {
  const hit = findNode(map.root, nodeId);
  if (!hit || !hit.parent) return null;
  const kids = hit.parent.children;
  kids.splice(kids.indexOf(hit.node), 1);
  // ligações que tocam qualquer nó do ramo apagado somem junto
  if (map.links?.length) {
    const gone = new Set();
    const walk = (n) => { gone.add(n.id); n.children.forEach(walk); };
    walk(hit.node);
    map.links = map.links.filter(k => !gone.has(k.from) && !gone.has(k.to));
  }
  return hit.parent.id;
}

// ---- Ligações (setas livres entre dois nós) ----
export function addLink(map, from, to) {
  if (from === to || !findNode(map.root, from) || !findNode(map.root, to)) return null;
  map.links ??= [];
  if (map.links.some(k => k.from === from && k.to === to)) return null;
  const link = { id: uid(), from, to };
  map.links.push(link);
  return link;
}

export function removeLink(map, linkId) {
  const before = map.links?.length ?? 0;
  map.links = (map.links ?? []).filter(k => k.id !== linkId);
  return map.links.length < before;
}

// curva automática entre os lados mais próximos das duas caixas: [p1, c1, c2, p2]
function autoCurve(a, b) {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  let p1, p2, c1, c2;
  if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
    const s = Math.sign(bx - ax) || 1;
    p1 = [ax + s * a.w / 2, ay];
    p2 = [bx - s * b.w / 2, by];
    const d = Math.max(40, Math.abs(p2[0] - p1[0]) / 2) * s;
    c1 = [p1[0] + d, p1[1]];
    c2 = [p2[0] - d, p2[1]];
  } else {
    // nós empilhados: sai e chega pelo lado de fora (longe da raiz) num arco
    const s = Math.sign(ax + bx) || 1;
    p1 = [s > 0 ? a.x + a.w : a.x, ay];
    p2 = [s > 0 ? b.x + b.w : b.x, by];
    const d = Math.max(50, Math.abs(by - ay) / 3) * s;
    c1 = [p1[0] + d, p1[1]];
    c2 = [p2[0] + d, p2[1]];
  }
  return [p1, c1, c2, p2];
}

const NORMAL = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const sidePoint = (b, side) => ({
  top: [b.x + b.w / 2, b.y], right: [b.x + b.w, b.y + b.h / 2],
  bottom: [b.x + b.w / 2, b.y + b.h], left: [b.x, b.y + b.h / 2],
}[side]);

// lado da caixa cujo meio fica mais perto do ponto
export function sideToward(b, [px, py]) {
  return Object.keys(NORMAL).reduce((best, side) => {
    const [x, y] = sidePoint(b, side), [bx, by] = sidePoint(b, best);
    return Math.hypot(x - px, y - py) < Math.hypot(bx - px, by - py) ? side : best;
  });
}

// curva saindo/chegando pelos lados escolhidos (lado ausente: o que aponta para o outro nó)
function sidedCurve(a, b, fromSide, toSide) {
  const s1 = fromSide || sideToward(a, center(b)), s2 = toSide || sideToward(b, center(a));
  const p1 = sidePoint(a, s1), p2 = sidePoint(b, s2);
  const d = Math.round(Math.max(40, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3));
  return [p1, [p1[0] + NORMAL[s1][0] * d, p1[1] + NORMAL[s1][1] * d], [p2[0] + NORMAL[s2][0] * d, p2[1] + NORMAL[s2][1] * d], p2];
}
const curveOf = (a, b, fromSide, toSide) => (fromSide || toSide ? sidedCurve(a, b, fromSide, toSide) : autoCurve(a, b));

// ponto de controle arrastável: meio da curva automática, ou meio dos centros + bend [dx, dy]
export function linkHandle(a, b, bend, fromSide, toSide) {
  if (bend) return [(a.x + a.w / 2 + b.x + b.w / 2) / 2 + bend[0], (a.y + a.h / 2 + b.y + b.h / 2) / 2 + bend[1]];
  const [p1, c1, c2, p2] = curveOf(a, b, fromSide, toSide);
  return [0, 1].map(i => (p1[i] + 3 * c1[i] + 3 * c2[i] + p2[i]) / 8);
}

// atributo d da seta; com bend vira quadrática que passa pelo ponto de controle
export function linkPath(a, b, bend, fromSide, toSide) {
  if (!bend) {
    const [p1, c1, c2, p2] = curveOf(a, b, fromSide, toSide);
    return `M${p1} C${c1} ${c2} ${p2}`;
  }
  const h = linkHandle(a, b, bend);
  const p1 = sidePoint(a, fromSide || sideToward(a, h)), p2 = sidePoint(b, toSide || sideToward(b, h));
  const c = [0, 1].map(i => 2 * h[i] - (p1[i] + p2[i]) / 2);
  return `M${p1} Q${c} ${p2}`;
}

// move o ramo para parentId na posição index; recusa raiz, o próprio nó e descendentes
export function moveNode(map, nodeId, parentId, index, side = null) {
  const hit = findNode(map.root, nodeId);
  if (!hit || !hit.parent || findNode(hit.node, parentId)) return false;
  const target = findNode(map.root, parentId)?.node;
  if (!target) return false;
  const n = hit.node, from = hit.parent.children, oldIdx = from.indexOf(n);
  from.splice(oldIdx, 1);
  if (hit.parent === target && oldIdx < index) index--;
  index = Math.max(0, Math.min(index, target.children.length));
  if (target === map.root) {
    n.side = side || n.side || balancedSide(target);
    if (!n.color) n.color = PALETTE[target.children.length % PALETTE.length];
  } else {
    if (hit.parent === map.root) n.color = null;  // cor era do ramo de 1º nível: passa a herdar
    n.side = null;
  }
  target.collapsed = false;
  target.children.splice(index, 0, n);
  return true;
}

// cola uma cópia profunda (ids novos) do ramo como último filho de parentId
export function pasteBranch(map, parentId, branch) {
  const clone = (n) => ({ ...n, id: uid(), children: n.children.map(clone) });
  const n = clone(branch);
  const parent = findNode(map.root, parentId).node;
  if (parent === map.root) {
    n.side = balancedSide(parent);
    n.color ||= PALETTE[parent.children.length % PALETTE.length];
  } else {
    if (branch.side) n.color = null;  // era 1º nível: passa a herdar a cor do novo ramo
    n.side = null;
  }
  parent.collapsed = false;
  parent.children.push(n);
  return n;
}

// onde um ramo arrastado cairia com o ponteiro em (px, py): {parentId, index, side} ou null
export function dropTarget(map, boxes, dragId, px, py) {
  const drag = findNode(map.root, dragId)?.node;
  if (!drag) return null;
  const banned = new Set();
  const ban = (n) => { banned.add(n.id); n.children.forEach(ban); };
  ban(drag);
  let best = null, bestD = Infinity;
  for (const b of boxes) {
    if (banned.has(b.id)) continue;
    const dx = Math.max(b.x - px, 0, px - b.x - b.w), dy = Math.max(b.y - py, 0, py - b.y - b.h);
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = b; }
  }
  if (!best || bestD > 120) return null;
  const root = map.root;
  // ponytail: soltar perto da raiz sempre anexa no fim; ordenar por posição se fizer falta
  if (best.id === root.id) {
    const side = map.layout === 'map' ? (px < best.x + best.w / 2 ? 'left' : 'right') : null;
    return { parentId: root.id, index: root.children.length, side };
  }
  const hit = findNode(root, best.id);
  const outer = map.layout === 'org' ? py > best.y + best.h * 0.75
    : best.side === 'left' && map.layout === 'map' ? px < best.x + best.w * 0.25
      : px > best.x + best.w * 0.75;
  if (outer) return { parentId: best.id, index: hit.node.children.length, side: null };
  const after = map.layout === 'org' ? px > best.x + best.w / 2 : py > best.y + best.h / 2;
  return {
    parentId: hit.parent.id,
    index: hit.parent.children.indexOf(hit.node) + (after ? 1 : 0),
    side: hit.parent === root ? best.side : null,
  };
}

export function commitText(map, nodeId, text, isNew) {
  const n = findNode(map.root, nodeId).node;
  const t = text.trim();
  if (t) {
    n.text = t;
    return nodeId;
  }
  return isNew ? removeNode(map, nodeId) ?? nodeId : nodeId;
}

export function branchColor(root, nodeId) {
  let color = '#222';
  const walk = (n) => {
    if (n.id === nodeId) {
      if (n !== root && n.color) color = n.color;
      return true;
    }
    for (const c of n.children) {
      if (walk(c)) {
        if (color === '#222' && n !== root && n.color) color = n.color;
        return true;
      }
    }
    return false;
  };
  walk(root);
  return color;
}

export class History {
  constructor(limit = 100) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }
  push(state) {
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    return this.past.pop();
  }
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    return this.future.pop();
  }
}

// ---- Layouts ----
// Cada layout devolve caixas (canto superior esquerdo + tamanho) e arestas pai→filho.
// measure(node, depth) -> {w, h} é injetado: no navegador mede via canvas (texto, fonte, largura fixa,
// imagem e ícones do nó); nos testes é fixo.

const visible = (n) => (n.collapsed ? [] : n.children);

// focusId: desenha só aquele ramo, como centro do mapa (modo foco), mantendo a cor do ramo
export function layout(map, measure, focusId = null) {
  const nodes = [], edges = [];
  const box = (n, depth, color, side) => {
    const { w, h } = measure(n, depth);
    const b = { id: n.id, x: 0, y: 0, w, h, depth, color, shape: effectiveShape(n, depth), side };
    nodes.push(b);
    return b;
  };
  const colorOf = (n, parentColor, depth) => (depth > 0 && n.color) || parentColor;
  const fn = { map: layoutMap, org: layoutOrg, list: layoutList }[map.layout] || layoutMap;
  const focus = focusId && focusId !== map.root.id ? findNode(map.root, focusId)?.node : null;
  const root = focus ?? map.root;
  const rootColor = focus ? branchColor(map.root, focus.id) : map.root.color || '#222';
  fn(root, measure, box, colorOf, edges, rootColor);
  return { nodes, edges };
}

function layoutMap(root, measure, box, colorOf, edges, rootColor) {
  const GAP_Y = 12;
  const heights = new Map();
  const subH = (n, depth) => {
    const kids = visible(n);
    const own = measure(n, depth).h;
    const sum = kids.reduce((s, c) => s + subH(c, depth + 1), 0) + GAP_Y * Math.max(0, kids.length - 1);
    const h = Math.max(own, sum);
    heights.set(n.id, h);
    return h;
  };
  // empilha filhos centrados em centerY, a partir da borda xEdge, para o lado indicado
  const stack = (parentBox, kids, depth, side, xEdge, centerY, color) => {
    const total = kids.reduce((s, c) => s + heights.get(c.id), 0) + GAP_Y * Math.max(0, kids.length - 1);
    let y = centerY - total / 2;
    for (const c of kids) {
      const h = heights.get(c.id);
      place(parentBox, c, depth, side, xEdge, y + h / 2, color);
      y += h + GAP_Y;
    }
  };
  const place = (parentBox, n, depth, side, xEdge, centerY, parentColor) => {
    const color = colorOf(n, parentColor, depth);
    const b = box(n, depth, color, side);
    b.x = side === 'right' ? xEdge : xEdge - b.w;
    b.y = centerY - b.h / 2;
    edges.push({ from: parentBox, to: b, color, depth });
    const next = side === 'right' ? b.x + b.w + 36 : b.x - 36;
    stack(b, visible(n), depth + 1, side, next, centerY, color);
  };
  subH(root, 0);
  const r = box(root, 0, rootColor, null);
  r.x = -r.w / 2;
  r.y = -r.h / 2;
  const kids = visible(root);
  stack(r, kids.filter(c => c.side !== 'left'), 1, 'right', r.x + r.w + 60, 0, rootColor);
  stack(r, kids.filter(c => c.side === 'left'), 1, 'left', r.x - 60, 0, rootColor);
}

function layoutOrg(root, measure, box, colorOf, edges, rootColor) {
  const GAP_X = 24, GAP_Y = 60;
  const widths = new Map();
  const subW = (n, depth) => {
    const kids = visible(n);
    const sum = kids.reduce((s, c) => s + subW(c, depth + 1), 0) + GAP_X * Math.max(0, kids.length - 1);
    const w = Math.max(measure(n, depth).w, sum);
    widths.set(n.id, w);
    return w;
  };
  const place = (parentBox, n, depth, centerX, top, parentColor) => {
    const color = depth === 0 ? parentColor : colorOf(n, parentColor, depth);
    const b = box(n, depth, color, null);
    b.x = centerX - b.w / 2;
    b.y = top;
    if (parentBox) edges.push({ from: parentBox, to: b, color, depth });
    const kids = visible(n);
    const total = kids.reduce((s, c) => s + widths.get(c.id), 0) + GAP_X * Math.max(0, kids.length - 1);
    let x = centerX - total / 2;
    for (const c of kids) {
      const w = widths.get(c.id);
      place(b, c, depth + 1, x + w / 2, b.y + b.h + GAP_Y, color);
      x += w + GAP_X;
    }
  };
  subW(root, 0);
  place(null, root, 0, 0, -measure(root, 0).h / 2, rootColor);
}

function layoutList(root, measure, box, colorOf, edges, rootColor) {
  let y = 0, x0 = 0;
  const place = (parentBox, n, depth, parentColor) => {
    const color = depth === 0 ? parentColor : colorOf(n, parentColor, depth);
    const b = box(n, depth, color, null);
    if (depth === 0) {
      x0 = -b.w / 2;
      y = -b.h / 2;
    }
    b.x = x0 + depth * 32;
    b.y = y;
    y += b.h + 8;
    if (parentBox) edges.push({ from: parentBox, to: b, color, depth });
    for (const c of visible(n)) place(b, c, depth + 1, color);
  };
  place(null, root, 0, rootColor);
}

export function edgePath(layoutName, a, b) {
  if (layoutName === 'org') {
    const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y, my = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
  }
  if (layoutName === 'list') {
    return `M${a.x + 12},${a.y + a.h} V${b.y + b.h / 2} H${b.x}`;
  }
  // nós sublinhados (profundidade ≥ 2, sem forma) ligam pela linha de baixo
  const anchorY = (n) => (n.shape === 'underline' ? n.y + n.h : n.y + n.h / 2);
  const right = b.x >= a.x + a.w / 2;
  const x1 = right ? a.x + a.w : a.x, y1 = anchorY(a);
  const x2 = right ? b.x : b.x + b.w, y2 = anchorY(b), mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

// nó mais próximo na direção (peso 2× no eixo perpendicular); sem candidato fica parado
export function navigate(boxes, fromId, dir) {
  const c = (b) => [b.x + b.w / 2, b.y + b.h / 2];
  const from = boxes.find(b => b.id === fromId);
  if (!from) return fromId;
  const [fx, fy] = c(from);
  let best = fromId, bestScore = Infinity;
  for (const b of boxes) {
    if (b === from) continue;
    const [x, y] = c(b);
    const dx = x - fx, dy = y - fy;
    const ahead = { right: dx, left: -dx, down: dy, up: -dy }[dir];
    if (ahead <= 1) continue;
    const side = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = ahead + 2 * side;
    if (score < bestScore) { bestScore = score; best = b.id; }
  }
  return best;
}

// ---- Estilo: nuvem e contorno do ramo ----

// contorno de nuvem: arcos para fora ao longo do perímetro (sentido horário)
export function cloudPath({ x, y, w, h }) {
  const pts = [];
  const edge = (x1, y1, x2, y2) => {
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 22));
    for (let i = 0; i < n; i++) pts.push([x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
  };
  edge(x, y, x + w, y);
  edge(x + w, y, x + w, y + h);
  edge(x + w, y + h, x, y + h);
  edge(x, y + h, x, y);
  const r = (a, b) => (Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.62).toFixed(1);
  const arcs = pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return `A${r(p, q)},${r(p, q)} 0 0 1 ${q[0].toFixed(1)},${q[1].toFixed(1)}`; });
  return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} ${arcs.join(' ')} Z`;
}

// retângulo que envolve o nó e seus descendentes visíveis, com folga pad
export function branchBounds(map, boxes, nodeId, pad = 12) {
  const ids = new Set();
  const walk = (n) => { ids.add(n.id); if (!n.collapsed) n.children.forEach(walk); };
  walk(findNode(map.root, nodeId).node);
  const bs = boxes.filter(b => ids.has(b.id));
  const x = Math.min(...bs.map(b => b.x)) - pad, y = Math.min(...bs.map(b => b.y)) - pad;
  return { x, y, w: Math.max(...bs.map(b => b.x + b.w)) + pad - x, h: Math.max(...bs.map(b => b.y + b.h)) + pad - y };
}

// quebra gulosa por palavras para caber em maxW; palavra maior que a largura fica inteira
export function wrapLines(text, maxW, widthOf) {
  const lines = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && widthOf(next) > maxW) { lines.push(cur); cur = word; } else cur = next;
  }
  lines.push(cur);
  return lines;
}

// ---- Link (URL) no nó ----
// só http(s); sem esquema vira https://; qualquer outro esquema (javascript:, data:...) é recusado
export function safeUrl(input) {
  const s = (input ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  try {
    const u = new URL(hasScheme ? s : `https://${s}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// ---- Outline: recuar (vira último filho do irmão anterior) / desrecuar (sobe para depois do pai) ----
export function indentNode(map, nodeId) {
  const hit = findNode(map.root, nodeId);
  const i = hit?.parent ? hit.parent.children.indexOf(hit.node) : -1;
  if (i < 1) return false;
  const prev = hit.parent.children[i - 1];
  return moveNode(map, nodeId, prev.id, prev.children.length);
}

export function outdentNode(map, nodeId) {
  const hit = findNode(map.root, nodeId);
  if (!hit?.parent || hit.parent === map.root) return false;
  const grand = findNode(map.root, hit.parent.id).parent;
  return moveNode(map, nodeId, grand.id, grand.children.indexOf(hit.parent) + 1, hit.parent.side);
}

// ---- Exportar: Markdown (raiz = título, ramos = lista com recuo; tudo, mesmo recolhido) ----
export function toMarkdown(map) {
  const esc = (t) => t.replace(/([\\[\]*_`#])/g, '\\$1');
  const item = (n) => {
    const url = safeUrl(n.url);
    return url ? `[${esc(n.text)}](${url})` : esc(n.text);
  };
  const lines = [`# ${item(map.root)}`, ''];
  const walk = (n, depth) => {
    for (const c of n.children) {
      lines.push(`${'  '.repeat(depth)}- ${item(c)}`);
      walk(c, depth + 1);
    }
  };
  walk(map.root, 0);
  return lines.join('\n') + '\n';
}
