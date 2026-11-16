import test from 'node:test';
import assert from 'node:assert/strict';
import { folderOf, childFolders, folderPath, removeFolder, placeDoc, subtree, moveFolder, folderOptions } from '../static/folders.js';

const tree = {
  version: 3,
  folders: [{ id: 'w', name: 'Trabalho', parent: null }, { id: 'c', name: 'Clientes', parent: 'w' }, { id: 'a', name: 'Arquivo', parent: null }],
  place: { m1: 'c', m2: 'w', m3: 'sumiu' },
};

test('folderOf, childFolders and folderPath', () => {
  assert.deepEqual([folderOf(tree, 'm1'), folderOf(tree, 'm3'), folderOf(tree, 'x')], ['c', null, null], 'pasta que sumiu = Início');
  assert.deepEqual(childFolders(tree, null).map(f => f.id), ['a', 'w'], 'em ordem alfabética');
  assert.deepEqual(childFolders(tree, 'w').map(f => f.id), ['c']);
  assert.deepEqual(folderPath(tree, 'c').map(f => f.name), ['Trabalho', 'Clientes']);
  assert.deepEqual(folderPath(tree, null), []);
});

test('removeFolder moves subfolders and documents one level up', () => {
  const t = removeFolder(tree, 'w');
  assert.deepEqual(t.folders.map(f => [f.id, f.parent]), [['c', null], ['a', null]], 'Clientes sobe para o Início');
  assert.deepEqual(t.place, { m1: 'c', m3: 'sumiu' }, 'm2 vai para o Início');
  const t2 = removeFolder(tree, 'c');
  assert.equal(t2.place.m1, 'w', 'documento sobe para Trabalho');
  assert.equal(tree.folders.length, 3, 'não altera o original');
});

test('placeDoc sets or clears the folder', () => {
  assert.equal(placeDoc(tree, 'm9', 'a').place.m9, 'a');
  assert.equal('m1' in placeDoc(tree, 'm1', null).place, false);
});

test('moveFolder refuses itself and descendants; folderOptions lists the tree', () => {
  assert.deepEqual([...subtree(tree, 'w')].sort(), ['c', 'w']);
  assert.equal(moveFolder(tree, 'w', 'c'), null, 'não entra numa subpasta dela');
  assert.equal(moveFolder(tree, 'w', 'w'), null, 'nem nela mesma');
  assert.equal(moveFolder(tree, 'c', 'a').folders.find(f => f.id === 'c').parent, 'a');
  assert.equal(moveFolder(tree, 'c', null).folders.find(f => f.id === 'c').parent, null, 'para o Início');
  assert.deepEqual(folderOptions(tree).map(o => [o.name, o.depth]), [['Arquivo', 0], ['Trabalho', 0], ['Clientes', 1]]);
});
