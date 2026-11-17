// Folders (pure logic): tree = {version, folders: [{id, name, parent}], place: {document id: folder id}}

const str = (x) => String(x ?? '');  // a title/name read from the file may not be text
const byId = (tree, id) => tree.folders.find(f => f.id === id) ?? null;

// a document's folder; a folder that no longer exists counts as Home (null)
export const folderOf = (tree, docId) => byId(tree, tree.place[docId])?.id ?? null;

export const childFolders = (tree, parent, locale = 'pt-BR') =>
  tree.folders.filter(f => (f.parent ?? null) === parent).sort((a, b) => str(a.name).localeCompare(str(b.name), locale));

// path from Home to the folder (excluding Home); [] for Home or an unknown folder
export function folderPath(tree, id) {
  const path = [];
  for (let f = byId(tree, id); f && path.length <= tree.folders.length; f = byId(tree, f.parent)) path.unshift(f);
  return path;
}

// deletes the folder: subfolders and documents move up to the parent folder
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

// puts the document in the folder (null = Home)
export function placeDoc(tree, docId, folderId) {
  const place = { ...tree.place };
  if (folderId) place[docId] = folderId; else delete place[docId];
  return { ...tree, place };
}

// the folder and everything below it (forbidden destinations when moving the folder)
export function subtree(tree, id) {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of tree.folders) if (out.has(f.parent) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

// moves the folder; null if the destination is the folder itself or one of its subfolders
export function moveFolder(tree, id, parent) {
  if (parent && subtree(tree, id).has(parent)) return null;
  return { ...tree, folders: tree.folders.map(f => (f.id === id ? { ...f, parent: parent ?? null } : f)) };
}

// all folders as a tree (for the "Move to" menu), with each one's depth
export function folderOptions(tree, parent = null, depth = 0, locale = 'pt-BR') {
  return childFolders(tree, parent, locale).flatMap(f => [{ id: f.id, name: f.name, depth }, ...folderOptions(tree, f.id, depth + 1, locale)]);
}

// ---- Sorting and searching the list ----
const fold = (s) => str(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();  // accent-insensitive, case-insensitive
const byName = (a, b, locale) => str(a).localeCompare(str(b), locale, { sensitivity: 'base', numeric: true });

// folders always by name (Z–A reverses); documents by modification date or by name
export function sortItems({ folders, docs }, mode, locale = 'pt-BR') {
  const fs = [...folders].sort((a, b) => byName(a.name, b.name, locale));
  const ds = [...docs];
  if (mode === 'az' || mode === 'za') ds.sort((a, b) => byName(a.title, b.title, locale));
  else ds.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));  // most recent first
  if (mode === 'za') { fs.reverse(); ds.reverse(); }
  if (mode === 'oldest') ds.reverse();
  return { folders: fs, docs: ds };
}

// search across all folders by name (or tag, for documents); every word must appear (accent- and case-insensitive)
export function searchItems(tree, docs, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hit = (...texts) => words.every(w => texts.some(s => fold(s).includes(w)));
  return { folders: tree.folders.filter(f => hit(f.name)), docs: docs.filter(d => hit(d.title, ...(d.tags ?? []))) };
}
