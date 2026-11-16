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
