import {
  uid, newMap, findNode, addChild, addSibling, removeNode, commitText,
  History, layout, edgePath, navigate,
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
  conflict = false;
  document.body.dataset.view = 'editor';
  setStatus('Salvo');
  centerView();
  render();
}

function centerView() {
  view.x = svg.clientWidth / 2;
  view.y = svg.clientHeight / 2;
  view.k = 1;
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
  viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  viewport.replaceChildren();
  for (const e of res.edges) {
    el('path', {
      d: edgePath(map.layout, e.from, e.to), fill: 'none', stroke: e.color,
      'stroke-width': Math.max(2, 6 - e.depth), 'stroke-linecap': 'round',
    }, viewport);
  }
  for (const b of boxes) drawNode(b);
  if (editing) placeInput();
}

function drawNode(b) {
  const n = findNode(map.root, b.id).node;
  const g = el('g', { class: 'node', 'data-id': b.id }, viewport);
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
  render();
}

// ---------- Mutações + histórico ----------
const snapshot = () => JSON.stringify({ root: map.root, layout: map.layout });

function mutate(fn) {
  history.push(snapshot());
  fn();
  render();
  scheduleSave();
}

function restore(state) {
  if (state === null) return;
  const s = JSON.parse(state);
  map.root = s.root;
  map.layout = s.layout;
  if (!findNode(map.root, selected)) selected = map.root.id;
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
      // nó novo descartado: volta para onde o usuário estava
      if (!findNode(map.root, id) && findNode(map.root, prev)) selected = prev;
    } else if (commit && text.trim() && text.trim() !== node.text) {
      history.push(snapshot());
      selected = commitText(map, id, text, false);
    }
    scheduleSave();
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
    restore(ev.shiftKey ? history.redo(snapshot()) : history.undo(snapshot()));
  } else if (ctrl && key.toLowerCase() === 'y') {
    ev.preventDefault();
    restore(history.redo(snapshot()));
  } else if (ctrl || ev.altKey) {
    return;
  } else if (key === 'Tab') {
    ev.preventDefault();
    addAndEdit(() => addChild(map, selected));
  } else if (key === 'Enter') {
    ev.preventDefault();
    addAndEdit(() => addSibling(map, selected));
  } else if (key === 'Delete' || key === 'Backspace') {
    ev.preventDefault();
    if (selected === map.root.id) return;
    mutate(() => { selected = removeNode(map, selected); });
  } else if (key === 'F2') {
    ev.preventDefault();
    startEdit(selected, false);
  } else if (key.startsWith('Arrow')) {
    ev.preventDefault();
    select(navigate(boxes, selected, key.slice(5).toLowerCase()));
  } else if (key === ' ') {
    ev.preventDefault();
    const n = findNode(map.root, selected).node;
    if (n.children.length && n !== map.root) mutate(() => { n.collapsed = !n.collapsed; });
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
  if (conflict) return;
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
  if (dirty || saving) ev.preventDefault();
});
window.addEventListener('resize', render);
