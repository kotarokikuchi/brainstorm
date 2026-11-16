// E2E no Chrome headless via DevTools Protocol (WebSocket nativo do Node, sem dependências).
// Uso: node tests/e2e.mjs   (precisa de google-chrome no PATH; sobe o próprio servidor)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const PORT = 8765, BASE = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(join(tmpdir(), 'galho-e2e-'));
const server = spawn('python3', ['-c',
  'import sys; from pathlib import Path; from app import make_server; make_server(Path(sys.argv[1]), int(sys.argv[2])).serve_forever()',
  join(tmp, 'data'), String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--remote-debugging-port=9333',
  '--window-size=1400,800', '--user-data-dir=' + join(tmp, 'chrome'), 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { chrome.kill(); server.kill(); rmSync(tmp, { recursive: true, force: true }); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); break; } catch { await sleep(200); } }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let seq = 0; const waiting = new Map(); const logs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') logs.push(d.params.exceptionDetails.exception?.description);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push(JSON.stringify(d.params.args)); };
const cmd = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
const KEYS = { Tab: 9, Enter: 13, Escape: 27, Delete: 46, ' ': 32, ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, z: 90, F2: 113 };
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
await fetch(BASE + '/api/maps/demo', { method: 'PUT', body: JSON.stringify({ version: 0, layout: 'map', root: n('Planejamento', [
  n('Recursos', [n('Time'), n('Orçamento')], 'left', '#2f5bea'),
  n('Cronograma', [n('Q1'), n('Q2')], 'right', '#e5383b'),
]) }) });
await cmd('Runtime.enable');
await cmd('Page.navigate', { url: BASE + '/#/map/demo' });
await sleep(1500);
const v0 = (await getMap()).version;

// Tab cria filho da raiz e abre o input; texto + Enter confirma
await key('Tab');
assert.equal(await ev(`!document.querySelector('#editor').hidden`), true, 'input aberto');
await typeText('Nova ideia');
await key('Delete');  // Review Focus 5: Delete dentro do input não apaga nó
await key('Enter');
assert.ok((await texts()).includes('Nova ideia'), 'nó criado: ' + (await texts()));
await sleep(900);
let s = await getMap();
assert.ok(JSON.stringify(s).includes('Nova ideia'), 'autosave gravou');
assert.equal(s.version, v0 + 1);
assert.equal(await status(), 'Salvo');

// Enter cria irmão; Esc no nó novo descarta
await key('Enter'); await typeText('descartar'); await key('Escape');
assert.ok(!(await texts()).includes('descartar'), 'Esc descarta nó novo');

// digitar sobre o nó edita substituindo
await key('x'); await typeText('yz'); await key('Enter');
assert.ok((await texts()).includes('xyz'), 'edição por digitação: ' + (await texts()));

// Delete apaga e Ctrl+Z desfaz, Ctrl+Shift+Z refaz
await key('Delete');
assert.ok(!(await texts()).includes('xyz'), 'delete: ' + (await texts()) + ' sel=' + (await ev(`document.querySelector('.selected-ring')?.parentNode.textContent`)));
await key('z', 2);
assert.ok((await texts()).includes('xyz'), 'undo');
await key('z', 2 | 8);
assert.ok(!(await texts()).includes('xyz'), 'redo');
await key('z', 2);

// setas: da raiz para a direita, Espaço recolhe
await sleep(900); await cmd('Page.reload'); await sleep(1500);
await key('ArrowRight');
const sel = await ev(`document.querySelector('.selected-ring').parentNode.dataset.id`);
assert.notEqual(sel, (await getMap()).root.id, 'seta moveu seleção');
const before = (await texts()).length;
await ev(`(() => { const g=[...document.querySelectorAll('.node')].find(g=>g.textContent.startsWith('Cronograma')); g.dispatchEvent(new MouseEvent('click',{bubbles:true})); })()`);
await key(' ');
assert.ok((await texts()).length < before, 'Espaço recolheu');
await key(' ');

// conflito: outra "aba" grava antes
await sleep(900);
const cur = await getMap();
await fetch(BASE + '/api/maps/demo', { method: 'PUT', body: JSON.stringify(cur) });
await key('F2'); await typeText('Cronograma 2026'); await key('Enter');
await sleep(900);
assert.match(await status(), /outra aba/, 'conflito detectado');

assert.deepEqual(logs, [], 'sem erros no console');
console.log('E2E OK');
ws.close(); chrome.kill();
