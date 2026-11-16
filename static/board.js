// Quadro de desenho (lousa estilo Excalidraw): documento {type: "board", title, elements}.
// O app.js cuida de rotas e do salvamento automático; este módulo cuida da lousa.

import {
  createElement, resizeTo, elementPaths, fillPath, elementBounds, DEFAULTS, elementAt, elementsInBox,
  moveElements, resizeElement, bringToFront, sendToBack, duplicateElements,
} from './board-model.js';
import { History } from './model.js';

const $ = (s) => document.querySelector(s);
const SVG = 'http://www.w3.org/2000/svg';
const svg = $('#board-canvas'), root = $('#board-root');
let deps = null;   // {api, scheduleSave, setStatus, resetSave}
let board = null;  // quadro aberto
let tool = 'select', history = new History();
let drawing = null, panning = null, spaceDown = false;
let selection = [], gesture = null, clipboard = null;  // gesture: mover / redimensionar / seleção por área
const style = { ...DEFAULTS };  // estilo para os próximos elementos (o painel muda)
const view = { x: 0, y: 0, k: 1 };
const SHAPES = new Set(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw']);

export function initBoard(d) { deps = d; }
export const currentBoard = () => board;
export function closeBoard() { board = null; }

export const newBoard = (id) => ({ id, version: 0, type: 'board', title: 'Quadro sem título', elements: [] });

export async function openBoard(id) {
  const r = await deps.api('GET', `/${id}`);
  if (!r.ok) {
    if (r.status === 500) alert('Não foi possível abrir este quadro: o arquivo dele está corrompido.');
    location.hash = '#/';
    return;
  }
  const doc = await r.json();
  if (doc.type !== 'board') { location.hash = `#/map/${id}`; return; }
  board = doc;
  history = new History();
  selection = [];
  Object.assign(view, { x: 0, y: 0, k: 1 });
  setTool('select');
  deps.resetSave();
  document.body.dataset.view = 'board';
  deps.setStatus('Salvo');
  $('#title').textContent = board.title;
  render();
}

const el = (tag, attrs, parent) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  parent?.append(e);
  return e;
};
const DASH = { solid: null, dashed: '8 8', dotted: '1.5 6' };
const HEX = /^#[0-9a-fA-F]{3,8}$/;  // cor vinda do arquivo só entra em id/atributo se for hexadecimal

// hachurado: um <pattern> diagonal por cor
function hatch(color) {
  const id = `hatch-${color.slice(1)}`;
  if (!document.getElementById(id)) {
    const defs = svg.querySelector('defs') ?? el('defs', {}, svg);
    const pat = el('pattern', { id, patternUnits: 'userSpaceOnUse', width: 8, height: 8, patternTransform: 'rotate(-45)' }, defs);
    el('rect', { width: 1.6, height: 8, fill: color }, pat);
  }
  return `url(#${id})`;
}

function drawElement(e) {
  const g = el('g', { class: 'el', 'data-id': e.id, opacity: (e.opacity ?? 100) / 100 });
  const bg = HEX.test(e.backgroundColor ?? '') && fillPath(e);
  if (bg) el('path', { d: bg, fill: e.fillStyle === 'solid' ? e.backgroundColor : hatch(e.backgroundColor), stroke: 'none' }, g);
  for (const d of elementPaths(e)) {
    el('path', {
      d, fill: 'none', stroke: e.strokeColor, 'stroke-width': e.strokeWidth,
      'stroke-dasharray': e.type === 'freedraw' ? null : DASH[e.strokeStyle], 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }, g);
  }
  return g;
}

function render() {
  if (!board) return;
  $('#title').textContent = board.title;
  root.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  root.replaceChildren(...board.elements.map(drawElement));
  drawSelection();
  $('#board-zoom').textContent = `${Math.round(view.k * 100)}%`;
  renderProps();
}

// ---------- Ferramentas, desenho, mover a tela ----------
function setTool(t) {
  tool = t;
  if (t !== 'select') selection = [];
  svg.dataset.tool = t;
  for (const b of document.querySelectorAll('#board-tools [data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
  render();  // painel de estilo aparece/some conforme a ferramenta
}
document.querySelector('#board-tools').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tool]')?.dataset.tool;
  if (t) setTool(t);
});

const snapshot = () => JSON.stringify(board.elements);
function changed(before) {
  history.push(before);
  render();
  deps.scheduleSave(board);
}
function restore(state) {
  if (state === null) return;
  board.elements = JSON.parse(state);
  render();
  deps.scheduleSave(board);
}
const undo = () => restore(history.undo(snapshot()));
const redo = () => restore(history.redo(snapshot()));

const toWorld = (e) => {
  const r = svg.getBoundingClientRect();
  return [(e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k];
};

svg.addEventListener('pointerdown', (e) => {
  if (!board) return;
  if (tool === 'hand' || spaceDown || e.button === 1) {
    panning = { x: e.clientX - view.x, y: e.clientY - view.y };
    svg.classList.add('panning');
  } else if (SHAPES.has(tool) && e.button === 0) {
    drawing = { el: createElement(tool, toWorld(e), { ...style }), before: snapshot() };
    board.elements.push(drawing.el);
  } else if (tool === 'select' && e.button === 0) {
    selectDown(e);
  } else return;
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', (e) => {
  if (panning) { view.x = e.clientX - panning.x; view.y = e.clientY - panning.y; render(); }
  else if (drawing) { resizeTo(drawing.el, toWorld(e)); render(); }
  else if (gesture) selectMove(e);
});
svg.addEventListener('pointerup', (e) => {
  if (panning) { panning = null; svg.classList.remove('panning'); return; }
  if (gesture) { selectUp(e); return; }
  if (!drawing) return;
  const { el: created, before } = drawing;
  drawing = null;
  resizeTo(created, toWorld(e));
  const b = elementBounds(created);
  if (b.w < 3 && b.h < 3) board.elements.pop();  // clique sem arrastar não cria nada
  else changed(before);
  setTool('select');  // como no Excalidraw: depois de desenhar, volta para seleção
  if (board.elements.includes(created)) selection = [created.id];
  render();
});

function zoomAt(factor, cx, cy) {
  const k = Math.min(30, Math.max(0.1, view.k * factor));
  view.x = cx - (cx - view.x) * (k / view.k);
  view.y = cy - (cy - view.y) * (k / view.k);
  view.k = k;
  render();
}
const zoomCenter = (factor) => zoomAt(factor, svg.clientWidth / 2, svg.clientHeight / 2);
// rodinha move a tela; Ctrl+rodinha (ou pinça) dá zoom no ponteiro
svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const r = svg.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
  } else {
    view.x -= e.deltaX;
    view.y -= e.deltaY;
    render();
  }
}, { passive: false });
$('#board-zoom-in').onclick = () => zoomCenter(1.1);
$('#board-zoom-out').onclick = () => zoomCenter(1 / 1.1);
$('#board-zoom').onclick = () => zoomCenter(1 / view.k);
$('#board-undo').onclick = undo;
$('#board-redo').onclick = redo;
for (const b of document.querySelectorAll('#board-view button')) b.addEventListener('mousedown', (e) => e.preventDefault());

// ---------- Teclado ----------
const TOOL_KEYS = {
  h: 'hand', v: 'select', 1: 'select', r: 'rectangle', 2: 'rectangle', d: 'diamond', 3: 'diamond',
  o: 'ellipse', 4: 'ellipse', a: 'arrow', 5: 'arrow', l: 'line', 6: 'line', p: 'freedraw', 7: 'freedraw',
};
document.addEventListener('keydown', (e) => {
  if (!board || document.body.dataset.view !== 'board' || e.target.closest?.('input, textarea, select')) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (ctrl && k === 'y') { e.preventDefault(); redo(); }
  else if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); zoomCenter(1.1); }
  else if (ctrl && k === '-') { e.preventDefault(); zoomCenter(1 / 1.1); }
  else if (ctrl && k === 'a') { e.preventDefault(); setTool('select'); selection = board.elements.map(x => x.id); render(); }
  else if (ctrl && k === 'd') { e.preventDefault(); act('duplicate'); }
  else if (ctrl && k === 'c') { if (selection.length) clipboard = JSON.stringify(board.elements.filter(x => selection.includes(x.id))); }
  else if (ctrl && k === 'v') { e.preventDefault(); paste(); }
  else if (ctrl && e.shiftKey && (e.key === ']' || e.key === '}')) { e.preventDefault(); act('front'); }
  else if (ctrl && e.shiftKey && (e.key === '[' || e.key === '{')) { e.preventDefault(); act('back'); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) { e.preventDefault(); act('delete'); }
  else if (e.key === 'Escape') { selection = []; setTool('select'); render(); }
  else if (e.key.startsWith('Arrow') && selection.length) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1, before = snapshot();
    const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    moveElements(board.elements, selection, dx, dy);
    changed(before);
  }
  else if (e.key === ' ') { e.preventDefault(); spaceDown = true; svg.classList.add('panning'); }
  else if (!ctrl && !e.altKey && TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ') { spaceDown = false; if (!panning) svg.classList.remove('panning'); }
});

// título do quadro: duplo clique no topo
$('#title').addEventListener('dblclick', () => {
  if (!board) return;
  const t = prompt('Nome do quadro', board.title);
  if (t === null || !t.trim() || t.trim() === board.title) return;
  board.title = t.trim();
  render();
  deps.scheduleSave(board);
});

// ---------- Seleção: clicar, Shift+clicar, área, mover, alças ----------
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function drawSelection() {
  const pad = 4 / view.k;
  for (const id of selection) {
    const item = board.elements.find(x => x.id === id);
    if (!item) continue;
    const b = elementBounds(item);
    el('rect', { class: 'sel-item', x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, 'stroke-width': 1 / view.k }, root);
  }
  if (selection.length === 1) {
    const b = elementBounds(board.elements.find(x => x.id === selection[0]) ?? { x: 0, y: 0, w: 0, h: 0 });
    const s = 8 / view.k, x1 = b.x - pad, y1 = b.y - pad, x2 = b.x + b.w + pad, y2 = b.y + b.h + pad;
    const pos = { nw: [x1, y1], n: [(x1 + x2) / 2, y1], ne: [x2, y1], e: [x2, (y1 + y2) / 2], se: [x2, y2], s: [(x1 + x2) / 2, y2], sw: [x1, y2], w: [x1, (y1 + y2) / 2] };
    for (const h of HANDLES) el('rect', { class: 'handle', 'data-handle': h, x: pos[h][0] - s / 2, y: pos[h][1] - s / 2, width: s, height: s, rx: 2 / view.k, 'stroke-width': 1 / view.k }, root);
  }
  if (gesture?.kind === 'marquee') {
    const m = marqueeBox(gesture);
    el('rect', { class: 'marquee', ...{ x: m.x, y: m.y, width: m.w, height: m.h }, 'stroke-width': 1 / view.k }, root);
  }
}

const marqueeBox = (g) => {
  const [a, b] = [g.start, g.cur];
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
};

function selectDown(e) {
  const p = toWorld(e), handle = e.target.closest?.('.handle')?.dataset.handle;
  if (handle && selection.length === 1) {
    const item = board.elements.find(x => x.id === selection[0]);
    gesture = { kind: 'resize', handle, item, start: structuredClone(item), before: snapshot() };
    return;
  }
  const hit = elementAt(board.elements, p, 6 / view.k);
  if (hit && e.shiftKey) {
    selection = selection.includes(hit) ? selection.filter(id => id !== hit) : [...selection, hit];
    render();
    return;
  }
  if (hit) {
    if (!selection.includes(hit)) selection = [hit];
    gesture = { kind: 'move', last: p, before: snapshot(), moved: false };
  } else {
    if (!e.shiftKey) selection = [];
    gesture = { kind: 'marquee', start: p, cur: p, keep: [...selection] };
  }
  render();
}

function selectMove(e) {
  const p = toWorld(e);
  if (gesture.kind === 'move') {
    moveElements(board.elements, selection, p[0] - gesture.last[0], p[1] - gesture.last[1]);
    gesture.last = p;
    gesture.moved = true;
  } else if (gesture.kind === 'resize') {
    resizeElement(gesture.item, gesture.handle, p, gesture.start);
    gesture.moved = true;
  } else gesture.cur = p;
  render();
}

function selectUp() {
  const g = gesture;
  gesture = null;
  if (g.kind === 'marquee') selection = [...new Set([...g.keep, ...elementsInBox(board.elements, marqueeBox(g))])];
  if ((g.kind === 'move' || g.kind === 'resize') && g.moved) changed(g.before);
  render();
}

// ---------- Ações na seleção ----------
function act(name) {
  if (!selection.length) return;
  const before = snapshot();
  if (name === 'delete') {
    board.elements = board.elements.filter(x => !selection.includes(x.id));
    selection = [];
  } else if (name === 'duplicate') {
    const copies = duplicateElements(board.elements, selection, 10);
    board.elements.push(...copies);
    selection = copies.map(c => c.id);
  } else if (name === 'front') board.elements = bringToFront(board.elements, selection);
  else if (name === 'back') board.elements = sendToBack(board.elements, selection);
  changed(before);
}

function paste() {
  if (!clipboard) return;
  const items = JSON.parse(clipboard), before = snapshot();
  const copies = duplicateElements(items, items.map(x => x.id), 20);
  board.elements.push(...copies);
  selection = copies.map(c => c.id);
  clipboard = JSON.stringify(copies);  // colar de novo desloca mais
  changed(before);
}

// ---------- Painel de estilo ----------
const props = $('#board-props');
const STROKES = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#6741d9'];
const FILLS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#d0bfff'];
const NUMERIC = new Set(['strokeWidth', 'roughness', 'opacity']);
for (const [prop, colors] of [['strokeColor', STROKES], ['backgroundColor', FILLS]]) {
  props.querySelector(`[data-prop="${prop}"]`).append(...colors.map((c) => {
    const b = document.createElement('button');
    b.dataset.value = c;
    b.title = c === 'transparent' ? 'Sem fundo' : c;
    if (c !== 'transparent') b.style.background = c;
    return b;
  }));
}

function renderProps() {
  const sel = board.elements.filter(x => selection.includes(x.id));
  props.hidden = !(sel.length || SHAPES.has(tool));
  $('#board-sel-actions').hidden = !sel.length;
  if (props.hidden) return;
  const cur = sel[0] ?? style;
  for (const group of props.querySelectorAll('[data-prop]')) {
    for (const b of group.querySelectorAll('[data-value]')) b.classList.toggle('active', String(cur[group.dataset.prop]) === b.dataset.value);
  }
  $('#board-opacity').value = cur.opacity ?? 100;
}

// muda o estilo dos selecionados (com desfazer) e dos próximos elementos
function setProp(prop, value) {
  style[prop] = value;
  const sel = board.elements.filter(x => selection.includes(x.id));
  if (!sel.length) { renderProps(); return; }
  const before = snapshot();
  for (const item of sel) item[prop] = value;
  changed(before);
}

props.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
props.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.act) return act(btn.dataset.act);
  const prop = btn.parentElement.closest('[data-prop]')?.dataset.prop;
  if (prop) setProp(prop, NUMERIC.has(prop) ? Number(btn.dataset.value) : btn.dataset.value);
});
$('#board-opacity').addEventListener('change', (e) => { setProp('opacity', Number(e.target.value)); e.target.blur(); });
