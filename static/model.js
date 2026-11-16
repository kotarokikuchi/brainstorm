// Lógica pura do editor: árvore, layouts, navegação e histórico (sem DOM).

export const PALETTE = [
  '#2f5bea', '#f2b705', '#8b3fd9', '#f97316', '#e43fa4', '#e5383b',
  '#5cb85c', '#14b8a6', '#3b9cf5', '#12a150', '#a16207', '#6b7280',
];

export const uid = () =>
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

const node = (text = '') => ({
  id: uid(), text, color: null, shape: null, collapsed: false, side: null, children: [],
});

export function newMap(id) {
  return { id, version: 0, layout: 'map', root: node('Mapa central') };
}

export function findNode(root, id, parent = null, depth = 0) {
  if (root.id === id) return { node: root, parent, depth };
  for (const c of root.children) {
    const hit = findNode(c, id, root, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export function addChild(map, parentId) {
  const parent = findNode(map.root, parentId).node;
  const n = node();
  if (parent === map.root) {
    const right = parent.children.filter(c => c.side === 'right').length;
    const left = parent.children.length - right;
    n.side = left < right ? 'left' : 'right';
    n.color = PALETTE[parent.children.length % PALETTE.length];
  }
  parent.collapsed = false;
  parent.children.push(n);
  return n;
}

export function addSibling(map, nodeId) {
  const hit = findNode(map.root, nodeId);
  if (!hit.parent) return addChild(map, nodeId);
  const n = node();
  n.side = hit.node.side;
  if (hit.parent === map.root) n.color = PALETTE[map.root.children.length % PALETTE.length];
  const kids = hit.parent.children;
  kids.splice(kids.indexOf(hit.node) + 1, 0, n);
  return n;
}

export function removeNode(map, nodeId) {
  const hit = findNode(map.root, nodeId);
  if (!hit || !hit.parent) return null;
  const kids = hit.parent.children;
  kids.splice(kids.indexOf(hit.node), 1);
  return hit.parent.id;
}

export function commitText(map, nodeId, text, isNew) {
  const n = findNode(map.root, nodeId).node;
  const t = text.trim();
  if (t) {
    n.text = t;
    return nodeId;
  }
  return isNew ? removeNode(map, nodeId) ?? nodeId : nodeId;
}

export function branchColor(root, nodeId) {
  let color = '#222';
  const walk = (n) => {
    if (n.id === nodeId) {
      if (n !== root && n.color) color = n.color;
      return true;
    }
    for (const c of n.children) {
      if (walk(c)) {
        if (color === '#222' && n !== root && n.color) color = n.color;
        return true;
      }
    }
    return false;
  };
  walk(root);
  return color;
}

export class History {
  constructor(limit = 100) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }
  push(state) {
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    return this.past.pop();
  }
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    return this.future.pop();
  }
}
