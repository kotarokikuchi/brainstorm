import {
  PALETTE, uid, newMap, findNode, addChild, addSibling, removeNode, commitText,
  History, layout, edgePath, navigate, moveNode, dropTarget, addLink, removeLink, linkPath, linkHandle, pasteBranch,
} from './model.js';

const $ = (s) => document.querySelector(s);
const SVG = 'http://www.w3.org/2000/svg';
const svg = $('#canvas'), viewport = $('#viewport'), input = $('#editor'), statusEl = $('#status');

let map = null;          // mapa aberto
let selected = null;     // id do nó selecionado
let editing = null;      // {id, isNew} enquanto o input está ativo
let boxes = [];          // caixas do último render
let history = new History();
const view = { x: 0, y: 0, k: 1 };  // translação + escala do viewport
// estado do autosave
let saveTimer = null, retryTimer = null, dirty = false, saving = null, conflict = false;
let pending = null;  // mapa com alteração pendente (sobrevive a sair do editor)

// ---------- API ----------
const api = (method, path = '', body) => fetch('/api/maps' + path, {
  method,
  headers: body ? { 'Content-Type': 'application/json' } : {},
  body: body && JSON.stringify(body),
});

// ---------- Rotas ----------
window.addEventListener('hashchange', route);
route();

async function route() {
  finishEdit(true);  // navegar no meio da digitação confirma o texto
  await flushSave();
  const m = location.hash.match(/^#\/map\/([a-z0-9-]+)$/);
  if (m) openMap(m[1]); else showList();
}

// ---------- Lista de mapas ----------
async function showList() {
  map = null;
  document.body.dataset.view = 'list';
  const items = await (await api('GET')).json();
  const ul = $('#maps');
  ul.replaceChildren(...items.map(it => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#/map/${it.id}`;
    a.textContent = it.title || '(sem título)';
    const time = document.createElement('time');
    time.textContent = new Date(it.updated).toLocaleString('pt-BR');
    const del = document.createElement('button');
    del.textContent = 'Apagar';
    del.onclick = async () => {
      if (!confirm(`Apagar o mapa "${a.textContent}"?`)) return;
      await api('DELETE', `/${it.id}`);
      showList();
    };
    li.append(a, time, del);
    return li;
  }));
  $('#empty').hidden = items.length > 0;
}

$('#new-map').onclick = async () => {
  const m = newMap(uid());
  const r = await api('PUT', `/${m.id}`, m);
  if (r.ok) location.hash = `#/map/${m.id}`;
  else alert('Não foi possível criar o mapa.');
};

// ---------- Editor ----------
async function openMap(id) {
  const r = await api('GET', `/${id}`);
  if (!r.ok) { location.hash = '#/'; return; }
  map = await r.json();
  history = new History();
  selected = map.root.id;
  if (conflict) dirty = false;  // edições do mapa em conflito foram abandonadas ao sair dele
  conflict = false;
  document.body.dataset.view = 'editor';
  setStatus('Salvo');
  stylePop.hidden = true;
  render();
  fitView();
}

// medida de texto via canvas (mesma fonte do SVG)
const ctx = document.createElement('canvas').getContext('2d');
const FONT = getComputedStyle(document.body).fontFamily;
const fontFor = (depth) => depth === 0 ? `700 24px ${FONT}` : depth === 1 ? `600 15px ${FONT}` : `400 14px ${FONT}`;
function measure(text, depth) {
  ctx.font = fontFor(depth);
  const w = Math.max(ctx.measureText(text).width, 30);
  if (depth === 0) return { w: w + 24, h: 44 };
  if (depth === 1) return { w: w + 36, h: 36 };
  return { w: w + 20, h: 28 };
}

const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
};

function render() {
  if (!map) return;
  $('#title').textContent = map.root.text;
  const res = layout(map, measure);
  boxes = res.nodes;
  // seleção nunca fica num nó invisível (recolhido/apagado): sobe ao ancestral visível
  if (selected !== null) {
    while (!boxes.some(b => b.id === selected)) selected = findNode(map.root, selected)?.parent?.id ?? map.root.id;
  }
  viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  viewport.replaceChildren();
  // na lista, arestas longas primeiro: o tronco fica segmentado com a cor de cada ramo
  const edges = map.layout === 'list' ? [...res.edges].reverse() : res.edges;
  for (const e of edges) {
    el('path', {
      d: edgePath(map.layout, e.from, e.to), fill: 'none', stroke: e.color,
      'stroke-width': Math.max(2, 6 - e.depth), 'stroke-linecap': 'round',
    }, viewport);
  }
  for (const b of boxes) drawNode(b);
  drawLinks();
  if (drag?.active) drawDrop();
  if (editing) placeInput();
  placeOverlays();
}

function drawNode(b) {
  const n = findNode(map.root, b.id).node;
  const g = el('g', { class: 'node', 'data-id': b.id }, viewport);
  if (drag?.active && drag.ids.has(b.id)) g.classList.add('dragging');
  // forma efetiva: raiz sem caixa, 1º nível pílula, demais sublinhado
  const shape = b.shape ?? (b.depth === 0 ? 'none' : b.depth === 1 ? 'pill' : 'underline');
  const filled = shape === 'pill' || shape === 'rect' || shape === 'rounded';
  if (filled) {
    const rx = { pill: b.h / 2, rect: 2, rounded: 8 }[shape];
    el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx, fill: b.color }, g);
  } else {
    // área clicável invisível
    el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }, g);
  }
  if (shape === 'underline') {
    el('line', {
      x1: b.x, y1: b.y + b.h, x2: b.x + b.w, y2: b.y + b.h,
      stroke: b.color, 'stroke-width': 2.5, 'stroke-linecap': 'round',
    }, g);
  }
  const t = el('text', {
    x: b.x + b.w / 2, y: b.y + b.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    fill: filled ? '#fff' : '#1d1d2b', style: `font: ${fontFor(b.depth)}`,
  }, g);
  t.textContent = editing?.id === b.id ? '' : n.text;
  if (b.id === selected) {
    el('rect', { class: 'selected-ring', x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, rx: 8 }, g);
  }
  if (n.children.length && b.depth > 0) drawToggle(b, n, g);
  g.addEventListener('click', (ev) => { ev.stopPropagation(); select(b.id); });
  g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); startEdit(b.id, false); });
}

// bolinha de recolher/expandir na borda externa do nó
function drawToggle(b, n, g) {
  let cx = b.x + b.w + 12, cy = b.y + b.h / 2;
  if (map.layout === 'map' && b.side === 'left') cx = b.x - 12;
  if (map.layout === 'org') { cx = b.x + b.w / 2; cy = b.y + b.h + 12; }
  const tg = el('g', { class: 'toggle' }, g);
  el('circle', { cx, cy, r: 9, stroke: b.color }, tg);
  const t = el('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: b.color }, tg);
  t.textContent = n.collapsed ? n.children.length : '−';
  tg.addEventListener('click', (ev) => {
    ev.stopPropagation();
    mutate(() => { n.collapsed = !n.collapsed; });
  });
}

function select(id) {
  selected = id;
  selectedLink = null;
  nodeMenu.hidden = true;
  render();
}

// ---------- Mutações + histórico ----------
const snapshot = () => JSON.stringify({ root: map.root, layout: map.layout, links: map.links ?? [] });

function mutate(fn) {
  history.push(snapshot());
  fn();
  render();
  scheduleSave();
}

const undo = () => restore(history.undo(snapshot()));
const redo = () => restore(history.redo(snapshot()));

function deleteSelected() {
  if (selectedLink) {
    const id = selectedLink;
    selectedLink = null;
    mutate(() => removeLink(map, id));
    return;
  }
  if (!selected || selected === map.root.id) return;
  mutate(() => { selected = removeNode(map, selected); });
}

function restore(state) {
  if (state === null) return;
  const s = JSON.parse(state);
  map.root = s.root;
  map.layout = s.layout;
  map.links = s.links ?? [];
  if (!map.links.some(k => k.id === selectedLink)) selectedLink = null;
  if (selected !== null && !findNode(map.root, selected)) selected = map.root.id;
  render();
  scheduleSave();
}

// ---------- Edição de texto ----------
function startEdit(id, isNew, initial) {
  editing = { id, isNew, prev: selected };
  selected = id;
  input.value = initial ?? findNode(map.root, id).node.text;
  input.hidden = false;
  render();
  input.focus();
  if (initial === undefined) input.select();
}

function placeInput() {
  const b = boxes.find(b => b.id === editing.id);
  if (!b) return;
  const w = Math.max(b.w, 140) * view.k;
  input.style.left = `${view.x + (b.x + b.w / 2) * view.k - w / 2}px`;
  input.style.top = `${view.y + b.y * view.k}px`;
  input.style.width = `${w}px`;
  input.style.height = `${b.h * view.k}px`;
  input.style.font = fontFor(b.depth).replace(/\d+px/, (px) => `${parseInt(px) * view.k}px`);
}

function finishEdit(commit) {
  if (!editing) return;
  const { id, isNew, prev } = editing;
  editing = null;
  input.hidden = true;
  const node = findNode(map.root, id)?.node;
  if (node) {
    const text = commit ? input.value : '';
    if (isNew) {
      // nó novo já entrou no histórico ao ser criado
      selected = commitText(map, id, text, true);
      if (findNode(map.root, id)) scheduleSave();
      // nó novo descartado: volta para onde o usuário estava (nada mudou, nada a salvar)
      else if (findNode(map.root, prev)) selected = prev;
    } else if (commit && text.trim() && text.trim() !== node.text) {
      history.push(snapshot());
      selected = commitText(map, id, text, false);
      scheduleSave();
    }
  }
  render();
}

input.addEventListener('keydown', (ev) => {
  ev.stopPropagation();
  if (ev.key === 'Enter') { ev.preventDefault(); finishEdit(true); }
  else if (ev.key === 'Escape') { ev.preventDefault(); finishEdit(false); }
  else if (ev.key === 'Tab') {
    ev.preventDefault();
    const id = editing.id;
    finishEdit(true);
    if (findNode(map.root, id)) addAndEdit(() => addChild(map, id));
  }
});
input.addEventListener('blur', () => finishEdit(true));

function addAndEdit(create) {
  history.push(snapshot());
  const n = create();
  startEdit(n.id, true, '');
}

// ---------- Teclado ----------
document.addEventListener('keydown', (ev) => {
  if (!map || editing || document.body.dataset.view !== 'editor') return;
  const ctrl = ev.ctrlKey || ev.metaKey;
  const key = ev.key;
  if (ctrl && key.toLowerCase() === 'z') {
    ev.preventDefault();
    ev.shiftKey ? redo() : undo();
  } else if (ctrl && key.toLowerCase() === 'y') {
    ev.preventDefault();
    redo();
  } else if (!selected && !ctrl) {
    // nada selecionado: setas/Tab/Enter voltam a selecionar a raiz; o resto é ignorado
    if (key.startsWith('Arrow') || key === 'Tab' || key === 'Enter') { ev.preventDefault(); select(map.root.id); }
  } else if (!selected) {
    return;
  } else if (ctrl && key.toLowerCase() === 'c') {
    actions.copy();
  } else if (ctrl && key.toLowerCase() === 'v') {
    ev.preventDefault();
    actions.paste();
  } else if (ctrl || ev.altKey) {
    return;
  } else if (key === 'Tab') {
    ev.preventDefault();
    addAndEdit(() => addChild(map, selected));
  } else if (key === 'Enter') {
    ev.preventDefault();
    addAndEdit(() => addSibling(map, selected));
  } else if (key === 'Escape') {
    linking = null;
    selectedLink = null;
    nodeMenu.hidden = stylePop.hidden = true;
    render();
  } else if (key === 'Delete' || key === 'Backspace') {
    ev.preventDefault();
    deleteSelected();
  } else if (key === 'F2') {
    ev.preventDefault();
    startEdit(selected, false);
  } else if (key.startsWith('Arrow')) {
    ev.preventDefault();
    select(navigate(boxes, selected, key.slice(5).toLowerCase()));
  } else if (key === ' ') {
    ev.preventDefault();
    actions.collapse();
  } else if (key.length === 1) {
    // digitar sobre um nó começa a editar substituindo o texto
    ev.preventDefault();
    startEdit(selected, false, key);
  }
});

// ---------- Autosave ----------

function setStatus(text, error = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
}

function scheduleSave() {
  // após um 409 não grava mais, mas marca pendência para o aviso ao fechar a aba
  if (conflict) { dirty = true; return; }
  dirty = true;
  pending = map;
  setStatus('Salvando…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}

async function save() {
  if (saving) return saving;
  if (!dirty || conflict || !pending) return;
  clearTimeout(saveTimer);
  clearTimeout(retryTimer);
  retryTimer = null;
  const m = pending;
  dirty = false;
  saving = (async () => {
    try {
      const r = await api('PUT', `/${m.id}`, m);
      if (r.status === 409) {
        conflict = true;
        setStatus('Mapa alterado em outra aba — recarregue', true);
      } else if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      } else {
        m.version = (await r.json()).version;
        if (!dirty) setStatus('Salvo');
      }
    } catch {
      dirty = true;
      setStatus('Erro ao salvar — tentando de novo', true);
      retryTimer = setTimeout(save, 5000);
    }
  })();
  await saving;
  saving = null;
  // mudanças feitas durante o PUT: salva de novo (sem esperar novo erro)
  if (dirty && !conflict && !retryTimer) save();
}

async function flushSave() {
  if (saving) await saving;
  if (dirty && !conflict) await save();
}

window.addEventListener('beforeunload', (ev) => {
  if (dirty || saving || editing) ev.preventDefault();
});
window.addEventListener('resize', render);

// ---------- Controles flutuantes: barra, estilo, "+" ----------
const toolbar = $('#toolbar'), stylePop = $('#style-pop'), nodeMenu = $('#node-menu'), hints = $('#hints');
const addChildBtn = $('#add-child'), addSiblingBtn = $('#add-sibling');

$('#swatches').append(...['', ...PALETTE].map(c => {
  const b = document.createElement('button');
  b.dataset.color = c;
  if (c) b.style.background = c;
  b.title = c || 'Cor padrão';
  return b;
}));

function setStyle(prop, value) {
  const n = findNode(map.root, selected).node;
  if (n[prop] !== value) mutate(() => { n[prop] = value; });
}

$('#swatches').onclick = (e) => {
  const c = e.target.dataset?.color;
  if (c !== undefined) setStyle('color', c || null);
};
$('#shapes').onclick = (e) => {
  const btn = e.target.closest('[data-shape]');
  if (!btn) return;
  // clicar na forma ativa volta ao padrão
  const n = findNode(map.root, selected).node;
  setStyle('shape', n.shape === btn.dataset.shape ? null : btn.dataset.shape);
};
$('#style-btn').onclick = () => { stylePop.hidden = !stylePop.hidden; nodeMenu.hidden = true; render(); };
$('#delete-btn').onclick = deleteSelected;
addChildBtn.onclick = () => addAndEdit(() => addChild(map, selected));
addSiblingBtn.onclick = () => addAndEdit(() => addSibling(map, selected));
$('#undo').onclick = undo;
$('#redo').onclick = redo;

function placeOverlays() {
  const b = drag?.active || linking ? null : boxes.find(b => b.id === selected);
  toolbar.hidden = !b;
  if (!b) stylePop.hidden = nodeMenu.hidden = true;
  addChildBtn.hidden = addSiblingBtn.hidden = hints.hidden = !b || !!editing;
  if (!b) return;
  const sx = (x) => view.x + x * view.k, sy = (y) => view.y + y * view.k;
  const n = findNode(map.root, b.id).node;
  const pos = (el, x, y) => { el.style.left = `${x}px`; el.style.top = `${y}px`; };

  pos(toolbar, sx(b.x + b.w / 2), sy(b.y));
  pos(stylePop, sx(b.x + b.w / 2) - 114, sy(b.y + b.h) + 14);
  pos(nodeMenu, sx(b.x + b.w / 2) - 125, sy(b.y + b.h) + 14);
  $('#more-btn').classList.toggle('active', !nodeMenu.hidden);
  $('#style-btn').classList.toggle('active', !stylePop.hidden);
  for (const s of $('#swatches').children) s.classList.toggle('active', (n.color || '') === s.dataset.color);
  for (const s of $('#shapes').children) s.classList.toggle('active', n.shape === s.dataset.shape);

  // "+ filho" do lado de fora do nó; afasta da bolinha de recolher quando existe
  const gap = n.children.length && b.depth > 0 ? 40 : 20;
  const left = map.layout === 'map' && b.side === 'left';
  let child, sibling;
  if (map.layout === 'org') {
    child = [sx(b.x + b.w / 2), sy(b.y + b.h) + gap];
    sibling = [sx(b.x + b.w) + 20, sy(b.y + b.h / 2)];
  } else {
    child = [left ? sx(b.x) - gap : sx(b.x + b.w) + gap, sy(b.y + b.h / 2)];
    sibling = [sx(b.x + b.w / 2), sy(b.y + b.h) + 18];
  }
  pos(addChildBtn, ...child);
  pos(addSiblingBtn, ...sibling);
  addSiblingBtn.hidden ||= b.depth === 0;
  // dicas só em nó sem filhos visíveis, como num mapa recém-criado
  hints.hidden ||= left || map.layout === 'org' || (n.children.length > 0 && !n.collapsed);
  pos(hints, child[0] + 22, child[1]);

  $('#layout-select').value = map.layout;
  $('#zoom-reset').textContent = `${Math.round(view.k * 100)}%`;
}

// botões não roubam o foco (o teclado continua indo para o mapa)
for (const b of document.querySelectorAll('#editor-view button, .history-btns button')) {
  b.addEventListener('mousedown', (e) => e.preventDefault());
}

// ---------- Layout, zoom e pan ----------
$('#layout-select').onchange = (e) => {
  const v = e.target.value;
  e.target.blur();
  if (v !== map.layout) mutate(() => { map.layout = v; });
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function zoomAt(factor, cx, cy) {
  const k = clamp(view.k * factor, 0.2, 3);
  view.x = cx - (cx - view.x) * (k / view.k);
  view.y = cy - (cy - view.y) * (k / view.k);
  view.k = k;
  render();
}
const zoomCenter = (factor) => zoomAt(factor, svg.clientWidth / 2, svg.clientHeight / 2);

function fitView(maxK = 1) {
  if (!boxes.length) return;
  const minX = Math.min(...boxes.map(b => b.x)), maxX = Math.max(...boxes.map(b => b.x + b.w));
  const minY = Math.min(...boxes.map(b => b.y)), maxY = Math.max(...boxes.map(b => b.y + b.h));
  const W = svg.clientWidth, H = svg.clientHeight;
  // margem vertical maior: a barra flutuante fica acima do nó
  view.k = clamp(Math.min((W - 80) / (maxX - minX), (H - 180) / (maxY - minY)), 0.2, maxK);
  view.x = W / 2 - ((minX + maxX) / 2) * view.k;
  view.y = H / 2 - ((minY + maxY) / 2) * view.k;
  render();
}

$('#zoom-in').onclick = () => zoomCenter(1.2);
$('#zoom-out').onclick = () => zoomCenter(1 / 1.2);
$('#zoom-reset').onclick = () => zoomCenter(1 / view.k);
$('#zoom-fit').onclick = () => fitView(3);

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

let pan = null;
svg.addEventListener('pointerdown', (e) => {
  if (e.target !== svg) return;  // só o fundo arrasta
  pan = { x: e.clientX - view.x, y: e.clientY - view.y, moved: false };
  svg.setPointerCapture(e.pointerId);
  svg.classList.add('panning');
});
svg.addEventListener('pointermove', (e) => {
  if (!pan) return;
  view.x = e.clientX - pan.x;
  view.y = e.clientY - pan.y;
  pan.moved = true;
  render();
});
svg.addEventListener('pointerup', () => {
  if (pan && !pan.moved) {
    selected = selectedLink = null;
    stylePop.hidden = nodeMenu.hidden = true;
    render();
  }
  pan = null;
  svg.classList.remove('panning');
});

// ---------- Arrastar ramos ----------
let drag = null;  // {id, ids, sx, sy, active, x, y, target}

viewport.addEventListener('pointerdown', (e) => {
  const g = e.target.closest('.node');
  if (!g || e.button !== 0 || editing || linking || e.target.closest('.toggle') || g.dataset.id === map.root.id) return;
  const ids = new Set();
  const collect = (n) => { ids.add(n.id); n.children.forEach(collect); };
  collect(findNode(map.root, g.dataset.id).node);
  drag = { id: g.dataset.id, ids, sx: e.clientX, sy: e.clientY, active: false, target: null };
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  // só vira arrasto depois de 5 px: clique simples continua selecionando
  if (!drag.active && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
  drag.active = true;
  svg.classList.add('panning');
  const r = svg.getBoundingClientRect();
  drag.x = (e.clientX - r.left - view.x) / view.k;
  drag.y = (e.clientY - r.top - view.y) / view.k;
  drag.target = dropTarget(map, boxes, drag.id, drag.x, drag.y);
  render();
});

window.addEventListener('pointerup', () => {
  if (!drag) return;
  const { id, active, target } = drag;
  drag = null;
  svg.classList.remove('panning');
  if (!active) return;
  if (target) {
    history.push(snapshot());
    if (moveNode(map, id, target.parentId, target.index, target.side)) {
      selected = id;
      scheduleSave();
    } else {
      history.undo(snapshot());  // movimento recusado: descarta o passo de histórico
      history.future = [];
    }
  }
  render();
});

// caixa cinza onde o ramo vai cair + nó "fantasma" seguindo o ponteiro
function drawDrop() {
  const W = 64, H = 24, t = drag.target;
  if (t) {
    const p = boxes.find(b => b.id === t.parentId);
    const ph = placeholderBox(t, p, W, H);
    el('path', { d: edgePath(map.layout, p, ph), fill: 'none', stroke: '#d4d2de', 'stroke-width': 3, class: 'drop-placeholder' }, viewport);
    el('rect', { ...ph, x: ph.x, y: ph.y, width: W, height: H, rx: 6, fill: '#e2e0ea', class: 'drop-placeholder' }, viewport);
  }
  const text = findNode(map.root, drag.id).node.text;
  const g = el('g', { class: 'drag-ghost' }, viewport);
  el('rect', { x: drag.x + 8, y: drag.y - 14, width: Math.max(60, text.length * 8 + 20), height: 28, rx: 8, fill: '#fff', stroke: '#2f80ff', 'stroke-width': 2 }, g);
  el('text', { x: drag.x + 18, y: drag.y, 'dominant-baseline': 'central', style: `font: ${fontFor(2)}` }, g).textContent = text;
}

function placeholderBox(t, p, W, H) {
  const box = (x, y) => ({ x, y, w: W, h: H, depth: p.depth + 1, shape: 'box' });
  const parent = findNode(map.root, t.parentId).node;
  const left = map.layout === 'map' && (t.side === 'left' || (!t.side && p.side === 'left'));
  // irmãos visíveis do mesmo lado: encosta acima do que será empurrado ou abaixo do último
  const kids = parent.collapsed ? [] : parent.children
    .filter(c => c.id !== drag.id && (map.layout !== 'map' || parent !== map.root || (c.side === 'left') === left));
  const all = parent.children.filter(c => c.id !== drag.id);
  const next = boxes.find(b => b.id === all[t.index - (all.length < parent.children.length && parent.children.findIndex(c => c.id === drag.id) < t.index ? 1 : 0)]?.id);
  const sameSide = next && kids.some(c => c.id === next.id);
  const last = boxes.find(b => b.id === kids[kids.length - 1]?.id);
  const alignX = (b) => (left ? b.x + b.w - W : b.x);
  if (map.layout === 'org') {
    if (sameSide) return box(next.x - W - 6, next.y);
    if (last) return box(last.x + last.w + 6, last.y);
    return box(p.x + p.w / 2 - W / 2, p.y + p.h + 40);
  }
  if (sameSide) return box(alignX(next), next.y - H - 4);
  if (last) return box(alignX(last), last.y + last.h + 4);
  if (map.layout === 'list') return box(p.x + 32, p.y + p.h + 4);
  return box(left ? p.x - 36 - W : p.x + p.w + 36, p.y + p.h / 2 - H / 2);
}

// ---------- Ligações entre nós ----------
let selectedLink = null;  // id da ligação selecionada
let linking = null;       // {from, x, y, target, byClick} enquanto cria uma ligação

const toWorld = (e) => {
  const r = svg.getBoundingClientRect();
  return [(e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k];
};

function drawLinks() {
  for (const k of map.links ?? []) {
    const a = boxes.find(b => b.id === k.from), b = boxes.find(b => b.id === k.to);
    if (!a || !b) continue;  // ponta escondida num ramo recolhido
    const d = linkPath(a, b, k.bend), sel = k.id === selectedLink;
    el('path', {
      d, class: 'link', fill: 'none', stroke: sel ? '#2f5bea' : '#22a559', 'stroke-width': sel ? 3 : 2,
      'stroke-dasharray': '5 5', 'marker-end': `url(#${sel ? 'arrow-sel' : 'arrow'})`,
    }, viewport);
    const hit = el('path', { d, class: 'link-hit', fill: 'none', stroke: 'transparent', 'stroke-width': 14 }, viewport);
    hit.addEventListener('click', (e) => { e.stopPropagation(); selectedLink = k.id; render(); });
    if (sel) drawBendHandle(k, a, b, d);
  }
  const from = boxes.find(b => b.id === (linking ? linking.from : selected));
  if (linking) {
    svg.classList.add('linking');
    const t = boxes.find(b => b.id === linking.target);
    if (t) el('rect', { class: 'link-target', x: t.x - 5, y: t.y - 5, width: t.w + 10, height: t.h + 10, rx: 10, fill: '#22a55914', stroke: '#22a559', 'stroke-width': 2 }, viewport);
    if (from && linking.x !== undefined) {
      const end = t ?? { x: linking.x, y: linking.y, w: 0, h: 0 };
      el('path', { d: linkPath(from, end), class: 'link-preview', fill: 'none', stroke: '#22a559', 'stroke-width': 2, 'stroke-dasharray': '3 4', 'marker-end': 'url(#arrow)' }, viewport);
    }
    return;
  }
  svg.classList.remove('linking');
  // bolinha no canto do nó selecionado: arrastar dela até outro nó cria a ligação
  if (from && !editing && !drag?.active) {
    const h = el('circle', { class: 'link-handle', cx: from.x + from.w + 4, cy: from.y + from.h + 4, r: 6 }, viewport);
    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      linking = { from: from.id, target: null };
    });
  }
}

$('#link-btn').onclick = () => { linking = { from: selected, target: null, byClick: true }; render(); };

// atualiza ponteiro e nó de destino (caixa sob o ponteiro, exceto a origem)
function trackLink(e) {
  [linking.x, linking.y] = toWorld(e);
  const hit = boxes.find(b => b.id !== linking.from && linking.x >= b.x && linking.x <= b.x + b.w && linking.y >= b.y && linking.y <= b.y + b.h);
  linking.target = hit?.id ?? null;
}

window.addEventListener('pointermove', (e) => {
  if (!linking) return;
  trackLink(e);
  render();
});

window.addEventListener('pointerup', (e) => {
  if (!linking) return;
  trackLink(e);
  const { from, target } = linking;
  linking = null;
  if (target && !(map.links ?? []).some(k => k.from === from && k.to === target)) {
    mutate(() => addLink(map, from, target));
  } else {
    render();
  }
});

// ---------- Menu "⋯" do nó + copiar/colar ----------
let clipboard = null;  // JSON do ramo copiado (vale entre mapas na mesma aba)

const actions = {
  child: () => addAndEdit(() => addChild(map, selected)),
  sibling: () => addAndEdit(() => addSibling(map, selected)),
  collapse: () => {
    const n = findNode(map.root, selected).node;
    if (n.children.length && n !== map.root) mutate(() => { n.collapsed = !n.collapsed; });
  },
  link: () => { linking = { from: selected, target: null, byClick: true }; render(); },
  copy: () => { clipboard = JSON.stringify(findNode(map.root, selected).node); },
  paste: () => {
    if (clipboard) mutate(() => { selected = pasteBranch(map, selected, JSON.parse(clipboard)).id; });
  },
  delete: deleteSelected,
};

$('#more-btn').onclick = () => {
  const n = findNode(map.root, selected).node;
  const item = (a) => nodeMenu.querySelector(`[data-action="${a}"]`);
  item('collapse').disabled = !n.children.length || n === map.root;
  item('delete').disabled = n === map.root;
  item('paste').disabled = !clipboard;
  nodeMenu.hidden = !nodeMenu.hidden;
  stylePop.hidden = true;
  render();
};

nodeMenu.onclick = (e) => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  nodeMenu.hidden = true;
  render();
  actions[b.dataset.action]();
};

// clicar fora dos controles (cabeçalho, lista...) fecha qualquer menu aberto
document.addEventListener('pointerdown', (e) => {
  if (!map || e.target.closest('.card, .adder, .node, .link-hit, .link-handle, #editor')) return;
  if (stylePop.hidden && nodeMenu.hidden) return;
  stylePop.hidden = nodeMenu.hidden = true;
  render();
}, true);

// ---------- Curvar ligações ----------
let bending = null;  // {link, a, b, pushed} enquanto arrasta o ponto de controle

// pontas da seta selecionada + ponto de controle arrastável (duplo clique volta ao automático)
function drawBendHandle(k, a, b, d) {
  const [p1, p2] = [d.match(/^M([-\d.e]+),([-\d.e]+)/), d.match(/([-\d.e]+),([-\d.e]+)$/)];
  for (const m of [p1, p2]) el('circle', { class: 'link-end', cx: m[1], cy: m[2], r: 4, fill: '#fff', stroke: '#2f5bea', 'stroke-width': 2 }, viewport);
  const [hx, hy] = linkHandle(a, b, k.bend);
  const h = el('circle', { class: 'link-bend', cx: hx, cy: hy, r: 6, fill: '#2f5bea', stroke: '#fff', 'stroke-width': 2 }, viewport);
  h.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    bending = { link: k, a, b, pushed: false };
  });
  h.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (k.bend) mutate(() => { delete k.bend; });
  });
}

window.addEventListener('pointermove', (e) => {
  if (!bending) return;
  const [wx, wy] = toWorld(e), { a, b } = bending;
  if (!bending.pushed) { history.push(snapshot()); bending.pushed = true; }
  bending.link.bend = [wx - (a.x + a.w / 2 + b.x + b.w / 2) / 2, wy - (a.y + a.h / 2 + b.y + b.h / 2) / 2];
  render();
});

window.addEventListener('pointerup', () => {
  if (!bending) return;
  if (bending.pushed) scheduleSave();
  bending = null;
  render();
});
