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
