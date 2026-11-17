// Pastas (lógica pura): tree = {version, folders: [{id, name, parent}], place: {id do documento: id da pasta}}

const str = (x) => String(x ?? '');  // título/nome vindo do arquivo pode não ser texto
const byId = (tree, id) => tree.folders.find(f => f.id === id) ?? null;

// pasta de um documento; pasta que sumiu conta como Início (null)
export const folderOf = (tree, docId) => byId(tree, tree.place[docId])?.id ?? null;

export const childFolders = (tree, parent) =>
  tree.folders.filter(f => (f.parent ?? null) === parent).sort((a, b) => str(a.name).localeCompare(str(b.name), 'pt-BR'));

// caminho do Início até a pasta (sem o Início); [] para o Início ou pasta desconhecida
export function folderPath(tree, id) {
  const path = [];
  for (let f = byId(tree, id); f && path.length <= tree.folders.length; f = byId(tree, f.parent)) path.unshift(f);
  return path;
}

// apaga a pasta: subpastas e documentos sobem para a pasta de cima
export function removeFolder(tree, id) {
  const gone = byId(tree, id);
  if (!gone) return tree;
  const up = gone.parent ?? null;
  const place = {};
  for (const [doc, f] of Object.entries(tree.place)) {
    const to = f === id ? up : f;
    if (to) place[doc] = to;
  }
  return {
    ...tree,
    folders: tree.folders.filter(f => f.id !== id).map(f => (f.parent === id ? { ...f, parent: up } : f)),
    place,
  };
}

// põe o documento na pasta (null = Início)
export function placeDoc(tree, docId, folderId) {
  const place = { ...tree.place };
  if (folderId) place[docId] = folderId; else delete place[docId];
  return { ...tree, place };
}

// a pasta e tudo abaixo dela (destinos proibidos ao mover a pasta)
export function subtree(tree, id) {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of tree.folders) if (out.has(f.parent) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

// muda a pasta de lugar; null se o destino for ela mesma ou uma subpasta dela
export function moveFolder(tree, id, parent) {
  if (parent && subtree(tree, id).has(parent)) return null;
  return { ...tree, folders: tree.folders.map(f => (f.id === id ? { ...f, parent: parent ?? null } : f)) };
}

// todas as pastas em árvore (para o menu "Mover para"), com a profundidade de cada uma
export function folderOptions(tree, parent = null, depth = 0) {
  return childFolders(tree, parent).flatMap(f => [{ id: f.id, name: f.name, depth }, ...folderOptions(tree, f.id, depth + 1)]);
}

// ---- Ordenar e buscar na lista ----
const fold = (s) => str(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();  // sem acento, sem maiúscula
const byName = (a, b) => str(a).localeCompare(str(b), 'pt-BR', { sensitivity: 'base', numeric: true });

// pastas sempre por nome (Z–A inverte); documentos por data de modificação ou por nome
export function sortItems({ folders, docs }, mode) {
  const fs = [...folders].sort((a, b) => byName(a.name, b.name));
  const ds = [...docs];
  if (mode === 'az' || mode === 'za') ds.sort((a, b) => byName(a.title, b.title));
  else ds.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));  // mais recentes primeiro
  if (mode === 'za') { fs.reverse(); ds.reverse(); }
  if (mode === 'oldest') ds.reverse();
  return { folders: fs, docs: ds };
}

// busca em todas as pastas, pelo nome; cada palavra precisa aparecer (sem diferença de acento/maiúscula)
export function searchItems(tree, docs, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hit = (s) => words.every(w => fold(s).includes(w));
  return { folders: tree.folders.filter(f => hit(f.name)), docs: docs.filter(d => hit(d.title)) };
}
