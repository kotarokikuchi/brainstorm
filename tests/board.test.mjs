import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, resizeTo, elementPaths, elementBounds, roughLine, rng } from '../static/board-model.js';

test('rng is deterministic per seed', () => {
  const a = rng(42), b = rng(42), c = rng(7);
  const xs = [a(), a(), a()];
  assert.deepEqual(xs, [b(), b(), b()]);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  assert.ok(xs.every(x => x >= 0 && x < 1));
});

test('roughLine with roughness 0 is a straight segment', () => {
  assert.equal(roughLine(0, 0, 100, 0, rng(1), 0), 'M0,0 Q50,0 100,0');
  const wobbly = roughLine(0, 0, 100, 0, rng(1), 2);
  assert.notEqual(wobbly, 'M0,0 Q50,0 100,0');
  assert.equal(wobbly, roughLine(0, 0, 100, 0, rng(1), 2), 'mesma semente, mesmo traço');
});

test('createElement + resizeTo normalize a drag in any direction', () => {
  const el = createElement('rectangle', [100, 80], { seed: 5 });
  resizeTo(el, [40, 20]);
  assert.deepEqual([el.x, el.y, el.w, el.h], [40, 20, 60, 60]);
  assert.equal(el.strokeColor, '#1e1e1e');
  assert.equal(el.seed, 5);
  const ln = createElement('arrow', [10, 10]);
  resizeTo(ln, [60, -30]);
  assert.deepEqual(ln.points, [[0, 0], [50, -40]]);
  const fd = createElement('freedraw', [0, 0]);
  resizeTo(fd, [5, 5]);
  resizeTo(fd, [10, 3]);
  assert.deepEqual(fd.points, [[0, 0], [5, 5], [10, 3]], 'lápis acumula pontos');
});

test('elementBounds covers lines with negative points', () => {
  const ln = createElement('line', [10, 10]);
  resizeTo(ln, [60, -30]);
  assert.deepEqual(elementBounds(ln), { x: 10, y: -30, w: 50, h: 40 });
  const r = createElement('ellipse', [0, 0]);
  resizeTo(r, [30, 20]);
  assert.deepEqual(elementBounds(r), { x: 0, y: 0, w: 30, h: 20 });
});

test('elementPaths draw each shape (two passes when rough) and arrowheads', () => {
  const mk = (type, roughness) => { const e = createElement(type, [0, 0], { seed: 3, roughness }); resizeTo(e, [100, 60]); return e; };
  const rect0 = elementPaths(mk('rectangle', 0));
  assert.equal(rect0.length, 1, 'sem desleixo: uma passada');
  for (const corner of ['0,0', '100,0', '100,60', '0,60']) assert.ok(rect0[0].includes(corner), corner);
  assert.equal(elementPaths(mk('rectangle', 1)).length, 2, 'com desleixo: duas passadas');
  assert.ok(elementPaths(mk('diamond', 0))[0].includes('50,0'), 'losango pelos pontos médios');
  assert.match(elementPaths(mk('ellipse', 0))[0], /^M/);
  const arrow = elementPaths(mk('arrow', 0));
  assert.equal(arrow.length, 2, 'haste + ponta');
  assert.equal(elementPaths(mk('line', 0)).length, 1);
  const fd = createElement('freedraw', [0, 0]);
  for (const p of [[5, 5], [10, 3], [20, 8]]) resizeTo(fd, p);
  assert.match(elementPaths(fd)[0], /^M0,0 /);
});

// ---- Entrega 3: seleção e edição ----
import { hitTest, elementAt, elementsInBox, moveElements, resizeElement, selectionBounds, bringToFront, sendToBack, duplicateElements } from '../static/board-model.js';

const shape = (type, x, y, w, h, extra = {}) => ({ ...createElement(type, [x, y], { seed: 1 }), w, h, ...extra });

test('hitTest: outline of empty shapes, inside of filled shapes, near lines', () => {
  const r = shape('rectangle', 0, 0, 100, 50);
  assert.equal(hitTest(r, [1, 25], 6), true, 'na borda');
  assert.equal(hitTest(r, [50, 25], 6), false, 'miolo vazio não pega');
  assert.equal(hitTest({ ...r, backgroundColor: '#a5d8ff' }, [50, 25], 6), true, 'preenchido pega no miolo');
  const e = shape('ellipse', 0, 0, 100, 50);
  assert.equal(hitTest(e, [100, 25], 6), true);
  assert.equal(hitTest(e, [50, 25], 6), false);
  const d = shape('diamond', 0, 0, 100, 100);
  assert.equal(hitTest(d, [25, 25], 6), true, 'aresta do losango');
  assert.equal(hitTest(d, [2, 2], 6), false, 'canto vazio do losango');
  const ln = createElement('line', [0, 0]); resizeTo(ln, [100, 100]);
  assert.equal(hitTest(ln, [50, 52], 6), true);
  assert.equal(hitTest(ln, [50, 80], 6), false);
});

test('elementAt picks the topmost hit; elementsInBox needs full containment', () => {
  const a = shape('rectangle', 0, 0, 100, 100, { backgroundColor: '#fff' });
  const b = shape('rectangle', 50, 50, 100, 100, { backgroundColor: '#fff' });
  assert.equal(elementAt([a, b], [75, 75], 6), b.id);
  assert.equal(elementAt([a, b], [500, 500], 6), null);
  assert.deepEqual(elementsInBox([a, b], { x: -5, y: -5, w: 110, h: 110 }), [a.id]);
});

test('moveElements and selectionBounds', () => {
  const a = shape('rectangle', 0, 0, 10, 10), ln = createElement('arrow', [20, 20]);
  resizeTo(ln, [40, 30]);
  moveElements([a, ln], [a.id, ln.id], 5, -5);
  assert.deepEqual([a.x, a.y, ln.x, ln.y], [5, -5, 25, 15]);
  assert.deepEqual(selectionBounds([a, ln], [a.id, ln.id]), { x: 5, y: -5, w: 40, h: 30 });
});

test('resizeElement by handle: shapes keep positive size, lines scale their points', () => {
  const r = shape('rectangle', 0, 0, 100, 50);
  const start = structuredClone(r);
  resizeElement(r, 'se', [150, 80], start);
  assert.deepEqual([r.x, r.y, r.w, r.h], [0, 0, 150, 80]);
  resizeElement(r, 'nw', [120, 70], start);  // passou do canto oposto: inverte sem tamanho negativo
  assert.deepEqual([r.x, r.y, r.w, r.h], [100, 50, 20, 20]);
  const ln = createElement('line', [0, 0]); resizeTo(ln, [100, 50]);
  resizeElement(ln, 'e', [200, 0], structuredClone(ln));
  assert.deepEqual(ln.points, [[0, 0], [200, 50]]);
});

test('layer order and duplicate', () => {
  const [a, b, c] = ['rectangle', 'ellipse', 'diamond'].map((t, i) => shape(t, i * 10, 0, 5, 5));
  assert.deepEqual(bringToFront([a, b, c], [a.id]).map(e => e.id), [b.id, c.id, a.id]);
  assert.deepEqual(sendToBack([a, b, c], [c.id]).map(e => e.id), [c.id, a.id, b.id]);
  const copies = duplicateElements([a, b, c], [b.id], 10);
  assert.equal(copies.length, 1);
  assert.notEqual(copies[0].id, b.id);
  assert.deepEqual([copies[0].x, copies[0].y, copies[0].type], [b.x + 10, b.y + 10, 'ellipse']);
});
