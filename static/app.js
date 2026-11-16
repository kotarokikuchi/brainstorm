import {
  PALETTE, uid, newMap, findNode, addChild, addSibling, removeNode, commitText,
  History, layout, edgePath, navigate, moveNode, dropTarget, addLink, removeLink, linkPath, linkHandle, pasteBranch, safeUrl, sideToward, indentNode, outdentNode, branchColor, toMarkdown, slides, cloudPath, branchBounds, MARKERS, markerShape, safeColor, wrapLines,
} from './model.js';
import { folderOf, childFolders, folderPath, removeFolder, placeDoc, subtree, moveFolder, folderOptions } from './folders.js';
import { initBoard, openBoard, closeBoard, currentBoard, newBoard, boardSvg, boardPlace, renameBoard } from './board.js';

const $ = (s) => document.querySelector(s);
const SVG = 'http://www.w3.org/2000/svg';
const svg = $('#canvas'), viewport = $('#viewport'), input = $('#editor'), statusEl = $('#status');

let map = null;          // mapa aberto
let selected = null;     // id do nó selecionado
let editing = null;
let toolbarOn = false;   // barra flutuante visível (só depois de clicar num nó)
let focusId = null;      // modo foco: id do ramo mostrado como centro (null = mapa inteiro)
let outlineOn = false;   // modo outline: lista editável no lugar do mapa      // {id, isNew} enquanto o input está ativo
let boxes = [];          // caixas do último render
let history = new History();
const view = { x: 0, y: 0, k: 1 };  // translação + escala do viewport
const WIDTHS = { thin: 1.5, medium: 3, thick: 5 };
const DASHES = { solid: null, dashed: '8 6', dotted: '1 5' };
// texto escuro em fundos claros (branco, amarelo...), branco nos escuros
const textOn = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#1d1d2b' : '#fff';
};
// estado do autosave
let saveTimer = null, retryTimer = null, dirty = false, saving = null, conflict = false;
let pending = null;  // mapa com alteração pendente (sobrevive a sair do editor)

// ---------- API ----------
const api = (method, path = '', body) => fetch('/api/maps' + path, {
  method,
  headers: body ? { 'Content-Type': 'application/json' } : {},
  body: body && JSON.stringify(body),
});

// ---------- Onde parou: posição, zoom e seleção de cada documento (só neste navegador) ----------
const PLACE = 'galho:place:';
function savePlace() {
  const board = currentBoard(), id = map?.id ?? board?.id;
  const place = map ? { view: { ...view }, selected, focusId, outlineOn } : board ? boardPlace() : null;
  try { if (id) localStorage.setItem(PLACE + id, JSON.stringify(place)); } catch { /* armazenamento bloqueado: só não lembra */ }
}
function loadPlace(id) {
  try {
    const p = JSON.parse(localStorage.getItem(PLACE + id));
    const v = p?.view;
    return v && [v.x, v.y, v.k].every(Number.isFinite) && v.k > 0 ? p : null;
  } catch { return null; }
}
window.addEventListener('pagehide', savePlace);  // recarregar (F5 ou automática) e fechar a aba

// ---------- Rotas ----------
window.addEventListener('hashchange', route);
route();

async function route() {
  savePlace();  // ainda com o documento anterior aberto
  finishEdit(true);  // navegar no meio da digitação confirma o texto
  await flushSave();
  const m = location.hash.match(/^#\/(map|board)\/([a-z0-9-]+)$/);
  // saindo de um documento que não conseguiu salvar: pergunta antes de abandonar as alterações
  if (dirty && pending && pending.id !== m?.[2]) {
    if (!confirm('Este documento tem alterações que não foram salvas (erro ao salvar). Sair mesmo assim e perdê-las?')) {
      const kind = pending.type === 'board' ? 'board' : 'map';
      window.history.replaceState(null, '', `#/${kind}/${pending.id}`);  // volta o endereço sem nova navegação
      return;
    }
    dirty = false;
    pending = null;
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  closeBoard();
  if (m) { await loadTree(); $('.brand').href = folderHref(folderOf(tree, m[2])); }  // voltar cai na pasta do documento
  if (m?.[1] === 'board') { map = null; openBoard(m[2]); } else if (m) openMap(m[2]);
  else showList(location.hash.match(/^#\/folder\/([a-z0-9-]+)$/)?.[1] ?? null);
}

// ---------- Pastas ----------
let tree = { version: 0, folders: [], place: {} }, listFolder = null;
const folderHref = (id) => (id ? `#/folder/${id}` : '#/');
async function loadTree() {
  const r = await fetch('/api/folders');
  if (r.ok) tree = await r.json();
}
// grava as pastas; se outra aba gravou antes (409), reaplica a mudança sobre a versão nova
async function saveTree(change) {
  for (let i = 0; i < 2; i++) {
    const r = await fetch('/api/folders', { method: 'PUT', body: JSON.stringify(change(tree)) });
    if (r.ok) { tree = await r.json(); return true; }
    if (r.status !== 409) break;
    tree = await r.json();
  }
  alert('Não foi possível salvar as pastas.');
  return false;
}

// ---------- Lista de mapas ----------
async function showList(folderId = null) {
  map = null;
  document.body.dataset.view = 'list';
  $('.brand').href = '#/';
  const [items, trash] = await Promise.all([api('GET').then(r => r.json()), fetch('/api/trash').then(r => r.json()), loadTree()]);
  listFolder = tree.folders.some(f => f.id === folderId) ? folderId : null;
  // trilha: Meus mapas › Trabalho › Clientes
  const crumbs = [{ id: null, name: 'Meus mapas' }, ...folderPath(tree, listFolder)];
  $('#list-title').replaceChildren(...crumbs.flatMap((c, i) => {
    const sep = Object.assign(document.createElement('span'), { className: 'crumb-sep', textContent: '›' });
    if (c.id && i === crumbs.length - 1) {  // pasta aberta: clicar no nome edita ali mesmo
      const cur = Object.assign(document.createElement('span'), { className: 'crumb-current', textContent: c.name, title: 'Clique para renomear', tabIndex: 0 });
      const edit = () => inlineEdit(cur, c.name, async (name) => { await renameFolder(c, name); showList(listFolder); });
      cur.onclick = edit;
      cur.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); edit(); } };
      return [sep, cur];
    }
    const a = document.createElement('a');
    a.href = folderHref(c.id);
    a.textContent = c.name;
    a.dataset.drop = c.id ?? '';  // soltar aqui move para essa pasta
    return i ? [sep, a] : [a];
  }));
  const btn = (text, data, value) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.dataset[data] = value;
    return b;
  };
  const subfolders = childFolders(tree, listFolder).map(f => {
    const li = document.createElement('li');
    li.classList.add('folder');
    const a = document.createElement('a');
    a.href = folderHref(f.id);
    a.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-folder"/></svg>';
    a.append(f.name);
    Object.assign(li.dataset, { drag: `folder:${f.id}`, drop: f.id });
    li.draggable = true;
    li.append(a, btn('Mover', 'moveFolder', f.id), btn('Renomear', 'renameFolder', f.id), btn('Apagar', 'deleteFolder', f.id));
    return li;
  });
  const docs = items.filter(it => folderOf(tree, it.id) === listFolder);
  $('#maps').replaceChildren(...subfolders, ...docs.map(it => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    const kind = it.type === 'board' ? 'board' : 'map';
    li.classList.toggle('board', kind === 'board');
    a.href = `#/${kind}/${it.id}`;
    a.innerHTML = `<svg viewBox="0 0 24 24"><use href="#i-${kind === 'board' ? 'brush' : 'sitemap'}"/></svg>`;
    a.append(it.title || '(sem título)');
    const time = document.createElement('time');
    time.textContent = new Date(it.updated).toLocaleString('pt-BR');
    li.dataset.drag = `doc:${it.id}`;
    li.draggable = true;
    li.append(a, time, btn('Mover', 'moveDoc', it.id), btn('Duplicar', 'duplicate', it.id), btn('Apagar', 'delete', it.id));
    return li;
  }));
  $('#empty').hidden = subfolders.length + docs.length > 0;
  $('#empty').textContent = listFolder ? 'Pasta vazia.' : 'Nenhum mapa ainda. Crie o primeiro.';
  $('#trash').hidden = !trash.length || !!listFolder;  // lixeira só no Início
  $('#trash summary').textContent = `Lixeira (${trash.length})`;
  $('#trash-list').replaceChildren(...trash.map(t => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = t.title || '(sem título)';
    const time = document.createElement('time');
    time.textContent = `apagado em ${new Date(t.deleted).toLocaleString('pt-BR')}`;
    li.append(name, time, btn('Restaurar', 'restore', t.id), btn('Apagar de vez', 'purge', t.id));
    return li;
  }));
}

// lista: duplicar / mover para a lixeira (dá para restaurar, então não pergunta)
$('#maps').addEventListener('click', async (e) => {
  const d = e.target.closest('button')?.dataset;
  if (d?.duplicate) {
    const r = await fetch(`/api/maps/${d.duplicate}/duplicate`, { method: 'POST' });
    if (r.ok && listFolder) { const { id } = await r.json(); await saveTree(t => placeDoc(t, id, listFolder)); }  // cópia na mesma pasta
  } else if (d?.delete) await api('DELETE', `/${d.delete}`);
  else if (d?.moveDoc || d?.moveFolder) return openMoveMenu(d.moveDoc ? 'doc' : 'folder', d.moveDoc ?? d.moveFolder, e.target.closest('button'));
  else if (d?.renameFolder) {
    const f = tree.folders.find(x => x.id === d.renameFolder);
    if (!f || !(await renameFolder(f, prompt('Nome da pasta', f.name)))) return;
  } else if (d?.deleteFolder) {
    const f = tree.folders.find(x => x.id === d.deleteFolder);
    if (!f || !confirm(`Apagar a pasta "${f.name}"? O que está dentro dela vai para a pasta de cima.`)) return;
    await saveTree(t => removeFolder(t, f.id));
  } else return;
  showList(listFolder);
});
// mover: menu "Mover para" (lista de pastas em árvore) ou arrastar e soltar sobre pasta/trilha
const moveMenu = $('#move-menu');
async function moveItem(kind, id, to) {
  moveMenu.hidden = true;
  if (kind === 'folder' && to && subtree(tree, id).has(to)) return;  // pasta dentro dela mesma
  if (await saveTree(t => (kind === 'doc' ? placeDoc(t, id, to) : moveFolder(t, id, to) ?? t))) showList(listFolder);
}
function openMoveMenu(kind, id, anchor) {
  const here = kind === 'doc' ? folderOf(tree, id) : tree.folders.find(f => f.id === id)?.parent ?? null;
  const banned = kind === 'folder' ? subtree(tree, id) : new Set();
  const item = (to, name, depth) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.dataset.to = to ?? '';
    b.style.paddingLeft = `${10 + depth * 16}px`;
    b.disabled = to === here || banned.has(to);
    return b;
  };
  const title = Object.assign(document.createElement('p'), { textContent: 'Mover para' });
  moveMenu.replaceChildren(title, item(null, 'Meus mapas', 0), ...folderOptions(tree).map(o => item(o.id, o.name, o.depth + 1)));
  moveMenu.onclick = (e) => { const b = e.target.closest('button[data-to]'); if (b) moveItem(kind, id, b.dataset.to || null); };
  const r = anchor.getBoundingClientRect();
  Object.assign(moveMenu.style, { top: `${r.bottom + 6}px`, left: `${Math.max(8, r.right - 260)}px` });
  moveMenu.hidden = false;
}
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#move-menu, [data-move-doc], [data-move-folder]')) moveMenu.hidden = true;
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') moveMenu.hidden = true; });
window.addEventListener('scroll', () => { moveMenu.hidden = true; });

const listView = $('#list-view');
listView.addEventListener('dragstart', (e) => {
  const src = e.target.closest?.('[data-drag]');
  if (src) e.dataTransfer.setData('text/x-galho', src.dataset.drag);
});
listView.addEventListener('dragover', (e) => {
  const target = e.target.closest?.('[data-drop]');
  if (!target || !e.dataTransfer.types.includes('text/x-galho')) return;
  e.preventDefault();
  target.classList.add('drop-over');
});
listView.addEventListener('dragleave', (e) => e.target.closest?.('[data-drop]')?.classList.remove('drop-over'));
listView.addEventListener('drop', (e) => {
  const target = e.target.closest?.('[data-drop]'), data = e.dataTransfer.getData('text/x-galho');
  if (!target || !data) return;
  e.preventDefault();
  target.classList.remove('drop-over');
  const [kind, id] = data.split(':');
  if (target.dataset.drop !== id) moveItem(kind, id, target.dataset.drop || null);
});

async function renameFolder(f, input) {
  const name = input?.trim().slice(0, 200);
  if (!name || name === f.name) return false;
  return saveTree(t => ({ ...t, folders: t.folders.map(x => (x.id === f.id ? { ...x, name } : x)) }));
}
// texto vira campo ali mesmo: Enter ou clicar fora salva (onSave com o texto aparado), Esc desiste
function inlineEdit(span, value, onSave) {
  const input = Object.assign(document.createElement('input'), { value, className: 'inline-input', maxLength: 200 });
  const fit = () => { input.style.width = `${Math.max(3, input.value.length + 1)}ch`; };
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    input.replaceWith(span);
    const v = input.value.trim();
    if (save && v && v !== value) await onSave(v);
  };
  input.oninput = fit;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  input.onblur = () => finish(true);
  fit();
  span.replaceWith(input);
  input.focus();
  input.select();
}

// nome do documento no topo: clicar edita ali mesmo (no mapa, é o texto do nó central)
const titleEl = $('#title');
const editTitle = () => {
  if (map) inlineEdit(titleEl, map.root.text, (t) => mutate(() => { map.root.text = t; }));
  else if (currentBoard()) inlineEdit(titleEl, currentBoard().title, renameBoard);
};
titleEl.onclick = editTitle;
titleEl.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); editTitle(); } };

$('#new-folder').onclick = async () => {
  const name = prompt('Nome da nova pasta')?.trim();
  if (!name) return;
  const parent = listFolder;
  if (await saveTree(t => ({ ...t, folders: [...t.folders, { id: uid(), name: name.slice(0, 200), parent }] }))) showList(parent);
};
$('#trash-list').addEventListener('click', async (e) => {
  const d = e.target.closest('button')?.dataset;
  if (d?.restore) {
    const r = await fetch(`/api/trash/${d.restore}/restore`, { method: 'POST' });
    if (r.status === 409) alert('Já existe um mapa com esse identificador; não foi possível restaurar.');
  } else if (d?.purge) {
    if (!confirm('Apagar de vez? Isso não pode ser desfeito.')) return;
    await fetch(`/api/trash/${d.purge}`, { method: 'DELETE' });
  } else return;
  showList(listFolder);
});

$('#new-board').onclick = async () => {
  const b = newBoard(uid());
  const r = await api('PUT', `/${b.id}`, b);
  if (r.ok && listFolder) await saveTree(t => placeDoc(t, b.id, listFolder));  // nasce na pasta aberta
  if (r.ok) location.hash = `#/board/${b.id}`;
  else alert('Não foi possível criar o quadro.');
};

$('#new-map').onclick = async () => {
  const m = newMap(uid());
  const r = await api('PUT', `/${m.id}`, m);
  if (r.ok && listFolder) await saveTree(t => placeDoc(t, m.id, listFolder));  // nasce na pasta aberta
  if (r.ok) location.hash = `#/map/${m.id}`;
  else alert('Não foi possível criar o mapa.');
};

// ---------- Editor ----------
async function openMap(id) {
  const r = await api('GET', `/${id}`);
  if (!r.ok) {
    if (r.status === 500) alert('Não foi possível abrir este mapa: o arquivo dele está corrompido.');
    location.hash = '#/';
    return;
  }
  map = await r.json();
  if (map.type === 'board') { map = null; location.hash = `#/board/${id}`; return; }  // endereço antigo de quadro
  history = new History();
  selected = map.root.id;
  toolbarOn = false;
  focusId = null;
  outlineOn = false;
  $('#history-panel').hidden = true;
  if (presenting) stopPresentation();
  document.body.classList.remove('outline-mode');
  $('#outline-view').hidden = true;
  if (conflict) dirty = false;  // edições do mapa em conflito foram abandonadas ao sair dele
  conflict = false;
  document.body.dataset.view = 'editor';
  setStatus('Salvo');
  stylePop.hidden = true;
  const place = loadPlace(id);
  if (place && findNode(map.root, place.selected)) selected = place.selected;
  if (place?.focusId && findNode(map.root, place.focusId)) focusId = place.focusId;
  render();
  if (place) { Object.assign(view, place.view); render(); } else fitView();
  if (place?.outlineOn) setOutline(true);
}

// medida de texto via canvas (mesma fonte do SVG)
const ctx = document.createElement('canvas').getContext('2d');
const FONT = getComputedStyle(document.body).fontFamily;
const BASE_SIZE = [24, 15, 14], SIZE_SCALE = { small: 0.85, large: 1.3 };
const isBold = (n, depth) => n.textBold ?? depth <= 1;  // raiz e 1º nível são negrito por padrão
// fonte do nó: padrão do nível + negrito/itálico/tamanho escolhidos
function fontFor(depth, n = {}) {
  const d = Math.min(depth, 2), weight = isBold(n, depth) ? (depth === 1 ? 600 : 700) : 400;
  const size = Math.round(BASE_SIZE[d] * (SIZE_SCALE[n.textSize] ?? 1));
  return `${n.textItalic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;
}
const PAD = [24, 36, 20], BASE_H = [44, 36, 28], LINE_H = [30, 20, 18];
const lvl = (depth) => Math.min(depth, 2);

// linhas do texto: uma só, ou quebradas para caber na largura fixa do nó (redimensionado)
function linesFor(n, depth, width) {
  const text = n.text;
  ctx.font = fontFor(depth, n);
  return width ? wrapLines(text, width - PAD[lvl(depth)], (t) => ctx.measureText(t).width) : [text];
}

// id de arquivo vindo do mapa só vira URL se tiver o formato gerado pelo servidor
const FILE_ID = /^[a-f0-9]{32}(\.[a-z0-9]{1,10})?$/;
const fileUrl = (id) => `/api/maps/${map.id}/files/${id}`;

// tamanho de exibição da imagem: no máx. 200 px (ou a largura fixa do nó), sem ampliar
function imageSize(image, width) {
  if (!image || !FILE_ID.test(image.id) || !(image.w > 0 && image.h > 0)) return null;
  const s = Math.min(1, ((width ?? 216) - 16) / image.w);
  return { w: Math.round(image.w * s), h: Math.round(image.h * s) };
}

const ICON_W = 26;  // ícones dentro do nó (comentário, link)
const inlineIcons = (n) => (n.comments?.length ? 1 : 0) + (n.url ? 1 : 0);

function measure(n, depth) {
  const { width, image } = n, icons = inlineIcons(n), scale = SIZE_SCALE[n.textSize] ?? 1;
  const lines = linesFor(n, depth, width && width - icons * ICON_W), d = lvl(depth), img = imageSize(image, width);
  const textW = Math.max(30, ...lines.map(l => ctx.measureText(l).width));
  return {
    w: Math.max(width ?? 0, textW + PAD[d] + icons * ICON_W, img ? img.w + 16 : 0),
    h: Math.round(BASE_H[d] * scale) + (lines.length - 1) * Math.round(LINE_H[d] * scale) + (img ? img.h + 8 : 0),
  };
}

const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  parent?.append(e);
  return e;
};

function render() {
  if (!map) return;
  $('#title').textContent = map.root.text;
  if (focusId && !findNode(map.root, focusId)) focusId = null;  // ramo focado foi apagado/desfeito
  const res = layout(map, measure, focusId);
  boxes = res.nodes;
  // seleção nunca fica num nó invisível (recolhido/apagado/fora do foco): sobe ao ancestral visível
  if (selected !== null && !boxes.some(b => b.id === selected)) {
    let id = selected;
    while (id && !boxes.some(b => b.id === id)) id = findNode(map.root, id)?.parent?.id;
    selected = id ?? focusId ?? map.root.id;
  }
  $('#focus-bar').hidden = !focusId;
  if (focusId) $('#focus-title').textContent = findNode(map.root, focusId).node.text;
  viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  viewport.replaceChildren();
  // na lista, arestas longas primeiro: o tronco fica segmentado com a cor de cada ramo
  const edges = map.layout === 'list' ? [...res.edges].reverse() : res.edges;
  // "mostrar como contorno": área tracejada em volta do ramo, atrás de tudo
  for (const b of boxes) {
    if (!findNode(map.root, b.id).node.boundary) continue;
    const r = branchBounds(map, boxes, b.id, 12);
    el('rect', {
      class: 'boundary', x: r.x, y: r.y, width: r.w, height: r.h, rx: 16,
      fill: b.color, 'fill-opacity': 0.08, stroke: b.color, 'stroke-width': 1.5, 'stroke-dasharray': '6 4',
    }, viewport);
  }
  for (const e of edges) {
    // a linha até o pai é estilizada pelo filho; ramo com sub-layout usa o estilo dele (e.kind)
    const n = findNode(map.root, e.to.id).node;
    el('path', {
      class: 'edge', d: edgePath(e.kind ?? map.layout, e.from, e.to), fill: 'none', stroke: n.lineColor || e.color,
      'stroke-width': n.lineWidth ? WIDTHS[n.lineWidth] : Math.max(2, 6 - e.depth),
      'stroke-dasharray': n.lineStyle === 'dashed' ? DASHES.dashed : null, 'stroke-linecap': 'round',
    }, viewport);
  }
  for (const b of boxes) drawNode(b);
  drawLinks();
  if (drag?.active) drawDrop();
  if (editing) placeInput();
  if (outlineOn) renderOutline();
  placeAnchors();
  placeOverlays();
  placeLinkBar();
}

function drawNode(b) {
  const n = findNode(map.root, b.id).node;
  const g = el('g', { class: 'node', 'data-id': b.id }, viewport);
  if (drag?.active && drag.ids.has(b.id)) g.classList.add('dragging');
  // forma efetiva: raiz sem caixa, 1º nível pílula, demais sublinhado
  const shape = b.shape;  // forma efetiva (effectiveShape): estilo em nó sem forma vira caixa
  const boxed = ['pill', 'rect', 'rounded', 'cloud'].includes(shape);
  const solid = boxed && !n.fillNone && !!(n.shape || b.depth === 1 || n.color);
  // borda: explícita, ou automática quando a caixa não tem preenchimento
  const border = n.borderColor || n.borderWidth || n.borderStyle || (boxed && !solid);
  const line = {
    stroke: border ? n.borderColor || b.color : null,
    'stroke-width': border ? WIDTHS[n.borderWidth || 'medium'] : null,
    'stroke-dasharray': DASHES[n.borderStyle || 'solid'],
  };
  const fill = solid ? b.color : 'transparent';
  if (shape === 'cloud') {
    el('path', { class: 'cloud', d: cloudPath(b), fill, ...line }, g);
  } else if (boxed) {
    const rx = { pill: b.h / 2, rect: 2, rounded: 8 }[shape];
    el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx, fill, ...line }, g);
  } else {
    // área clicável invisível
    el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }, g);
  }
  if (shape === 'underline') {
    el('line', {
      x1: b.x, y1: b.y + b.h, x2: b.x + b.w, y2: b.y + b.h, 'stroke-linecap': 'round',
      stroke: n.borderColor || b.color, 'stroke-width': n.borderWidth ? WIDTHS[n.borderWidth] : 2.5,
      'stroke-dasharray': line['stroke-dasharray'],
    }, g);
  }
  const img = imageSize(n.image, n.width);
  if (img) el('image', { href: fileUrl(n.image.id), x: b.x + (b.w - img.w) / 2, y: b.y + 8, width: img.w, height: img.h }, g);
  const top = img ? img.h + 8 : 0, cy = b.y + top + (b.h - top) / 2;  // centro da área do texto
  const icon = inlineIcons(n) * ICON_W, tx = b.x + (b.w - icon) / 2;  // texto centrado no espaço sem os ícones
  if (icon) drawInlineIcons(b, cy, g, n);
  const t = el('text', {
    x: tx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    fill: n.textColor || (solid ? textOn(b.color) : '#1d1d2b'), style: `font: ${fontFor(b.depth, n)}`,
  }, g);
  const lines = editing?.id === b.id ? [''] : linesFor(n, b.depth, n.width && n.width - inlineIcons(n) * ICON_W);
  if (lines.length === 1) t.textContent = lines[0];
  else {
    const lh = Math.round(LINE_H[lvl(b.depth)] * (SIZE_SCALE[n.textSize] ?? 1)), y0 = cy - (lines.length - 1) * lh / 2;
    lines.forEach((line, i) => { el('tspan', { x: tx, y: y0 + i * lh }, t).textContent = line; });
  }
  if (b.id === selected && !selectedLink) {
    el('rect', { class: 'selected-ring', x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, rx: 8 }, g);
  }
  if (n.children.length && b.depth > 0) drawToggle(b, n, g);
  if (n.attachments?.length) drawAttachBadge(b, n);
  g.addEventListener('click', (ev) => { ev.stopPropagation(); select(b.id, true); });
  g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); startEdit(b.id, false); });
}

// bolinha de recolher/expandir na borda externa do nó
function drawToggle(b, n, g) {
  let cx = b.x + b.w + 12, cy = b.y + b.h / 2;
  const lay = b.kind ?? map.layout;
  if (lay === 'map' && b.side === 'left') cx = b.x - 12;
  if (lay === 'org') { cx = b.x + b.w / 2; cy = b.y + b.h + 12; }
  // expandido: círculo vazado pequeno; recolhido: círculo com o número de filhos escondidos
  const tg = el('g', { class: 'toggle' }, g);
  el('circle', { class: 'hit', cx, cy, r: 12 }, tg);  // área de clique
  if (n.collapsed) {
    el('circle', { cx, cy, r: 9, stroke: b.color }, tg);
    el('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: b.color }, tg).textContent = n.children.length;
  } else {
    el('circle', { class: 'open', cx, cy, r: 5, stroke: b.color }, tg);
  }
  tg.addEventListener('click', (ev) => {
    ev.stopPropagation();
    mutate(() => { n.collapsed = !n.collapsed; });
  });
}

// a barra flutuante só aparece quando o nó foi clicado (não ao abrir nem ao navegar pelo teclado)
function select(id, byClick = false) {
  selected = id;
  toolbarOn = byClick;
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
  input.style.font = fontFor(b.depth, findNode(map.root, b.id).node).replace(/\d+px/, (px) => `${parseInt(px) * view.k}px`);
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
      else {
        // nó novo descartado: nada mudou — tira o passo do desfazer e volta para onde estava
        history.past.pop();
        if (findNode(map.root, prev)) selected = prev;
      }
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
  if (presenting) { presentKey(ev); return; }  // na apresentação só as teclas de navegação valem
  if (ev.target.closest?.('input, textarea, select')) return;  // digitando num campo (ex.: comentário)
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
  } else if (ev.altKey && ev.shiftKey && ev.code === 'KeyO') {
    ev.preventDefault();
    setOutline(true);
  } else if (ctrl && key === '.') {
    ev.preventDefault();
    actions.focus();
  } else if (ctrl && (key.toLowerCase() === 'b' || key.toLowerCase() === 'i')) {
    ev.preventDefault();
    toggleText(key.toLowerCase() === 'b' ? 'textBold' : 'textItalic');
  } else if (ctrl && key.toLowerCase() === 'c') {
    actions.copy();
  } else if (ctrl && key.toLowerCase() === 'v') {
    ev.preventDefault();
    actions.paste();
  } else if (ev.altKey && ev.shiftKey && ev.code === 'KeyC') {
    ev.preventDefault();
    toolbarOn = true;
    commentPop.hidden = true;
    openNodePop(commentPop);
  } else if (ctrl || ev.altKey) {
    return;
  } else if (key === 'Tab') {
    ev.preventDefault();
    addAndEdit(() => addChild(map, selected));
  } else if (key === 'Enter') {
    ev.preventDefault();
    actions.sibling();
  } else if (key === 'Escape') {
    // Esc fecha o que estiver aberto; sem nada aberto, sai do modo foco
    const busy = linking || selectedLink || nodePops.some(p => !p.hidden) || [...document.querySelectorAll('.link-pop')].some(p => !p.hidden);
    if (!busy && focusId) setFocus(null);
    linking = null;
    selectedLink = null;
    closeNodePops();
    closeLinkPops();
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
  } else if (key === 'Dead' || key === 'Process') {
    // acento (tecla morta) ou IME: abre a edição vazia sem bloquear; o caractere composto cai no campo
    startEdit(selected, false, '');
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

function scheduleSave(doc = map) {
  // após um 409 não grava mais, mas marca pendência para o aviso ao fechar a aba
  if (conflict) { dirty = true; return; }
  dirty = true;
  pending = doc;
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
const toolbar = $('#toolbar'), stylePop = $('#style-pop'), nodeMenu = $('#node-menu'), imagePop = $('#image-pop'), attachPop = $('#attach-pop'), hints = $('#hints');
const commentPop = $('#comment-pop'), textPop = $('#text-pop'), urlPop = $('#url-pop');
// painéis presos ao nó selecionado: só um aberto por vez
const nodePops = [stylePop, nodeMenu, imagePop, attachPop, commentPop, textPop, urlPop];
function closeNodePops() { for (const p of nodePops) p.hidden = true; }
function openNodePop(pop) {
  const show = pop.hidden;
  closeNodePops();
  pop.hidden = !show;
  render();
  if (pop === commentPop && show) $('#comment-input').focus();
}
const addChildBtn = $('#add-child'), addSiblingBtn = $('#add-sibling');

// ---------- Painel de estilo: abas Forma / Borda / Linha ----------
const EXTRA_COLORS = ['#ffffff', '#c2410c', '#3f4448'];  // branco, terracota, grafite
const customInput = $('#custom-color');
let styleTab = 'shape', customProp = 'color';

const swatch = (c) => {
  const b = document.createElement('button');
  b.dataset.value = c;
  if (c && c !== 'none') b.style.background = c;
  b.title = c === '' ? 'Automática' : c === 'none' ? 'Sem preenchimento' : c;
  return b;
};
for (const row of document.querySelectorAll('#style-pop .swatches[data-extra], #text-pop .swatches[data-extra]')) {
  const extra = row.dataset.extra.split(' ').map(v => (v === 'auto' ? '' : v));
  row.append(...[...extra, ...PALETTE, ...EXTRA_COLORS].map(swatch));
}

// cores fora da paleta já usadas no mapa viram amostras "personalizadas"
function fillCustomRows() {
  const known = new Set([...PALETTE, ...EXTRA_COLORS]), used = new Set();
  const walk = (n) => {
    for (const k of ['color', 'borderColor', 'lineColor']) if (n[k] && !known.has(n[k])) used.add(n[k]);
    n.children.forEach(walk);
  };
  walk(map.root);
  const list = [...used].join();
  for (const row of stylePop.querySelectorAll('.swatches[data-custom]')) {
    if (row.dataset.list === list) continue;
    row.dataset.list = list;
    row.replaceChildren(...[...used].map(swatch));
  }
}

function setStyle(changes) {
  const n = findNode(map.root, selected).node;
  if (Object.entries(changes).every(([k, v]) => (n[k] ?? null) === (v ?? null))) return;
  mutate(() => Object.assign(n, changes));
}

const applyColor = (prop, v) => setStyle(prop === 'color' ? { color: v || null, fillNone: false } : { [prop]: v || null });

stylePop.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
stylePop.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { styleTab = tabBtn.dataset.tab; placeOverlays(); return; }
  const add = e.target.closest('.add-custom');
  if (add) { customProp = add.dataset.prop; customInput.click(); return; }
  const btn = e.target.closest('[data-value]'), group = btn?.parentElement.closest('[data-prop]');
  if (!btn || !group) return;
  const prop = group.dataset.prop, v = btn.dataset.value, n = findNode(map.root, selected).node;
  if (group.classList.contains('swatches')) {
    if (v === 'none') setStyle({ fillNone: true });
    else applyColor(prop, v);
  } else {
    setStyle({ [prop]: n[prop] === v ? null : v });  // clicar na opção ativa volta ao padrão
  }
});
customInput.addEventListener('change', () => applyColor(customProp, customInput.value));
$('#boundary').addEventListener('change', (e) => { e.target.blur(); setStyle({ boundary: e.target.checked || null }); });
$('#style-btn').onclick = () => openNodePop(stylePop);
$('#delete-btn').onclick = deleteSelected;
addChildBtn.onclick = () => addAndEdit(() => addChild(map, selected));
addSiblingBtn.onclick = () => addAndEdit(() => addSibling(map, selected));
$('#undo').onclick = undo;
$('#redo').onclick = redo;

function placeOverlays() {
  const b = drag?.active || linking || selectedLink || outlineOn ? null : boxes.find(b => b.id === selected);
  toolbar.hidden = !b || !toolbarOn;
  if (toolbar.hidden) closeNodePops();
  addChildBtn.hidden = addSiblingBtn.hidden = hints.hidden = !b || !!editing;
  if (!b) return;
  const sx = (x) => view.x + x * view.k, sy = (y) => view.y + y * view.k;
  const n = findNode(map.root, b.id).node;
  const pos = (el, x, y) => { el.style.left = `${x}px`; el.style.top = `${y}px`; };

  pos(toolbar, sx(b.x + b.w / 2), sy(b.y));
  // popovers abaixo do nó, mas sem passar da borda de baixo da tela
  const below = (pop, x) => pos(pop, x, Math.max(8, Math.min(sy(b.y + b.h) + 14, svg.clientHeight - pop.offsetHeight - 8)));
  below(stylePop, sx(b.x + b.w / 2) - 140);
  below(nodeMenu, sx(b.x + b.w / 2) - 125);
  below(imagePop, sx(b.x + b.w / 2) - 140);
  if (!attachPop.hidden) fillAttachList(n);
  below(attachPop, sx(b.x + b.w / 2) - 150);
  if (!commentPop.hidden) fillCommentList(n);
  below(commentPop, sx(b.x + b.w / 2) - 160);
  below(textPop, sx(b.x + b.w / 2) - 140);
  below(urlPop, sx(b.x + b.w / 2) - 170);
  $('#url-btn').classList.toggle('active', !urlPop.hidden);
  $('#url-remove').hidden = !n.url;
  $('#text-btn').classList.toggle('active', !textPop.hidden);
  for (const t of textPop.querySelectorAll('[data-toggle]')) {
    t.classList.toggle('active', t.dataset.toggle === 'textBold' ? isBold(n, b.depth) : !!n[t.dataset.toggle]);
  }
  $('#comment-btn').classList.toggle('active', !commentPop.hidden);
  $('#attach-btn').classList.toggle('active', !attachPop.hidden);
  $('#image-btn').classList.toggle('active', !imagePop.hidden);
  $('#image-remove').hidden = !n.image;
  $('#more-btn').classList.toggle('active', !nodeMenu.hidden);
  $('#style-btn').classList.toggle('active', !stylePop.hidden);
  for (const t of stylePop.querySelectorAll('[data-tab]')) t.classList.toggle('active', t.dataset.tab === styleTab);
  for (const pnl of stylePop.querySelectorAll('[data-panel]')) pnl.hidden = pnl.dataset.panel !== styleTab;
  fillCustomRows();
  for (const group of document.querySelectorAll('#style-pop div[data-prop], #text-pop div[data-prop]')) {
    const prop = group.dataset.prop;
    const cur = prop === 'color' && n.fillNone ? 'none' : (n[prop] ?? '');
    for (const btn of group.querySelectorAll('[data-value]')) btn.classList.toggle('active', btn.dataset.value === cur);
  }
  $('#boundary').checked = !!n.boundary;

  // "+ filho" do lado de fora do nó; afasta da bolinha de recolher quando existe
  const gap = n.children.length && b.depth > 0 ? 40 : 20;
  const lay = b.kind ?? map.layout;
  const left = lay === 'map' && b.side === 'left';
  let child, sibling;
  if (lay === 'org') {
    child = [sx(b.x + b.w / 2), sy(b.y + b.h) + gap];
    sibling = [sx(b.x + b.w) + 20, sy(b.y + b.h / 2)];
  } else {
    child = [left ? sx(b.x) - gap : sx(b.x + b.w) + gap, sy(b.y + b.h / 2)];
    sibling = [sx(b.x + b.w / 2), sy(b.y + b.h) + 18];
  }
  pos(addChildBtn, ...child);
  pos(addSiblingBtn, ...sibling);
  addSiblingBtn.hidden ||= b.depth === 0;
  // com painel/menu aberto, os "+" e as dicas sairiam por cima dele
  if (nodePops.some(p => !p.hidden)) addChildBtn.hidden = addSiblingBtn.hidden = hints.hidden = true;
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
    el('path', { d: edgePath(p.kind ?? map.layout, p, ph), fill: 'none', stroke: '#d4d2de', 'stroke-width': 3, class: 'drop-placeholder' }, viewport);
    el('rect', { ...ph, x: ph.x, y: ph.y, width: W, height: H, rx: 6, fill: '#e2e0ea', class: 'drop-placeholder' }, viewport);
  }
  const text = findNode(map.root, drag.id).node.text;
  const g = el('g', { class: 'drag-ghost' }, viewport);
  el('rect', { x: drag.x + 8, y: drag.y - 14, width: Math.max(60, text.length * 8 + 20), height: 28, rx: 8, fill: '#fff', stroke: '#2f80ff', 'stroke-width': 2 }, g);
  el('text', { x: drag.x + 18, y: drag.y, 'dominant-baseline': 'central', style: `font: ${fontFor(2)}` }, g).textContent = text;
}

function placeholderBox(t, p, W, H) {
  const lay = p.kind ?? map.layout;  // ramo com sub-layout: regras do tipo dele
  const box = (x, y) => ({ x, y, w: W, h: H, depth: p.depth + 1, shape: 'box' });
  const parent = findNode(map.root, t.parentId).node;
  const left = lay === 'map' && (t.side === 'left' || (!t.side && p.side === 'left'));
  // irmãos visíveis do mesmo lado: encosta acima do que será empurrado ou abaixo do último
  const kids = parent.collapsed ? [] : parent.children
    .filter(c => c.id !== drag.id && (lay !== 'map' || parent !== map.root || (c.side === 'left') === left));
  const all = parent.children.filter(c => c.id !== drag.id);
  const next = boxes.find(b => b.id === all[t.index - (all.length < parent.children.length && parent.children.findIndex(c => c.id === drag.id) < t.index ? 1 : 0)]?.id);
  const sameSide = next && kids.some(c => c.id === next.id);
  const last = boxes.find(b => b.id === kids[kids.length - 1]?.id);
  const alignX = (b) => (left ? b.x + b.w - W : b.x);
  if (lay === 'org') {
    if (sameSide) return box(next.x - W - 6, next.y);
    if (last) return box(last.x + last.w + 6, last.y);
    return box(p.x + p.w / 2 - W / 2, p.y + p.h + 40);
  }
  if (sameSide) return box(alignX(next), next.y - H - 4);
  if (last) return box(alignX(last), last.y + last.h + 4);
  if (lay === 'list') return box(p.x + 32, p.y + p.h + 4);
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
    if (retarget?.link === k) { drawRetarget(k, a, b); continue; }
    const d = linkPath(a, b, k.bend, k.fromSide, k.toSide), sel = k.id === selectedLink, color = k.color || LINK_GREEN;
    el('path', {
      d, class: 'link', fill: 'none', stroke: color, 'stroke-width': sel ? 3 : 2, 'stroke-dasharray': '5 5',
      'marker-start': markerUrl(k.startMarker, color), 'marker-end': markerUrl(k.endMarker ?? 'arrow', color),
    }, viewport);
    if (k.label) drawLinkLabel(k, a, b, color);
    const hit = el('path', { d, class: 'link-hit', fill: 'none', stroke: 'transparent', 'stroke-width': 14 }, viewport);
    hit.addEventListener('click', (e) => { e.stopPropagation(); if (selectedLink !== k.id) closeLinkPops(); selectedLink = k.id; render(); });
    if (sel) drawBendHandle(k, a, b, d);
  }
  const from = boxes.find(b => b.id === (linking ? linking.from : selected));
  if (linking) {
    svg.classList.add('linking');
    const t = linking.fromSide && boxes.find(b => b.id === linking.target);
    if (t) {
      el('rect', { class: 'link-target', x: t.x - 5, y: t.y - 5, width: t.w + 10, height: t.h + 10, rx: 10, fill: '#22a55914', stroke: '#22a559', 'stroke-width': 2 }, viewport);
      // 4 pontos possíveis de chegada; o mais perto do ponteiro fica maior
      const near = sideToward(t, [linking.x, linking.y]);
      const pts = { top: [t.x + t.w / 2, t.y], right: [t.x + t.w, t.y + t.h / 2], bottom: [t.x + t.w / 2, t.y + t.h], left: [t.x, t.y + t.h / 2] };
      for (const [side, [cx, cy]] of Object.entries(pts)) el('circle', { class: 'anchor-dot', cx, cy, r: side === near ? 6 : 3.5, fill: '#22a559' }, viewport);
    }
    if (from && linking.fromSide && linking.x !== undefined) {
      const end = t ?? { x: linking.x, y: linking.y, w: 0, h: 0 };
      const toSide = t ? sideToward(t, [linking.x, linking.y]) : null;
      el('path', { d: linkPath(from, end, null, linking.fromSide, toSide), class: 'link-preview', fill: 'none', stroke: '#22a559', 'stroke-width': 2, 'stroke-dasharray': '3 4', 'marker-end': 'url(#arrow)' }, viewport);
    }
    return;
  }
  svg.classList.remove('linking');
  // bolinha no canto de fora do nó selecionado: arrastar muda a largura; duplo clique volta ao automático
  if (from && toolbarOn && !editing && !drag?.active && !selectedLink) {
    const n = findNode(map.root, from.id).node;
    const left = map.layout === 'map' && from.side === 'left';
    const h = el('circle', { class: 'resize-handle', cx: left ? from.x - 4 : from.x + from.w + 4, cy: from.y + from.h + 4, r: 6 }, viewport);
    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      // nó centralizado (raiz, organograma) cresce para os dois lados: dobra o deslocamento
      const factor = from.depth === 0 || map.layout === 'org' ? 2 : 1;
      resizing = { node: n, sx: toWorld(e)[0], w0: from.w, sign: left ? -1 : 1, factor, pushed: false };
    });
    h.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (n.width) mutate(() => { delete n.width; });
    });
  }
}

$('#link-btn').onclick = () => { linking = { from: selected, target: null, byClick: true }; render(); };

// atualiza ponteiro e nó de destino (caixa sob o ponteiro, exceto a origem)
// nó sob o ponteiro: o elemento resolve formas que passam da caixa (nuvem); senão, caixa com folga
function nodeUnder(e, x, y, exclude) {
  const g = e.target.closest?.('.node'), pad = 8;
  const hit = g ? boxes.find(b => b.id === g.dataset.id)
    : boxes.find(b => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad);
  return hit && hit.id !== exclude ? hit.id : null;
}

function trackLink(e) {
  [linking.x, linking.y] = toWorld(e);
  linking.target = nodeUnder(e, linking.x, linking.y, linking.from);
}

window.addEventListener('pointermove', (e) => {
  if (!linking?.fromSide) return;  // só depois de escolher o lado de saída num dos 4 "+"
  trackLink(e);
  render();
});

window.addEventListener('pointerup', (e) => {
  if (!linking) return;
  if (e.target.closest?.('.link-anchor')) return;  // escolheu o lado de saída; espera o destino
  if (!linking.fromSide) {
    // ainda escolhendo o lado: clique no fundo cancela; em nós, ignora
    if (e.target === svg) { linking = null; render(); }
    return;
  }
  trackLink(e);
  const { from, target, fromSide } = linking;
  linking = null;
  if (target && !(map.links ?? []).some(k => k.from === from && k.to === target)) {
    const toSide = fromSide ? sideToward(boxes.find(b => b.id === target), toWorld(e)) : null;
    mutate(() => {
      const k = addLink(map, from, target);
      if (fromSide) Object.assign(k, { fromSide, toSide });
    });
  } else {
    render();
  }
});

// ---------- Pontos de conexão (modo "Ligar") ----------
const anchorBtns = [...document.querySelectorAll('.link-anchor')], linkRing = $('#link-ring');

// no modo ligar, o nó de origem mostra contorno verde e um "+" em cada lado
function placeAnchors() {
  for (const btn of anchorBtns) btn.hidden = true;
  linkRing.hidden = true;
  const b = linking && boxes.find(x => x.id === linking.from);
  if (!b) return;
  const sx = (x) => view.x + x * view.k, sy = (y) => view.y + y * view.k;
  const L = sx(b.x), R = sx(b.x + b.w), T = sy(b.y), B = sy(b.y + b.h);
  const pos = { top: [(L + R) / 2, T - 20], right: [R + 20, (T + B) / 2], bottom: [(L + R) / 2, B + 20], left: [L - 20, (T + B) / 2] };
  for (const btn of anchorBtns) {
    const [x, y] = pos[btn.dataset.side];
    Object.assign(btn.style, { left: `${x}px`, top: `${y}px` });
    btn.classList.toggle('active', btn.dataset.side === linking.fromSide);
    btn.hidden = false;
  }
  Object.assign(linkRing.style, { left: `${L - 5}px`, top: `${T - 5}px`, width: `${R - L + 10}px`, height: `${B - T + 10}px` });
  linkRing.hidden = false;
}

for (const btn of anchorBtns) {
  btn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    linking.fromSide = btn.dataset.side;
    [linking.x, linking.y] = toWorld(e);
    render();
  });
}

// ---------- Menu "⋯" do nó + copiar/colar ----------
let clipboard = null;  // JSON do ramo copiado (vale entre mapas na mesma aba)

const actions = {
  child: () => addAndEdit(() => addChild(map, selected)),
  // no foco, o centro não ganha irmão (ficaria fora da tela): vira filho
  sibling: () => addAndEdit(() => (selected === focusId ? addChild : addSibling)(map, selected)),
  focus: () => setFocus(focusId === selected ? null : selected),
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
  // "mostrar ramo como": só para ramos (não a raiz) e quando o mapa está no layout mapa
  const row = $('#branch-layout-row');
  row.hidden = n === map.root || map.layout !== 'map';
  for (const b of row.querySelectorAll('[data-value]')) b.classList.toggle('active', b.dataset.value === (n.branchLayout ?? ''));
  openNodePop(nodeMenu);
};

nodeMenu.onclick = (e) => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  nodeMenu.hidden = true;
  render();
  actions[b.dataset.action]();
};

// clicar fora dos controles (cabeçalho, lista...) fecha qualquer menu aberto
// (vale também nos quadros; os botões do topo cuidam dos próprios menus)
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.card, .adder, .link-anchor, .node, .link-hit, .resize-handle, #editor, .topbar-toggle')) return;
  const pops = [...nodePops, ...document.querySelectorAll('.link-pop'), ...topPops(), $('#board-help')];
  if (pops.every(p => p.hidden)) return;
  for (const p of pops) p.hidden = true;
  if (map) render();
}, true);

// menus do topo: um aberto por vez; clicar de novo no botão fecha
const topPops = () => [$('#export-menu'), $('#history-panel'), $('#map-menu')];
function toggleTop(pop) {
  const show = pop.hidden;
  for (const p of topPops()) p.hidden = true;
  pop.hidden = !show;
}

// ---------- Curvar ligações ----------
let bending = null;  // {link, a, b, pushed} enquanto arrasta o ponto de controle

// pontas da seta selecionada + ponto de controle arrastável (duplo clique volta ao automático)
function drawBendHandle(k, a, b, d) {
  const [p1, p2] = [d.match(/^M([-\d.e]+),([-\d.e]+)/), d.match(/([-\d.e]+),([-\d.e]+)$/)];
  // pontas arrastáveis: soltar sobre outro nó troca a origem/destino da ligação
  for (const [m, which] of [[p1, 'from'], [p2, 'to']]) {
    const c = el('circle', { class: 'link-end', 'data-which': which, cx: m[1], cy: m[2], r: 6, fill: '#fff', stroke: '#2f5bea', 'stroke-width': 2 }, viewport);
    c.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      retarget = { link: k, which, x: +m[1], y: +m[2], target: null };
    });
  }
  const [hx, hy] = linkHandle(a, b, k.bend, k.fromSide, k.toSide);
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


// ---------- Mover origem/destino de uma ligação ----------
let retarget = null;  // {link, which: 'from'|'to', x, y, target} enquanto arrasta uma ponta

const targetDots = (t, x, y) => {
  el('rect', { class: 'link-target', x: t.x - 5, y: t.y - 5, width: t.w + 10, height: t.h + 10, rx: 10, fill: '#22a55914', stroke: '#22a559', 'stroke-width': 2 }, viewport);
  const near = sideToward(t, [x, y]);
  const pts = { top: [t.x + t.w / 2, t.y], right: [t.x + t.w, t.y + t.h / 2], bottom: [t.x + t.w / 2, t.y + t.h], left: [t.x, t.y + t.h / 2] };
  for (const [side, [cx, cy]] of Object.entries(pts)) el('circle', { class: 'anchor-dot', cx, cy, r: side === near ? 6 : 3.5, fill: '#22a559' }, viewport);
};

function drawRetarget(k, a, b) {
  const { which, x, y } = retarget;
  const t = boxes.find(bx => bx.id === retarget.target);
  if (t) targetDots(t, x, y);
  const loose = t ?? { x, y, w: 0, h: 0 }, side = t ? sideToward(t, [x, y]) : null;
  const d = which === 'to' ? linkPath(a, loose, null, k.fromSide, side) : linkPath(loose, b, null, side, k.toSide);
  el('path', { d, class: 'link-preview', fill: 'none', stroke: '#22a559', 'stroke-width': 2, 'stroke-dasharray': '3 4', 'marker-end': 'url(#arrow)' }, viewport);
}

window.addEventListener('pointermove', (e) => {
  if (!retarget) return;
  [retarget.x, retarget.y] = toWorld(e);
  const other = retarget.which === 'to' ? retarget.link.from : retarget.link.to;
  retarget.target = nodeUnder(e, retarget.x, retarget.y, other);
  render();
});

window.addEventListener('pointerup', (e) => {
  if (!retarget) return;
  const { link: k, which, target } = retarget;
  retarget = null;
  const [x, y] = toWorld(e);
  const from = which === 'from' ? target : k.from, to = which === 'to' ? target : k.to;
  const dup = (map.links ?? []).some(o => o !== k && o.from === from && o.to === to);
  if (target && !dup) {
    const side = sideToward(boxes.find(b => b.id === target), [x, y]);
    mutate(() => Object.assign(k, which === 'to' ? { to: target, toSide: side } : { from: target, fromSide: side }));
  } else {
    render();
  }
});

// ---------- Barra da ligação: cor, pontas, inverter, rótulo, excluir ----------
const LINK_GREEN = '#22a559';
// <marker> por (tipo, cor), criado sob demanda; auto-start-reverse serve para as duas pontas
function markerUrl(type, color) {
  const shape = markerShape(type, color);  // valida tipo e cor (vêm do arquivo do mapa)
  if (!shape) return null;
  const id = `m-${type}-${safeColor(color).slice(1)}`;
  if (!document.getElementById(id)) {
    const m = el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    m.innerHTML = shape;
    svg.querySelector('defs').append(m);
  }
  return `url(#${id})`;
}

const markerIcon = (type, flip) => {
  const shape = markerShape(type, 'currentColor');
  return `<svg viewBox="0 0 24 12" style="width:24px;height:12px${flip ? ';transform:scaleX(-1)' : ''}">`
    + `<line x1="2" y1="6" x2="${shape ? 15 : 22}" y2="6" stroke="currentColor" stroke-width="2"/>`
    + (shape ? `<g transform="translate(13,1)">${shape}</g>` : '') + '</svg>';
};

// rótulo um pouco acima do ponto de controle, com halo da cor do fundo
function drawLinkLabel(k, a, b, color) {
  const [x, y] = linkHandle(a, b, k.bend, k.fromSide, k.toSide);
  const t = el('text', {
    class: 'link-label', x, y: y - 16, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: color,
    stroke: '#f6f5fb', 'stroke-width': 4, 'paint-order': 'stroke', style: `font: 600 13px ${FONT}`,
  }, viewport);
  t.textContent = k.label;
  t.addEventListener('click', (e) => { e.stopPropagation(); selectedLink = k.id; render(); });
  t.addEventListener('dblclick', (e) => { e.stopPropagation(); selectedLink = k.id; editLinkLabel(); });
}

const linkBar = $('#link-toolbar'), linkColors = $('#link-colors'), linkMarkers = $('#link-markers'), linkMenu = $('#link-menu');
let markerEnd = 'end';  // qual ponta o seletor de marcadores está editando
const currentLink = () => (map?.links ?? []).find(k => k.id === selectedLink);
const closeLinkPops = () => { linkColors.hidden = linkMarkers.hidden = linkMenu.hidden = true; };

function setLink(changes) {
  const k = currentLink();
  if (k) mutate(() => Object.assign(k, changes));
}

function placeLinkBar() {
  const k = !bending && !retarget && !outlineOn && currentLink();
  const a = k && boxes.find(b => b.id === k.from), b = k && boxes.find(b => b.id === k.to);
  linkBar.hidden = !(a && b);
  if (linkBar.hidden) return closeLinkPops();
  const [hx, hy] = linkHandle(a, b, k.bend, k.fromSide, k.toSide);
  const x = view.x + hx * view.k, y = view.y + hy * view.k + 22;
  Object.assign(linkBar.style, { left: `${x}px`, top: `${y}px` });
  for (const p of document.querySelectorAll('.link-pop')) Object.assign(p.style, { left: `${x}px`, top: `${y + 56}px` });
  const color = k.color || LINK_GREEN;
  linkBar.querySelector('.dot').style.background = color;
  $('#link-start-btn').innerHTML = markerIcon(k.startMarker ?? 'none', true);
  $('#link-end-btn').innerHTML = markerIcon(k.endMarker ?? 'arrow', false);
  for (const s of linkColors.querySelectorAll('[data-value]')) s.classList.toggle('active', s.dataset.value === (k.color ?? ''));
}

function editLinkLabel() {
  const k = currentLink();
  if (!k) return;
  const t = prompt('Rótulo da ligação', k.label ?? '');
  if (t !== null && (t.trim() || null) !== (k.label ?? null)) setLink({ label: t.trim() || null });
}

linkColors.querySelector('.swatches').append(...['', ...PALETTE, ...EXTRA_COLORS].map(swatch));
for (const p of [linkBar, ...document.querySelectorAll('.link-pop')]) {
  p.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
}
const togglePop = (pop) => { const open = pop.hidden; closeLinkPops(); pop.hidden = !open; };

$('#link-color-btn').onclick = () => togglePop(linkColors);
$('#link-more').onclick = () => togglePop(linkMenu);
for (const [btn, end] of [['#link-start-btn', 'start'], ['#link-end-btn', 'end']]) {
  $(btn).onclick = () => {
    markerEnd = end;
    const k = currentLink(), cur = end === 'start' ? k.startMarker ?? 'none' : k.endMarker ?? 'arrow';
    linkMarkers.replaceChildren(...MARKERS.map(t => {
      const b = document.createElement('button');
      b.dataset.value = t;
      b.title = t;
      b.innerHTML = markerIcon(t, end === 'start');
      b.classList.toggle('active', t === cur);
      return b;
    }));
    togglePop(linkMarkers);
  };
}
$('#link-swap').onclick = () => {
  const k = currentLink();
  setLink({ startMarker: k.endMarker ?? 'arrow', endMarker: k.startMarker ?? 'none' });
};
linkColors.onclick = (e) => {
  const v = e.target.closest('[data-value]')?.dataset.value;
  if (v !== undefined) { linkColors.hidden = true; setLink({ color: v || null }); }
};
linkMarkers.onclick = (e) => {
  const v = e.target.closest('[data-value]')?.dataset.value;
  if (v) { linkMarkers.hidden = true; setLink({ [markerEnd === 'start' ? 'startMarker' : 'endMarker']: v }); }
};
linkMenu.onclick = (e) => {
  const a = e.target.closest('[data-action]')?.dataset.action;
  closeLinkPops();
  if (a === 'label') editLinkLabel();
  if (a === 'delete') deleteSelected();
};

// ---------- Redimensionar nó ----------
let resizing = null;  // {node, sx, w0, sign, factor, pushed} enquanto arrasta a bolinha

window.addEventListener('pointermove', (e) => {
  if (!resizing) return;
  const r = resizing, dx = toWorld(e)[0] - r.sx;
  if (!r.pushed) { history.push(snapshot()); r.pushed = true; }
  r.node.width = Math.max(60, Math.round(r.w0 + dx * r.sign * r.factor));
  render();
});

window.addEventListener('pointerup', () => {
  if (!resizing) return;
  if (resizing.pushed) scheduleSave();
  resizing = null;
  render();
});

// ---------- Arquivos: envio ao servidor ----------
async function uploadFile(file) {
  const r = await fetch(`/api/maps/${map.id}/files`, {
    method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name) }, body: file,
  });
  if (!r.ok) throw new Error(r.status === 413 ? 'arquivo maior que 20 MB' : `HTTP ${r.status}`);
  return r.json();
}

// ---------- Imagem no nó ----------
const naturalSize = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => { resolve({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(url); };
  im.onerror = () => { reject(new Error('imagem inválida')); URL.revokeObjectURL(url); };
  im.src = url;
});

async function addImage(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { alert('Use uma imagem PNG, JPG, GIF ou WEBP.'); return; }
  const id = selected;
  try {
    const [size, info] = await Promise.all([naturalSize(file), uploadFile(file)]);
    imagePop.hidden = true;
    const n = findNode(map.root, id)?.node;
    if (n) mutate(() => { n.image = { id: info.id, ...size }; });
  } catch (e) {
    alert(`Não foi possível adicionar a imagem: ${e.message}`);
  }
}

$('#image-btn').onclick = () => openNodePop(imagePop);
$('#image-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; addImage(f); });
const drop = $('#image-drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addImage(e.dataTransfer.files[0]); });
$('#image-remove').onclick = () => {
  const n = findNode(map.root, selected).node;
  imagePop.hidden = true;
  mutate(() => { delete n.image; });
};

// ---------- Anexos ----------
// selo no canto do nó: clipe + quantidade; clicar abre a lista
function drawAttachBadge(b, n) {
  const x = b.x + b.w - 14, y = b.y - 6;
  const g = el('g', { class: 'attach-badge', 'data-id': b.id }, viewport);
  el('rect', { x: x - 18, y: y - 9, width: 36, height: 18, rx: 9, fill: '#fff', stroke: b.color, 'stroke-width': 1.5 }, g);
  el('use', { href: '#i-paperclip', x: x - 15, y: y - 7, width: 14, height: 14, fill: 'none', stroke: b.color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  el('text', { x: x + 7, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: b.color }, g).textContent = n.attachments.length;
  g.addEventListener('click', (e) => {
    e.stopPropagation();
    select(b.id, true);
    closeNodePops();
    openNodePop(attachPop);
  });
}

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function fillAttachList(n) {
  const items = (n.attachments ?? []).map((a, i) => {
    const li = document.createElement('li');
    if (FILE_ID.test(a.id)) {
      const link = document.createElement('a');
      link.href = fileUrl(a.id);
      link.download = a.name;
      link.textContent = a.name;
      li.append(link);
    }
    const size = document.createElement('small');
    size.textContent = fmtSize(a.size ?? 0);
    const rm = document.createElement('button');
    rm.dataset.remove = i;
    rm.title = 'Remover anexo';
    rm.textContent = '×';
    li.append(size, rm);
    return li;
  });
  $('#attach-list').replaceChildren(...items);
}

async function addAttachments(files) {
  const id = selected, added = [];
  try {
    for (const f of files) {
      const info = await uploadFile(f);
      added.push({ id: info.id, name: info.name, size: info.size });
    }
  } catch (e) {
    alert(`Não foi possível enviar o arquivo: ${e.message}`);
  }
  const n = findNode(map.root, id)?.node;
  if (n && added.length) mutate(() => { n.attachments = [...(n.attachments ?? []), ...added]; });
}

$('#attach-btn').onclick = () => openNodePop(attachPop);
$('#attach-input').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addAttachments(fs); });
const attachDrop = $('#attach-drop');
attachDrop.addEventListener('dragover', (e) => { e.preventDefault(); attachDrop.classList.add('over'); });
attachDrop.addEventListener('dragleave', () => attachDrop.classList.remove('over'));
attachDrop.addEventListener('drop', (e) => { e.preventDefault(); attachDrop.classList.remove('over'); addAttachments([...e.dataTransfer.files]); });
$('#attach-list').addEventListener('click', (e) => {
  const i = e.target.closest('[data-remove]')?.dataset.remove;
  if (i === undefined) return;
  const n = findNode(map.root, selected).node;
  mutate(() => { n.attachments = n.attachments.filter((_, k) => k !== +i); if (!n.attachments.length) delete n.attachments; });
});

// ---------- Recarga automática ----------
// o servidor avisa (SSE) quando static/ muda ou quando ele reinicia; a página recarrega
// só num momento seguro: sem edição/arrasto em andamento e com tudo salvo
let liveStamp = null, reloadWanted = false;
new EventSource('/api/events').onmessage = (e) => {
  if (liveStamp === null) liveStamp = e.data;
  else if (e.data !== liveStamp) reloadWanted = true;
};

setInterval(async () => {
  if (!reloadWanted || editing || drag?.active || linking || bending || retarget || resizing) return;
  await flushSave();
  if (!dirty && !saving) location.reload();  // com conflito/erro de gravação não recarrega (não perde edições)
}, 1000);

// ---------- Comentários ----------
// ícones dentro do nó, da direita para a esquerda: comentários, link
function drawInlineIcons(b, cy, g, n) {
  let x = b.x + b.w - 4;
  const icon = (cls, symbol, onClick) => {
    x -= ICON_W;
    const ic = el('g', { class: cls }, g);
    el('circle', { cx: x + 12, cy, r: 11, fill: '#ffffffcc' }, ic);
    el('use', { href: symbol, x: x + 4, y: cy - 8, width: 16, height: 16, fill: 'none', stroke: '#1d1d2b', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, ic);
    ic.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  };
  if (n.comments?.length) icon('comment-icon', '#i-message', () => { select(b.id, true); closeNodePops(); openNodePop(commentPop); });
  if (n.url) {
    // revalida ao abrir: o mapa vem de arquivo e pode ter sido editado à mão
    icon('url-icon', '#i-link', () => { const u = safeUrl(n.url); if (u) window.open(u, '_blank', 'noopener,noreferrer'); });
  }
}

function fillCommentList(n) {
  const items = (n.comments ?? []).map((c, i) => {
    const li = document.createElement('li');
    li.textContent = c.text;
    const time = document.createElement('time');
    time.textContent = new Date(c.at).toLocaleString('pt-BR');
    const del = document.createElement('button');
    del.dataset.del = i;
    del.title = 'Apagar comentário';
    del.textContent = '×';
    li.append(time, del);
    return li;
  });
  $('#comment-list').replaceChildren(...items);
}

$('#comment-btn').onclick = () => openNodePop(commentPop);
$('#comment-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#comment-input'), text = input.value.trim();
  if (!text) return;
  const n = findNode(map.root, selected).node;
  input.value = '';
  mutate(() => { n.comments = [...(n.comments ?? []), { id: uid(), text, at: new Date().toISOString() }]; });
  input.focus();
});
// Enter envia (o atalho do mapa não roda dentro do campo); Esc fecha o painel
$('#comment-input').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); $('#comment-form').requestSubmit(); }
  if (e.key === 'Escape') { e.target.blur(); commentPop.hidden = true; render(); }
});
$('#comment-list').addEventListener('click', (e) => {
  const i = e.target.closest('[data-del]')?.dataset.del;
  if (i === undefined) return;
  const n = findNode(map.root, selected).node;
  mutate(() => { n.comments = n.comments.filter((_, k) => k !== +i); if (!n.comments.length) delete n.comments; });
});

// ---------- Estilo do texto ----------
// alterna negrito/itálico; voltar ao padrão do nível grava null
function toggleText(prop) {
  const hit = findNode(map.root, selected);
  const cur = prop === 'textBold' ? isBold(hit.node, hit.depth) : !!hit.node.textItalic;
  const def = prop === 'textBold' ? hit.depth <= 1 : false;
  setStyle({ [prop]: !cur === def ? null : !cur });
}

$('#text-btn').onclick = () => openNodePop(textPop);
textPop.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
textPop.addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle]');
  if (t) return toggleText(t.dataset.toggle);
  const btn = e.target.closest('[data-value]'), group = btn?.parentElement.closest('[data-prop]');
  if (btn && group) setStyle({ [group.dataset.prop]: btn.dataset.value || null });
});

// ---------- Link (URL) no nó ----------
$('#url-btn').onclick = () => {
  $('#url-input').value = findNode(map.root, selected).node.url ?? '';
  $('#url-error').hidden = true;
  openNodePop(urlPop);
  if (!urlPop.hidden) $('#url-input').focus();
};
$('#url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = safeUrl($('#url-input').value);
  $('#url-error').hidden = !!url;
  if (!url) return;
  urlPop.hidden = true;
  setStyle({ url });
});
$('#url-input').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); $('#url-form').requestSubmit(); }
  if (e.key === 'Escape') { e.target.blur(); urlPop.hidden = true; render(); }
});
$('#url-remove').onclick = () => {
  const n = findNode(map.root, selected).node;
  urlPop.hidden = true;
  mutate(() => { delete n.url; });
};

// ---------- Modo foco ----------
function setFocus(id) {
  focusId = id && id !== map.root.id ? id : null;
  selected = id ?? selected;
  closeNodePops();
  render();
  fitView();
}
$('#focus-exit').onclick = () => setFocus(null);

// ---------- Modo outline ----------
const outlineList = $('#outline-view .outline');
const rowInput = (id) => $(`#outline-view li[data-id="${CSS.escape(id)}"] > .row input`);
const allInputs = () => [...outlineList.querySelectorAll('input')];

function setOutline(on) {
  outlineOn = on;
  document.body.classList.toggle('outline-mode', on);
  $('#outline-view').hidden = !on;
  $('#outline-btn').classList.toggle('active', on);
  closeNodePops();
  selectedLink = null;
  render();
  if (on) focusRow(selected ?? map.root.id);
  else fitView();
}

function focusRow(id, pos) {
  const i = rowInput(id);
  if (!i) return;
  i.focus();
  const p = pos ?? i.value.length;
  i.setSelectionRange(p, p);
  selected = id;
}

// remonta a lista a partir do mapa, devolvendo o foco/cursor à linha em edição
function renderOutline() {
  const act = document.activeElement;
  const keep = act?.closest?.('#outline-view') ? { id: act.dataset.id, pos: act.selectionStart } : null;
  const build = (n) => {
    const li = document.createElement('li');
    li.dataset.id = n.id;
    const row = document.createElement('div');
    row.className = 'row';
    const bullet = document.createElement('button');
    bullet.className = 'bullet';
    bullet.dataset.toggle = n.id;
    bullet.style.color = branchColor(map.root, n.id);
    bullet.textContent = n.children.length ? (n.collapsed ? '▸' : '▾') : '•';
    bullet.title = n.children.length ? 'Recolher / expandir' : '';
    const input = document.createElement('input');
    input.value = n.text;
    input.dataset.id = n.id;
    row.append(bullet, input);
    li.append(row);
    if (n.children.length && !n.collapsed) {
      const ul = document.createElement('ul');
      ul.append(...n.children.map(build));
      li.append(ul);
    }
    return li;
  };
  outlineList.replaceChildren(build(map.root));
  if (keep) focusRow(keep.id, keep.pos);
}

// grava o texto da linha; vazio volta ao texto anterior
function commitRow(input) {
  const n = findNode(map.root, input.dataset.id)?.node, text = input.value.trim();
  if (!n) return;
  if (!text) { input.value = n.text; return; }
  if (text !== n.text) mutate(() => { n.text = text; });
}

// muda o mapa só se fn() devolver true (não deixa passo vazio no desfazer)
function tryMutate(fn) {
  history.push(snapshot());
  if (fn()) { render(); scheduleSave(); return true; }
  history.past.pop();
  return false;
}

outlineList.addEventListener('keydown', (e) => {
  const input = e.target.closest('input');
  if (!input) return;
  e.stopPropagation();
  const id = input.dataset.id, inputs = allInputs(), idx = inputs.indexOf(input);
  if (e.key === 'Escape') { e.preventDefault(); commitRow(input); setOutline(false); return; }
  if (e.altKey && e.shiftKey && e.code === 'KeyO') { e.preventDefault(); commitRow(input); setOutline(false); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    commitRow(input);
    let created;
    // nó novo começa vazio no outline (o mapa mostra vazio até ser digitado)
    tryMutate(() => (created = id === map.root.id ? addChild(map, id) : addSibling(map, id)));
    focusRow(created.id);
  } else if (e.key === 'Tab') {
    e.preventDefault();
    commitRow(input);
    tryMutate(() => (e.shiftKey ? outdentNode : indentNode)(map, id));
    focusRow(id);
  } else if (e.key === 'Backspace' && input.value === '' && id !== map.root.id) {
    e.preventDefault();
    const prev = inputs[idx - 1]?.dataset.id;
    tryMutate(() => removeNode(map, id) !== null);
    if (prev) focusRow(prev);
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const next = inputs[idx + (e.key === 'ArrowUp' ? -1 : 1)];
    commitRow(input);
    if (next) focusRow(next.dataset.id);
  }
});
outlineList.addEventListener('focusout', (e) => {
  const input = e.target.closest('input');
  if (input?.isConnected && document.activeElement !== input) commitRow(input);
});
outlineList.addEventListener('click', (e) => {
  const id = e.target.closest('[data-toggle]')?.dataset.toggle;
  const n = id && findNode(map.root, id)?.node;
  if (n?.children.length) mutate(() => { n.collapsed = !n.collapsed; });
});
$('#outline-btn').onclick = () => setOutline(!outlineOn);

// ---------- Exportar: PNG, PDF (impressão) e Markdown ----------
const exportMenu = $('#export-menu');
const fileBase = () => ((map ? map.root.text : currentBoard().title).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'mapa').slice(0, 60);

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const toDataUrl = async (url) => {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
};

// SVG do mapa como arquivo solto: sem elementos de seleção, com CSS, ícones e imagens embutidos
async function standaloneSvg() {
  const bb = viewport.getBBox(), pad = 40;
  const clone = svg.cloneNode(true);
  clone.removeAttribute('id');
  clone.querySelector('#viewport').removeAttribute('transform');
  const uiOnly = '.selected-ring, .resize-handle, .link-bend, .link-end, .link-hit, .anchor-dot, .link-preview, .link-target, .drop-placeholder, .drag-ghost';
  for (const e of clone.querySelectorAll(uiOnly)) e.remove();
  const defs = clone.querySelector('defs');
  for (const id of new Set([...clone.querySelectorAll('use')].map(u => u.getAttribute('href')))) {
    const sym = document.querySelector(id);
    if (sym) defs.append(sym.cloneNode(true));
  }
  const style = document.createElementNS(SVG, 'style');
  style.textContent = `.toggle circle{fill:#fff;stroke-width:1.5}.toggle .hit{fill:transparent;stroke:none}.toggle .open{stroke-width:2.5}`
    + `.toggle text{font:700 10px ${FONT}}.attach-badge text{font:700 11px ${FONT}}`;
  defs.append(style);
  for (const im of clone.querySelectorAll('image')) im.setAttribute('href', await toDataUrl(im.getAttribute('href')));
  const w = bb.width + 2 * pad, h = bb.height + 2 * pad;
  clone.setAttribute('xmlns', SVG);
  clone.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${w} ${h}`);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  return { xml: new XMLSerializer().serializeToString(clone), w, h };
}

async function exportPng() {
  const board = currentBoard();
  const { xml, w, h } = board ? await boardSvg() : await standaloneSvg(), scale = 2;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const g = c.getContext('2d');
  g.fillStyle = board ? '#ffffff' : '#f6f5fb';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  download(await new Promise((r) => c.toBlob(r, 'image/png')), `${fileBase()}.png`);
}

const EXPORTS = {
  png: exportPng,
  svg: async () => {
    const { xml } = currentBoard() ? await boardSvg() : await standaloneSvg();
    download(new Blob([xml], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
  },
  md: () => download(new Blob([toMarkdown(map)], { type: 'text/markdown' }), `${fileBase()}.md`),
  pdf: () => {
    if (outlineOn) setOutline(false);
    closeNodePops();
    selectedLink = null;
    fitView();
    window.print();  // o navegador oferece "Salvar como PDF"
  },
};

$('#export-btn').onclick = () => toggleTop(exportMenu);
exportMenu.addEventListener('mousedown', (e) => e.preventDefault());
exportMenu.addEventListener('click', async (e) => {
  const kind = e.target.closest('[data-export]')?.dataset.export;
  if (!kind) return;
  exportMenu.hidden = true;
  try { await EXPORTS[kind](); } catch (err) { alert(`Não foi possível exportar: ${err.message}`); }
});

// ---------- Histórico de versões ----------
const historyPanel = $('#history-panel');

async function loadHistory() {
  const items = await (await api('GET', `/${map.id}/history`)).json();
  const rows = items.map((v) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const when = document.createElement('strong');
    when.textContent = new Date(v.saved).toLocaleString('pt-BR');
    const what = document.createElement('small');
    what.textContent = `${v.title} · ${v.nodes} tópico${v.nodes === 1 ? '' : 's'}`;
    info.append(when, what);
    const btn = document.createElement('button');
    btn.dataset.restore = v.version;
    btn.textContent = 'Restaurar';
    li.append(info, btn);
    return li;
  });
  if (!rows.length) {
    const li = document.createElement('li');
    li.textContent = 'Nenhuma versão anterior ainda.';
    rows.push(li);
  }
  $('#history-list').replaceChildren(...rows);
}

$('#history-btn').onclick = async () => {
  if (!historyPanel.hidden) { historyPanel.hidden = true; return; }
  for (const p of topPops()) p.hidden = true;
  await loadHistory();
  historyPanel.hidden = false;
};
$('#history-close').onclick = () => { historyPanel.hidden = true; };
$('#history-list').addEventListener('click', async (e) => {
  const v = e.target.closest('[data-restore]')?.dataset.restore;
  if (!v || !confirm('Restaurar esta versão? (Ctrl+Z desfaz)')) return;
  const r = await api('GET', `/${map.id}/history/${v}`);
  if (!r.ok) { alert('Não foi possível carregar esta versão.'); return; }
  const old = await r.json();
  historyPanel.hidden = true;
  // restaurar é uma mudança como outra qualquer: entra no desfazer e é salva por cima da atual
  mutate(() => { map.root = old.root; map.layout = old.layout ?? 'map'; map.links = old.links ?? []; });
});

// ---------- Menu do mapa (título): duplicar / mover para a lixeira ----------
const mapMenu = $('#map-menu');
$('#map-menu-btn').onclick = () => toggleTop(mapMenu);
mapMenu.addEventListener('mousedown', (e) => e.preventDefault());
mapMenu.addEventListener('click', async (e) => {
  const action = e.target.closest('[data-map-action]')?.dataset.mapAction;
  if (!action) return;
  mapMenu.hidden = true;
  const doc = map ?? currentBoard(), id = doc.id, kind = doc.type === 'board' ? 'board' : 'map';
  await flushSave();
  if (action === 'duplicate') {
    const r = await fetch(`/api/maps/${id}/duplicate`, { method: 'POST' });
    if (r.ok) location.hash = `#/${kind}/${(await r.json()).id}`;
    else alert('Não foi possível duplicar o mapa.');
  } else if (action === 'trash') {
    dirty = false;  // o mapa vai inteiro para a lixeira; nada pendente a perguntar
    pending = null;
    await api('DELETE', `/${id}`);
    location.hash = '#/';
  }
});

// ---------- Apresentação ----------
let presenting = null;  // {list, i}

function showSlide(i) {
  presenting.i = Math.max(0, Math.min(i, presenting.list.length - 1));
  focusId = presenting.list[presenting.i];
  selected = null;
  selectedLink = null;
  closeNodePops();
  render();
  fitView(2);
  $('#present-count').textContent = `${presenting.i + 1} / ${presenting.list.length}`;
}

function startPresentation() {
  if (outlineOn) setOutline(false);
  presenting = { list: slides(map), i: 0 };
  document.body.classList.add('presenting');
  $('#present-bar').hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});  // sem tela cheia, segue na janela
  setTimeout(() => showSlide(0), 50);  // espera o layout sem o topo para ajustar o zoom
}

function stopPresentation() {
  presenting = null;
  focusId = null;
  document.body.classList.remove('presenting');
  $('#present-bar').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  selected = map?.root.id ?? null;
  if (map) { render(); fitView(); }
}

function presentKey(ev) {
  const k = ev.key;
  if (k === 'ArrowRight' || k === ' ' || k === 'PageDown') { ev.preventDefault(); showSlide(presenting.i + 1); }
  else if (k === 'ArrowLeft' || k === 'PageUp') { ev.preventDefault(); showSlide(presenting.i - 1); }
  else if (k === 'Escape') { ev.preventDefault(); stopPresentation(); }
}

$('#present-btn').onclick = startPresentation;
$('#present-prev').onclick = () => showSlide(presenting.i - 1);
$('#present-next').onclick = () => showSlide(presenting.i + 1);
$('#present-exit').onclick = stopPresentation;
// saiu da tela cheia pelo navegador (Esc do próprio navegador): encerra a apresentação também
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && presenting) stopPresentation(); });

// ---------- Mostrar este ramo como (menu ⋯) ----------
$('#branch-layout-row').addEventListener('click', (e) => {
  const v = e.target.closest('[data-value]')?.dataset.value;
  if (v === undefined) return;
  nodeMenu.hidden = true;
  setStyle({ branchLayout: v || null });
});

// ---------- Quadros (lousa) ----------
initBoard({
  api,
  setStatus,
  scheduleSave,
  resetSave: () => { if (conflict) dirty = false; conflict = false; },
  loadPlace,
});
