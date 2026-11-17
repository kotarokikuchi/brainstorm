// Quadro de desenho (lousa estilo Excalidraw): documento {type: "board", title, elements}.
// O app.js cuida de rotas e do salvamento automático; este módulo cuida da lousa.

import {
  createElement, resizeTo, elementPaths, fillPath, elementBounds, DEFAULTS, elementAt, elementsInBox,
  moveElements, resizeElement, bringToFront, sendToBack, duplicateElements, elementsHitBy, paint, elementsInPolygon, forwardOne, backwardOne, okElement, sanitizeElement,
} from './board-model.js';
import { History, safeUrl, wrapLines, isHex, FILE_ID } from './model.js';
import { t } from './i18n.js';

const $ = (s) => document.querySelector(s);
const SVG = 'http://www.w3.org/2000/svg';
const svg = $('#board-canvas'), root = $('#board-root');
let deps = null;   // {api, scheduleSave, setStatus, resetSave}
let board = null;  // quadro aberto
let tool = 'select', history = new History();
let drawing = null, panning = null, spaceDown = false;
let selection = [], gesture = null, clipboard = null;  // gesture: mover / redimensionar / seleção por área
const TEXT_DEFAULTS = { textAlign: 'left', fontFamily: 'hand' };  // textos antigos não têm esses campos
const style = { ...DEFAULTS, fontSize: 20, ...TEXT_DEFAULTS };  // estilo para os próximos elementos (o painel muda)
let editingText = null, erasing = null;
const FONTS = {
  hand: 'Kalam, "Segoe Print", "Comic Sans MS", cursive',  // Kalam vem junto (static/fonts)
  normal: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  code: 'ui-monospace, "Cascadia Code", Consolas, "DejaVu Sans Mono", monospace',
};
const fontOf = (e) => FONTS[e.fontFamily] ?? FONTS.hand;
const lineH = (fs) => fs * 1.25;
const mctx = document.createElement('canvas').getContext('2d');
const view = { x: 0, y: 0, k: 1 };
const SHAPES = new Set(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw']);
const STYLED = new Set([...SHAPES, 'text', 'note', 'bucket']);
const HAS_TEXT = new Set(['text', 'note']);
const NOTE_PAD = 12, NOTE_SIZE = 200, NOTE_COLOR = '#ffec99';  // ferramentas que mostram o painel de estilo

export function initBoard(d) { deps = d; }
export const currentBoard = () => board;
export const boardPlace = () => ({ view: { ...view }, selection: [...selection] });
export function closeBoard() { board = null; }

export const newBoard = (id, title = 'Quadro sem título') => ({ id, version: 0, type: 'board', title, elements: [] });

export async function openBoard(id) {
  const r = await deps.api('GET', `/${id}`);
  if (!r.ok) {
    if (r.status === 500) alert(t('board.openError'));
    location.hash = '#/';
    return;
  }
  const doc = await r.json();
  if (doc.type !== 'board') { location.hash = `#/map/${id}`; return; }
  await document.fonts.load('20px Kalam').catch(() => {});  // medir texto só com a fonte carregada
  board = doc;
  history = new History();
  const place = deps.loadPlace(id);  // volta onde parou (posição, zoom, seleção)
  Object.assign(view, place?.view ?? { x: 0, y: 0, k: 1 });
  setTool('select');
  selection = (Array.isArray(place?.selection) ? place.selection : []).filter(s => board.elements.some(x => x.id === s));
  deps.resetSave();
  document.body.dataset.view = 'board';
  deps.setStatus(t('status.saved'));
  $('#title').textContent = board.title;
  render();
}

const el = (tag, attrs, parent) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  parent?.append(e);
  return e;
};
const ALIGN = { left: ['start', 0], center: ['middle', 0.5], right: ['end', 1] };  // âncora e ponto na caixa
const DASH = { solid: null, dashed: '8 8', dotted: '1.5 6' };
const fileUrl = (id) => `/api/maps/${board.id}/files/${id}`;
// cor vinda do arquivo só entra em id/atributo/estilo se for hexadecimal
const strokeOf = (e) => (isHex(e.strokeColor) ? e.strokeColor : DEFAULTS.strokeColor);

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

// linha de base igual à da caixa de edição (regra do CSS): meia sobra da altura de linha acima,
// depois a ascendente da fonte. Com "text-before-edge" cada fonte ficava alguns px acima/abaixo.
function baseline(e) {
  mctx.font = `${e.fontSize}px ${fontOf(e)}`;
  const m = mctx.measureText('Hg'), a = m.fontBoundingBoxAscent, d = m.fontBoundingBoxDescent;
  return (lineH(e.fontSize) - (a + d)) / 2 + a;
}
function drawLines(g, e, lines, x, y, w) {
  const align = ALIGN[e.textAlign] ?? ALIGN.left, ax = x + w * align[1], b = baseline(e);
  const t = el('text', { x: ax, y: y + b, fill: strokeOf(e), 'font-size': e.fontSize, 'font-family': fontOf(e), 'text-anchor': align[0] }, g);
  lines.forEach((line, i) => { el('tspan', { x: ax, y: y + b + i * lineH(e.fontSize) }, t).textContent = line; });
}

// nota adesiva: o texto quebra por palavras na largura da nota; a nota cresce para baixo se faltar espaço
function noteLines(e, text = e.text) {
  mctx.font = `${e.fontSize}px ${fontOf(e)}`;
  return text.split('\n').flatMap(p => wrapLines(p, e.w - 2 * NOTE_PAD, s => mctx.measureText(s).width));
}
const fitNote = (e, text = e.text) => { e.h = Math.max(e.h, 2 * NOTE_PAD + noteLines(e, text).length * lineH(e.fontSize)); };

const warned = new Set();  // elementos inválidos já avisados no console
// um elemento inválido no arquivo não derruba o quadro: fica vazio (dá para selecionar tudo e apagar)
function drawElement(e) {
  try { return drawOne(e); } catch (err) {
    if (!warned.has(e?.id)) { warned.add(e?.id); console.warn('Elemento inválido ignorado no desenho:', e?.id, err); }
    return el('g', { class: 'el' });
  }
}
function drawOne(e) {
  const g = el('g', { class: 'el', 'data-id': e.id, opacity: (e.opacity ?? 100) / 100 });
  if (erasing?.ids.has(e.id)) g.classList.add('erasing');
  if (e.type === 'note') {
    el('rect', { class: 'note-bg', x: e.x, y: e.y, width: e.w, height: e.h, rx: 4, fill: isHex(e.backgroundColor) ? e.backgroundColor : NOTE_COLOR }, g);
    if (editingText?.el !== e) drawLines(g, e, noteLines(e), e.x + NOTE_PAD, e.y + NOTE_PAD, e.w - 2 * NOTE_PAD);
    return g;
  }
  if (e.type === 'text') {
    if (editingText?.el !== e) drawLines(g, e, e.text.split('\n'), e.x, e.y, e.w);
    return g;
  }
  if (e.type === 'image') {
    if (FILE_ID.test(e.fileId ?? '')) el('image', { href: fileUrl(e.fileId), x: e.x, y: e.y, width: e.w, height: e.h, preserveAspectRatio: 'none' }, g);
    return g;
  }
  const bg = isHex(e.backgroundColor) && fillPath(e);
  if (bg) el('path', { d: bg, fill: e.fillStyle === 'solid' ? e.backgroundColor : hatch(e.backgroundColor), stroke: 'none' }, g);
  for (const d of elementPaths(e)) {
    el('path', {
      d, fill: 'none', stroke: strokeOf(e), 'stroke-width': e.strokeWidth,
      'stroke-dasharray': e.type === 'freedraw' ? null : DASH[e.strokeStyle], 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }, g);
  }
  return g;
}

// ícone de link no canto do elemento (tamanho fixo na tela); clicar abre o endereço
function drawLinkBadge(e) {
  const b = elementBounds(e), k = view.k;
  const g = el('g', { class: 'link-badge', 'data-id': e.id, transform: `translate(${b.x + b.w + 4 / k} ${b.y - 26 / k}) scale(${1 / k})` }, root);
  el('title', {}, g).textContent = safeUrl(e.link);
  el('rect', { width: 22, height: 22, rx: 6 }, g);
  el('use', { href: '#i-link', x: 3, y: 3, width: 16, height: 16 }, g);
}

function render() {
  if (!board) return;
  $('#title').textContent = board.title;
  root.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  root.replaceChildren(...board.elements.map(drawElement));
  for (const e of board.elements) if (safeUrl(e.link)) drawLinkBadge(e);
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
  // ferramenta do menu "mais": o botão ⋯ fica ativo e mostra o ícone dela
  const extra = more.querySelector(`[data-tool="${t}"] use`)?.getAttribute('href');
  moreBtn.classList.toggle('active', !!extra);
  moreBtn.querySelector('use').setAttribute('href', extra ?? '#i-dots');
  more.hidden = true;
  render();  // painel de estilo aparece/some conforme a ferramenta
}
const more = $('#board-more'), moreBtn = $('#board-more-btn');
moreBtn.onclick = () => { more.hidden = !more.hidden; };
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#board-more, #board-more-btn')) more.hidden = true; }, true);
document.querySelector('#board-tools').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tool]')?.dataset.tool;
  if (t === 'image') { more.hidden = true; imageInput.click(); }
  else if (t) setTool(t);
});

const snapshot = () => JSON.stringify(board.elements);
function changed(before) {
  try { render(); } catch (err) {
    // a mudança quebrou o desenho: volta ao estado anterior (nada é salvo) e deixa o erro aparecer
    board.elements = JSON.parse(before);
    selection = selection.filter(id => board.elements.some(x => x.id === id));
    render();
    throw err;
  }
  history.push(before);
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
  // editando texto/nota: o clique só conclui a edição (com a ferramenta Texto ou Nota ainda ativa,
  // ele criaria outro elemento e a edição atual se perderia sem salvar)
  if (editingText) { e.preventDefault(); commitText(); return; }
  const badge = e.target.closest?.('.link-badge');
  if (badge && e.button === 0) {
    const url = safeUrl(board.elements.find(x => x.id === badge.dataset.id)?.link);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (isDoubleClick(e) && tool === 'select' && e.button === 0 && onDoubleClick(e)) {
    e.preventDefault();  // sem os eventos de mouse depois, o foco fica no campo de texto
    gesture = null;
    return;
  }
  if (tool === 'hand' || spaceDown || e.button === 1) {
    panning = { x: e.clientX - view.x, y: e.clientY - view.y };
    svg.classList.add('panning');
  } else if (SHAPES.has(tool) && e.button === 0) {
    drawing = { el: createElement(tool, toWorld(e), { ...style }), before: snapshot() };
    board.elements.push(drawing.el);
  } else if (tool === 'select' && e.button === 0) {
    selectDown(e);
  } else if (tool === 'laser' && e.button === 0) {
    laserDown = true;
    laser.push([...toWorld(e), performance.now(), true]);
    if (!laserRaf) drawLaser();
  } else if (tool === 'lasso' && e.button === 0) {
    gesture = { kind: 'lasso', pts: [toWorld(e)], keep: e.shiftKey ? [...selection] : [] };
  } else if (tool === 'note' && e.button === 0) {
    e.preventDefault();
    const [x, y] = toWorld(e), bg = isHex(style.backgroundColor) ? style.backgroundColor : NOTE_COLOR;
    startText(createElement('note', [x - NOTE_SIZE / 2, y - NOTE_SIZE / 2], { ...style, backgroundColor: bg, w: NOTE_SIZE, h: NOTE_SIZE, text: '' }), true);
    return;
  } else if (tool === 'text' && e.button === 0) {
    e.preventDefault();
    startText(createElement('text', toWorld(e), { ...style, text: '' }), true);
    return;
  } else if (tool === 'bucket' && e.button === 0) {
    const id = elementAt(board.elements, toWorld(e), 6 / view.k, true);
    if (id) { const before = snapshot(); paint(board.elements.find(x => x.id === id), style); changed(before); }
    return;
  } else if (tool === 'eraser' && e.button === 0) {
    const p = toWorld(e);
    erasing = { last: p, ids: new Set(elementsHitBy(board.elements, p, p, 4 / view.k)), before: snapshot() };
    render();
  } else return;
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', (e) => {
  if (panning) { view.x = e.clientX - panning.x; view.y = e.clientY - panning.y; render(); }
  else if (drawing) { resizeTo(drawing.el, toWorld(e)); render(); }
  else if (gesture) selectMove(e);
  else if (laserDown) laser.push([...toWorld(e), performance.now(), false]);
  else if (erasing) {
    const p = toWorld(e);
    for (const id of elementsHitBy(board.elements, erasing.last, p, 4 / view.k)) erasing.ids.add(id);
    erasing.last = p;
    render();
  }
});
svg.addEventListener('pointerup', (e) => {
  if (panning) { panning = null; svg.classList.remove('panning'); return; }
  if (gesture) { selectUp(e); return; }
  if (laserDown) { laserDown = false; return; }
  if (erasing) {
    const { ids, before } = erasing;
    erasing = null;
    if (ids.size) { board.elements = board.elements.filter(x => !ids.has(x.id)); changed(before); } else render();
    return;
  }
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

// ponteiro laser: rastro vermelho que some em 1 s; fica fora de board.elements (nunca salvo)
let laser = [], laserDown = false, laserRaf = 0;  // pontos [x, y, instante, começa traço novo?]
function drawLaser() {
  const now = performance.now();
  laser = laser.filter(p => now - p[2] < 1000);
  root.querySelector('.laser')?.remove();
  const d = laser.map((p, i) => `${i === 0 || p[3] ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
  if (laser.length) el('path', { class: 'laser', d, 'stroke-width': 4 / view.k }, root);
  laserRaf = laser.length || laserDown ? requestAnimationFrame(drawLaser) : 0;
}

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
  t: 'text', 8: 'text', n: 'note', e: 'eraser', 0: 'eraser', b: 'bucket', q: 'lasso', k: 'laser',
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
  else if (ctrl && k === 'k') { e.preventDefault(); act('link'); }
  else if (ctrl && k === 'c') { if (selection.length) clipboard = clipJson(selected()); }
  // Ctrl+X: o evento "cut" (sistema) vem depois desta tecla; se ele não vier, recorta só na cópia interna
  else if (ctrl && k === 'x') { if (selection.length) pendingCut = setTimeout(() => { clipboard = clipJson(selected()); act('delete'); }, 0); }
  // Ctrl+V: sem preventDefault, para o evento "paste" (que traz imagens) acontecer antes; se não houver imagem, cola os elementos
  else if (ctrl && k === 'v') { pendingPaste = setTimeout(paste, 0); }
  else if (ctrl && e.shiftKey && (e.key === ']' || e.key === '}')) { e.preventDefault(); act('front'); }
  else if (ctrl && e.shiftKey && (e.key === '[' || e.key === '{')) { e.preventDefault(); act('back'); }
  else if (ctrl && e.key === ']') { e.preventDefault(); act('forward'); }
  else if (ctrl && e.key === '[') { e.preventDefault(); act('backward'); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) { e.preventDefault(); act('delete'); }
  else if (e.key === '?') { help.hidden = !help.hidden; }
  else if (e.key === 'Escape') { help.hidden = true; more.hidden = true; selection = []; setTool('select'); render(); }
  else if (e.key.startsWith('Arrow') && selection.length) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1, before = snapshot();
    const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    moveElements(board.elements, selection, dx, dy);
    changed(before);
  }
  else if (e.key === ' ') { e.preventDefault(); spaceDown = true; svg.classList.add('panning'); }
  else if (!ctrl && !e.altKey && e.key === '9') imageInput.click();
  else if (!ctrl && !e.altKey && TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ') { spaceDown = false; if (!panning) svg.classList.remove('panning'); }
});

// ---------- Imagens: seletor (9 / menu ⋯), colar e arrastar arquivo ----------
const imageInput = $('#board-image-input');
let pendingPaste = 0;
imageInput.addEventListener('change', () => { const f = imageInput.files[0]; imageInput.value = ''; insertImage(f); });
// área de transferência do sistema: vale entre abas e depois de recarregar (a variável clipboard é só o plano B)
const CLIP = 'application/x-brainstorm-board', MAX_CLIP = 1e6;
const boardKeys = (e) => board && document.body.dataset.view === 'board' && !e.target.closest?.('input, textarea, select');
let pendingCut = 0;
const selected = () => board.elements.filter(x => selection.includes(x.id));
// imagens levam o quadro de origem: colando em outro quadro, o arquivo é copiado para ele
const clipJson = (items) => JSON.stringify(items.map(x => (x.type === 'image' ? { ...x, fileSrc: board.id } : x)));
const DOC_ID = /^[a-z0-9-]{1,64}$/;
async function bringFiles(items) {
  const out = [];
  for (const x of items) {
    if (x.type !== 'image' || !x.fileSrc || x.fileSrc === board.id) { out.push(x); continue; }
    try {
      if (!DOC_ID.test(x.fileSrc) || !FILE_ID.test(x.fileId ?? '')) throw new Error('arquivo inválido');
      const r = await fetch(`/api/maps/${x.fileSrc}/files/${x.fileId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const up = await fetch(`/api/maps/${board.id}/files`, { method: 'POST', headers: { 'X-Filename': x.fileId }, body: await r.blob() });
      if (!up.ok) throw new Error(`HTTP ${up.status}`);
      out.push({ ...x, fileId: (await up.json()).id });
    } catch { /* arquivo de origem sumiu (ex.: quadro apagado): essa imagem fica de fora */ }
  }
  return out;
}
function copyTo(e) {
  const items = selected();
  clipboard = clipJson(items);
  e.clipboardData.setData(CLIP, clipboard);
  e.clipboardData.setData('text/plain', items.map(x => x.text).filter(Boolean).join('\n'));  // texto para outros programas
  e.preventDefault();
}
document.addEventListener('copy', (e) => { if (boardKeys(e) && selection.length) copyTo(e); });
document.addEventListener('cut', (e) => {  // recortar = copiar e apagar
  if (!boardKeys(e) || !selection.length) return;
  clearTimeout(pendingCut);
  copyTo(e);
  act('delete');
});
// colar: elementos do Brainstorm > imagem > texto (vira um texto no centro da tela)
document.addEventListener('paste', (e) => {
  if (!boardKeys(e) || !e.clipboardData) return;
  const json = e.clipboardData.getData(CLIP);
  if (json.length > MAX_CLIP) { clearTimeout(pendingPaste); e.preventDefault(); return; }  // grande demais: recusa
  const f = [...e.clipboardData.files].find(x => x.type.startsWith('image/'));
  const text = e.clipboardData.getData('text/plain').replace(/\s+$/, '');
  if (!json && !f && !text) return;  // nada aproveitável: fica o plano B (cópia interna)
  clearTimeout(pendingPaste);
  e.preventDefault();
  if (json) { clipboard = json; paste(); } else if (f) insertImage(f); else pasteText(text);
});
function pasteText(text) {
  const before = snapshot(), [cx, cy] = [(svg.clientWidth / 2 - view.x) / view.k, (svg.clientHeight / 2 - view.y) / view.k];
  const item = createElement('text', [cx, cy], { ...style, text: text.slice(0, 10000) });
  measureText(item);
  Object.assign(item, { x: cx - item.w / 2, y: cy - item.h / 2 });
  board.elements.push(item);
  setTool('select');
  selection = [item.id];
  changed(before);
}
svg.addEventListener('dragover', (e) => e.preventDefault());
svg.addEventListener('drop', (e) => {
  const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
  if (!f) return;
  e.preventDefault();
  insertImage(f, toWorld(e));
});

// envia ao servidor (mesma rota de anexos dos mapas) e põe no centro da tela, com no máx. 400 px
async function insertImage(file, at = null) {
  if (!file || !board) return;
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { alert(t('common.imageTypeError')); return; }
  const id = board.id;
  try {
    const r = await fetch(`/api/maps/${id}/files`, { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name || 'imagem.png') }, body: file });
    if (!r.ok) throw new Error(r.status === 413 ? t('error.fileTooLarge') : `HTTP ${r.status}`);
    const { id: fileId } = await r.json();
    const im = new Image();
    im.src = `/api/maps/${id}/files/${fileId}`;
    await im.decode();
    if (board?.id !== id) return;  // trocou de quadro durante o envio
    const k = Math.min(1, 400 / Math.max(im.naturalWidth, im.naturalHeight)), w = im.naturalWidth * k, h = im.naturalHeight * k;
    const [cx, cy] = at ?? [(svg.clientWidth / 2 - view.x) / view.k, (svg.clientHeight / 2 - view.y) / view.k];
    const before = snapshot(), item = { ...createElement('image', [cx - w / 2, cy - h / 2]), w, h, fileId };
    board.elements.push(item);
    setTool('select');
    selection = [item.id];
    changed(before);
  } catch (err) {
    alert(t('board.image.insertError', { error: err.message }));
  }
}

// título do quadro (o app.js cuida da edição no topo)
export function renameBoard(t) {
  if (!board || !t || t === board.title) return;
  board.title = t;
  render();
  deps.scheduleSave(board);
}

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
  if (gesture?.kind === 'lasso') {
    el('path', { class: 'marquee', d: 'M' + gesture.pts.map(q => q.join(',')).join(' L') + ' Z', 'stroke-width': 1 / view.k }, root);
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
    if (gesture.item.type === 'note') fitNote(gesture.item);
    gesture.moved = true;
  } else if (gesture.kind === 'lasso') gesture.pts.push(p);
  else gesture.cur = p;
  render();
}

function selectUp() {
  const g = gesture;
  gesture = null;
  if (g.kind === 'marquee') selection = [...new Set([...g.keep, ...elementsInBox(board.elements, marqueeBox(g))])];
  if (g.kind === 'lasso') {
    selection = [...new Set([...g.keep, ...elementsInPolygon(board.elements, g.pts)])];
    if (selection.length) setTool('select');  // depois do laço, a seleção já pode ser arrastada
  }
  if ((g.kind === 'move' || g.kind === 'resize') && g.moved) changed(g.before);
  render();
}

// ---------- Ações na seleção ----------
function act(name) {
  if (!selection.length) return;
  const before = snapshot();
  if (name === 'link') {
    const sel = board.elements.filter(x => selection.includes(x.id));
    const input = prompt(t('board.link.prompt'), sel[0].link ?? '');
    if (input === null) return;
    const url = safeUrl(input);
    if (input.trim() && !url) { alert(t('board.link.invalid')); return; }
    for (const x of sel) { if (url) x.link = url; else delete x.link; }
    return changed(before);
  }
  if (name === 'delete') {
    board.elements = board.elements.filter(x => !selection.includes(x.id));
    selection = [];
  } else if (name === 'duplicate') {
    const copies = duplicateElements(board.elements, selection, 10);
    board.elements.push(...copies);
    selection = copies.map(c => c.id);
  } else if (name === 'front') board.elements = bringToFront(board.elements, selection);
  else if (name === 'back') board.elements = sendToBack(board.elements, selection);
  else if (name === 'forward') board.elements = forwardOne(board.elements, selection);
  else if (name === 'backward') board.elements = backwardOne(board.elements, selection);
  changed(before);
}

// elementos colados podem ter vindo de outro site: okElement recusa o que não dá para desenhar,
// sanitizeElement limpa o resto (board-model.js)
async function paste() {
  if (!clipboard) return;
  let items;
  try { items = JSON.parse(clipboard); } catch { return; }
  if (!Array.isArray(items) || !items.every(okElement)) return;
  const id = board.id;
  items = await bringFiles(items.map(sanitizeElement));
  if (board?.id !== id || !items.length) return;  // trocou de quadro durante a cópia dos arquivos
  const before = snapshot();
  const copies = duplicateElements(items, items.map(x => x.id), 20).map(({ fileSrc, ...c }) => c);
  board.elements.push(...copies);
  selection = copies.map(c => c.id);
  clipboard = clipJson(copies);  // colar de novo desloca mais
  changed(before);
}

// ---------- Painel de estilo ----------
const props = $('#board-props');
const STROKES = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#6741d9'];
const FILLS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#d0bfff'];
const NUMERIC = new Set(['strokeWidth', 'roughness', 'opacity', 'fontSize']);
for (const [prop, colors] of [['strokeColor', STROKES], ['backgroundColor', FILLS]]) {
  props.querySelector(`[data-prop="${prop}"]`).append(...colors.map((c) => {
    const b = document.createElement('button');
    b.dataset.value = c;
    b.title = c === 'transparent' ? t('board.props.noBackground') : c;
    if (c !== 'transparent') b.style.background = c;
    return b;
  }));
}

function renderProps() {
  const sel = board.elements.filter(x => selection.includes(x.id));
  props.hidden = !(sel.length || STYLED.has(tool));
  $('#board-font-row').hidden = !(sel.some(x => HAS_TEXT.has(x.type)) || HAS_TEXT.has(tool));
  $('#board-sel-actions').hidden = !sel.length;
  if (props.hidden) return;
  const cur = sel[0] ?? style;
  for (const group of props.querySelectorAll('[data-prop]')) {
    const p = group.dataset.prop;
    for (const b of group.querySelectorAll('[data-value]')) b.classList.toggle('active', String(cur[p] ?? TEXT_DEFAULTS[p]) === b.dataset.value);
  }
  $('#board-opacity').value = cur.opacity ?? 100;
}

// muda o estilo dos selecionados (com desfazer) e dos próximos elementos
function setProp(prop, value) {
  style[prop] = value;
  const sel = board.elements.filter(x => selection.includes(x.id));
  if (!sel.length) { renderProps(); return; }
  const before = snapshot();
  for (const item of sel) {
    item[prop] = value;
    if (item.type === 'text') measureText(item);
    if (item.type === 'note') fitNote(item);
  }
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

// ---------- Texto ----------
const textArea = $('#board-text');

// largura/altura do texto (linhas × altura de linha), guardadas no elemento
function measureText(e, text = e.text) {
  mctx.font = `${e.fontSize}px ${fontOf(e)}`;
  const lines = text.split('\n');
  e.w = Math.max(4, ...lines.map(l => mctx.measureText(l).width));
  e.h = lines.length * lineH(e.fontSize);
}

function placeTextArea() {
  const e = editingText.el, k = view.k, note = e.type === 'note', pad = note ? NOTE_PAD : 0;
  const lines = note ? noteLines(e, textArea.value) : textArea.value.split('\n');
  mctx.font = `${e.fontSize}px ${fontOf(e)}`;
  Object.assign(textArea.style, {
    left: `${view.x + (e.x + pad) * k}px`, top: `${view.y + (e.y + pad) * k}px`, color: strokeOf(e), textAlign: e.textAlign ?? 'left',
    // propriedades separadas: o atalho "font" zeraria a altura de linha e cortaria as últimas linhas
    fontFamily: fontOf(e), fontSize: `${e.fontSize * k}px`, lineHeight: `${lineH(e.fontSize) * k}px`,
    whiteSpace: note ? 'pre-wrap' : 'pre',  // na nota, a caixa quebra na largura dela
    width: note ? `${(e.w - 2 * pad) * k}px` : `${(Math.max(20, ...lines.map(l => mctx.measureText(l).width)) + 20) * k}px`,
    // folga proporcional: as letras da Kalam passam da altura de linha; sem ela o navegador
    // rola o texto para cima para mostrar o cursor (o texto "pula" ao clicar)
    height: `${(lines.length * lineH(e.fontSize) + e.fontSize * 0.5) * k}px`,
  });
  textArea.scrollTop = 0;  // cresce antes de rolar: a primeira linha não some
}

function startText(e, isNew) {
  editingText = { el: e, isNew, before: snapshot(), old: e.text };
  if (isNew && e.type === 'note') board.elements.push(e);  // a nota aparece já durante a digitação
  textArea.value = e.text;
  textArea.hidden = false;
  placeTextArea();
  render();
  textArea.focus();
  textArea.setSelectionRange(textArea.value.length, textArea.value.length);
}

function commitText() {
  if (!editingText) return;
  const { el: e, isNew, before, old } = editingText;
  editingText = null;
  textArea.blur();  // tira o foco antes de esconder: senão as próximas teclas iriam para o campo
  textArea.hidden = true;
  const text = textArea.value.replace(/\s+$/, ''), note = e.type === 'note';  // nota vazia continua (é uma forma)
  if (!text && !note) {
    if (!isNew) { board.elements = board.elements.filter(x => x !== e); changed(before); }  // apagou o texto todo
  } else if (isNew || text !== old) {
    e.text = text;
    if (note) fitNote(e); else measureText(e);
    if (isNew && !note) board.elements.push(e);
    changed(before);
  }
  setTool('select');
  if (text || note) selection = [e.id];
  render();
}

// a caixa, a nota e a moldura de seleção acompanham o texto (digitar e Enter, que insere a quebra por código)
function textChanged() {
  const e = editingText?.el;
  if (e?.type === 'note') { fitNote(e, textArea.value); render(); }
  if (e?.type === 'text') { measureText(e, textArea.value); render(); }
  placeTextArea();
}
textArea.addEventListener('input', textChanged);
// Enter quebra a linha (a caixa cresce antes, então nada rola para fora); Esc, Ctrl+Enter ou clicar fora confirmam
textArea.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commitText(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    textArea.setRangeText('\n', textArea.selectionStart, textArea.selectionEnd, 'end');
    textChanged();
  }
});
textArea.addEventListener('blur', commitText);
textArea.addEventListener('scroll', () => { textArea.scrollTop = 0; });  // a caixa já cabe tudo: rolar só desalinharia

// duplo clique: edita o texto sob o ponteiro, ou cria um texto novo no vazio.
// Detectado no pointerdown: a lousa redesenha a cada toque, então o navegador não gera dblclick.
let lastDown = null;
function isDoubleClick(e) {
  const now = performance.now();
  const dbl = lastDown && now - lastDown.t < 400 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6;
  lastDown = dbl ? null : { t: now, x: e.clientX, y: e.clientY };
  return dbl;
}
function onDoubleClick(e) {
  const p = toWorld(e), id = elementAt(board.elements, p, 6 / view.k);
  const hit = id && board.elements.find(x => x.id === id);
  if (HAS_TEXT.has(hit?.type)) startText(hit, false);
  else if (!hit) startText(createElement('text', p, { ...style, text: '' }), true);
  else return false;  // duplo clique numa forma: segue como clique normal (selecionar/arrastar)
  return true;
}

// ---------- Ajuda ----------
const help = $('#board-help');
$('#board-help-btn').onclick = () => { help.hidden = !help.hidden; };

// ---------- Exportar (o app.js chama): SVG solto do quadro, sem seleção, com fundo branco ----------
// fonte embutida no arquivo exportado (a imagem solta não enxerga os arquivos do app)
const dataUrl = async (href) => {
  const blob = await (await fetch(href)).blob();
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
};
async function fontCss() {
  const parts = await Promise.all(['latin', 'latin-ext'].map(async (sub) =>
    `@font-face{font-family:Kalam;src:url(${await dataUrl(`fonts/kalam-${sub}-400-normal.woff2`)}) format("woff2")}`));
  return parts.join('');
}

export async function boardSvg() {
  const pad = 30, bb = root.getBBox();
  const clone = svg.cloneNode(true);
  clone.removeAttribute('id');
  clone.removeAttribute('data-tool');
  clone.removeAttribute('class');
  const r = clone.querySelector('#board-root');
  r.removeAttribute('transform');
  for (const x of r.querySelectorAll('.sel-item, .handle, .marquee, .laser, .link-badge')) x.remove();
  const w = Math.max(1, bb.width) + 2 * pad, h = Math.max(1, bb.height) + 2 * pad;
  const bg = document.createElementNS(SVG, 'rect');
  Object.entries({ x: bb.x - pad, y: bb.y - pad, width: w, height: h, fill: '#ffffff' }).forEach(([k, v]) => bg.setAttribute(k, v));
  r.prepend(bg);
  // imagens embutidas: o arquivo exportado não enxerga o servidor
  await Promise.all([...r.querySelectorAll('image')].map(async (im) => im.setAttribute('href', await dataUrl(im.getAttribute('href')))));
  if (board.elements.some(x => HAS_TEXT.has(x.type) && fontOf(x) === FONTS.hand)) {
    const st = document.createElementNS(SVG, 'style');
    st.textContent = await fontCss();
    clone.prepend(st);
  }
  clone.setAttribute('xmlns', SVG);
  clone.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${w} ${h}`);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  return { xml: new XMLSerializer().serializeToString(clone), w, h, title: board.title };
}
