import test from 'node:test';
import assert from 'node:assert/strict';
import { folderOf, childFolders, folderPath, removeFolder, placeDoc, subtree, moveFolder, folderOptions } from '../static/folders.js';

const tree = {
  version: 3,
  folders: [{ id: 'w', name: 'Trabalho', parent: null }, { id: 'c', name: 'Clientes', parent: 'w' }, { id: 'a', name: 'Arquivo', parent: null }],
  place: { m1: 'c', m2: 'w', m3: 'sumiu' },
};

test('folderOf, childFolders and folderPath', () => {
  assert.deepEqual([folderOf(tree, 'm1'), folderOf(tree, 'm3'), folderOf(tree, 'x')], ['c', null, null], 'a folder that vanished = Home');
  assert.deepEqual(childFolders(tree, null).map(f => f.id), ['a', 'w'], 'in alphabetical order');
  assert.deepEqual(childFolders(tree, 'w').map(f => f.id), ['c']);
  assert.deepEqual(folderPath(tree, 'c').map(f => f.name), ['Trabalho', 'Clientes']);
  assert.deepEqual(folderPath(tree, null), []);
});

test('removeFolder moves subfolders and documents one level up', () => {
  const t = removeFolder(tree, 'w');
  assert.deepEqual(t.folders.map(f => [f.id, f.parent]), [['c', null], ['a', null]], 'Clientes moves up to Home');
  assert.deepEqual(t.place, { m1: 'c', m3: 'sumiu' }, 'm2 goes to Home');
  const t2 = removeFolder(tree, 'c');
  assert.equal(t2.place.m1, 'w', 'the document moves up to Trabalho');
  assert.equal(tree.folders.length, 3, 'does not change the original');
});

test('placeDoc sets or clears the folder', () => {
  assert.equal(placeDoc(tree, 'm9', 'a').place.m9, 'a');
  assert.equal('m1' in placeDoc(tree, 'm1', null).place, false);
});

test('moveFolder refuses itself and descendants; folderOptions lists the tree', () => {
  assert.deepEqual([...subtree(tree, 'w')].sort(), ['c', 'w']);
  assert.equal(moveFolder(tree, 'w', 'c'), null, 'cannot go into one of its own subfolders');
  assert.equal(moveFolder(tree, 'w', 'w'), null, 'nor into itself');
  assert.equal(moveFolder(tree, 'c', 'a').folders.find(f => f.id === 'c').parent, 'a');
  assert.equal(moveFolder(tree, 'c', null).folders.find(f => f.id === 'c').parent, null, 'to Home');
  assert.deepEqual(folderOptions(tree).map(o => [o.name, o.depth]), [['Arquivo', 0], ['Trabalho', 0], ['Clientes', 1]]);
});

import { sortItems, searchItems } from '../static/folders.js';

test('sortItems orders folders by name and documents by date or name', () => {
  const docs = [
    { id: 'd1', title: 'beta', updated: '2026-01-02T00:00:00Z' },
    { id: 'd2', title: 'Álamo', updated: '2026-01-03T00:00:00Z' },
    { id: 'd3', title: 'item 10', updated: '2026-01-01T00:00:00Z' },
    { id: 'd4', title: 'item 9', updated: '2026-01-04T00:00:00Z' },
  ];
  const ids = (r) => [r.folders.map(f => f.id).join(''), r.docs.map(d => d.id).join(',')];
  assert.deepEqual(ids(sortItems({ folders: tree.folders, docs }, 'recent')), ['acw', 'd4,d2,d1,d3']);
  assert.deepEqual(ids(sortItems({ folders: tree.folders, docs }, 'oldest')), ['acw', 'd3,d1,d2,d4']);
  assert.deepEqual(ids(sortItems({ folders: tree.folders, docs }, 'az')), ['acw', 'd2,d1,d4,d3'], 'accents and natural number order');
  assert.deepEqual(ids(sortItems({ folders: tree.folders, docs }, 'za')), ['wca', 'd3,d4,d1,d2']);
});

test('searchItems finds folders and documents anywhere, ignoring accents and case', () => {
  const docs = [{ id: 'm1', title: 'Reunião de Sexta' }, { id: 'm2', title: 'Plano' }];
  const r = searchItems(tree, docs, 'reuniao sex');
  assert.deepEqual(r.docs.map(d => d.id), ['m1'], 'all the words, accent-insensitive');
  assert.deepEqual(searchItems(tree, docs, 'CLI').folders.map(f => f.id), ['c'], 'subfolder too');
  assert.deepEqual(searchItems(tree, docs, 'nada').docs, []);
});

test('list survives titles and folder names that are not strings', () => {
  const docs = [{ id: 'a', title: 5, updated: '1' }, { id: 'b', title: null, updated: '2' }, { id: 'c', title: 'Beta', updated: '3' }];
  const tree = { folders: [{ id: 'f', name: 7, parent: null }, { id: 'g', name: 'Alfa', parent: null }], place: {} };
  const r = sortItems({ folders: tree.folders, docs }, 'az');
  assert.deepEqual([r.folders.map(f => f.id), r.docs.map(d => d.id)], [['f', 'g'], ['b', 'a', 'c']]);
  assert.deepEqual(searchItems(tree, docs, '5').docs.map(d => d.id), ['a']);
  assert.deepEqual(searchItems(tree, docs, '7').folders.map(f => f.id), ['f']);
  assert.deepEqual(childFolders(tree, null).map(f => f.id), ['f', 'g']);
});

test('searchItems matches each word against the title or a tag', () => {
  const tree = { version: 0, folders: [], place: {} };
  const docs = [{ id: 's', title: 'Revisão', tags: ['python'] }, { id: 'm', title: 'Mapa' }];
  assert.deepEqual(searchItems(tree, docs, 'pyth').docs.map(d => d.id), ['s']);
  assert.deepEqual(searchItems(tree, docs, 'revi pyth').docs.map(d => d.id), ['s']);
  assert.deepEqual(searchItems(tree, docs, 'mapa').docs.map(d => d.id), ['m']);
});
