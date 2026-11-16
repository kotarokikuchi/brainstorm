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
