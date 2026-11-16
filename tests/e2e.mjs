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
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1));
setTimeout(() => { console.error('E2E timeout'); process.exit(1); }, 45000).unref();
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
const KEYS = { Tab: 9, Enter: 13, Escape: 27, Delete: 46, ' ': 32, ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, z: 90, c: 67, v: 86, F2: 113 };
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

// barra flutuante: cor e forma no nó selecionado
const clickNode = (prefix) => ev(`[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('${prefix}')).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await clickNode('Recursos');
assert.equal(await ev(`!document.querySelector('#toolbar').hidden`), true, 'toolbar visível');
await ev(`document.querySelector('#style-btn').click()`);
await ev(`document.querySelector('#style-pop [data-color="#14b8a6"]').click()`);
await ev(`document.querySelector('#style-pop [data-shape="rect"]').click()`);
await sleep(900);
const rec = (await getMap()).root.children.find(c => c.text === 'Recursos');
assert.equal(rec.color, '#14b8a6');
assert.equal(rec.shape, 'rect');
assert.equal(await ev(`[...document.querySelectorAll('#viewport path')].filter(p => p.getAttribute('stroke') === '#14b8a6').length`), 3, 'descendentes herdam a cor');

// botões "+" criam filho e irmão
await ev(`document.querySelector('#add-child').click()`);
assert.equal(await ev(`!document.querySelector('#editor').hidden`), true, '+ filho abre edição');
await typeText('Pelo mais'); await key('Enter');
assert.equal((await getMap()).root.children.length >= 2, true);
assert.ok((await texts()).includes('Pelo mais'));

// layout e zoom
await ev(`(() => { const s = document.querySelector('#layout-select'); s.value = 'org'; s.dispatchEvent(new Event('change')); })()`);
await sleep(900);
assert.equal((await getMap()).layout, 'org');
await ev(`document.querySelector('#zoom-in').click()`);
assert.notEqual(await ev(`document.querySelector('#zoom-reset').textContent`), '100%');
await ev(`document.querySelector('#zoom-reset').click()`);
assert.equal(await ev(`document.querySelector('#zoom-reset').textContent`), '100%');
await ev(`document.querySelector('#undo').click()`);
assert.equal(await ev(`document.querySelector('#layout-select').value`), 'map', 'desfazer pelo botão');
await sleep(900);

// revisão I2: recolher o avô leva a seleção para o nó recolhido
await clickNode('Time');
const recBox = `[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Recursos'))`;
await ev(`${recBox}.querySelector('.toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
assert.match(await ev(`document.querySelector('.selected-ring').parentNode.textContent`), /^Recursos/, 'seleção sobe ao recolher');
await ev(`${recBox}.querySelector('.toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await sleep(900);

// revisão M1: entrar e sair da edição sem mudar nada não grava
const vBefore = (await getMap()).version;
await key('F2'); await key('Enter');
await sleep(900);
assert.equal((await getMap()).version, vBefore, 'edição sem mudança não grava');

// revisão M5: texto em digitação protege o fechamento e a navegação encerra a edição
const unloadBlocked = () => ev(`(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`);
await key('F2'); await ev(`document.querySelector('#editor').setSelectionRange(999, 999)`); await typeText(' rascunho');
assert.equal(await unloadBlocked(), true, 'beforeunload avisa durante edição');
await ev(`location.hash = '#/'`); await sleep(600);
await ev(`location.hash = '#/map/demo'`); await sleep(1200);
assert.equal(await ev(`document.querySelector('#editor').hidden`), true, 'edição encerrada ao navegar');
assert.ok((await texts()).some(t => t.endsWith('rascunho')), 'texto digitado foi confirmado');
await key('Tab');
assert.equal(await ev(`!document.querySelector('#editor').hidden`), true, 'teclado funciona após voltar');
await key('Escape');
await sleep(900);

// arrastar ramo: Q1 vira filho de Recursos (lado esquerdo → soltar à esquerda), placeholder aparece, Ctrl+Z desfaz
const rect = (prefix) => ev(`(() => { const r = [...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('${prefix}')).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const mouse = (type, x, y) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });

const q1 = await rect('Q1'), recR = await rect('Recursos');
await mouse('mousePressed', q1.x + q1.w / 2, q1.y + q1.h / 2);
for (let i = 1; i <= 5; i++) {
  await mouse('mouseMoved', q1.x + q1.w / 2 + (recR.x - 10 - q1.x - q1.w / 2) * i / 5, q1.y + q1.h / 2 + (recR.y + recR.h / 2 - q1.y - q1.h / 2) * i / 5);
  await sleep(30);
}
assert.equal(await ev(`!!document.querySelector('#viewport .drop-placeholder')`), true, 'placeholder visível');
await mouse('mouseReleased', recR.x - 10, recR.y + recR.h / 2);
await sleep(900);
const recursos = () => getMap().then(m => m.root.children.find(c => c.text.startsWith('Recursos')));
assert.ok((await recursos()).children.some(c => c.text === 'Q1'), 'Q1 movido para Recursos');
assert.equal(await ev(`!!document.querySelector('#viewport .drop-placeholder')`), false, 'placeholder some ao soltar');
await key('z', 2);
await sleep(900);
assert.ok(!(await recursos()).children.some(c => c.text === 'Q1'), 'desfazer move de volta');

// ligar nós: arrastar da bolinha de Q2 até Time cria a seta; clicar nela + Del apaga; Ctrl+Z volta
const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];
await clickNode('Q2');
const hd = await ev(`(() => { const r = document.querySelector('#viewport .link-handle').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const [hx, hy] = center(hd), [tx, ty] = center(await rect('Time'));
await mouse('mousePressed', hx, hy);
for (let i = 1; i <= 5; i++) { await mouse('mouseMoved', hx + (tx - hx) * i / 5, hy + (ty - hy) * i / 5); await sleep(30); }
assert.equal(await ev(`!!document.querySelector('#viewport .link-preview')`), true, 'prévia da ligação');
await mouse('mouseReleased', tx, ty);
await sleep(900);
assert.equal((await getMap()).links.length, 1, 'ligação gravada');
assert.equal(await ev(`document.querySelectorAll('#viewport .link').length`), 1, 'seta desenhada');
await ev(`document.querySelector('#viewport .link-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await key('Delete');
await sleep(900);
assert.equal((await getMap()).links.length, 0, 'Del apaga a ligação selecionada');
assert.ok((await texts()).includes('Q2'), 'Del não apagou o nó');
await key('z', 2);
await sleep(900);
assert.equal((await getMap()).links.length, 1, 'desfazer restaura a ligação');
// botão "Ligar" na barra: depois clicar no nó de destino
await clickNode('Q2');
await ev(`document.querySelector('#link-btn').click()`);
const [qx, qy] = center(await rect('Q1'));
await mouse('mousePressed', qx, qy);  // sem mover antes: clique direto no destino
await mouse('mouseReleased', qx, qy);
await sleep(900);
assert.equal((await getMap()).links.length, 2, 'botão Ligar cria ligação');

// menu "⋯" do nó: itens, copiar/colar pelo menu e por Ctrl+C/Ctrl+V, novo filho, Esc fecha
const menuOpen = () => ev(`!document.querySelector('#node-menu').hidden`);
const menu = (action) => ev(`document.querySelector('#node-menu [data-action="${action}"]').click()`);
await clickNode('Q2');
await ev(`document.querySelector('#more-btn').click()`);
assert.equal(await menuOpen(), true, 'menu abre');
assert.deepEqual(await ev(`[...document.querySelectorAll('#node-menu [data-action]')].map(b => b.dataset.action)`),
  ['child', 'sibling', 'collapse', 'link', 'copy', 'paste', 'delete']);
await menu('copy');
assert.equal(await menuOpen(), false, 'menu fecha após ação');
await clickNode('Time');
await ev(`document.querySelector('#more-btn').click()`);
await menu('paste');
await sleep(900);
const timeKids = async () => (await recursos()).children.find(c => c.text === 'Time').children.map(c => c.text);
assert.deepEqual(await timeKids(), ['Q2'], 'colar pelo menu');
await clickNode('Q1');
await key('c', 2);
await clickNode('Time');
await key('v', 2);
await sleep(900);
assert.deepEqual(await timeKids(), ['Q2', 'Q1'], 'Ctrl+C / Ctrl+V');
await ev(`document.querySelector('#more-btn').click()`);
await menu('child');
assert.equal(await ev(`!document.querySelector('#editor').hidden`), true, 'novo filho pelo menu');
await key('Escape');
await ev(`document.querySelector('#more-btn').click()`);
await key('Escape');
assert.equal(await menuOpen(), false, 'Esc fecha o menu');
await sleep(900);

// clicar fora: fundo do mapa fecha menus e tira a seleção; cabeçalho só fecha menus; setas voltam a selecionar
const emptyPoint = () => ev(`(() => { for (let y = 120; y < 700; y += 20) for (let x = 20; x < 1300; x += 20) if (document.elementFromPoint(x, y)?.id === 'canvas') return [x, y]; })()`);
const visible = (sel) => ev(`!document.querySelector('${sel}').hidden`);
await clickNode('Q2');
await ev(`document.querySelector('#more-btn').click()`);
assert.equal(await visible('#node-menu'), true);
await mouse('mousePressed', 300, 25); await mouse('mouseReleased', 300, 25);  // cabeçalho
assert.equal(await visible('#node-menu'), false, 'clicar no cabeçalho fecha o menu');
assert.equal(await visible('#toolbar'), true, 'cabeçalho mantém a seleção');
await ev(`document.querySelector('#style-btn').click()`);
const [ex, ey] = await emptyPoint();
await mouse('mousePressed', ex, ey); await mouse('mouseReleased', ex, ey);
assert.equal(await visible('#style-pop'), false, 'fundo fecha o estilo');
assert.equal(await visible('#toolbar'), false, 'fundo esconde a barra');
assert.equal(await visible('#add-child'), false, 'fundo esconde o +');
assert.equal(await ev(`!!document.querySelector('.selected-ring')`), false, 'nada selecionado');
await key('Delete');  // sem seleção: não faz nada nem quebra
await key('ArrowRight');
assert.equal(await ev(`!!document.querySelector('.selected-ring')`), true, 'seta seleciona de novo');
await sleep(900);

// curvar ligação: seta selecionada mostra o ponto de controle; arrastar curva; desfazer/refazer; duplo clique volta ao automático
await ev(`document.querySelector('#viewport .link-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
const bh = await ev(`(() => { const r = document.querySelector('#viewport .link-bend').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const [bx0, by0] = center(bh);
await mouse('mousePressed', bx0, by0);
for (let i = 1; i <= 5; i++) { await mouse('mouseMoved', bx0 + 18 * i, by0 + 14 * i); await sleep(30); }
await mouse('mouseReleased', bx0 + 90, by0 + 70);
await sleep(900);
const bend = async () => (await getMap()).links[0].bend;
assert.ok((await bend()) && Math.hypot(...(await bend())) > 50, 'curva gravada');
assert.match(await ev(`document.querySelector('#viewport .link').getAttribute('d')`), / Q/, 'seta passa pelo ponto');
await key('z', 2);
await sleep(900);
assert.equal(await bend(), undefined, 'desfazer a curva');
await key('z', 2 | 8);
await sleep(900);
assert.ok(await bend(), 'refazer a curva');
await ev(`document.querySelector('#viewport .link-bend').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await sleep(900);
assert.equal(await bend(), undefined, 'duplo clique volta à curva automática');

// conflito: outra "aba" grava antes
await sleep(900);
const cur = await getMap();
await fetch(BASE + '/api/maps/demo', { method: 'PUT', body: JSON.stringify(cur) });
await key('F2'); await typeText('Cronograma 2026'); await key('Enter');
await sleep(900);
assert.match(await status(), /outra aba/, 'conflito detectado');

// revisão I1: editar após o conflito mantém o aviso ao fechar
await key('F2'); await typeText(' depois'); await key('Enter');
assert.equal(await unloadBlocked(), true, 'beforeunload avisa após conflito');

assert.deepEqual(logs, [], 'sem erros no console');
console.log('E2E OK');
process.exit(0);
