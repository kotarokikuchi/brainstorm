// E2E in headless Chrome via the DevTools Protocol (Node's native WebSocket, no dependencies).
// Usage: node tests/e2e.mjs   (needs google-chrome on PATH; starts its own server)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
// configurable ports: several e2e runs (e.g. agents in worktrees) can run at the same time
const PORT = Number(process.env.E2E_PORT ?? 8765), CDP = Number(process.env.E2E_CDP_PORT ?? 9333), BASE = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(join(tmpdir(), 'brainstorm-e2e-'));
const server = spawn('python3', ['-c',
  'import sys; from pathlib import Path; from app import make_server; make_server(Path(sys.argv[1]), int(sys.argv[2]), auth=("e2e", "senha-e2e")).serve_forever()',
  join(tmp, 'data'), String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
// the test checks Portuguese texts: the browser runs in pt-BR, whatever the machine's language
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + CDP, '--lang=pt-BR', '--accept-lang=pt-BR',
  '--window-size=1400,800', '--user-data-dir=' + join(tmp, 'chrome'), 'about:blank'], { stdio: 'ignore', env: { ...process.env, LANGUAGE: 'pt_BR' } });
// maxRetries: Chrome may still be writing the profile when the process exits
process.on('exit', () => { chrome.kill(); server.kill(); rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1));
setTimeout(() => { console.error('E2E timeout'); process.exit(1); }, 300000).unref();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); break; } catch { await sleep(200); } }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let seq = 0, promptAnswer = '', dialogAccept = true; const waiting = new Map(); const logs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') logs.push(d.params.exceptionDetails.exception?.description);
  if (d.method === 'Page.javascriptDialogOpening') cmd('Page.handleJavaScriptDialog', { accept: dialogAccept, promptText: promptAnswer });
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push(JSON.stringify(d.params.args)); };
const cmd = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
const KEYS = { Tab: 9, Enter: 13, Escape: 27, Delete: 46, ' ': 32, ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, z: 90, c: 67, v: 86, b: 66, i: 73, '.': 190, Backspace: 8, ArrowUp: 38, d: 68, a: 65, ']': 221, F2: 113 };
async function key(k, mods = 0) { 
  const base = { key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, windowsVirtualKeyCode: KEYS[k], modifiers: mods };
  await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (k.length === 1 && !mods) await cmd('Input.dispatchKeyEvent', { type: 'char', text: k, ...base });
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(50);
}
const typeText = (t) => cmd('Input.insertText', { text: t });
const getMap = async () => (await fetch(BASE + '/api/maps/demo')).json();
const texts = () => ev(`[...document.querySelectorAll('#viewport .node text')].map(t => t.textContent)`);
const status = () => ev(`document.querySelector('#status').textContent`);

const n = (text, kids = [], side = null, color = null) => ({ id: 'n' + Math.random().toString(36).slice(2), text, color, shape: null, collapsed: false, side, children: kids });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/maps'); break; } catch { await sleep(100); } }
// the e2e server requires login: Node's fetch calls use their own session (the browser's is made by the page)
const apiLogin = await fetch(BASE + '/api/login', { method: 'POST', body: JSON.stringify({ user: 'e2e', password: 'senha-e2e' }) });
assert.equal(apiLogin.status, 200, 'login via the API');
const sessionCookie = apiLogin.headers.get('set-cookie').split(';')[0];
const nodeFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => nodeFetch(url, String(url).startsWith(BASE) ? { ...opts, headers: { ...(opts.headers ?? {}), Cookie: sessionCookie } } : opts);
await fetch(BASE + '/api/maps/demo', { method: 'PUT', body: JSON.stringify({ version: 0, layout: 'map', root: n('Planejamento', [
  n('Recursos', [n('Time'), n('Orçamento')], 'left', '#2f5bea'),
  n('Cronograma', [n('Q1'), n('Q2')], 'right', '#e5383b'),
]) }) });
await cmd('Runtime.enable');
await cmd('Page.enable');
// login page: without a session the app sends you there; a wrong password warns; the right one gets in
await cmd('Page.navigate', { url: BASE + '/' }); await sleep(1200);
assert.equal(await ev(`location.pathname`), '/login.html', 'without a login, goes to the login page');
// if Chrome's options are not enough on this machine, the stored choice guarantees pt-BR
if (await ev(`navigator.language`) !== 'pt-BR') { await ev(`localStorage.setItem('brainstorm:lang', 'pt-BR')`); await cmd('Page.navigate', { url: BASE + '/login.html' }); await sleep(1200); }
assert.deepEqual(await ev(`[document.documentElement.lang, document.querySelector('#lang').value, document.querySelector('#lang').options.length, document.title]`),
  ['pt-BR', 'pt-BR', 4, 'Entrar · Brainstorm'], 'login page loads the texts and the language selector without a session');
const submitLogin = (u, p) => ev(`(() => { document.querySelector('#login-user').value = '${u}'; document.querySelector('#login-password').value = '${p}'; document.querySelector('#login-form').requestSubmit(); })()`);
await submitLogin('e2e', 'errada'); await sleep(1600);
assert.equal(await ev(`document.querySelector('#login-error').hidden ? '' : document.querySelector('#login-error').textContent`), 'Usuário ou senha incorretos.', 'wrong password warns');
await submitLogin('e2e', 'senha-e2e'); await sleep(1200);
assert.equal(await ev(`location.pathname`), '/', 'right password gets into the app');
await cmd('Page.navigate', { url: BASE + '/#/map/demo' });
await sleep(1500);
const v0 = (await getMap()).version;
assert.equal(await ev(`document.querySelector('#toolbar').hidden`), true, 'bar only appears after clicking the node');

// Tab creates a child of the root and opens the input; text + Enter confirms
await key('Tab');
assert.equal(await ev(`!document.querySelector('#editor').hidden`), true, 'input open');
await typeText('Nova ideia');
await key('Delete');  // Review Focus 5: Delete inside the input does not delete the node
await key('Enter');
assert.ok((await texts()).includes('Nova ideia'), 'nó criado: ' + (await texts()));
await sleep(900);
let s = await getMap();
assert.ok(JSON.stringify(s).includes('Nova ideia'), 'autosave saved');
assert.equal(s.version, v0 + 1);
assert.equal(await status(), 'Salvo');

// Enter creates a sibling; Esc on the new node discards it
await key('Enter'); await typeText('descartar'); await key('Escape');
assert.ok(!(await texts()).includes('descartar'), 'Esc discards the new node');

// typing over the node edits, replacing the text
await key('x'); await typeText('yz'); await key('Enter');
assert.ok((await texts()).includes('xyz'), 'edição por digitação: ' + (await texts()));

// Delete removes and Ctrl+Z undoes, Ctrl+Shift+Z redoes
await key('Delete');
assert.ok(!(await texts()).includes('xyz'), 'delete: ' + (await texts()) + ' sel=' + (await ev(`document.querySelector('.selected-ring')?.parentNode.textContent`)));
await key('z', 2);
assert.ok((await texts()).includes('xyz'), 'undo');
await key('z', 2 | 8);
assert.ok(!(await texts()).includes('xyz'), 'redo');
await key('z', 2);

// arrows: from the root to the right, Space collapses
await sleep(900); await cmd('Page.reload'); await sleep(1500);
await key('ArrowRight');
const sel = await ev(`document.querySelector('.selected-ring').parentNode.dataset.id`);
assert.notEqual(sel, (await getMap()).root.id, 'arrow moved the selection');
const before = (await texts()).length;
await ev(`(() => { const g=[...document.querySelectorAll('.node')].find(g=>g.textContent.startsWith('Cronograma')); g.dispatchEvent(new MouseEvent('click',{bubbles:true})); })()`);
await key(' ');
assert.ok((await texts()).length < before, 'Space collapsed');
await key(' ');

// floating bar: colour and shape on the selected node
const clickNode = (prefix) => ev(`[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('${prefix}')).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await clickNode('Recursos');
assert.equal(await ev(`!document.querySelector('#toolbar').hidden`), true, 'toolbar visible');
await ev(`document.querySelector('#style-btn').click()`);
await ev(`document.querySelector('#style-pop [data-prop="color"] [data-value="#14b8a6"]').click()`);
await ev(`document.querySelector('#style-pop [data-prop="shape"] [data-value="rect"]').click()`);
await sleep(900);
const rec = (await getMap()).root.children.find(c => c.text === 'Recursos');
assert.equal(rec.color, '#14b8a6');
assert.equal(rec.shape, 'rect');
assert.equal(await ev(`[...document.querySelectorAll('#viewport path')].filter(p => p.getAttribute('stroke') === '#14b8a6').length`), 3, 'descendants inherit the colour');

// style panel: Shape/Border/Line tabs, no fill, custom colour, cloud, branch outline
const recNode = async () => (await getMap()).root.children.find(c => c.text === 'Recursos');
const pick = (panel, prop, value) => ev(`document.querySelector('#style-pop [data-panel="${panel}"] [data-prop="${prop}"] [data-value="${value}"]').click()`);
const tab = (name) => ev(`document.querySelector('#style-pop [data-tab="${name}"]').click()`);
const recG = `[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Recursos'))`;
const shown = (sel) => ev(`!document.querySelector('${sel}').hidden`);
await pick('shape', 'shape', 'cloud');
assert.equal(await ev(`!!${recG}.querySelector('path.cloud')`), true, 'cloud shape');
await pick('shape', 'color', 'none');
await sleep(900);
assert.equal((await recNode()).fillNone, true, 'no fill');
// (the '+' opens the native colour picker, which does not run in headless: applies the colour directly through the input)
await ev(`(() => { const i = document.querySelector('#custom-color'); i.value = '#123456'; i.dispatchEvent(new Event('change')); })()`);
await sleep(900);
assert.equal((await recNode()).color, '#123456', 'custom colour');
assert.equal((await recNode()).fillNone, false, 'colour fills again');
assert.equal(await ev(`!!document.querySelector('#style-pop [data-panel="shape"] [data-prop="color"] [data-value="#123456"]')`), true, 'custom colour becomes a swatch');
await ev(`document.querySelector('#boundary').click()`);
await sleep(900);
assert.equal((await recNode()).boundary, true);
assert.equal(await ev(`!!document.querySelector('#viewport .boundary')`), true, 'branch outline');
await tab('border');
assert.equal(await shown('#style-pop [data-panel="border"]'), true, 'border tab');
assert.equal(await shown('#style-pop [data-panel="shape"]'), false);
await pick('border', 'borderColor', '#e5383b');
await pick('border', 'borderWidth', 'thick');
await pick('border', 'borderStyle', 'dashed');
await sleep(900);
let rn = await recNode();
assert.deepEqual([rn.borderColor, rn.borderWidth, rn.borderStyle], ['#e5383b', 'thick', 'dashed']);
assert.equal(await ev(`(() => { const p = ${recG}.querySelector('path.cloud'); return p.getAttribute('stroke') + ' ' + !!p.getAttribute('stroke-dasharray'); })()`), '#e5383b true', 'border drawn');
await tab('line');
await pick('line', 'lineColor', '#2f5bea');
await pick('line', 'lineStyle', 'dashed');
await sleep(900);
assert.equal(await ev(`[...document.querySelectorAll('#viewport path.edge')].filter(p => p.getAttribute('stroke') === '#2f5bea' && p.getAttribute('stroke-dasharray')).length`), 1, 'parent line styled');
await pick('line', 'lineStyle', 'dashed');  // clicking the active one returns to the default
await sleep(900);
assert.equal((await recNode()).lineStyle, null);
await tab('shape');

// "+" buttons create a child and a sibling
await ev(`document.querySelector('#add-child').click()`);
assert.equal(await ev(`!document.querySelector('#editor').hidden`), true, '+ child opens editing');
await typeText('Pelo mais'); await key('Enter');
assert.equal((await getMap()).root.children.length >= 2, true);
assert.ok((await texts()).includes('Pelo mais'));

// layout and zoom
await ev(`(() => { const s = document.querySelector('#layout-select'); s.value = 'org'; s.dispatchEvent(new Event('change')); })()`);
await sleep(900);
assert.equal((await getMap()).layout, 'org');
await ev(`document.querySelector('#zoom-in').click()`);
assert.notEqual(await ev(`document.querySelector('#zoom-reset').textContent`), '100%');
await ev(`document.querySelector('#zoom-reset').click()`);
assert.equal(await ev(`document.querySelector('#zoom-reset').textContent`), '100%');
await ev(`document.querySelector('#undo').click()`);
assert.equal(await ev(`document.querySelector('#layout-select').value`), 'map', 'undo via the button');
await sleep(900);

// review I2: collapsing the grandparent moves the selection to the collapsed node
await clickNode('Time');
const recBox = `[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Recursos'))`;
await ev(`${recBox}.querySelector('.toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
assert.match(await ev(`document.querySelector('.selected-ring').parentNode.textContent`), /^Recursos/, 'selection moves up on collapse');
assert.equal(await ev(`${recBox}.querySelector('.toggle text')?.textContent`), String((await getMap()).root.children.find(c => c.text.startsWith('Recursos')).children.length), 'collapsed shows the number of children');
await ev(`${recBox}.querySelector('.toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await sleep(900);
assert.equal(await ev(`${recBox}.querySelector('.toggle text')`), null, 'expanded: just the circle, no text');

// review M1: entering and leaving edit mode without changing anything does not save
const vBefore = (await getMap()).version;
await key('F2'); await key('Enter');
await sleep(900);
assert.equal((await getMap()).version, vBefore, 'an edit with no change does not save');

// review M5: text being typed protects closing and navigation ends the edit
const unloadBlocked = () => ev(`(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`);
await key('F2'); await ev(`document.querySelector('#editor').setSelectionRange(999, 999)`); await typeText(' rascunho');
assert.equal(await unloadBlocked(), true, 'beforeunload warns during editing');
await ev(`location.hash = '#/'`); await sleep(600);
await ev(`location.hash = '#/map/demo'`); await sleep(1200);
assert.equal(await ev(`document.querySelector('#editor').hidden`), true, 'editing ended on navigation');
assert.ok((await texts()).some(t => t.endsWith('rascunho')), 'typed text was confirmed');
await key('Tab');
assert.equal(await ev(`!document.querySelector('#editor').hidden`), true, 'keyboard works after going back');
await key('Escape');
await sleep(900);

// dragging a branch: Q1 becomes a child of Recursos (left side → drop on the left), placeholder appears, Ctrl+Z undoes
const rect = (prefix) => ev(`(() => { const r = [...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('${prefix}')).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const mouse = (type, x, y) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });

const q1 = await rect('Q1'), recR = await rect('Recursos');
await mouse('mousePressed', q1.x + q1.w / 2, q1.y + q1.h / 2);
for (let i = 1; i <= 5; i++) {
  await mouse('mouseMoved', q1.x + q1.w / 2 + (recR.x - 10 - q1.x - q1.w / 2) * i / 5, q1.y + q1.h / 2 + (recR.y + recR.h / 2 - q1.y - q1.h / 2) * i / 5);
  await sleep(30);
}
assert.equal(await ev(`!!document.querySelector('#viewport .drop-placeholder')`), true, 'placeholder visible');
await mouse('mouseReleased', recR.x - 10, recR.y + recR.h / 2);
await sleep(900);
const recursos = () => getMap().then(m => m.root.children.find(c => c.text.startsWith('Recursos')));
assert.ok((await recursos()).children.some(c => c.text === 'Q1'), 'Q1 moved to Recursos');
assert.equal(await ev(`!!document.querySelector('#viewport .drop-placeholder')`), false, 'placeholder disappears on drop');
await key('z', 2);
await sleep(900);
assert.ok(!(await recursos()).children.some(c => c.text === 'Q1'), 'undo moves it back');

// linking nodes: "Ligar" button on Q2, move to Time shows the preview, clicking creates the arrow; clicking it + Del deletes; Ctrl+Z restores
const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];
const clickAnchor = async (side) => {
  const [x, y] = await ev(`(() => { const r = document.querySelector('.link-anchor[data-side="${side}"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y);
};
await clickNode('Q2');
await ev(`document.querySelector('#link-btn').click()`);
const [tx, ty] = center(await rect('Time'));
// without choosing a side: no active side, no preview, and clicking the target does not link
assert.equal(await ev(`document.querySelectorAll('.link-anchor.active').length`), 0, 'no side preselected');
await mouse('mouseMoved', tx, ty);
assert.equal(await ev(`!!document.querySelector('#viewport .link-preview')`), false, 'no preview before choosing the side');
await mouse('mousePressed', tx, ty); await mouse('mouseReleased', tx, ty);
await sleep(300);
assert.equal((await getMap()).links?.length ?? 0, 0, 'clicking the target without a side does not link');
assert.equal(await ev(`document.querySelectorAll('.link-anchor:not([hidden])').length`), 4, 'stays in link mode');
await clickAnchor('left');
await mouse('mouseMoved', tx, ty);
assert.equal(await ev(`!!document.querySelector('#viewport .link-preview')`), true, 'preview after choosing the side');
await mouse('mousePressed', tx, ty);
await mouse('mouseReleased', tx, ty);
await sleep(900);
assert.equal((await getMap()).links.length, 1, 'link saved');
assert.equal(await ev(`document.querySelectorAll('#viewport .link').length`), 1, 'arrow drawn');
await ev(`document.querySelector('#viewport .link-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await key('Delete');
await sleep(900);
assert.equal((await getMap()).links.length, 0, 'Del deletes the selected link');
assert.ok((await texts()).includes('Q2'), 'Del did not delete the node');
await key('z', 2);
await sleep(900);
assert.equal((await getMap()).links.length, 1, 'undo restores the link');
// "Ligar" button on the bar: then click the target node
await clickNode('Q2');
await ev(`document.querySelector('#link-btn').click()`);
await clickAnchor('left');
const [qx, qy] = center(await rect('Recursos'));  // far from Q2's "+"
await mouse('mousePressed', qx, qy);  // without moving first: direct click on the target
await mouse('mouseReleased', qx, qy);
await sleep(900);
assert.equal((await getMap()).links.length, 2, 'Ligar button creates a link');

// node "⋯" menu: items, copy/paste through the menu and Ctrl+C/Ctrl+V, new child, Esc closes
const menuOpen = () => ev(`!document.querySelector('#node-menu').hidden`);
const menu = (action) => ev(`document.querySelector('#node-menu [data-action="${action}"]').click()`);
await clickNode('Q2');
await ev(`document.querySelector('#more-btn').click()`);
assert.equal(await menuOpen(), true, 'menu opens');
assert.deepEqual(await ev(`[...document.querySelectorAll('#node-menu [data-action]')].map(b => b.dataset.action)`),
  ['child', 'sibling', 'collapse', 'focus', 'link', 'copy', 'cut', 'paste', 'delete']);
await menu('copy');
assert.equal(await menuOpen(), false, 'menu closes after an action');
await clickNode('Time');
await ev(`document.querySelector('#more-btn').click()`);
await menu('paste');
await sleep(900);
const timeKids = async () => (await recursos()).children.find(c => c.text === 'Time').children.map(c => c.text);
assert.deepEqual(await timeKids(), ['Q2'], 'paste via the menu');
await clickNode('Q1');
await key('c', 2);
await clickNode('Time');
await key('v', 2);
await sleep(900);
assert.deepEqual(await timeKids(), ['Q2', 'Q1'], 'Ctrl+C / Ctrl+V');
await ev(`document.querySelector('#more-btn').click()`);
await menu('child');
assert.equal(await ev(`!document.querySelector('#editor').hidden`), true, 'new child via the menu');
await key('Escape');
await ev(`document.querySelector('#more-btn').click()`);
await key('Escape');
assert.equal(await menuOpen(), false, 'Esc closes the menu');
await sleep(900);

// clicking outside: the map background closes menus and clears the selection; the header only closes menus; arrows select again
const emptyPoint = () => ev(`(() => { for (let y = 120; y < 700; y += 20) for (let x = 20; x < 1300; x += 20) if (document.elementFromPoint(x, y)?.id === 'canvas') return [x, y]; })()`);
const visible = (sel) => ev(`!document.querySelector('${sel}').hidden`);
// empty spot in the header (hits neither a button nor the name, which change width)
const headerPoint = () => ev(`(() => { for (let x = 400; x < 1300; x += 10) if (document.elementFromPoint(x, 25)?.classList.contains('topbar')) return [x, 25]; })()`);
await clickNode('Q2');
await ev(`document.querySelector('#more-btn').click()`);
assert.equal(await visible('#node-menu'), true);
const [hx, hy] = await headerPoint(); await mouse('mousePressed', hx, hy); await mouse('mouseReleased', hx, hy);  // header (empty space)
assert.equal(await visible('#node-menu'), false, 'clicking the header closes the menu');
assert.equal(await visible('#toolbar'), true, 'header keeps the selection');
await ev(`document.querySelector('#style-btn').click()`);
const [ex, ey] = await emptyPoint();
await mouse('mousePressed', ex, ey); await mouse('mouseReleased', ex, ey);
assert.equal(await visible('#style-pop'), false, 'background closes the style panel');
assert.equal(await visible('#toolbar'), false, 'background hides the bar');
assert.equal(await visible('#add-child'), false, 'background hides the +');
assert.equal(await ev(`!!document.querySelector('.selected-ring')`), false, 'nothing selected');
await key('Delete');  // no selection: does nothing and does not break
await key('ArrowRight');
assert.equal(await ev(`!!document.querySelector('.selected-ring')`), true, 'arrow selects again');
assert.equal(await ev(`document.querySelector('#toolbar').hidden`), true, 'keyboard navigation does not open the bar');
await sleep(900);

// bending a link: the selected arrow shows the control point; dragging bends; undo/redo; double click returns to automatic
await ev(`document.querySelector('#viewport .link-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
const bh = await ev(`(() => { const r = document.querySelector('#viewport .link-bend').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const [bx0, by0] = center(bh);
await mouse('mousePressed', bx0, by0);
for (let i = 1; i <= 5; i++) { await mouse('mouseMoved', bx0 + 18 * i, by0 + 14 * i); await sleep(30); }
await mouse('mouseReleased', bx0 + 90, by0 + 70);
await sleep(900);
const bend = async () => (await getMap()).links[0].bend;
assert.ok(Array.isArray(await bend()), 'curve saved');
assert.match(await ev(`document.querySelector('#viewport .link').getAttribute('d')`), / Q/, 'arrow passes through the point');
await key('z', 2);
await sleep(900);
assert.equal(await bend(), undefined, 'undo the curve');
await key('z', 2 | 8);
await sleep(900);
assert.ok(await bend(), 'redo the curve');
await ev(`document.querySelector('#viewport .link-bend').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await sleep(900);
assert.equal(await bend(), undefined, 'double click returns to the automatic curve');

// connection points: the 4 "+" on the origin node appear only in "Ligar" mode; choose the side and click the target
const hoverOn = async (prefix) => { const [x, y] = center(await rect(prefix)); await mouse('mouseMoved', x, y); await sleep(50); };
const anchorsShown = () => ev(`[...document.querySelectorAll('.link-anchor')].filter(b => !b.hidden).map(b => b.dataset.side).sort()`);
await clickNode('Cronograma');
assert.deepEqual(await anchorsShown(), [], 'no "+" outside link mode');
await hoverOn('Cronograma');
assert.deepEqual(await anchorsShown(), [], 'hover does not show "+"');
await ev(`document.querySelector('#more-btn').click()`);
await menu('link');
assert.deepEqual(await anchorsShown(), ['bottom', 'left', 'right', 'top'], '4 connection options');
const anchorTop = await ev(`(() => { const r = document.querySelector('.link-anchor[data-side="top"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const [ax, ay] = center(anchorTop);
await mouse('mousePressed', ax, ay); await mouse('mouseReleased', ax, ay);  // chooses the top side
assert.equal(await ev(`document.querySelector('.link-anchor[data-side="top"]').classList.contains('active')`), true);
const recTop = await rect('Recursos');
const [rx, ry] = [recTop.x + recTop.w / 2, recTop.y + 2];  // near the top of Recursos
await mouse('mouseMoved', rx, ry);
assert.equal(await ev(`document.querySelectorAll('#viewport .anchor-dot').length`), 4, 'target shows the 4 points');
await mouse('mousePressed', rx, ry); await mouse('mouseReleased', rx, ry);
await sleep(900);
const newLink = (await getMap()).links.at(-1);
const cron = (await getMap()).root.children.find(c => c.text === 'Cronograma');
assert.equal(newLink.from, cron.id);
assert.deepEqual([newLink.fromSide, newLink.toSide], ['top', 'top'], 'sides saved');
assert.deepEqual(await anchorsShown(), [], '"+" disappear when finished');

// moving the link's target: drag the end of the selected arrow to another node; Ctrl+Z undoes
await ev(`document.querySelector('#viewport .link-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
const endTo = await ev(`(() => { const r = document.querySelector('#viewport .link-end[data-which="to"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const [ex0, ey0] = center(endTo), [ox, oy] = center(await rect('Orçamento'));
await mouse('mousePressed', ex0, ey0);
for (let i = 1; i <= 5; i++) { await mouse('mouseMoved', ex0 + (ox - ex0) * i / 5, ey0 + (oy - ey0) * i / 5); await sleep(30); }
assert.equal(await ev(`!!document.querySelector('#viewport .link-target')`), true, 'new target highlighted');
await mouse('mouseReleased', ox, oy);
await sleep(900);
const orc = (await recursos()).children.find(c => c.text === 'Orçamento');
const first = (await getMap()).links[0];
assert.equal(first.to, orc.id, 'target moved');
assert.ok(first.toSide, 'arrival side saved');
await key('z', 2);
await sleep(900);
assert.notEqual((await getMap()).links[0].to, orc.id, 'undo goes back to the old target');

// link bar: colour, start/end ends, reverse, label and delete
const linkBar = (sel) => ev(`!document.querySelector('${sel}').hidden`);
const clickSel = (sel) => ev(`document.querySelector('${sel}').click()`);
const link0 = async () => (await getMap()).links[0];
await ev(`document.querySelector('#viewport .link-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
assert.equal(await linkBar('#link-toolbar'), true, 'link bar appears');
assert.equal(await visible('#toolbar'), false, 'node bar disappears');
await clickSel('#link-color-btn');
assert.equal(await linkBar('#link-colors'), true);
await clickSel('#link-colors [data-value="#e5383b"]');
await clickSel('#link-end-btn');
assert.equal(await linkBar('#link-markers'), true);
await clickSel('#link-markers [data-value="diamond"]');
await clickSel('#link-start-btn');
await clickSel('#link-markers [data-value="dot-open"]');
await sleep(900);
let l0 = await link0();
assert.deepEqual([l0.color, l0.startMarker, l0.endMarker], ['#e5383b', 'dot-open', 'diamond']);
assert.equal(await ev(`document.querySelector('#viewport path.link').getAttribute('stroke')`), '#e5383b', 'colour applied');
assert.match(await ev(`document.querySelector('#viewport path.link').getAttribute('marker-start')`), /dot-open/, 'start end drawn');
await clickSel('#link-swap');
await sleep(900);
l0 = await link0();
assert.deepEqual([l0.startMarker, l0.endMarker], ['diamond', 'dot-open'], 'reverse swaps the ends');
promptAnswer = 'depende de';
await clickSel('#link-more');
await clickSel('#link-menu [data-action="label"]');
await sleep(900);
assert.equal((await link0()).label, 'depende de', 'label saved');
assert.equal(await ev(`document.querySelector('#viewport .link-label')?.textContent`), 'depende de', 'label drawn');
const nLinks = (await getMap()).links.length;
await clickSel('#link-more');
await clickSel('#link-menu [data-action="delete"]');
await sleep(900);
assert.equal((await getMap()).links.length, nLinks - 1, 'delete the link via the menu');
assert.equal(await linkBar('#link-toolbar'), false, 'bar disappears on delete');

// style on any node: a border on an underlined node becomes an open box; a colour becomes a filled box
const timeG = `[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Time'))`;
await clickNode('Time');
await ev(`document.querySelector('#style-btn').click()`);
await tab('border');
await pick('border', 'borderColor', '#8b3fd9');
assert.equal(await ev(`(() => { const r = ${timeG}.querySelector('rect[stroke]'); return r && r.getAttribute('stroke') + ' ' + r.getAttribute('fill'); })()`), '#8b3fd9 transparent', 'border on a plain node becomes a box');
await tab('shape');
await pick('shape', 'color', '#2f5bea');
assert.equal(await ev(`${timeG}.querySelector('rect[stroke]').getAttribute('fill')`), '#2f5bea', 'colour on a plain node fills it');
await key('Escape');
await sleep(900);

// resizing: the dot at the selected node's corner changes the width; text wraps; double click returns to automatic
const timeNode = async () => (await recursos()).children.find(c => c.text.startsWith('Equipe') || c.text === 'Time');
await clickNode('Time');
await key('F2'); await typeText('Equipe do projeto e responsabilidades'); await key('Enter');
await sleep(300);
await clickNode('Equipe');
const rh = await ev(`(() => { const r = document.querySelector('#viewport .resize-handle').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const [rx0, ry0] = center(rh);
const wBefore = (await rect('Equipe')).w;
// Time is on the left side: the dot is at the outer corner (left) and dragging right narrows it
await mouse('mousePressed', rx0, ry0);
for (let i = 1; i <= 5; i++) { await mouse('mouseMoved', rx0 + 20 * i, ry0); await sleep(30); }
await mouse('mouseReleased', rx0 + 100, ry0);
await sleep(900);
const tn = await timeNode();
assert.ok(tn.width && tn.width < wBefore, `saved width is smaller (${tn.width} < ${wBefore})`);
assert.ok(await ev(`[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Equipe')).querySelectorAll('tspan').length`) > 1, 'text wraps into lines');
await ev(`document.querySelector('#viewport .resize-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await sleep(900);
assert.equal((await timeNode()).width, undefined, 'double click returns to automatic');
await key('z', 2);
await sleep(900);
assert.ok((await timeNode()).width, 'undo restores the width');
assert.equal(await ev(`!!document.querySelector('#viewport .link-handle')`), false, 'dot no longer creates a link');

// node image: the bar button opens the panel; choosing a file uploads it to the server and shows it on the node; remove takes it off
const orcNode = async () => (await recursos()).children.find(c => c.text === 'Orçamento');
await clickNode('Orçamento');
await ev(`document.querySelector('#image-btn').click()`);
assert.equal(await ev(`!document.querySelector('#image-pop').hidden`), true, 'image panel opens');
await ev(`(async () => {
  const c = document.createElement('canvas'); c.width = 40; c.height = 30;
  c.getContext('2d').fillRect(0, 0, 40, 30);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'quadro.png', { type: 'image/png' }));
  const input = document.querySelector('#image-input'); input.files = dt.files; input.dispatchEvent(new Event('change'));
})()`);
await sleep(1500);
const img = (await orcNode()).image;
assert.ok(img && /^[a-f0-9]{32}\.png$/.test(img.id), 'image saved on the node');
assert.deepEqual([img.w, img.h], [40, 30], 'natural size stored');
const href = await ev(`[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Orçamento')).querySelector('image')?.getAttribute('href')`);
assert.ok(href?.endsWith(img.id), 'image drawn on the node');
assert.equal(await ev(`fetch('${href}').then(r => r.status)`), 200, 'server serves the image');
await ev(`document.querySelector('#image-btn').click()`);
await ev(`document.querySelector('#image-remove').click()`);
await sleep(900);
assert.equal((await orcNode()).image, undefined, 'remove the image');
await key('z', 2);
await sleep(900);
assert.ok((await orcNode()).image, 'undo brings the image back');

// attachments: the 📎 button opens the list; add several; badge with a count on the node; download; remove; undo
await clickNode('Orçamento');
await ev(`document.querySelector('#attach-btn').click()`);
assert.equal(await ev(`!document.querySelector('#attach-pop').hidden`), true, 'attachments panel opens');
await ev(`(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['ata da reunião'], 'ata.txt', { type: 'text/plain' }));
  dt.items.add(new File([new Uint8Array([37, 80, 68, 70])], 'plano.pdf', { type: 'application/pdf' }));
  const input = document.querySelector('#attach-input'); input.files = dt.files; input.dispatchEvent(new Event('change'));
})()`);
await sleep(1500);
let atts = (await orcNode()).attachments;
assert.deepEqual(atts?.map(a => a.name), ['ata.txt', 'plano.pdf'], 'attachments saved');
const orcG = `[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Orçamento'))`;
assert.equal(await ev(`document.querySelector('#viewport .attach-badge[data-id="' + ${orcG}.dataset.id + '"]')?.textContent`), '2', 'badge with the number of attachments');
const links = await ev(`[...document.querySelectorAll('#attach-list a[download]')].map(a => [a.getAttribute('download'), a.getAttribute('href')])`);
assert.equal(links.length, 2, 'list with download links');
assert.equal(links[0][0], 'ata.txt');
assert.equal(await ev(`fetch('${links[0][1]}').then(r => r.headers.get('content-disposition'))`), 'attachment', 'attachment downloads as a file');
await ev(`document.querySelector('#attach-list [data-remove]').click()`);
await sleep(900);
assert.deepEqual((await orcNode()).attachments.map(a => a.name), ['plano.pdf'], 'remove the attachment');
await key('z', 2);
await sleep(900);
assert.equal((await orcNode()).attachments.length, 2, 'undo brings the attachment back');
await key('Escape');
await clickNode('Q2');
await ev(`document.querySelector('#viewport .attach-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
assert.equal(await ev(`!document.querySelector('#attach-pop').hidden`), true, 'clicking the badge opens the attachments');
assert.equal(await ev(`document.querySelectorAll('#attach-list li').length`), 2);
await key('Escape');

// comments: the 💬 button opens the panel; Enter sends; icon on the node; typing in the field does not fire shortcuts; delete; undo; Alt+Shift+C
await clickNode('Orçamento');
await ev(`document.querySelector('#comment-btn').click()`);
assert.equal(await ev(`!document.querySelector('#comment-pop').hidden`), true, 'comments panel opens');
assert.equal(await ev(`document.activeElement?.id`), 'comment-input', 'field gets focus');
await key('x');  // a letter in the field must not start editing the node
assert.equal(await ev(`document.querySelector('#editor').hidden`), true, 'map shortcuts do not fire in the field');
await ev(`document.querySelector('#comment-input').value = ''`);
await typeText('Revisar valores');
await key('Enter');
await sleep(900);
assert.deepEqual((await orcNode()).comments?.map(c => c.text), ['Revisar valores'], 'comment saved');
assert.ok((await orcNode()).comments[0].at, 'with date/time');
assert.equal(await ev(`document.querySelectorAll('#comment-list li').length`), 1, 'list shows the comment');
assert.equal(await ev(`!!${orcG}.querySelector('.comment-icon')`), true, 'comment icon on the node');
assert.equal(await ev(`document.querySelector('#comment-input').value`), '', 'field cleared after sending');
await ev(`document.querySelector('#comment-list [data-del]').click()`);
await sleep(900);
assert.equal((await orcNode()).comments, undefined, 'delete the comment');
await ev(`document.activeElement.blur()`);  // Ctrl+Z inside the field is the field's own undo
await key('z', 2);
await sleep(900);
assert.equal((await orcNode()).comments.length, 1, 'undo brings the comment back');
await ev(`document.activeElement.blur()`);
await key('Escape');
assert.equal(await ev(`document.querySelector('#comment-pop').hidden`), true);
await clickNode('Orçamento');
await key('c', 1 | 8);  // Alt+Shift+C
assert.equal(await ev(`!document.querySelector('#comment-pop').hidden`), true, 'Alt+Shift+C shortcut opens the comments');
await ev(`document.activeElement.blur()`);
await key('Escape');
await clickNode('Q2');
await ev(`${orcG}.querySelector('.comment-icon').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
assert.equal(await ev(`!document.querySelector('#comment-pop').hidden`), true, 'clicking the icon opens the comments');
await ev(`document.activeElement.blur()`);
await key('Escape');

// text style: bold, italic, size, colour; Ctrl+B toggles bold
const orcFont = () => ev(`${orcG}.querySelector('text').getAttribute('style')`);
await clickNode('Orçamento');
const wPlain = (await rect('Orçamento')).w;
await ev(`document.querySelector('#text-btn').click()`);
assert.equal(await ev(`!document.querySelector('#text-pop').hidden`), true, 'text panel opens');
await ev(`document.querySelector('#text-pop [data-toggle="textBold"]').click()`);
await ev(`document.querySelector('#text-pop [data-toggle="textItalic"]').click()`);
await ev(`document.querySelector('#text-pop [data-prop="textSize"] [data-value="large"]').click()`);
await ev(`document.querySelector('#text-pop [data-prop="textColor"] [data-value="#e5383b"]').click()`);
await sleep(900);
let on = await orcNode();
assert.deepEqual([on.textBold, on.textItalic, on.textSize, on.textColor], [true, true, 'large', '#e5383b']);
assert.match(await orcFont(), /italic 700 18px/, 'font applied');
assert.equal(await ev(`${orcG}.querySelector('text').getAttribute('fill')`), '#e5383b', 'text colour');
assert.ok((await rect('Orçamento')).w > wPlain, 'larger text widens the node');
await ev(`document.querySelector('#text-pop [data-prop="textSize"] [data-value=""]').click()`);
await sleep(900);
assert.equal((await orcNode()).textSize, null, 'Médio goes back to the default');
await key('Escape');
await clickNode('Orçamento');
await key('b', 2);
await sleep(900);
assert.equal((await orcNode()).textBold, null, 'Ctrl+B goes back to the default (not bold)');

// link (URL) on the node: http(s) only; the 🔗 icon on the node opens in a new tab; remove
await clickNode('Orçamento');
await ev(`document.querySelector('#url-btn').click()`);
assert.equal(await ev(`!document.querySelector('#url-pop').hidden`), true, 'link panel opens');
assert.equal(await ev(`document.activeElement?.id`), 'url-input', 'field gets focus');
await typeText('javascript:alert(1)');
await key('Enter');
await sleep(300);
assert.equal((await orcNode()).url, undefined, 'javascript: refused');
assert.equal(await ev(`!document.querySelector('#url-error').hidden`), true, 'shows the error');
await ev(`document.querySelector('#url-input').value = ''`);
await typeText('exemplo.com/docs');
await key('Enter');
await sleep(900);
assert.equal((await orcNode()).url, 'https://exemplo.com/docs', 'address normalised and saved');
assert.equal(await ev(`!!${orcG}.querySelector('.url-icon')`), true, 'link icon on the node');
await ev(`window.open = (u, t, f) => { window.__opened = [u, t, f]; }`);
await ev(`${orcG}.querySelector('.url-icon').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
assert.deepEqual(await ev(`window.__opened`), ['https://exemplo.com/docs', '_blank', 'noopener,noreferrer'], 'clicking opens in a new tab');
await clickNode('Orçamento');
await ev(`document.querySelector('#url-btn').click()`);
await ev(`document.querySelector('#url-remove').click()`);
await sleep(900);
assert.equal((await orcNode()).url, undefined, 'remove the link');
await ev(`document.activeElement.blur()`);
await key('Escape');

// focus mode: Ctrl+. shows only the branch; Esc leaves; "Focar neste ramo" menu; "Sair do foco" button
await clickNode('Cronograma');
await key('.', 2);
await sleep(300);
assert.equal(await ev(`!document.querySelector('#focus-bar').hidden`), true, 'focus bar appears');
const inFocus = await texts();
assert.ok(inFocus.some(t => t.startsWith('Cronograma')), 'focused branch appears');
assert.ok(!inFocus.some(t => t.startsWith('Recursos')), 'other branches disappear');
await key('Escape');
await sleep(300);
assert.equal(await ev(`document.querySelector('#focus-bar').hidden`), true, 'Esc leaves focus');
assert.ok((await texts()).some(t => t.startsWith('Recursos')), 'whole map is back');
await clickNode('Cronograma');
await ev(`document.querySelector('#more-btn').click()`);
await menu('focus');
await sleep(300);
assert.ok(!(await texts()).some(t => t.startsWith('Recursos')), '"Focar neste ramo" menu');
await key('Tab'); await typeText('Novo no foco'); await key('Enter');  // editing keeps working in focus
await sleep(900);
assert.ok((await getMap()).root.children.find(c => c.text.startsWith('Cronograma')).children.some(c => c.text === 'Novo no foco'));
await ev(`document.querySelector('#focus-exit').click()`);
await sleep(300);
assert.equal(await ev(`document.querySelector('#focus-bar').hidden`), true, 'button leaves focus');

// outline mode: editable list; Enter creates an item; Tab/Shift+Tab indents; Backspace on an empty item deletes; Esc returns to the map
const cronNode = async () => (await getMap()).root.children.find(c => c.text.startsWith('Cronograma'));
await ev(`document.querySelector('#outline-btn').click()`);
assert.equal(await ev(`!document.querySelector('#outline-view').hidden`), true, 'outline appears');
assert.equal(await ev(`getComputedStyle(document.querySelector('#canvas')).display`), 'none', 'map disappears');
const countVisible = (n) => 1 + (n.collapsed ? 0 : n.children.reduce((a, c) => a + countVisible(c), 0));
assert.equal(await ev(`document.querySelectorAll('#outline-view input').length`), countVisible((await getMap()).root), 'one line per visible node');
const q2 = (await cronNode()).children.find(c => c.text === 'Q2');
await ev(`(() => { const i = document.querySelector('#outline-view [data-id="${q2.id}"] > .row input'); i.focus(); i.setSelectionRange(99, 99); })()`);
await key('Enter');
assert.equal(await ev(`document.activeElement.value`), '', 'Enter creates an empty item with focus');
await typeText('Q3');
await key('Enter');
await key('Backspace');  // empty item: deletes and goes back to the previous one
await sleep(900);
assert.deepEqual((await cronNode()).children.map(c => c.text).filter(t => /^Q\d$/.test(t)), ['Q1', 'Q2', 'Q3'], 'Q3 created, empty one deleted');
assert.equal(await ev(`document.activeElement.value`), 'Q3', 'focus goes back to the previous item');
await key('Tab');
await sleep(900);
assert.deepEqual((await cronNode()).children.find(c => c.text === 'Q2').children.map(c => c.text), ['Q3'], 'Tab indents into Q2');
await key('Tab', 8);
await sleep(900);
assert.ok((await cronNode()).children.some(c => c.text === 'Q3'), 'Shift+Tab outdents');
await ev(`(() => { const i = document.activeElement; i.value = 'Q3 revisado'; })()`);
await key('ArrowUp');  // leaving the line confirms the text
await sleep(900);
assert.ok((await cronNode()).children.some(c => c.text === 'Q3 revisado'), 'text editing in the outline');
await key('Escape');
assert.equal(await ev(`document.querySelector('#outline-view').hidden`), true, 'Esc returns to the map');
assert.ok((await texts()).includes('Q3 revisado'), 'map shows the new item');

// export: Markdown, PNG (a real image) and PDF (browser print)
await ev(`(() => {
  window.__downloads = [];
  HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push([this.download, this.href]); };
  window.print = () => { window.__printed = true; };
})()`);
await ev(`document.querySelector('#export-btn').click()`);
assert.equal(await ev(`!document.querySelector('#export-menu').hidden`), true, 'export menu opens');
await ev(`document.querySelector('#export-menu [data-export="md"]').click()`);
await sleep(300);
let dl = await ev(`window.__downloads.at(-1)`);
assert.match(dl[0], /\.md$/, '.md file');
const md = await ev(`fetch('${dl[1]}').then(r => r.text())`);
assert.match(md, /^# Planejamento/, 'title in the Markdown');
assert.match(md, /\n- Recursos/, 'branches in the Markdown');
await ev(`document.querySelector('#export-btn').click()`);
await ev(`document.querySelector('#export-menu [data-export="png"]').click()`);
await sleep(2500);
dl = await ev(`window.__downloads.at(-1)`);
assert.match(dl[0], /\.png$/, '.png file');
const png = await ev(`fetch('${dl[1]}').then(r => r.arrayBuffer()).then(b => [b.byteLength, [...new Uint8Array(b.slice(0, 4))]])`);
assert.ok(png[0] > 5000, `PNG has content (${png[0]} bytes)`);
assert.deepEqual(png[1], [137, 80, 78, 71], 'PNG signature');
await ev(`document.querySelector('#export-btn').click()`);
await ev(`document.querySelector('#export-menu [data-export="pdf"]').click()`);
await sleep(300);
assert.equal(await ev(`window.__printed`), true, 'PDF opens the print dialog');
assert.equal(await ev(`document.querySelector('#export-menu').hidden`), true, 'menu closes');

// review M4: Esc on a freshly created node leaves no empty undo step
const q1Text = async () => (await getMap()).root.children.find(c => c.text.startsWith('Cronograma')).children[0].text;
await clickNode('Q1');
await key('F2'); await typeText('Q1 editado'); await key('Enter');
await key('Tab'); await key('Escape');  // creates and discards a child
await key('z', 2);
await sleep(900);
assert.equal(await q1Text(), 'Q1', 'the first Ctrl+Z undoes the last real change');

// review M6: starting an edit with a dead key (accent) does not lose the accent
await clickNode('Q1');
await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 });
await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 });
await typeText('á');
assert.equal(await ev(`document.querySelector('#editor').value`), 'á', 'accent goes into the edit');
await key('Escape');

// review M2: with a save error, leaving the map asks; cancelling stays on the map with the change pending
await ev(`(() => { window.__realFetch = window.fetch; window.fetch = (u, o) => (o?.method === 'PUT' ? Promise.reject(new Error('offline')) : window.__realFetch(u, o)); })()`);
await clickNode('Q1');
await key('F2'); await typeText('Q1 offline'); await key('Enter');
await sleep(900);
assert.match(await ev(`document.querySelector('#status').textContent`), /Erro ao salvar/);
dialogAccept = false;
await ev(`location.hash = '#/'`);
await sleep(500);
dialogAccept = true;
assert.equal(await ev(`document.body.dataset.view`), 'editor', 'cancel stays on the map');
assert.match(await ev(`location.hash`), /^#\/map\//, 'address goes back to the map');
assert.ok((await texts()).includes('Q1 offline'), 'change stays on screen');
await ev(`window.fetch = window.__realFetch`);
await sleep(6000);  // retry every 5 s
assert.equal(await q1Text(), 'Q1 offline', 'change saved when the network returns');

// version history: the panel lists versions; restoring the oldest brings back the initial map; Ctrl+Z returns
const recKids = async () => (await recursos()).children.map(c => c.text);
const recBefore = await recKids();
await ev(`document.querySelector('#history-btn').click()`);
await sleep(500);
assert.equal(await ev(`!document.querySelector('#history-panel').hidden`), true, 'history panel opens');
assert.ok(await ev(`document.querySelectorAll('#history-list li').length`) >= 1, 'lists versions');
dialogAccept = true;
await ev(`[...document.querySelectorAll('#history-list [data-restore]')].at(-1).click()`);  // the oldest
await sleep(1200);
assert.deepEqual(await recKids(), ['Time', 'Orçamento'], 'old version restored');
assert.equal(await ev(`document.querySelector('#history-panel').hidden`), true, 'panel closes');
await key('z', 2);
await sleep(900);
assert.deepEqual(await recKids(), recBefore, 'Ctrl+Z undoes the restore');

// show this branch as: org chart / list / map via the node's ⋯ menu
const recNow = async () => (await getMap()).root.children.find(c => c.text.startsWith('Recursos'));
const branchAs = async (v) => {
  await clickNode('Recursos');
  await ev(`document.querySelector('#more-btn').click()`);
  assert.equal(await ev(`!document.querySelector('#branch-layout-row').hidden`), true, 'option in the menu');
  await ev(`document.querySelector('#branch-layout-row [data-value="${v}"]').click()`);
  await sleep(900);
};
await branchAs('org');
assert.equal((await recNow()).branchLayout, 'org');
const recR2 = await rect('Recursos'), orcR2 = await rect('Orçamento');
assert.ok(orcR2.y > recR2.y + recR2.h - 4, 'children below the branch (org chart)');
assert.ok(await ev(`[...document.querySelectorAll('#viewport path.edge')].some(p => / C/.test(p.getAttribute('d')) && p.getAttribute('d').split(' ').length > 2)`));
await branchAs('list');
assert.equal((await recNow()).branchLayout, 'list');
await branchAs('');
assert.equal((await recNow()).branchLayout, null, 'Mapa goes back to the default');
await clickNode('Planejamento');
await ev(`document.querySelector('#more-btn').click()`);
assert.equal(await ev(`document.querySelector('#branch-layout-row').hidden`), true, 'root does not have the option');
await key('Escape');

// conflict: another "tab" saves first
await sleep(900);
const cur = await getMap();
await fetch(BASE + '/api/maps/demo', { method: 'PUT', body: JSON.stringify(cur) });
await key('F2'); await typeText('Cronograma 2026'); await key('Enter');
await sleep(900);
assert.match(await status(), /outra aba/, 'conflict detected');

// review I1: editing after the conflict keeps the close-tab warning
await key('F2'); await typeText(' depois'); await key('Enter');
assert.equal(await unloadBlocked(), true, 'beforeunload warns after the conflict');

// presentation: ▶ enters; → advances to the branch; ← goes back; Esc leaves
const nSlides = (await getMap()).root.children.length + 1;
await ev(`document.querySelector('#present-btn').click()`);
await sleep(400);
assert.equal(await ev(`document.body.classList.contains('presenting')`), true, 'enters the presentation');
assert.equal(await ev(`document.querySelector('#present-count').textContent`), `1 / ${nSlides}`);
await key('ArrowRight');
await sleep(300);
assert.equal(await ev(`document.querySelector('#present-count').textContent`), `2 / ${nSlides}`, '→ advances');
const firstBranch = (await getMap()).root.children[0].text;
const onSlide = await texts();
assert.ok(onSlide.includes(firstBranch) && !onSlide.includes((await getMap()).root.text), 'slide shows only the branch');
assert.equal(await ev(`!!document.querySelector('.selected-ring')`), false, 'no selection in the presentation');
await key('ArrowLeft');
await sleep(300);
assert.equal(await ev(`document.querySelector('#present-count').textContent`), `1 / ${nSlides}`, '← goes back');
await key('Escape');
await sleep(300);
assert.equal(await ev(`document.body.classList.contains('presenting')`), false, 'Esc leaves');

// duplicate and trash: the map menu duplicates and opens the copy; move to trash; restore; duplicate/delete from the list; delete permanently
dialogAccept = true;
const mapIds = async () => (await (await fetch(BASE + '/api/maps')).json()).map(m => m.id);
const trashIds = async () => (await (await fetch(BASE + '/api/trash')).json()).map(m => m.id);
await ev(`document.querySelector('#map-menu-btn').click()`);
assert.equal(await ev(`!document.querySelector('#map-menu').hidden`), true, 'map menu opens');
await ev(`document.querySelector('#map-menu [data-map-action="duplicate"]').click()`);
await sleep(1500);
const copyId = await ev(`location.hash.split('/').pop()`);
assert.notEqual(copyId, 'demo', 'opens the copy');
assert.match(await ev(`document.querySelector('#title').textContent`), /\(cópia\)$/);
await ev(`document.querySelector('#map-menu-btn').click()`);
await ev(`document.querySelector('#map-menu [data-map-action="trash"]').click()`);
await sleep(1200);
assert.equal(await ev(`document.body.dataset.view`), 'list', 'goes back to the list');
assert.ok(!(await mapIds()).includes(copyId) && (await trashIds()).includes(copyId), 'copy in the trash');
assert.match(await ev(`document.querySelector('#trash summary').textContent`), /Lixeira \(1\)/);
await ev(`document.querySelector('#trash').open = true`);
await ev(`document.querySelector('#trash-list [data-restore="${copyId}"]').click()`);
await sleep(800);
assert.ok((await mapIds()).includes(copyId), 'restored');
await ev(`document.querySelector('#maps [data-duplicate="demo"]').click()`);
await sleep(800);
const extra = (await mapIds()).filter(id => id !== 'demo' && id !== copyId);
assert.equal(extra.length, 1, 'duplicate via the list');
await ev(`document.querySelector('#maps [data-delete="${extra[0]}"]').click()`);
await sleep(800);
assert.ok((await trashIds()).includes(extra[0]), 'delete via the list goes to the trash');
await ev(`document.querySelector('#trash').open = true`);
await ev(`document.querySelector('#trash-list [data-purge="${extra[0]}"]').click()`);
await sleep(800);
assert.ok(!(await trashIds()).includes(extra[0]), 'delete permanently');

// boards (whiteboard): new board from the list; rename via the title; shows in the list as a board; reopens
await ev(`location.hash = '#/'`);
await sleep(800);
await ev(`document.querySelector('#new-board').click()`);
await sleep(1200);
assert.equal(await ev(`document.body.dataset.view`), 'board', 'opens the whiteboard');
const boardId = await ev(`location.hash.match(/^#\\/board\\/(.+)$/)?.[1]`);
assert.ok(boardId, 'board address');
assert.equal(await ev(`getComputedStyle(document.querySelector('#board-canvas')).display`), 'block', 'whiteboard visible');
await ev(`document.querySelector('#title').click()`);
assert.equal(await ev(`document.activeElement?.className`), 'inline-input', 'board name becomes a field at the top');
await typeText('Nome descartado');
await key('Escape');
assert.equal(await ev(`document.querySelector('#title').textContent`), 'Quadro sem título', 'Esc cancels');
await ev(`document.querySelector('#title').click()`);
await typeText('Rascunho de ideias');
await key('Enter');
await sleep(900);
const boardDoc = await (await fetch(BASE + `/api/maps/${boardId}`)).json();
assert.deepEqual([boardDoc.type, boardDoc.title, boardDoc.elements], ['board', 'Rascunho de ideias', []], 'renamed and saved');
assert.equal(await ev(`document.querySelector('#title').textContent`), 'Rascunho de ideias');
await ev(`location.hash = '#/'`);
await sleep(800);
assert.equal(await ev(`document.querySelector('#maps a[href="#/board/${boardId}"]')?.textContent`), 'Rascunho de ideias', 'board in the list');
assert.equal(await ev(`document.querySelector('#maps a[href="#/board/${boardId}"]').closest('li').classList.contains('board')`), true);
await ev(`location.hash = '#/board/${boardId}'`);
await sleep(800);
assert.equal(await ev(`document.body.dataset.view`), 'board', 'reopens the board');

// whiteboard: draw with the tools (keys 2–7), back to selection, undo/redo, zoom and panning
const boardEls = async () => (await (await fetch(BASE + `/api/maps/${boardId}`)).json()).elements;
const cv = await ev(`(() => { const r = document.querySelector('#board-canvas').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
const dragOn = async (x1, y1, x2, y2, steps = 5) => {
  await mouse('mousePressed', cv.x + x1, cv.y + y1);
  for (let i = 1; i <= steps; i++) await mouse('mouseMoved', cv.x + x1 + (x2 - x1) * i / steps, cv.y + y1 + (y2 - y1) * i / steps + (i % 2) * 3);
  await mouse('mouseReleased', cv.x + x2, cv.y + y2);
};
await key('2');
assert.equal(await ev(`document.querySelector('#board-tools [data-tool="rectangle"]').classList.contains('active')`), true, 'key 2 = rectangle');
await dragOn(350, 100, 510, 200);
await sleep(900);
let els = await boardEls();
assert.equal(els.length, 1);
assert.equal(els[0].type, 'rectangle');
assert.ok(Math.abs(els[0].w - 160) < 2 && Math.abs(els[0].h - 100) < 4, `drag size (${els[0].w}×${els[0].h})`);
assert.equal(await ev(`document.querySelector('#board-tools [data-tool="select"]').classList.contains('active')`), true, 'goes back to selection');
await key('2');
await mouse('mousePressed', cv.x + 650, cv.y + 420); await mouse('mouseReleased', cv.x + 650, cv.y + 420);
await key('4'); await dragOn(550, 100, 670, 180);
await key('3'); await dragOn(700, 100, 800, 180);
await key('5'); await dragOn(350, 260, 550, 300);
await sleep(700); await key('6'); await dragOn(350, 330, 550, 330);
await key('7'); await dragOn(600, 260, 750, 320, 10);
await sleep(900);
els = await boardEls();
assert.deepEqual(els.map(e => e.type), ['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'freedraw'], 'a click without dragging creates nothing; each tool creates its own type');
assert.ok(els[5].points.length >= 6, 'pencil keeps the stroke');
assert.equal(await ev(`document.querySelectorAll('#board-root .el').length`), 6, 'everything drawn');
await key('z', 2);
await sleep(900);
assert.equal((await boardEls()).length, 5, 'Ctrl+Z undoes');
await key('z', 2 | 8);
await sleep(900);
assert.equal((await boardEls()).length, 6, 'Ctrl+Shift+Z redoes');
await ev(`document.querySelector('#board-zoom-in').click()`);
assert.notEqual(await ev(`document.querySelector('#board-zoom').textContent`), '100%', 'zoom');
const tBefore = await ev(`document.querySelector('#board-root').getAttribute('transform')`);
await key('h');
await dragOn(900, 400, 950, 450);
assert.notEqual(await ev(`document.querySelector('#board-root').getAttribute('transform')`), tBefore, 'hand tool pans');
assert.equal((await boardEls()).length, 6, 'panning creates no elements');

// whiteboard: select, move, style panel, resize, duplicate, delete, area selection, layers
const elBox = (id) => ev(`(() => { const r = document.querySelector('#board-root .el[data-id="${id}"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const selCount = () => ev(`document.querySelectorAll('#board-root .sel-item').length`);
const click = async (x, y, mods = 0) => { await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods }); await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods }); };
const dragScreen = async (x1, y1, x2, y2) => { await mouse('mousePressed', x1, y1); for (let i = 1; i <= 4; i++) await mouse('mouseMoved', x1 + (x2 - x1) * i / 4, y1 + (y2 - y1) * i / 4); await mouse('mouseReleased', x2, y2); };
await key('v');
els = await boardEls();
const rectId = els[0].id;
let rb = await elBox(rectId);
await click(rb.x + 2, rb.y + rb.h / 2);  // left edge of the rectangle
assert.equal(await selCount(), 1, 'clicking the border selects');
assert.equal(await ev(`!document.querySelector('#board-props').hidden`), true, 'style panel appears');
await click(rb.x + rb.w / 2, rb.y + rb.h / 2);  // empty interior: drops the selection
assert.equal(await selCount(), 0, 'empty interior does not select');
await click(rb.x + 2, rb.y + rb.h / 2);
const x0 = (await boardEls())[0].x;
await dragScreen(rb.x + 2, rb.y + rb.h / 2, rb.x + 42, rb.y + rb.h / 2 + 20);
await sleep(900);
assert.ok((await boardEls()).find(e => e.id === rectId).x > x0 + 20, 'dragging moves');
await ev(`document.querySelector('#board-props [data-prop="strokeColor"] [data-value="#e03131"]').click()`);
await ev(`document.querySelector('#board-props [data-prop="backgroundColor"] [data-value="#a5d8ff"]').click()`);
await ev(`document.querySelector('#board-props [data-prop="fillStyle"] [data-value="solid"]').click()`);
await ev(`document.querySelector('#board-props [data-prop="strokeWidth"] [data-value="4"]').click()`);
await ev(`(() => { const r = document.querySelector('#board-opacity'); r.value = 50; r.dispatchEvent(new Event('change')); })()`);
await sleep(900);
let re = (await boardEls()).find(e => e.id === rectId);
assert.deepEqual([re.strokeColor, re.backgroundColor, re.fillStyle, re.strokeWidth, re.opacity], ['#e03131', '#a5d8ff', 'solid', 4, 50], 'panel applies the style');
const wBefore2 = re.w;
const hd = await ev(`(() => { const r = document.querySelector('#board-root .handle[data-handle="se"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
await dragScreen(hd[0], hd[1], hd[0] + 40, hd[1] + 30);
await sleep(900);
assert.ok((await boardEls()).find(e => e.id === rectId).w > wBefore2 + 20, 'handle resizes');
await key('d', 2);
await sleep(900);
assert.equal((await boardEls()).length, 7, 'Ctrl+D duplicates');
await key('Delete');
await sleep(900);
assert.equal((await boardEls()).length, 6, 'Delete removes the selected copy');
await key('Escape');
els = await boardEls();
const [eb, db] = [await elBox(els[1].id), await elBox(els[2].id)];  // ellipse and diamond
const pad = 15;
await dragScreen(Math.min(eb.x, db.x) - pad, Math.min(eb.y, db.y) - pad, Math.max(eb.x + eb.w, db.x + db.w) + pad, Math.max(eb.y + eb.h, db.y + db.h) + pad);
assert.equal(await selCount(), 2, 'area selection');
await key(']', 2 | 8);
await sleep(900);
assert.deepEqual((await boardEls()).slice(-2).map(e => e.id), [els[1].id, els[2].id], 'Ctrl+Shift+] brings to front');
await key('[', 2);
await sleep(900);
assert.deepEqual((await boardEls()).slice(-3, -1).map(e => e.id), [els[1].id, els[2].id], 'Ctrl+[ goes down a layer');
await ev(`document.querySelector('#board-props [data-act="forward"]').click()`);
await sleep(900);
assert.deepEqual((await boardEls()).slice(-2).map(e => e.id), [els[1].id, els[2].id], 'button goes up a layer');
await key('a', 2);
assert.equal(await selCount(), 6, 'Ctrl+A selects all');
await key('Escape');
assert.equal(await selCount(), 0, 'Esc drops the selection');

// whiteboard: text, eraser, SVG/PNG export, shortcuts
const dbl = async (x, y) => { for (const clickCount of [1, 2]) { await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount }); await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount }); } };
const nEls = (await boardEls()).length;
await key('8');
await click(cv.x + 900, cv.y + 300);
assert.equal(await ev(`!document.querySelector('#board-text').hidden`), true, 'key 8 + click opens the text');
assert.equal(await ev(`document.activeElement?.id`), 'board-text');
await typeText('Olá quadro');
await key('Escape');
await sleep(900);
let txEl = (await boardEls()).at(-1);
assert.deepEqual([txEl.type, txEl.text], ['text', 'Olá quadro'], 'text created');
assert.ok(txEl.w > 20 && txEl.h > 10, 'text measured');
assert.equal(await ev(`[...document.querySelectorAll('#board-root text')].some(t => t.textContent === 'Olá quadro')`), true, 'text drawn');
const tb = await elBox(txEl.id);
await dbl(tb.x + tb.w / 2, tb.y + tb.h / 2);
assert.equal(await ev(`document.querySelector('#board-text').value`), 'Olá quadro', 'double click edits');
await ev(`document.querySelector('#board-text').setSelectionRange(99, 99)`);
await typeText('!');
await key('Escape');
await sleep(900);
assert.equal((await boardEls()).at(-1).text, 'Olá quadro!', 'edit saved');
await dbl(cv.x + 1000, cv.y + 500);  // empty: new text
assert.equal(await ev(`!document.querySelector('#board-text').hidden`), true);
await key('Escape');  // empty: discards
await sleep(500);
assert.equal((await boardEls()).length, nEls + 1, 'empty text is not created');
const lineId = (await boardEls()).find(e => e.type === 'line').id;
await key('e');
const lb = await elBox(lineId);
await dragScreen(lb.x + lb.w / 2, lb.y - 25, lb.x + lb.w / 2, lb.y + lb.h + 25);  // crosses the line  // crosses the horizontal line at y = 330
await sleep(900);
assert.ok(!(await boardEls()).some(e => e.id === lineId), 'eraser deletes what it crosses');
assert.equal((await boardEls()).length, nEls, 'only the line went away');
await ev(`(() => { window.__downloads = []; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push([this.download, this.href]); }; })()`);
await ev(`document.querySelector('#export-btn').click()`);
assert.equal(await ev(`getComputedStyle(document.querySelector('#export-menu [data-export="md"]')).display`), 'none', 'board does not export Markdown');
await ev(`document.querySelector('#export-menu [data-export="svg"]').click()`);
await sleep(800);
let bdl = await ev(`window.__downloads.at(-1)`);
assert.match(bdl[0], /\.svg$/);
const svgText = await ev(`fetch('${bdl[1]}').then(r => r.text())`);
assert.match(svgText, /^<svg/, 'valid SVG');
assert.ok(svgText.includes('Olá quadro!') && !svgText.includes('sel-item'), 'SVG with the text and without the selection');
await ev(`document.querySelector('#export-btn').click()`);
await ev(`document.querySelector('#export-menu [data-export="png"]').click()`);
await sleep(2000);
bdl = await ev(`window.__downloads.at(-1)`);
assert.match(bdl[0], /\.png$/);
assert.deepEqual(await ev(`fetch('${bdl[1]}').then(r => r.arrayBuffer()).then(b => [...new Uint8Array(b.slice(0, 4))])`), [137, 80, 78, 71], 'board PNG');
await key('?');
assert.equal(await ev(`!document.querySelector('#board-help').hidden`), true, '? shows the shortcuts');
await key('Escape');
assert.equal(await ev(`document.querySelector('#board-help').hidden`), true);

// board: Enter breaks the line (as in a text editor) without the first line disappearing; Esc confirms; no border
await key('8');
await click(cv.x + 900, cv.y + 420);
assert.equal(await ev(`getComputedStyle(document.querySelector('#board-text')).outlineStyle`), 'none', 'no dashed border');
await typeText('Linha um');
await key('Enter');
assert.equal(await ev(`document.querySelector('#board-text').hidden`), false, 'Enter does not close');
await typeText('linha dois');
await key('Enter');
await typeText('linha três');
assert.equal(await ev(`document.querySelector('#board-text').value`), 'Linha um\nlinha dois\nlinha três', 'Enter breaks the line');
assert.equal(await ev(`document.querySelector('#board-text').scrollTop`), 0, 'first line stays visible');
for (let i = 4; i <= 7; i++) { await key('Enter'); await typeText(String(i)); }
assert.ok(await ev(`(() => { const t = document.querySelector('#board-text'); return t.scrollHeight <= t.clientHeight + 1; })()`), 'box shows all the lines');
for (let i = 0; i < 4; i++) { await key('Backspace'); await key('Backspace'); }
await key('Escape');
await sleep(900);
let lastTxt = (await boardEls()).at(-1);
assert.deepEqual([lastTxt.type, lastTxt.text], ['text', 'Linha um\nlinha dois\nlinha três'], 'Esc confirms the three lines');
assert.equal(await ev(`[...document.querySelectorAll('#board-root .el[data-id="${lastTxt.id}"] tspan')].length`), 3, 'drawn on three lines');
const lt = await elBox(lastTxt.id);
await dbl(lt.x + lt.w / 2, lt.y + 5);
await ev(`document.querySelector('#board-text').setSelectionRange(99, 99)`);
await typeText('!');
await key('Enter', 2);  // Ctrl+Enter also confirms
await sleep(900);
assert.equal((await boardEls()).at(-1).text, 'Linha um\nlinha dois\nlinha três!', 'Ctrl+Enter confirms');
// large text: the edit box fits Kalam's letters and does not scroll (before, the text "jumped" up)
await ev(`document.querySelector('#board-props [data-prop="fontSize"] [data-value="36"]').click()`);
const big = await elBox(lastTxt.id);
assert.ok(big.x > 0 && big.y + big.h < 700, 'text stays on screen');
assert.equal(await ev(`document.querySelector('#board-text').hidden`), true);
await dbl(big.x + 10, big.y + big.h / 2);
assert.equal(await ev(`document.querySelector('#board-text').value`), lastTxt.text.replace(/!?$/, '!'), 'editing the large text');
assert.ok(await ev(`(() => { const t = document.querySelector('#board-text'); return t.scrollHeight <= t.clientHeight; })()`), 'box fits the large text');
assert.equal(await ev(`(() => { const t = document.querySelector('#board-text'); t.scrollTop = 30; t.dispatchEvent(new Event('scroll')); return t.scrollTop; })()`), 0, 'box does not scroll');
await key('Escape');
await ev(`document.querySelector('#board-props [data-prop="fontSize"] [data-value="20"]').click()`);
await sleep(900);
await ev(`document.querySelector('#board-props [data-prop="textAlign"] [data-value="center"]').click()`);
await sleep(900);
assert.equal((await boardEls()).at(-1).textAlign, 'center', 'alignment saved');
assert.equal(await ev(`document.querySelector('#board-root .el[data-id="${lastTxt.id}"] text').getAttribute('text-anchor')`), 'middle', 'text centred');
const wHand = (await boardEls()).at(-1).w;
await ev(`document.querySelector('#board-props [data-prop="fontFamily"] [data-value="code"]').click()`);
await sleep(900);
const codeTxt = (await boardEls()).at(-1);
assert.equal(codeTxt.fontFamily, 'code', 'font family saved');
assert.notEqual(codeTxt.w, wHand, 'width measured again with the new font');
assert.match(await ev(`document.querySelector('#board-root .el[data-id="${lastTxt.id}"] text').getAttribute('font-family')`), /monospace/, 'text in a code font');
await ev(`document.querySelector('#board-props [data-prop="fontFamily"] [data-value="hand"]').click()`);
await ev(`(() => { window.prompt = () => 'example.com/doc'; window.__opened = []; window.open = (u) => { window.__opened.push(u); }; })()`);
await ev(`document.querySelector('#board-props [data-act="link"]').click()`);
await sleep(900);
assert.equal((await boardEls()).at(-1).link, 'https://example.com/doc', 'link saved (with https)');
const lbx = await ev(`(() => { const r = document.querySelector('#board-root .link-badge').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
await click(lbx[0], lbx[1]);
assert.deepEqual(await ev(`window.__opened`), ['https://example.com/doc'], 'clicking the icon opens the link');
await ev(`window.prompt = () => 'javascript:alert(1)'; window.alert = () => {}`);
await key('k', 2);
await sleep(900);
assert.equal((await boardEls()).at(-1).link, 'https://example.com/doc', 'invalid address does not get in');

// board: each tool shows its shortcut letter in the corner of the button
const hint = (t) => ev(`getComputedStyle(document.querySelector('#board-tools [data-tool="${t}"]'), '::after').content`);
assert.deepEqual(await Promise.all(['hand', 'select', 'rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'eraser'].map(hint)),
  ['"H"', '"V"', '"R"', '"D"', '"O"', '"A"', '"L"', '"P"', '"T"', '"E"'], 'shortcut letters on the buttons');

// board: the top menus close when clicking outside and when clicking their own button again
const shownSel = (sel) => ev(`!document.querySelector('${sel}').hidden`);
await ev(`document.querySelector('#map-menu-btn').click()`);
assert.equal(await shownSel('#map-menu'), true, 'board menu opens');
await click(cv.x + 1100, cv.y + 560);  // empty whiteboard
assert.equal(await shownSel('#map-menu'), false, 'clicking outside closes the board menu');
const mb = await ev(`(() => { const r = document.querySelector('#map-menu-btn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
await click(mb[0], mb[1]);
assert.equal(await shownSel('#map-menu'), true);
await click(mb[0], mb[1]);
assert.equal(await shownSel('#map-menu'), false, 'clicking ⋯ again closes it');
await ev(`document.querySelector('#export-btn').click()`);
await click(mb[0], mb[1]);
assert.equal(await shownSel('#export-menu'), false, 'opening a top menu closes the other');
assert.equal(await shownSel('#map-menu'), true);
await click(cv.x + 1300, cv.y + 150);  // another spot: two clicks in the same place become a double click (new text)
await key('?');
assert.equal(await shownSel('#board-help'), true);
await click(cv.x + 1100, cv.y + 560);
assert.equal(await shownSel('#board-help'), false, 'clicking outside closes the shortcuts');

// board: "more tools" menu and paint bucket
await ev(`document.querySelector('#board-more-btn').click()`);
assert.equal(await shownSel('#board-more'), true, 'more tools menu opens');
await click(cv.x + 1300, cv.y + 150);
assert.equal(await shownSel('#board-more'), false, 'clicking outside closes the more menu');
await key('2');
await dragScreen(cv.x + 1050, cv.y + 500, cv.x + 1200, cv.y + 600);
await sleep(900);
const emptyRect = (await boardEls()).at(-1);
assert.equal(emptyRect.type, 'rectangle');
await ev(`document.querySelector('#board-more-btn').click()`);
await ev(`document.querySelector('#board-more [data-tool="bucket"]').click()`);
assert.equal(await shownSel('#board-more'), false, 'choosing closes the menu');
assert.equal(await ev(`document.querySelector('#board-more-btn').classList.contains('active')`), true, '⋯ button active with the bucket');
assert.equal(await ev(`document.querySelector('#board-more-btn use').getAttribute('href')`), '#i-bucket-droplet', '⋯ shows the bucket icon');
await ev(`document.querySelector('#board-props [data-prop="backgroundColor"] [data-value="#ffec99"]').click()`);
await click(cv.x + 1125, cv.y + 550);  // empty interior of the rectangle
await sleep(900);
assert.equal((await boardEls()).find(e => e.id === emptyRect.id).backgroundColor, '#ffec99', 'bucket paints the fill');
await key('v');
await key('b');
assert.equal(await ev(`document.querySelector('#board-tools [data-tool="bucket"]').classList.contains('active')`), true, 'key B = bucket');
await key('v');

// board: lasso selection (free-form outline around the painted rectangle)
await key('q');
assert.equal(await ev(`document.querySelector('#board-more-btn use').getAttribute('href')`), '#i-lasso', 'key Q = lasso');
const loop = [[1030, 480], [1220, 480], [1220, 620], [1030, 620], [1030, 490]];
await mouse('mousePressed', cv.x + loop[0][0], cv.y + loop[0][1]);
for (const [x, y] of loop.slice(1)) await mouse('mouseMoved', cv.x + x, cv.y + y);
assert.equal(await ev(`document.querySelectorAll('#board-root path.marquee').length`), 1, 'lasso outline appears');
await mouse('mouseReleased', cv.x + 1030, cv.y + 490);
assert.equal(await selCount(), 1, 'lasso selects what lies inside');
assert.equal(await ev(`document.querySelector('#board-canvas').dataset.tool`), 'select', 'after the lasso goes back to selection');
await key('Escape');

// board: the laser pointer leaves a trail that fades and does not become an element
const nBeforeLaser = (await boardEls()).length;
await key('k');
assert.equal(await ev(`document.querySelector('#board-more-btn use').getAttribute('href')`), '#i-laser', 'key K = laser');
await mouse('mousePressed', cv.x + 700, cv.y + 560);
for (let i = 1; i <= 5; i++) await mouse('mouseMoved', cv.x + 700 + i * 30, cv.y + 560 + (i % 2) * 20);
assert.equal(await ev(`document.querySelectorAll('#board-root path.laser').length`), 1, 'laser trail appears');
await mouse('mouseReleased', cv.x + 850, cv.y + 560);
await sleep(1400);
assert.equal(await ev(`document.querySelectorAll('#board-root path.laser').length`), 0, 'trail fades on its own');
assert.equal((await boardEls()).length, nBeforeLaser, 'laser creates no elements');
await key('v');

// board: insert an image (file picker and paste), drawn, saved and embedded in the exported SVG
const pngFile = `(async () => { const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#e03131'; x.fillRect(0, 0, 80, 40);
  return new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'teste.png', { type: 'image/png' }); })()`;
const nBeforeImg = (await boardEls()).length;
await ev(`(async () => { const dt = new DataTransfer(); dt.items.add(await ${pngFile});
  const i = document.querySelector('#board-image-input'); i.files = dt.files; i.dispatchEvent(new Event('change')); })()`);
await sleep(1500);
let imgEl = (await boardEls()).at(-1);
assert.deepEqual([imgEl.type, imgEl.w, imgEl.h], ['image', 80, 40], 'image inserted at its natural size');
assert.equal((await fetch(BASE + `/api/maps/${boardId}/files/${imgEl.fileId}`)).headers.get('content-type'), 'image/png', 'file saved on the server');
assert.equal(await ev(`document.querySelectorAll('#board-root image').length`), 1, 'image drawn');
assert.equal(await selCount(), 1, 'new image stays selected');
await ev(`(async () => { const dt = new DataTransfer(); dt.items.add(await ${pngFile}); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt })); })()`);
await sleep(1500);
assert.equal((await boardEls()).length, nBeforeImg + 2, 'Ctrl+V pastes the image');
await ev(`document.querySelector('#export-btn').click()`);
await ev(`document.querySelector('#export-menu [data-export="svg"]').click()`);
await sleep(800);
const imgSvg = await ev(`fetch(window.__downloads.at(-1)[1]).then(r => r.text())`);
assert.ok(imgSvg.includes('href="data:image/png') && !imgSvg.includes('/api/maps/'), 'exported SVG with the image embedded');

// board: sticky note (N) — a click creates it already editing, text wraps at the width, double click re-edits
const nBeforeNote = (await boardEls()).length;
await key('n');
await click(cv.x + 500, cv.y + 300);
assert.equal(await ev(`document.activeElement?.id`), 'board-text', 'note opens ready to type');
assert.equal(await ev(`document.querySelectorAll('#board-root .note-bg').length`), 1, 'note appears while typing');
await typeText('Uma nota adesiva com um texto comprido que precisa quebrar sozinho dentro dela');
assert.equal(await ev(`getComputedStyle(document.querySelector('#board-text')).whiteSpace`), 'pre-wrap', 'box wraps at the note width');
await key('Escape');
await sleep(900);
const note = (await boardEls()).at(-1);
assert.deepEqual([note.type, note.w, (await boardEls()).length], ['note', 200, nBeforeNote + 1], 'note saved');
assert.ok(await ev(`document.querySelectorAll('#board-root .el[data-id="${note.id}"] tspan').length`) > 1, 'text wrapped onto several lines');
const nb = await elBox(note.id);
await dbl(nb.x + nb.w / 2, nb.y + nb.h / 2);
assert.equal(await ev(`document.querySelector('#board-text').value`), note.text, 'double click re-edits the note');
await key('Escape');

// board: clicking outside finishes the note/text without losing what was typed (before: it created another and vanished)
for (const [tool, x] of [['n', 300], ['t', 800]]) {
  const before = (await boardEls()).length;
  await key(tool);
  await click(cv.x + x, cv.y + 150);
  await typeText('123');
  await sleep(500);
  await click(cv.x + x + 250, cv.y + 450);  // outside
  await sleep(900);
  const els = await boardEls();
  assert.deepEqual([els.length, els.at(-1).text], [before + 1, '123'], `clicking outside saves (${tool})`);
  assert.equal(await ev(`document.querySelector('#board-text').hidden`), true);
}

// reloading returns to where you left off: position/zoom and selection (board and map)
await key('a', 2);
await ev(`document.querySelector('#board-zoom-in').click()`);
const boardT = await ev(`document.querySelector('#board-root').getAttribute('transform')`), boardSel = await selCount();
await sleep(900); await cmd('Page.reload'); await sleep(1500);
assert.equal(await ev(`document.querySelector('#board-root').getAttribute('transform')`), boardT, 'board comes back at the same position and zoom');
assert.equal(await selCount(), boardSel, 'board comes back with the same selection');
await ev(`location.hash = '#/map/demo'`); await sleep(800);
await ev(`document.querySelector('#zoom-in').click()`);
await clickNode('Recursos');
const mapT = await ev(`document.querySelector('#viewport').getAttribute('transform')`);
await sleep(900); await cmd('Page.reload'); await sleep(1500);
assert.equal(await ev(`document.querySelector('#viewport').getAttribute('transform')`), mapT, 'map comes back at the same position and zoom');
assert.ok((await ev(`document.querySelector('.selected-ring').parentNode.textContent`)).startsWith('Recursos'), 'map comes back with the same node selected');

// folders: create, enter, subfolder, a new document is created in the folder, going back lands in the folder, rename, delete (contents move up)
const tree = async () => (await fetch(BASE + '/api/folders')).json();
const listNames = () => ev(`[...document.querySelectorAll('#maps li > a')].map(a => a.textContent)`);
await ev(`location.hash = '#/'`); await sleep(800);
await ev(`window.prompt = () => 'Trabalho'; document.querySelector('#new-folder').click()`); await sleep(800);
const work = (await tree()).folders.find(f => f.name === 'Trabalho');
assert.ok(work && work.parent === null, 'folder created at Home');
assert.ok((await listNames()).includes('Trabalho'), 'folder appears in the list');
await ev(`document.querySelector('#maps li.folder a').click()`); await sleep(800);
assert.equal(await ev(`location.hash`), `#/folder/${work.id}`, 'enters the folder');
assert.equal(await ev(`document.querySelector('#empty').textContent`), 'Pasta vazia.');
await ev(`window.prompt = () => 'Clientes'; document.querySelector('#new-folder').click()`); await sleep(800);
const cli = (await tree()).folders.find(f => f.name === 'Clientes');
assert.equal(cli.parent, work.id, 'subfolder inside Trabalho');
await ev(`location.hash = '#/folder/${cli.id}'`); await sleep(800);
assert.equal(await ev(`document.querySelector('#list-title').textContent`), 'Meus mapas›Trabalho›Clientes', 'breadcrumb');
await ev(`document.querySelector('#new-map').click()`); await sleep(1200);
const newMapId = await ev(`location.hash.match(/^#\\/map\\/(.+)$/)?.[1]`);
assert.equal((await tree()).place[newMapId], cli.id, 'new map is created in the open folder');
assert.equal(await ev(`document.querySelector('.brand').getAttribute('href')`), `#/folder/${cli.id}`, 'going back leads to the map folder');
await ev(`document.querySelector('.brand').click()`); await sleep(800);
assert.equal((await listNames()).length, 1, 'map listed inside the folder');
await ev(`location.hash = '#/folder/${work.id}'`); await sleep(800);
await ev(`window.prompt = () => 'Clientes VIP'; document.querySelector('#maps li.folder [data-rename-folder]').click()`); await sleep(800);
assert.equal((await tree()).folders.find(f => f.id === cli.id).name, 'Clientes VIP', 'renames');
await ev(`location.hash = '#/'`); await sleep(800);
const rootDocs = (await listNames()).length;
await ev(`window.confirm = () => true; [...document.querySelectorAll('#maps li.folder')].find(li => li.textContent.startsWith('Trabalho')).querySelector('[data-delete-folder]').click()`); await sleep(800);
const t2 = await tree();
assert.ok(!t2.folders.some(f => f.id === work.id), 'folder deleted');
assert.equal(t2.folders.find(f => f.id === cli.id).parent, null, 'subfolder moves up to Home');
assert.equal(t2.place[newMapId], cli.id, 'map stays in the subfolder');
assert.equal((await listNames()).length, rootDocs, 'Clientes VIP in place of Trabalho');

// folders: move via the menu and by dragging; a folder does not enter itself
const vip = (await tree()).folders.find(f => f.name === 'Clientes VIP');
const rootDocId = await ev(`document.querySelector('#maps li:not(.folder)').dataset.drag.split(':')[1]`);
await ev(`document.querySelector('#maps li:not(.folder) [data-move-doc]').click()`);
assert.equal(await shownSel('#move-menu'), true, 'Move to menu opens');
assert.equal(await ev(`document.querySelector('#move-menu [data-to=""]').disabled`), true, 'current folder disabled');
await ev(`document.querySelector('#move-menu [data-to="${vip.id}"]').click()`); await sleep(800);
assert.equal((await tree()).place[rootDocId], vip.id, 'menu moves the document');
assert.equal(await shownSel('#move-menu'), false);
await ev(`document.querySelector('#maps li.folder [data-move-folder]').click()`);
assert.equal(await ev(`document.querySelector('#move-menu [data-to="${vip.id}"]').disabled`), true, 'a folder cannot go into itself');
await key('Escape');
await ev(`window.prompt = () => 'Destino'; document.querySelector('#new-folder').click()`); await sleep(800);
const dest = (await tree()).folders.find(f => f.name === 'Destino');
await ev(`(() => { const dt = new DataTransfer();
  const src = [...document.querySelectorAll('#maps li.folder')].find(li => li.textContent.startsWith('Clientes VIP'));
  const dst = [...document.querySelectorAll('#maps li.folder')].find(li => li.textContent.startsWith('Destino'));
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); })()`);
await sleep(800);
assert.equal((await tree()).folders.find(f => f.id === vip.id).parent, dest.id, 'dragging a folder onto a folder moves it');
await ev(`location.hash = '#/folder/${vip.id}'`); await sleep(800);
await ev(`(() => { const dt = new DataTransfer();
  document.querySelector('#maps li:not(.folder)').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  const home = document.querySelector('#list-title a[data-drop=""]');
  home.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  home.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); })()`);
await sleep(800);
assert.equal(Object.values((await tree()).place).filter(v => v === vip.id).length, 1, 'dropping on the breadcrumb takes the document to Home');

// folders: clicking the open folder's name (title) edits it in place; Esc cancels, Enter saves
await ev(`location.hash = '#/folder/${dest.id}'`); await sleep(800);
await ev(`document.querySelector('#list-title .crumb-current').click()`);
assert.equal(await ev(`document.activeElement?.className`), 'inline-input', 'name becomes an edit field');
await typeText('Rascunho');
await key('Escape'); await sleep(800);
assert.equal((await tree()).folders.find(f => f.id === dest.id).name, 'Destino', 'Esc cancels');
await ev(`document.querySelector('#list-title .crumb-current').click()`);
await typeText('Projetos');
await key('Enter'); await sleep(800);
assert.equal((await tree()).folders.find(f => f.id === dest.id).name, 'Projetos', 'Enter saves the new name');
assert.equal(await ev(`document.querySelector('#list-title .crumb-current').textContent`), 'Projetos');

// map: clicking the name at the top edits it in place (it is the central node's text)
await ev(`location.hash = '#/map/demo'`); await sleep(800);
await ev(`document.querySelector('#title').click()`);
await typeText('Planejamento 2027');
await key('Enter'); await sleep(900);
assert.equal((await getMap()).root.text, 'Planejamento 2027', 'map name saved');
assert.equal(await ev(`document.querySelector('#title').textContent`), 'Planejamento 2027');

// system clipboard (copy/paste events): the map copies a branch as an indented list; pasted text becomes topics
const clipEvent = (type, data = {}) => ev(`(() => { const dt = new DataTransfer();
  for (const [k, v] of Object.entries(${JSON.stringify(data)})) dt.setData(k, v);
  const e = new ClipboardEvent('${type}', { clipboardData: dt, bubbles: true, cancelable: true });
  document.dispatchEvent(e);
  return { prevented: e.defaultPrevented, types: [...dt.types], text: dt.getData('text/plain'), json: dt.getData('application/x-brainstorm-board') || dt.getData('application/x-brainstorm-branch') }; })()`);
await clickNode('Planejamento 2027');
const mcopy = await clipEvent('copy');
assert.ok(mcopy.prevented && mcopy.json && mcopy.text.startsWith('Planejamento 2027\n  '), 'copy branch: Brainstorm + indented list');
const kidsBefore = (await getMap()).root.children.length;
await clipEvent('paste', { 'text/plain': 'Ideia A\n  Detalhe A1\nIdeia B' });
await sleep(900);
const rootKids = (await getMap()).root.children;
assert.equal(rootKids.length, kidsBefore + 2, 'pasted text becomes topics');
assert.deepEqual(rootKids.find(c => c.text === 'Ideia A').children.map(c => c.text), ['Detalhe A1'], 'indent becomes child');
await clipEvent('paste', { 'application/x-brainstorm-branch': '{"text": 1}' });
await sleep(500);
assert.equal((await getMap()).root.children.length, kidsBefore + 2, 'invalid branch is ignored');

// board: copy elements to the system and paste (also after a reload); outside text becomes text
await ev(`location.hash = '#/board/${boardId}'`); await sleep(1200);
await key('a', 2);
const nSel = await selCount(), nBoard = (await boardEls()).length;
const bcopy = await clipEvent('copy');
assert.ok(bcopy.prevented && JSON.parse(bcopy.json).length === nSel, 'copy elements to the system');
await cmd('Page.reload'); await sleep(1500);
await clipEvent('paste', { 'application/x-brainstorm-board': bcopy.json });
await sleep(900);
assert.equal((await boardEls()).length, nBoard + nSel, 'paste after a reload');
await clipEvent('paste', { 'text/plain': 'Texto colado' });
await sleep(900);
assert.deepEqual([(await boardEls()).at(-1).type, (await boardEls()).at(-1).text], ['text', 'Texto colado'], 'outside text becomes text');
await clipEvent('paste', { 'application/x-brainstorm-board': '[{"type":"script","x":0,"y":0}]' });
await sleep(500);
assert.equal((await boardEls()).length, nBoard + nSel + 1, 'unknown element is ignored');

// Ctrl+X cuts: in the system (cut event) and by the key (internal copy); paste restores
const nCut = (await boardEls()).length, cutId = (await boardEls()).at(-1).id;
await key('a', 2);
await key('Escape');
const lastBox = await elBox(cutId);
await click(lastBox.x + lastBox.w / 2, lastBox.y + lastBox.h / 2);
const bcut = await clipEvent('cut');
await sleep(900);
assert.ok(bcut.prevented && JSON.parse(bcut.json)[0].id === cutId, 'cut copies to the system');
assert.equal((await boardEls()).length, nCut - 1, 'cut deletes');
await clipEvent('paste', { 'application/x-brainstorm-board': bcut.json });
await sleep(900);
assert.equal((await boardEls()).length, nCut, 'paste brings back what was cut');
await key('x', 2);
await sleep(900);
assert.equal((await boardEls()).length, nCut - 1, 'Ctrl+X by key also cuts');
await ev(`location.hash = '#/map/demo'`); await sleep(1000);
await clickNode('Ideia B');
await clipEvent('cut');
await sleep(900);
assert.ok(!(await getMap()).root.children.some(c => c.text === 'Ideia B'), 'map: cut deletes the branch');

// pasting into another document brings the files along (board image; node image and attachment)
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upTo = async (doc, name) => (await (await fetch(BASE + `/api/maps/${doc}/files`, { method: 'POST', headers: { 'X-Filename': name }, body: pngBytes })).json()).id;
const elBase = { strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'hachure', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, seed: 1 };
await fetch(BASE + '/api/maps/qa', { method: 'PUT', body: JSON.stringify({ version: 0, type: 'board', title: 'QA', elements: [] }) });
await fetch(BASE + '/api/maps/qb', { method: 'PUT', body: JSON.stringify({ version: 0, type: 'board', title: 'QB', elements: [] }) });
const qaFile = await upTo('qa', 'a.png');
await fetch(BASE + '/api/maps/qa', { method: 'PUT', body: JSON.stringify({ version: 1, type: 'board', title: 'QA', elements: [{ ...elBase, id: 'img1', type: 'image', x: 300, y: 200, w: 80, h: 80, fileId: qaFile }] }) });
await ev(`location.hash = '#/board/qa'`); await sleep(1200);
await key('a', 2);
const qcopy = await clipEvent('copy');
await ev(`location.hash = '#/board/qb'`); await sleep(1200);
await clipEvent('paste', { 'application/x-brainstorm-board': qcopy.json });
await sleep(1200);
const qbImg = (await (await fetch(BASE + '/api/maps/qb')).json()).elements[0];
assert.ok(qbImg && qbImg.fileId !== qaFile && !('fileSrc' in qbImg), 'pasted image gets its own file in the other board');
assert.equal((await fetch(BASE + `/api/maps/qb/files/${qbImg.fileId}`)).status, 200, 'file exists in the destination board');
await fetch(BASE + '/api/maps/ma', { method: 'PUT', body: JSON.stringify({ version: 0, root: { id: 'ra', text: 'Origem', children: [] } }) });
const maImg = await upTo('ma', 'n.png'), maAtt = await upTo('ma', 'doc.png');
await fetch(BASE + '/api/maps/ma', { method: 'PUT', body: JSON.stringify({ version: 1, root: { id: 'ra', text: 'Origem', children: [
  { id: 'na', text: 'Com arquivos', side: 'right', children: [], image: { id: maImg, w: 1, h: 1 }, attachments: [{ id: maAtt, name: 'doc.png', size: 70 }] }] } }) });
await ev(`location.hash = '#/map/ma'`); await sleep(1200);
await clickNode('Com arquivos');
const mcopy2 = await clipEvent('copy');
await ev(`location.hash = '#/map/demo'`); await sleep(1200);
await clickNode('Planejamento 2027');
await clipEvent('paste', { 'application/x-brainstorm-branch': mcopy2.json });
await sleep(1500);
const pasted = (await getMap()).root.children.find(c => c.text === 'Com arquivos');
assert.ok(pasted && pasted.image.id !== maImg && pasted.attachments[0].id !== maAtt && !('src' in pasted), 'pasted branch gets its own files');
assert.equal((await fetch(BASE + `/api/maps/demo/files/${pasted.attachments[0].id}`)).status, 200, 'attachment exists in the destination map');

// text does not shift on entering edit mode: first ink line equal (±1 px) in the drawing and in the box
const inkTop = async (b) => {
  const shotData = (await cmd('Page.captureScreenshot', { clip: { x: b.x - 10, y: b.y - 10, width: b.w + 20, height: b.h + 20, scale: 1 } })).result.data;
  return ev(`(async () => { const im = new Image(); im.src = 'data:image/png;base64,${shotData}'; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const p = (y * c.width + x) * 4; if (Math.max(d[p], d[p + 1], d[p + 2]) < 80) return y; }
    return -1; })()`);
};
await ev(`location.hash = '#/board/qb'`); await sleep(1200);
for (const fam of ['hand', 'normal', 'code']) {
  await key('8');
  await click(cv.x + 700, cv.y + 420);
  await typeText('casasdasdasda');
  await key('Escape');
  await ev(`document.querySelector('#board-props [data-prop="fontSize"] [data-value="36"]').click()`);
  await ev(`document.querySelector('#board-props [data-prop="fontFamily"] [data-value="${fam}"]').click()`);
  await sleep(300);
  await click(cv.x + 1250, cv.y + 120);  // drops the selection (without the frame in the snapshot)
  await sleep(500);
  const tid = (await ev(`[...document.querySelectorAll('#board-root .el')].at(-1).dataset.id`));
  const tb = await elBox(tid);
  const viewTop = await inkTop(tb);
  await dbl(tb.x + tb.w / 2, tb.y + tb.h / 2);
  await ev(`document.querySelector('#board-text').style.caretColor = 'transparent'`);
  const editTop = await inkTop(tb);
  assert.ok(viewTop >= 0 && Math.abs(editTop - viewTop) <= 1, `text (${fam}) stays in place when editing: ${viewTop} vs ${editTop}`);
  await key('Escape');
  await key('Delete');
  await sleep(300);
}

// when editing an existing text, the dashed frame follows the added/deleted characters
await key('8');
await click(cv.x + 700, cv.y + 420);
await typeText('casas');
await key('Escape');
await sleep(300);
const etId = await ev(`[...document.querySelectorAll('#board-root .el')].at(-1).dataset.id`);
const selW = () => ev(`document.querySelector('#board-root .sel-item').getBoundingClientRect().width`);
const ebx = await elBox(etId), w0 = await selW();
await dbl(ebx.x + ebx.w / 2, ebx.y + ebx.h / 2);
await ev(`document.querySelector('#board-text').setSelectionRange(99, 99)`);
await typeText(' da mãe joana');
const w1 = await selW();
assert.ok(w1 > w0 + 50, `frame grows while typing: ${w0} → ${w1}`);
for (let i = 0; i < 9; i++) await key('Backspace');
assert.ok(await selW() < w1 - 30, 'frame shrinks on delete');
const selH = () => ev(`document.querySelector('#board-root .sel-item').getBoundingClientRect().height`);
const h0 = await selH();
await key('Enter');
assert.ok(await selH() > h0 + 15, 'frame grows with Enter');
await typeText('linha 2');
await key('Escape');

// list: search across all folders (accent/case-insensitive) and remembered sort order
await ev(`location.hash = '#/'`); await sleep(1000);
await ev(`document.querySelector('#search').focus()`);
await typeText('clientes vip');
await sleep(300);
assert.deepEqual(await ev(`[...document.querySelectorAll('#maps li')].map(li => [li.classList.contains('folder'), li.querySelector('a').firstChild.nextSibling.textContent, li.querySelector('.where')?.textContent])`),
  [[true, 'Clientes VIP', 'Meus mapas › Projetos']], 'search finds the subfolder and shows where it is');
await key('Escape');
assert.equal(await ev(`document.querySelector('#search').value`), '', 'Esc clears the search');
assert.equal(await ev(`document.querySelectorAll('#maps .where').length`), 0, 'without a search, goes back to the folder list');
const folderOrder = () => ev(`[...document.querySelectorAll('#maps li.folder > a')].map(a => a.textContent)`);
await ev(`(() => { const s = document.querySelector('#sort'); s.value = 'za'; s.dispatchEvent(new Event('change')); })()`);
const za = await folderOrder();
assert.deepEqual(za, [...za].sort((a, b) => b.localeCompare(a, 'pt-BR')), 'Nome (Z–A)');
await cmd('Page.reload'); await sleep(1500);
assert.equal(await ev(`document.querySelector('#sort').value`), 'za', 'sort order remembered after a reload');
await ev(`(() => { const s = document.querySelector('#sort'); s.value = 'recent'; s.dispatchEvent(new Event('change')); })()`);

// search also in the trash (by name), even inside a folder
await fetch(BASE + '/api/maps/lixo-teste', { method: 'PUT', body: JSON.stringify({ version: 0, type: 'board', title: 'Lixo de teste', elements: [] }) });
await fetch(BASE + '/api/maps/lixo-teste', { method: 'DELETE' });
await ev(`location.hash = '#/folder/${dest.id}'`); await sleep(1000);
await ev(`document.querySelector('#search').focus()`);
await typeText('lixo de');
await sleep(300);
assert.equal(await shownSel('#trash'), true, 'trash appears in the search');
assert.equal(await ev(`document.querySelector('#trash').open`), true, 'open');
assert.deepEqual(await ev(`[...document.querySelectorAll('#trash-list li span')].map(s => s.textContent)`), ['Lixo de teste'], 'only what matches the search');
assert.equal(await shownSel('#empty'), false, 'no "nothing found" when only the trash has results');
await key('Escape');
assert.equal(await shownSel('#trash'), false, 'without a search, inside the folder, the trash disappears');

// deleting a map/board asks first; cancelling does not delete
await fetch(BASE + '/api/maps/pergunta', { method: 'PUT', body: JSON.stringify({ version: 0, type: 'board', title: 'Pergunta', elements: [] }) });
await ev(`location.hash = '#/'`); await sleep(1000);
await ev(`window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return false; }; document.querySelector('#maps [data-delete="pergunta"]').click()`); await sleep(600);
assert.match(await ev(`window.__asked[0]`), /^Apagar o quadro "Pergunta"\?/, 'prompt with the name');
assert.equal((await fetch(BASE + '/api/maps/pergunta')).status, 200, 'cancel does not delete');
await ev(`window.confirm = () => true; document.querySelector('#maps [data-delete="pergunta"]').click()`); await sleep(800);
assert.equal((await fetch(BASE + '/api/maps/pergunta')).status, 404, 'confirming deletes (goes to the trash)');

// forged pastes (another site can put anything on the clipboard): nothing breaks the drawing,
// nothing invalid is saved and the document stays editable
await fetch(BASE + '/api/maps/secb', { method: 'PUT', body: JSON.stringify({ version: 0, type: 'board', title: 'Seguro', elements: [{ ...elBase, id: 'ok1', type: 'rectangle', x: 300, y: 200, w: 80, h: 60 }] }) });
const secEls = async () => (await (await fetch(BASE + '/api/maps/secb')).json()).elements;
const secDom = () => ev(`document.querySelectorAll('#board-root .el').length`);
await ev(`location.hash = '#/board/secb'`); await sleep(1200);
for (const bad of ['[{"id":"1","type":"text","x":0,"y":0}]', '[{"id":"1","type":"arrow","x":0,"y":0}]', JSON.stringify([{ id: '1', type: 'text', x: 0, y: 0, text: 'a'.repeat(1000001) }])]) {
  await clipEvent('paste', { 'application/x-brainstorm-board': bad });
  await sleep(700);
  assert.deepEqual([(await secEls()).length, await secDom()], [1, 1], 'colagem forjada recusada: ' + bad.slice(0, 40));
}
await clipEvent('paste', { 'application/x-brainstorm-board': '[{"id":"1","type":"rectangle","x":0,"y":0,"link":5}]' });
await sleep(900);
const secPasted = (await secEls()).at(-1);
assert.deepEqual([(await secEls()).length, await secDom(), secPasted.type, 'link' in secPasted], [2, 2, 'rectangle', false], 'invalid link is dropped and the rest is pasted');
await key('ArrowRight');
await sleep(900);
assert.equal((await secEls()).at(-1).x, secPasted.x + 1, 'board keeps saving after the forged pastes');

await fetch(BASE + '/api/maps/secm', { method: 'PUT', body: JSON.stringify({ version: 0, layout: 'map', root: { id: 'sr', text: 'Seguro', children: [] } }) });
const secMap = async () => (await (await fetch(BASE + '/api/maps/secm')).json()).root;
const secNodes = () => ev(`document.querySelectorAll('#viewport .node').length`);
await ev(`location.hash = '#/map/secm'`); await sleep(1200);
await clipEvent('paste', { 'application/x-brainstorm-branch': '{"text":"a","children":[{"text":"b","children":[],"shape":"rect","color":5}]}' });
await sleep(900);
const secA = (await secMap()).children[0];
assert.deepEqual([secA.text, secA.children[0].text, secA.children[0].shape, 'color' in secA.children[0]], ['a', 'b', 'rect', false], 'invalid colour is dropped from the pasted branch');
assert.equal(await secNodes(), 3, 'map is still drawn after the forged paste');
await clickNode('Seguro');
await clipEvent('paste', { 'application/x-brainstorm-branch': '{"text":"cor","children":[],"borderColor":"url(https://attacker.example/p.gif)","lineColor":"#e5383b"}' });
await sleep(900);
const secCor = (await secMap()).children.find(c => c.text === 'cor');
assert.deepEqual(['borderColor' in secCor, secCor.lineColor], [false, '#e5383b'], 'url(...) colour is not stored; the hexadecimal one stays');
await clickNode('cor');
await ev(`document.querySelector('#style-btn').click()`);
assert.equal(await ev(`document.querySelectorAll('#style-pop [style*="url("], #viewport [stroke*="url(h"], #viewport [fill*="url(h"]').length`), 0, 'no url(...) colour reaches the panel or the drawing');
await clipEvent('paste', { 'application/x-brainstorm-branch': JSON.stringify({ text: 'x'.repeat(1000001), children: [] }) });
await sleep(700);
assert.equal(await secNodes(), 4, 'branch too large is refused');
await key('Escape');
await key('Tab');
await typeText('depois');
await key('Enter');
await sleep(900);
assert.ok((await secMap()).children.find(c => c.text === 'cor').children.some(c => c.text === 'depois'), 'map keeps saving after the forged pastes');

// language selector: the choice is stored, the page reloads and the texts come from the language's dictionary
await ev(`location.hash = '#/'`); await sleep(800);
assert.deepEqual(await ev(`[...document.querySelectorAll('#lang option')].map(o => o.textContent)`), ['Português (Brasil)', 'English', 'Español', '日本語']);
assert.equal(await ev(`document.querySelector('#lang').title`), 'Idioma');
const pickLang = async (code) => {
  await ev(`(() => { window.sameDocument = true; const s = document.querySelector('#lang'); s.value = '${code}'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(1500);
  return ev(`[window.sameDocument ?? 'reloaded', localStorage.getItem('brainstorm:lang'), document.querySelector('#lang').value, document.documentElement.lang]`);
};
const uiTexts = () => ev(`[document.querySelector('#new-map').textContent, document.querySelector('#search').placeholder, document.querySelector('#logout-btn').title, document.querySelector('#trash summary').textContent.replace(/\\d+/, '{n}')]`);
for (const code of ['en', 'es', 'ja']) {
  const d = (await import(new URL(`../static/locales/${code}.js`, import.meta.url))).default;
  assert.deepEqual(await pickLang(code), ['reloaded', code, code, code], `choosing ${code} stores the choice and reloads`);
  assert.deepEqual(await uiTexts(), [d['list.newMap'], d['list.searchPlaceholder'], d['topbar.logout'], d['trash.title']], `interface in ${code} (HTML and JS-built texts)`);
}
assert.deepEqual(await pickLang('pt-BR'), ['reloaded', 'pt-BR', 'pt-BR', 'pt-BR'], 'back to Portuguese');

// Maps / Boards menus at the top: open and close, list only that kind (from all folders) and create a new one
await ev(`location.hash = '#/'`); await sleep(800);
await ev(`document.querySelector('#boards-menu-btn').click()`);
assert.equal(await shownSel('#boards-menu'), true, 'Quadros menu opens');
await ev(`document.querySelector('#maps-menu-btn').click()`);
assert.deepEqual([await shownSel('#boards-menu'), await shownSel('#maps-menu')], [false, true], 'opening one menu closes the other');
await ev(`document.querySelector('#maps-menu-btn').click()`);
assert.equal(await shownSel('#maps-menu'), false, 'clicking again closes it');
const docsOf = async (board) => (await (await fetch(BASE + '/api/maps')).json()).filter(m => (m.type === 'board') === board).length;
await ev(`document.querySelector('#boards-menu-btn').click(); document.querySelector('#list-boards').click()`); await sleep(1000);
assert.equal(await ev(`location.hash`), '#/boards');
assert.equal(await shownSel('#boards-menu'), false, 'choosing an item closes the menu');
const nBoards = await docsOf(true);
assert.deepEqual(await ev(`[document.querySelectorAll('#maps li').length, document.querySelectorAll('#maps li.board').length, document.querySelectorAll('#maps li .where').length]`),
  [nBoards, nBoards, nBoards], 'List boards: only boards, from all folders, with the location of each');
assert.equal(await ev(`document.querySelector('#list-title').textContent`), 'Meus mapas›Quadros', 'breadcrumb shows the listed type');
await ev(`document.querySelector('#maps-menu-btn').click(); document.querySelector('#list-maps').click()`); await sleep(1000);
const nMaps = await docsOf(false);
assert.deepEqual(await ev(`[document.querySelectorAll('#maps li').length, document.querySelectorAll('#maps li.board').length]`), [nMaps, 0], 'List maps: only maps');
await ev(`location.hash = '#/map/demo'`); await sleep(1000);
assert.equal(await ev(`getComputedStyle(document.querySelector('#boards-menu-btn')).display !== 'none'`), true, 'menus in the editor too');
await ev(`document.querySelector('#maps-menu-btn').click(); document.querySelector('#new-map').click()`); await sleep(1500);
assert.match(await ev(`location.hash`), /^#\/map\/[a-z0-9-]+$/, 'New map via the menu opens the new map');
assert.equal(await docsOf(false), nMaps + 1, 'map created');

// skills: create, type with preview, tag, search, named version, compare, restore, listing and stored mode
await ev(`location.hash = '#/'`); await sleep(800);
const skillDocs = async () => (await (await fetch(BASE + '/api/maps')).json()).filter(m => m.type === 'skill');
const nSkills0 = (await skillDocs()).length;
await ev(`document.querySelector('#skills-menu-btn').click(); document.querySelector('#new-skill').click()`); await sleep(1500);
assert.match(await ev(`location.hash`), /^#\/skill\/[a-z0-9-]+$/, 'New skill opens the skill');
const skId = (await ev(`location.hash`)).split('/').pop();
assert.equal((await skillDocs()).length, nSkills0 + 1, 'skill created');
assert.equal(await ev(`document.querySelector('#skill-text').value`), '# Skill sem título\n\n## Quando usar\n\n## Instruções\n', 'skeleton is the pt-BR template');
const getSkill = async () => (await fetch(BASE + '/api/maps/' + skId)).json();
const skType = (v) => ev(`(() => { const t = document.querySelector('#skill-text'); t.value = ${JSON.stringify(v)}; t.dispatchEvent(new Event('input')); })()`);
await skType('**oi**'); await sleep(500);
assert.match(await ev(`document.querySelector('#skill-preview').innerHTML`), /<strong>oi<\/strong>/, 'preview renders bold');
await ev(`(() => { const i = document.querySelector('#skill-tag-input'); i.value = 'teste'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
assert.deepEqual(await ev(`[...document.querySelectorAll('#skill-tag-list .skill-tag')].map(c => c.firstChild.textContent)`), ['teste'], 'tag chip appears');
await sleep(1500);
assert.deepEqual((await (await fetch(BASE + '/api/maps')).json()).find(m => m.id === skId).tags, ['teste'], 'tag saved on the server');
promptAnswer = 'v1';
await ev(`document.querySelector('#skill-save-version').click()`); await sleep(1000);
await ev(`document.querySelector('#skill-versions-btn').click()`); await sleep(800);
assert.equal(await ev(`[...document.querySelectorAll('#skill-version-list li strong')].some(s => s.textContent === 'v1')`), true, 'named version appears in bold');
await skType('**oi**\n\nnovo parágrafo'); await sleep(1500);
await ev(`(() => { const i = document.querySelector('#skill-tag-input'); i.value = 'extra'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`); await sleep(1500);
assert.deepEqual((await getSkill()).tags, ['teste', 'extra'], 'current tags differ from v1');
const v1Btn = `[...document.querySelectorAll('#skill-version-list li')].find(li => li.querySelector('strong').textContent === 'v1')`;
await ev(`${v1Btn}.querySelector('[data-compare]').click()`); await sleep(800);
assert.ok(await ev(`document.querySelectorAll('#skill-diff-lines .diff-line.add').length`) > 0, 'compare shows an added line');
dialogAccept = true;
await ev(`${v1Btn}.querySelector('[data-restore]').click()`); await sleep(1500);
assert.equal(await ev(`document.querySelector('#skill-text').value`), '**oi**', 'restore brings back the version text');
const restored = await getSkill();
assert.equal(restored.content, '**oi**', 'server received the restored text');
assert.deepEqual(restored.tags, ['teste'], 'server received the restored tags');
const hist = await (await fetch(BASE + '/api/maps/' + skId + '/history')).json();
assert.ok((await Promise.all(hist.map(h => fetch(BASE + '/api/maps/' + skId + '/history/' + h.version).then(r => r.json())))).some(b => b.content === '**oi**\n\nnovo parágrafo'), 'text from before the restore stayed in the history');
await ev(`document.querySelector('.skill-modes [data-mode="preview"]').click()`); await sleep(300);
assert.equal(await ev(`getComputedStyle(document.querySelector('#skill-text')).display`), 'none', 'Preview mode hides the textarea');
await ev(`location.hash = '#/'`); await sleep(500);
await ev(`location.reload()`); await sleep(2000);
await ev(`location.hash = '#/skill/${skId}'`); await sleep(1200);
assert.deepEqual(await ev(`[document.querySelector('#skill-view').dataset.mode, getComputedStyle(document.querySelector('#skill-text')).display]`), ['preview', 'none'], 'Preview mode persists after a reload');
await ev(`document.querySelector('.skill-modes [data-mode="split"]').click()`);
await ev(`location.hash = '#/skills'`); await sleep(1000);
const nSk = (await skillDocs()).length;
assert.deepEqual(await ev(`[document.querySelectorAll('#maps li').length, document.querySelectorAll('#maps li.skill').length]`), [nSk, nSk], 'List skills: only skills');
await ev(`(() => { const s = document.querySelector('#search'); s.value = 'teste'; s.dispatchEvent(new Event('input')); })()`); await sleep(600);
assert.ok(await ev(`document.querySelectorAll('#maps li.skill').length`) >= 1, 'searching the tag finds the skill');
assert.ok((await ev(`[...document.querySelectorAll('#maps li.skill a')].map(a => a.getAttribute('href'))`)).includes('#/skill/' + skId), 'the item found is the skill created');
await ev(`(() => { const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input')); })()`);

// settings: the menu opens both screens; saving the key shows only the mask; the Wasabi region fills the endpoint;
// the storage secret does not come back (closed local endpoint: nothing goes out to the internet)
await ev(`location.hash = '#/'`); await sleep(500);
await ev(`document.querySelector('#settings-menu-btn').click(); document.querySelector('#settings-llm-btn').click()`); await sleep(1000);
assert.deepEqual(await ev(`[location.hash, document.body.dataset.view, document.querySelector('#settings-llm').hidden, document.querySelector('#settings-backup').hidden, document.querySelector('#settings-menu').hidden, document.querySelectorAll('#llm-list li').length]`),
  ['#/settings/llm', 'settings', false, true, true, 6], 'Configure LLM opens the screen with the providers');
const llmRow = `document.querySelector('#llm-list li[data-id="openai"]')`;
await ev(`(() => { const r = ${llmRow}; r.querySelector('input[type=password]').value = 'sk-e2e-segredo-WXYZ'; r.querySelector('button.primary').click(); })()`); await sleep(800);
assert.deepEqual(await ev(`(() => { const r = ${llmRow}, k = r.querySelector('input[type=password]'); return [k.value, k.placeholder.includes('…WXYZ'), r.querySelector('.settings-msg').textContent, r.querySelector('.settings-badge').textContent]; })()`),
  ['', true, 'Salvo.', 'Chave salva'], 'saving the key shows only the mask');
assert.equal(await ev(`document.documentElement.outerHTML.includes('segredo')`), false, 'the key does not stay on the page');
const llmApi = await (await fetch(BASE + '/api/settings/llm')).text();
// default LLM: the radio only applies to those with a key and marks just one
assert.deepEqual(await ev(`[...document.querySelectorAll('#llm-list input[name=llm-default]')].map(r => r.disabled)`),
  [true, false, true, true, true, true], 'only the provider with a key can be the default');
await ev(`${llmRow}.querySelector('input[name=llm-default]').click()`); await sleep(1000);
assert.deepEqual(await ev(`[[...document.querySelectorAll('#llm-list input[name=llm-default]:checked')].map(r => r.closest('li').dataset.id), document.querySelector('#llm-list li.is-default')?.dataset.id]`),
  [['openai'], 'openai'], 'choosing the default marks the card');
assert.equal((await (await fetch(BASE + '/api/settings/llm')).json()).find(p => p.default)?.id, 'openai', 'the default is saved on the server');
assert.ok(!llmApi.includes('segredo') && llmApi.includes('…WXYZ'), 'the API only returns the mask');
await ev(`document.querySelector('#settings-menu-btn').click(); document.querySelector('#settings-backup-btn').click()`); await sleep(1000);
assert.deepEqual(await ev(`[location.hash, document.querySelector('#settings-llm').hidden, document.querySelector('#settings-backup').hidden, document.querySelector('#backup-run').disabled]`),
  ['#/settings/backup', true, false, true], 'Configure backup opens the screen; without storage you cannot back up');
await ev(`(() => { const r = document.querySelector('#backup-region'); r.value = 'eu-central-2'; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
assert.equal(await ev(`document.querySelector('#backup-endpoint').value`), 'https://s3.eu-central-2.wasabisys.com', 'region fills the endpoint');
const fillBackup = (endpoint) => ev(`(() => { const v = { '#backup-endpoint': '${endpoint}', '#backup-bucket': 'e2e-bucket', '#backup-access': 'AKE2E', '#backup-secret': 'segredo-storage-QRST' };
  for (const [s, x] of Object.entries(v)) document.querySelector(s).value = x;
  document.querySelector('#backup-form').requestSubmit(); })()`);
await fillBackup('http://127.0.0.1:9'); await sleep(800);
assert.match(await ev(`document.querySelector('#backup-msg').textContent`), /https:\/\//, 'endpoint without https is refused');
await fillBackup('https://127.0.0.1:9'); await sleep(1500);
assert.deepEqual(await ev(`[document.querySelector('#backup-msg').textContent, document.querySelector('#backup-secret').value, document.querySelector('#backup-secret').placeholder.includes('…QRST'), document.querySelector('#backup-run').disabled]`),
  ['Configuração salva.', '', true, false], 'saving shows only the tail of the secret');
const backupApi = await (await fetch(BASE + '/api/settings/backup')).text();
assert.ok(!backupApi.includes('segredo-storage') && backupApi.includes('…QRST'), 'the backup API only returns the mask');
assert.match(await ev(`document.querySelector('#backup-list-msg').textContent`), /^Erro: network error/, 'storage down appears in the list');

// conflict (409) right on the first edit: the close-tab warning already applies, no need to edit again
const putDoc = (id, body) => fetch(BASE + '/api/maps/' + id, { method: 'PUT', body: JSON.stringify(body) });
await putDoc('cf1', { version: 0, layout: 'map', root: { id: 'cf1r', text: 'Conflito', children: [] } });
await ev(`location.hash = '#/map/cf1'`); await sleep(1000);
await putDoc('cf1', { version: 1, layout: 'map', root: { id: 'cf1r', text: 'Outra aba', children: [] } });  // the "other tab" saves first
await key('F2'); await typeText('Minha edição'); await key('Enter');
await sleep(900);
assert.match(await status(), /Documento alterado em outra aba/, 'conflict shows the document message');
assert.equal(await unloadBlocked(), true, 'beforeunload warns right after the conflict');
assert.equal((await (await fetch(BASE + '/api/maps/cf1')).json()).root.text, 'Outra aba', 'the other tab is not overwritten');

// 410: document moved to the trash in another tab — stops retrying, its own message, close-tab warning
await putDoc('cf2', { version: 0, layout: 'map', root: { id: 'cf2r', text: 'Lixeira', children: [] } });
await ev(`location.hash = '#/map/cf2'`); await sleep(1000);
await fetch(BASE + '/api/maps/cf2', { method: 'DELETE' });
await ev(`window.__puts = 0; window.__f = window.fetch; window.fetch = (u, o) => { if (o?.method === 'PUT') window.__puts++; return window.__f(u, o); }`);
await key('F2'); await typeText('Editei na lixeira'); await key('Enter');
await sleep(900);
assert.match(await status(), /movido para a lixeira em outra aba/, '410 shows its own message');
assert.equal(await unloadBlocked(), true, 'beforeunload warns with the document in the trash');
await sleep(5800);  // the retry would be every 5 s
assert.equal(await ev(`window.__puts`), 1, '410 is not repeated');
await ev(`window.fetch = window.__f`);

// race: opening a document and going back before the response leaves the list on screen, without opening the editor
await putDoc('cf3', { version: 0, layout: 'map', root: { id: 'cf3r', text: 'Corrida', children: [] } });
await ev(`location.hash = '#/'`); await sleep(800);
await ev(`window.__f = window.fetch; window.fetch = (u, o) => (String(u).endsWith('/api/maps/cf3') && !o?.method ? new Promise(r => setTimeout(r, 1200)).then(() => window.__f(u, o)) : window.__f(u, o))`);
await ev(`location.hash = '#/map/cf3'`); await sleep(300);
await ev(`location.hash = '#/'`); await sleep(2000);
assert.deepEqual(await ev(`[location.hash, document.body.dataset.view]`), ['#/', 'list'], 'going back before the response stays on the list');
await ev(`window.fetch = window.__f`);

// Log out: ends the session and goes back to the login page
await ev(`location.hash = '#/'`); await sleep(800);
assert.equal(await ev(`!document.querySelector('#logout-btn').hidden`), true, 'Sair button appears with login active');
await ev(`document.querySelector('#logout-btn').click()`); await sleep(1200);
assert.equal(await ev(`location.pathname`), '/login.html', 'Sair goes back to the login');
assert.equal(await ev(`fetch('/api/maps').then(r => r.status)`), 401, 'session ended');

assert.deepEqual(logs, [], 'no console errors');
console.log('E2E OK');
process.exit(0);
