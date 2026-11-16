// Lógica pura do editor: árvore, layouts, navegação e histórico (sem DOM).

export const PALETTE = [
  '#2f5bea', '#f2b705', '#8b3fd9', '#f97316', '#e43fa4', '#e5383b',
  '#5cb85c', '#14b8a6', '#3b9cf5', '#12a150', '#a16207', '#6b7280',
];

export const uid = () =>
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

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

// curva entre os lados mais próximos das duas caixas (horizontal ou vertical)
export function linkPath(a, b) {
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
  return `M${p1} C${c1} ${c2} ${p2}`;
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
// measure(text, depth) -> {w, h} é injetado: no navegador mede via SVG, nos testes é fixo.

const visible = (n) => (n.collapsed ? [] : n.children);

export function layout(map, measure) {
  const nodes = [], edges = [];
  const box = (n, depth, color, side) => {
    const { w, h } = measure(n.text, depth);
    const b = { id: n.id, x: 0, y: 0, w, h, depth, color, shape: n.shape, side };
    nodes.push(b);
    return b;
  };
  const colorOf = (n, parentColor, depth) => (depth > 0 && n.color) || parentColor;
  const fn = { map: layoutMap, org: layoutOrg, list: layoutList }[map.layout] || layoutMap;
  fn(map.root, measure, box, colorOf, edges);
  return { nodes, edges };
}

function layoutMap(root, measure, box, colorOf, edges) {
  const GAP_Y = 12;
  const heights = new Map();
  const subH = (n, depth) => {
    const kids = visible(n);
    const own = measure(n.text, depth).h;
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
  const r = box(root, 0, root.color || '#222', null);
  r.x = -r.w / 2;
  r.y = -r.h / 2;
  const kids = visible(root);
  stack(r, kids.filter(c => c.side !== 'left'), 1, 'right', r.x + r.w + 60, 0, '#222');
  stack(r, kids.filter(c => c.side === 'left'), 1, 'left', r.x - 60, 0, '#222');
}

function layoutOrg(root, measure, box, colorOf, edges) {
  const GAP_X = 24, GAP_Y = 60;
  const widths = new Map();
  const subW = (n, depth) => {
    const kids = visible(n);
    const sum = kids.reduce((s, c) => s + subW(c, depth + 1), 0) + GAP_X * Math.max(0, kids.length - 1);
    const w = Math.max(measure(n.text, depth).w, sum);
    widths.set(n.id, w);
    return w;
  };
  const place = (parentBox, n, depth, centerX, top, parentColor) => {
    const color = depth === 0 ? n.color || '#222' : colorOf(n, parentColor, depth);
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
  place(null, root, 0, 0, -measure(root.text, 0).h / 2, '#222');
}

function layoutList(root, measure, box, colorOf, edges) {
  let y = 0, x0 = 0;
  const place = (parentBox, n, depth, parentColor) => {
    const color = depth === 0 ? n.color || '#222' : colorOf(n, parentColor, depth);
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
  place(null, root, 0, '#222');
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
  const anchorY = (n) => (n.depth >= 2 && !n.shape ? n.y + n.h : n.y + n.h / 2);
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
