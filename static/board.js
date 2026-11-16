// Quadro de desenho (lousa estilo Excalidraw): documento {type: "board", title, elements}.
// O app.js cuida de rotas e do salvamento automático; este módulo cuida da lousa.

const $ = (s) => document.querySelector(s);
let deps = null;   // {api, scheduleSave, setStatus, resetSave}
let board = null;  // quadro aberto

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
  deps.resetSave();
  document.body.dataset.view = 'board';
  deps.setStatus('Salvo');
  $('#title').textContent = board.title;
  render();
}

function render() {
  if (!board) return;
  $('#title').textContent = board.title;
}

// título do quadro: duplo clique no topo
$('#title').addEventListener('dblclick', () => {
  if (!board) return;
  const t = prompt('Nome do quadro', board.title);
  if (t === null || !t.trim() || t.trim() === board.title) return;
  board.title = t.trim();
  render();
  deps.scheduleSave(board);
});
