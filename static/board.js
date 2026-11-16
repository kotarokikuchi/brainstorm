// Quadro de desenho (lousa estilo Excalidraw): documento {type: "board", title, elements}.
// O app.js cuida de rotas e do salvamento automático; este módulo cuida da lousa.

import { createElement, resizeTo, elementPaths, fillPath, elementBounds } from './board-model.js';
import { History } from './model.js';

const $ = (s) => document.querySelector(s);
const SVG = 'http://www.w3.org/2000/svg';
const svg = $('#board-canvas'), root = $('#board-root');
let deps = null;   // {api, scheduleSave, setStatus, resetSave}
let board = null;  // quadro aberto
let tool = 'select', history = new History();
let drawing = null, panning = null, spaceDown = false;
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

function drawElement(e) {
  const g = el('g', { class: 'el', 'data-id': e.id, opacity: (e.opacity ?? 100) / 100 });
  const fill = e.backgroundColor && e.backgroundColor !== 'transparent' && fillPath(e);
  if (fill) el('path', { d: fill, fill: e.backgroundColor, stroke: 'none' }, g);
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
  $('#board-zoom').textContent = `${Math.round(view.k * 100)}%`;
}

// ---------- Ferramentas, desenho, mover a tela ----------
function setTool(t) {
  tool = t;
  svg.dataset.tool = t;
  for (const b of document.querySelectorAll('#board-tools [data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
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
    drawing = { el: createElement(tool, toWorld(e)), before: snapshot() };
    board.elements.push(drawing.el);
  } else return;
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', (e) => {
  if (panning) { view.x = e.clientX - panning.x; view.y = e.clientY - panning.y; render(); }
  else if (drawing) { resizeTo(drawing.el, toWorld(e)); render(); }
});
svg.addEventListener('pointerup', (e) => {
  if (panning) { panning = null; svg.classList.remove('panning'); return; }
  if (!drawing) return;
  const { el: created, before } = drawing;
  drawing = null;
  resizeTo(created, toWorld(e));
  const b = elementBounds(created);
  if (b.w < 3 && b.h < 3) board.elements.pop();  // clique sem arrastar não cria nada
  else changed(before);
  setTool('select');  // como no Excalidraw: depois de desenhar, volta para seleção
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
