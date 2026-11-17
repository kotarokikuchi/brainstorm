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
  assert.equal(wobbly, roughLine(0, 0, 100, 0, rng(1), 2), 'same seed, same stroke');
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
  assert.deepEqual(fd.points, [[0, 0], [5, 5], [10, 3]], 'pencil accumulates points');
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
  assert.equal(rect0.length, 1, 'no sloppiness: one pass');
  for (const corner of ['0,0', '100,0', '100,60', '0,60']) assert.ok(rect0[0].includes(corner), corner);
  assert.equal(elementPaths(mk('rectangle', 1)).length, 1, 'Artist (default): a single stroke, no duplicate line');
  assert.equal(elementPaths(mk('line', 1)).length, 1);
  assert.equal(elementPaths(mk('rectangle', 2)).length, 2, 'Cartoonist: two passes on purpose');
  assert.ok(elementPaths(mk('diamond', 0))[0].includes('50,0'), 'diamond through the midpoints');
  assert.match(elementPaths(mk('ellipse', 0))[0], /^M/);
  const arrow = elementPaths(mk('arrow', 0));
  assert.equal(arrow.length, 2, 'shaft + tip');
  assert.equal(elementPaths(mk('line', 0)).length, 1);
  const fd = createElement('freedraw', [0, 0]);
  for (const p of [[5, 5], [10, 3], [20, 8]]) resizeTo(fd, p);
  assert.match(elementPaths(fd)[0], /^M0,0 /);
});

// ---- Delivery 3: selection and editing ----
import { hitTest, elementAt, elementsInBox, moveElements, resizeElement, selectionBounds, bringToFront, sendToBack, duplicateElements } from '../static/board-model.js';

const shape = (type, x, y, w, h, extra = {}) => ({ ...createElement(type, [x, y], { seed: 1 }), w, h, ...extra });

test('hitTest: outline of empty shapes, inside of filled shapes, near lines', () => {
  const r = shape('rectangle', 0, 0, 100, 50);
  assert.equal(hitTest(r, [1, 25], 6), true, 'on the border');
  assert.equal(hitTest(r, [50, 25], 6), false, 'empty interior does not hit');
  assert.equal(hitTest({ ...r, backgroundColor: '#a5d8ff' }, [50, 25], 6), true, 'filled hits in the interior');
  const e = shape('ellipse', 0, 0, 100, 50);
  assert.equal(hitTest(e, [100, 25], 6), true);
  assert.equal(hitTest(e, [50, 25], 6), false);
  const d = shape('diamond', 0, 0, 100, 100);
  assert.equal(hitTest(d, [25, 25], 6), true, 'diamond edge');
  assert.equal(hitTest(d, [2, 2], 6), false, 'empty corner of the diamond');
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
  resizeElement(r, 'nw', [120, 70], start);  // crossed past the opposite corner: flips without a negative size
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

// ---- Delivery 4: text and eraser ----
import { elementsHitBy } from '../static/board-model.js';

test('text elements: no stroke paths, hit by their box, resize scales the font', () => {
  const t = { ...createElement('text', [10, 10], { text: 'Olá', fontSize: 20 }), w: 40, h: 25 };
  assert.deepEqual(elementPaths(t), []);
  assert.equal(hitTest(t, [30, 20], 0), true);
  assert.equal(hitTest(t, [80, 20], 0), false);
  const start = structuredClone(t);
  resizeElement(t, 'se', [90, 60], start);
  assert.deepEqual([t.x, t.y, t.w, t.h, t.fontSize], [10, 10, 80, 50, 40], 'proportional scale by height');
});

test('elementsHitBy finds what an eraser stroke crosses', () => {
  const ln = createElement('line', [0, 50]); resizeTo(ln, [100, 50]);
  const r = { ...createElement('rectangle', [200, 0]), w: 50, h: 50 };
  assert.deepEqual(elementsHitBy([ln, r], [50, 0], [50, 100], 4), [ln.id], 'crosses the line');
  assert.deepEqual(elementsHitBy([ln, r], [150, 0], [150, 100], 4), [], 'touches nothing');
  assert.deepEqual(elementsHitBy([ln, r], [190, 25], [260, 25], 4), [r.id], 'crosses the rectangle border');
});

// ---- Paint bucket ----
import { paint } from '../static/board-model.js';

test('paint fills closed shapes and recolors lines and text; elementAt inside hits empty shapes', () => {
  const st = { backgroundColor: '#ffc9c9', fillStyle: 'solid', strokeColor: '#e03131' };
  const r = paint(shape('rectangle', 0, 0, 100, 50), st);
  assert.deepEqual([r.backgroundColor, r.fillStyle, r.strokeColor], ['#ffc9c9', 'solid', '#1e1e1e'], 'shape: fill');
  const ln = paint({ ...createElement('line', [0, 0]), points: [[0, 0], [100, 0]] }, st);
  assert.deepEqual([ln.backgroundColor, ln.strokeColor], ['transparent', '#e03131'], 'line: stroke colour');
  const empty = shape('rectangle', 0, 0, 100, 50);
  assert.equal(elementAt([empty], [50, 25], 6), null, 'a plain click in the empty interior does not hit');
  assert.equal(elementAt([empty], [50, 25], 6, true), empty.id, 'bucket hits in the interior');
});

// ---- Lasso ----
import { elementsInPolygon } from '../static/board-model.js';

test('elementsInPolygon keeps only elements fully inside the free outline', () => {
  const a = shape('rectangle', 10, 10, 20, 20), b = shape('ellipse', 100, 10, 40, 40);
  const ln = { ...createElement('line', [10, 60]), points: [[0, 0], [30, 0]] };
  const tri = [[0, 0], [80, 0], [0, 80]];  // triangle: does it catch a and the line? the line runs to x=40 at y=60 (outside)
  assert.deepEqual(elementsInPolygon([a, b, ln], tri), [a.id]);
  const all = [[0, 0], [200, 0], [200, 100], [0, 100]];
  assert.deepEqual(elementsInPolygon([a, b, ln], all), [a.id, b.id, ln.id]);
  assert.deepEqual(elementsInPolygon([a], [[0, 0], [50, 50]]), [], 'outline with fewer than 3 points');
});

// ---- Image ----
test('image elements hit by their whole box and resize freely', () => {
  const im = { ...createElement('image', [10, 10]), w: 80, h: 40, fileId: 'a'.repeat(32) + '.png' };
  assert.equal(hitTest(im, [50, 30], 6), true, 'image interior');
  assert.equal(hitTest(im, [200, 30], 6), false);
  assert.deepEqual(elementPaths(im), [], 'no stroke');
  resizeElement(im, 'se', [130, 70], { ...im });
  assert.deepEqual([im.w, im.h], [120, 60]);
});

// ---- Layers, one step ----
import { forwardOne, backwardOne } from '../static/board-model.js';

test('forwardOne / backwardOne move the selection one layer', () => {
  const els = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const ids = (xs) => xs.map(x => x.id).join('');
  assert.equal(ids(forwardOne(els, ['a'])), 'bacd');
  assert.equal(ids(forwardOne(els, ['a', 'c'])), 'badc');
  assert.equal(ids(forwardOne(els, ['d'])), 'abcd', 'already on top');
  assert.equal(ids(forwardOne(els, ['c', 'd'])), 'abcd', 'a block on top is not shuffled');
  assert.equal(ids(backwardOne(els, ['c'])), 'acbd');
  assert.equal(ids(backwardOne(els, ['a', 'b'])), 'abcd', 'a block at the bottom is not shuffled');
  assert.equal(ids(els), 'abcd', 'does not change the original list');
});

test('paint recolors sticky notes like closed shapes', () => {
  const n = paint({ ...createElement('note', [0, 0]), w: 200, h: 200 }, { backgroundColor: '#b2f2bb', fillStyle: 'solid', strokeColor: '#e03131' });
  assert.deepEqual([n.backgroundColor, n.strokeColor], ['#b2f2bb', '#1e1e1e']);
});

import { okElement, sanitizeElement } from '../static/board-model.js';

test('okElement rejects pasted elements the renderer cannot draw', () => {
  assert.equal(okElement({ id: '1', type: 'text', x: 0, y: 0 }), false, 'text without text');
  assert.equal(okElement({ id: '1', type: 'note', x: 0, y: 0, text: 5 }), false);
  assert.equal(okElement({ id: '1', type: 'arrow', x: 0, y: 0 }), false, 'arrow without points');
  assert.equal(okElement({ id: '1', type: 'line', x: 0, y: 0, points: [[0, 0]] }), false, 'line with 1 point');
  assert.equal(okElement({ id: '1', type: 'freedraw', x: 0, y: 0, points: [] }), false);
  assert.equal(okElement({ id: '1', type: 'arrow', x: 0, y: 0, points: [[0, 0], [1, 'a']] }), false);
  assert.equal(okElement({ id: '1', type: 'script', x: 0, y: 0 }), false);
  assert.equal(okElement({ id: '1', type: 'rectangle', x: 0, y: null }), false);
  assert.equal(okElement(null), false);
  assert.ok(okElement({ id: '1', type: 'rectangle', x: 0, y: 0, link: 5 }), 'no points and a bad link: accepted (and cleaned later)');
  assert.ok(okElement({ id: '1', type: 'text', x: 0, y: 0, text: '' }));
  assert.ok(okElement({ id: '1', type: 'freedraw', x: 0, y: 0, points: [[0, 0]] }));
  assert.ok(okElement({ id: '1', type: 'arrow', x: 0, y: 0, points: [[0, 0], [5, 5]] }));
});

test('sanitizeElement drops badly typed fields so drawing never throws', () => {
  const r = sanitizeElement({ id: '1', type: 'rectangle', x: 0, y: 0, link: 5 });
  assert.deepEqual(r, { id: '1', type: 'rectangle', x: 0, y: 0, w: 0, h: 0 });
  assert.equal(elementPaths(r).length, 1);
  const e = sanitizeElement({
    id: '2', type: 'ellipse', x: 1, y: 2, w: 3, h: 4, points: 'x', strokeColor: 'url(https://attacker.example/p.gif)',
    backgroundColor: 5, strokeWidth: '2', roughness: null, opacity: {}, seed: 7, fillStyle: 1, link: 'https://a.com',
  });
  assert.deepEqual(e, { id: '2', type: 'ellipse', x: 1, y: 2, w: 3, h: 4, roughness: null, seed: 7, link: 'https://a.com' });
  assert.equal(sanitizeElement({ type: 'rectangle', x: 0, y: 0, backgroundColor: 'transparent' }).backgroundColor, 'transparent');
  assert.equal(sanitizeElement({ type: 'rectangle', x: 0, y: 0, backgroundColor: '#ffc9c9' }).backgroundColor, '#ffc9c9');
  assert.equal(sanitizeElement({ type: 'text', x: 0, y: 0, text: 'a', fontSize: 'big' }).fontSize, 20);
  assert.equal(sanitizeElement({ type: 'note', x: 0, y: 0, text: 'a', fontSize: 28 }).fontSize, 28);
  assert.deepEqual(sanitizeElement({ type: 'line', x: 0, y: 0, points: [[0, 0], [1, 1]] }).points, [[0, 0], [1, 1]]);
});
