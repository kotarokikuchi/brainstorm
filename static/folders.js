// Pastas (lógica pura): tree = {version, folders: [{id, name, parent}], place: {id do documento: id da pasta}}

const byId = (tree, id) => tree.folders.find(f => f.id === id) ?? null;

// pasta de um documento; pasta que sumiu conta como Início (null)
export const folderOf = (tree, docId) => byId(tree, tree.place[docId])?.id ?? null;

export const childFolders = (tree, parent) =>
  tree.folders.filter(f => (f.parent ?? null) === parent).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

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
