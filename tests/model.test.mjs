import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, uid, newMap, findNode, addChild, addSibling, removeNode,
  commitText, branchColor, History,
} from '../static/model.js';

test('newMap has central root and version 0', () => {
  const m = newMap('abc');
  assert.equal(m.id, 'abc');
  assert.equal(m.version, 0);
  assert.equal(m.layout, 'map');
  assert.equal(m.root.text, 'Mapa central');
  assert.deepEqual(m.root.children, []);
  assert.match(uid(), /^[a-z0-9-]{1,64}$/);
  assert.notEqual(uid(), uid());
});

test('addChild balances sides and assigns palette colors', () => {
  const m = newMap('a');
  const kids = [1, 2, 3].map(() => addChild(m, m.root.id));
  assert.deepEqual(kids.map(k => k.side), ['right', 'left', 'right']);
  assert.deepEqual(kids.map(k => k.color), PALETTE.slice(0, 3));
  const grand = addChild(m, kids[0].id);
  assert.equal(grand.side, null);
  assert.equal(grand.color, null);
  assert.equal(findNode(m.root, grand.id).depth, 2);
  assert.equal(findNode(m.root, grand.id).parent, kids[0]);
});

test('addChild expands a collapsed parent', () => {
  const m = newMap('a');
  const k = addChild(m, m.root.id);
  k.collapsed = true;
  addChild(m, k.id);
  assert.equal(k.collapsed, false);
});

test('addSibling on root adds child; on node inserts after it', () => {
  const m = newMap('a');
  const a = addSibling(m, m.root.id);
  assert.equal(m.root.children[0], a);
  const b = addChild(m, m.root.id);
  const s = addSibling(m, a.id);
  assert.deepEqual(m.root.children.map(n => n.id), [a.id, s.id, b.id]);
  assert.equal(s.side, a.side);
});

test('removeNode returns parent id and refuses root', () => {
  const m = newMap('a');
  const k = addChild(m, m.root.id);
  const g = addChild(m, k.id);
  assert.equal(removeNode(m, g.id), k.id);
  assert.deepEqual(k.children, []);
  assert.equal(removeNode(m, m.root.id), null);
  assert.equal(m.root.children.length, 1);
});

test('commitText: empty new node is removed, empty existing keeps text', () => {
  const m = newMap('a');
  const k = addChild(m, m.root.id);
  assert.equal(commitText(m, k.id, '  Ideia  ', true), k.id);
  assert.equal(k.text, 'Ideia');
  assert.equal(commitText(m, k.id, '   ', false), k.id);
  assert.equal(k.text, 'Ideia');
  const n = addChild(m, k.id);
  assert.equal(commitText(m, n.id, '', true), k.id);
  assert.equal(findNode(m.root, n.id), null);
});

test('branchColor inherits from nearest colored ancestor', () => {
  const m = newMap('a');
  const k = addChild(m, m.root.id);
  const g = addChild(m, k.id);
  const gg = addChild(m, g.id);
  assert.equal(branchColor(m.root, m.root.id), '#222');
  assert.equal(branchColor(m.root, gg.id), k.color);
  g.color = '#abcdef';
  assert.equal(branchColor(m.root, gg.id), '#abcdef');
});

test('History undo/redo and limit', () => {
  const h = new History();
  assert.equal(h.undo('s0'), null);
  for (let i = 0; i < 101; i++) h.push(`s${i}`);
  let cur = 'now', n = 0, s;
  while ((s = h.undo(cur)) !== null) { cur = s; n++; }
  assert.equal(n, 100);
  assert.equal(cur, 's1');
  assert.equal(h.redo(cur), 's2');
  h.push('x');
  assert.equal(h.redo('y'), null);
});

// ---- Task 3: layouts ----
import { layout, edgePath, navigate } from '../static/model.js';

const measure = (text) => ({ w: text.length * 8 + 16, h: 20 });
const byId = (res) => Object.fromEntries(res.nodes.map(b => [b.id, b]));

function sample(layoutName) {
  const m = newMap('a');
  m.layout = layoutName;
  const r1 = addChild(m, m.root.id); r1.text = 'Direita';
  const l1 = addChild(m, m.root.id); l1.text = 'Esquerda';
  const r2 = addChild(m, m.root.id); r2.text = 'Outra';
  const g1 = addChild(m, r1.id); g1.text = 'Neto um';
  const g2 = addChild(m, r1.id); g2.text = 'Neto dois';
  return { m, r1, l1, r2, g1, g2 };
}

test('map layout: right children right of root, left children left', () => {
  const { m, r1, l1, g1 } = sample('map');
  const res = layout(m, measure);
  const b = byId(res);
  const root = b[m.root.id];
  assert.equal(root.x + root.w / 2, 0);
  assert.equal(root.y + root.h / 2, 0);
  assert.ok(b[r1.id].x >= root.x + root.w);
  assert.ok(b[l1.id].x + b[l1.id].w <= root.x);
  assert.ok(b[g1.id].x >= b[r1.id].x + b[r1.id].w);
  assert.equal(b[g1.id].color, r1.color);
  assert.equal(b[g1.id].side, 'right');
  assert.equal(res.edges.length, 5);
  assert.equal(res.nodes.length, 6);
});

test('map layout: siblings do not overlap vertically', () => {
  const { m, r1, r2, g1, g2 } = sample('map');
  const b = byId(layout(m, measure));
  assert.ok(b[g1.id].y + b[g1.id].h <= b[g2.id].y);
  // a subárvore de r1 (com netos) não invade r2
  assert.ok(b[g2.id].y + b[g2.id].h <= b[r2.id].y);
});

test('org layout: children below parent and centered', () => {
  const { m, r1, g1, g2 } = sample('org');
  const b = byId(layout(m, measure));
  const root = b[m.root.id];
  for (const c of m.root.children) assert.ok(b[c.id].y >= root.y + root.h);
  assert.ok(b[g1.id].x + b[g1.id].w <= b[g2.id].x);
  const mid = (b[g1.id].x + b[g2.id].x + b[g2.id].w) / 2;
  assert.ok(Math.abs(mid - (b[r1.id].x + b[r1.id].w / 2)) < 1);
});

test('list layout: preorder, indented by depth', () => {
  const { m, r1, g1, g2, l1 } = sample('list');
  const res = layout(m, measure);
  assert.deepEqual(res.nodes.map(n => n.id), [m.root.id, r1.id, g1.id, g2.id, l1.id, m.root.children[2].id]);
  const b = byId(res);
  assert.equal(b[g1.id].x - b[r1.id].x, 32);
  for (let i = 1; i < res.nodes.length; i++) assert.ok(res.nodes[i].y >= res.nodes[i - 1].y + res.nodes[i - 1].h);
});

test('collapsed node hides descendants', () => {
  for (const name of ['map', 'org', 'list']) {
    const { m, r1, g1 } = sample(name);
    r1.collapsed = true;
    const res = layout(m, measure);
    assert.equal(byId(res)[g1.id], undefined);
    assert.equal(res.nodes.length, 4);
    assert.equal(res.edges.length, 3);
  }
});

test('edgePath returns an SVG path for each layout', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 }, b = { x: 50, y: 40, w: 10, h: 10 };
  for (const name of ['map', 'org', 'list']) assert.match(edgePath(name, a, b), /^M[\d\s.,-]+[CVH]/);
});

test('navigate picks nearest node in direction, else stays', () => {
  const { m, r1, l1, g1, g2 } = sample('map');
  const res = layout(m, measure);
  assert.equal(navigate(res.nodes, r1.id, 'right'), g1.id);
  assert.equal(navigate(res.nodes, g1.id, 'down'), g2.id);
  assert.equal(navigate(res.nodes, g1.id, 'left'), r1.id);
  assert.equal(navigate(res.nodes, l1.id, 'left'), l1.id);
});

// ---- Mover ramos ----
import { moveNode, dropTarget } from '../static/model.js';

test('moveNode reparents and reorders', () => {
  const { m, r1, l1, r2, g1, g2 } = sample('map');
  assert.equal(moveNode(m, g2.id, r1.id, 0), true);
  assert.deepEqual(r1.children.map(n => n.id), [g2.id, g1.id]);
  // mover para depois de si mesmo no mesmo pai ajusta o índice
  assert.equal(moveNode(m, g2.id, r1.id, 2), true);
  assert.deepEqual(r1.children.map(n => n.id), [g1.id, g2.id]);
  // 1º nível → mais fundo: perde lado e cor própria (herda o novo ramo)
  assert.equal(moveNode(m, r2.id, l1.id, 0), true);
  assert.equal(r2.side, null);
  assert.equal(r2.color, null);
  assert.equal(findNode(m.root, r2.id).parent, l1);
  // mais fundo → 1º nível: ganha lado e cor
  assert.equal(moveNode(m, g1.id, m.root.id, 0, 'left'), true);
  assert.equal(g1.side, 'left');
  assert.ok(PALETTE.includes(g1.color));
});

test('moveNode refuses root, self and own descendants', () => {
  const { m, r1, g1 } = sample('map');
  assert.equal(moveNode(m, m.root.id, r1.id, 0), false);
  assert.equal(moveNode(m, r1.id, r1.id, 0), false);
  assert.equal(moveNode(m, r1.id, g1.id, 0), false);
  assert.equal(findNode(m.root, r1.id).parent, m.root);
});

test('moveNode expands a collapsed target', () => {
  const { m, r1, l1 } = sample('map');
  l1.collapsed = true;
  moveNode(m, r1.id, l1.id, 0);
  assert.equal(l1.collapsed, false);
});

test('dropTarget: outer side of a node makes a child, inner part a sibling', () => {
  const { m, r1, l1, g1, g2 } = sample('map');
  const res = layout(m, measure);
  const b = byId(res);
  const center = (x) => [x.x + x.w / 2, x.y + x.h / 2];
  // à direita de r1 (lado de fora) → filho de r1 no fim
  const [, ry] = center(b[r1.id]);
  assert.deepEqual(dropTarget(m, res.nodes, l1.id, b[r1.id].x + b[r1.id].w + 5, ry),
    { parentId: r1.id, index: 2, side: null });
  // metade de cima de g2, lado de dentro → irmão antes de g2
  assert.deepEqual(dropTarget(m, res.nodes, l1.id, b[g2.id].x + 2, b[g2.id].y + 2),
    { parentId: r1.id, index: 1, side: null });
  // perto da raiz, à esquerda → filho da raiz no lado esquerdo
  const root = b[m.root.id];
  const t = dropTarget(m, res.nodes, g1.id, root.x - 5, root.y + root.h / 2);
  assert.equal(t.parentId, m.root.id);
  assert.equal(t.side, 'left');
});

test('dropTarget ignores the dragged branch itself', () => {
  const { m, r1, g1 } = sample('map');
  const res = layout(m, measure);
  const g = byId(res)[g1.id];
  const t = dropTarget(m, res.nodes, r1.id, g.x + g.w / 2, g.y + g.h / 2);
  assert.notEqual(t?.parentId, g1.id);
  assert.notEqual(t?.parentId, r1.id);
});

// ---- Ligações entre nós ----
import { addLink, removeLink, linkPath } from '../static/model.js';

test('newMap starts with no links', () => {
  assert.deepEqual(newMap('a').links, []);
});

test('addLink connects two nodes and refuses self, duplicates and unknown ids', () => {
  const { m, r1, l1 } = sample('map');
  const link = addLink(m, r1.id, l1.id);
  assert.deepEqual([link.from, link.to], [r1.id, l1.id]);
  assert.equal(m.links.length, 1);
  assert.equal(addLink(m, r1.id, l1.id), null);
  assert.equal(addLink(m, r1.id, r1.id), null);
  assert.equal(addLink(m, r1.id, 'nope'), null);
  // mapa antigo sem a lista de links também funciona
  delete m.links;
  assert.ok(addLink(m, l1.id, r1.id));
});

test('removeLink and removeNode clean up links', () => {
  const { m, r1, l1, g1, r2 } = sample('map');
  const a = addLink(m, g1.id, l1.id);
  addLink(m, r2.id, l1.id);
  assert.equal(removeLink(m, a.id), true);
  assert.equal(removeLink(m, a.id), false);
  addLink(m, g1.id, r2.id);
  removeNode(m, r1.id);  // leva g1 junto: ligação g1→r2 some
  assert.deepEqual(m.links.map(k => [k.from, k.to]), [[r2.id, l1.id]]);
});

test('linkPath draws a curve between the nearest sides', () => {
  const a = { x: 0, y: 0, w: 40, h: 20 }, b = { x: 200, y: 10, w: 40, h: 20 };
  assert.match(linkPath(a, b), /^M40,10 C/);           // sai pela direita de a
  assert.match(linkPath(a, b), / 200,20$/);            // chega pela esquerda de b
  // empilhados: arco pelo lado de fora (longe da raiz em x=0), sem cruzar os nós do meio
  const c = { x: 0, y: 200, w: 40, h: 20 };
  assert.match(linkPath(a, c), /^M40,10 C.* 40,210$/);
  const l1 = { x: -80, y: 0, w: 40, h: 20 }, l2 = { x: -80, y: 200, w: 40, h: 20 };
  assert.match(linkPath(l1, l2), /^M-80,10 C.* -80,210$/);
});

// ---- Copiar/colar ramo ----
import { pasteBranch } from '../static/model.js';

test('pasteBranch inserts a deep copy with fresh ids', () => {
  const { m, r1, l1, g1 } = sample('map');
  const copy = JSON.parse(JSON.stringify(r1));
  const n = pasteBranch(m, l1.id, copy);
  assert.equal(findNode(m.root, n.id).parent, l1);
  assert.equal(n.text, r1.text);
  assert.equal(n.children.length, 2);
  assert.notEqual(n.id, r1.id);
  assert.notEqual(n.children[0].id, g1.id);
  // 1º nível colado mais fundo: sem lado, herda a cor do novo ramo
  assert.equal(n.side, null);
  assert.equal(n.color, null);
  // colar de novo não compartilha objetos com a cópia anterior
  const n2 = pasteBranch(m, l1.id, copy);
  assert.notEqual(n2.children[0].id, n.children[0].id);
});

test('pasteBranch under root gets side and color', () => {
  const { m, g1 } = sample('map');
  const n = pasteBranch(m, m.root.id, JSON.parse(JSON.stringify(g1)));
  assert.ok(n.side === 'left' || n.side === 'right');
  assert.ok(PALETTE.includes(n.color));
});

// ---- Curvar ligações ----
import { linkHandle } from '../static/model.js';

test('linkHandle: no bend → curve midpoint; with bend → centers midpoint + offset', () => {
  const a = { x: 0, y: 0, w: 40, h: 20 }, b = { x: 200, y: 0, w: 40, h: 20 };
  assert.deepEqual(linkHandle(a, b), [120, 10]);
  assert.deepEqual(linkHandle(a, b, [0, 100]), [120, 110]);
});

test('linkPath with bend passes through the handle and leaves by the nearest sides', () => {
  const a = { x: 0, y: 0, w: 40, h: 20 }, b = { x: 200, y: 0, w: 40, h: 20 };
  const d = linkPath(a, b, [0, 300]);
  // ponto de controle abaixo: sai pela base de a e chega pela base de b
  assert.match(d, /^M20,20 Q/);
  assert.match(d, / 220,20$/);
  // quadrática passa pelo handle em t=0.5: controle = 2H - (p1+p2)/2
  assert.match(d, /Q120,600 /);
});
