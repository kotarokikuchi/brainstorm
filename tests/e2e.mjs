// E2E no Chrome headless via DevTools Protocol (WebSocket nativo do Node, sem dependências).
// Uso: node tests/e2e.mjs   (precisa de google-chrome no PATH; sobe o próprio servidor)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
// portas configuráveis: vários e2e (ex.: agentes em worktrees) podem rodar ao mesmo tempo
const PORT = Number(process.env.E2E_PORT ?? 8765), CDP = Number(process.env.E2E_CDP_PORT ?? 9333), BASE = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(join(tmpdir(), 'galho-e2e-'));
const server = spawn('python3', ['-c',
  'import sys; from pathlib import Path; from app import make_server; make_server(Path(sys.argv[1]), int(sys.argv[2]), auth=("e2e", "senha-e2e")).serve_forever()',
  join(tmp, 'data'), String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
// o teste confere textos em português: o navegador roda em pt-BR, seja qual for o idioma da máquina
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + CDP, '--lang=pt-BR', '--accept-lang=pt-BR',
  '--window-size=1400,800', '--user-data-dir=' + join(tmp, 'chrome'), 'about:blank'], { stdio: 'ignore', env: { ...process.env, LANGUAGE: 'pt_BR' } });
// maxRetries: o Chrome ainda pode estar gravando o perfil quando o processo sai
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
// o servidor do e2e exige login: os fetch do Node usam uma sessão própria (a do navegador é feita pela página)
const apiLogin = await fetch(BASE + '/api/login', { method: 'POST', body: JSON.stringify({ user: 'e2e', password: 'senha-e2e' }) });
assert.equal(apiLogin.status, 200, 'login pela API');
const sessionCookie = apiLogin.headers.get('set-cookie').split(';')[0];
const nodeFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => nodeFetch(url, String(url).startsWith(BASE) ? { ...opts, headers: { ...(opts.headers ?? {}), Cookie: sessionCookie } } : opts);
await fetch(BASE + '/api/maps/demo', { method: 'PUT', body: JSON.stringify({ version: 0, layout: 'map', root: n('Planejamento', [
  n('Recursos', [n('Time'), n('Orçamento')], 'left', '#2f5bea'),
  n('Cronograma', [n('Q1'), n('Q2')], 'right', '#e5383b'),
]) }) });
await cmd('Runtime.enable');
await cmd('Page.enable');
// página de login: sem sessão o app manda para ela; senha errada avisa; a certa entra
await cmd('Page.navigate', { url: BASE + '/' }); await sleep(1200);
assert.equal(await ev(`location.pathname`), '/login.html', 'sem login, vai para a página de login');
// se as opções do Chrome não bastarem nesta máquina, a escolha guardada garante o pt-BR
if (await ev(`navigator.language`) !== 'pt-BR') { await ev(`localStorage.setItem('galho:lang', 'pt-BR')`); await cmd('Page.navigate', { url: BASE + '/login.html' }); await sleep(1200); }
assert.deepEqual(await ev(`[document.documentElement.lang, document.querySelector('#lang').value, document.querySelector('#lang').options.length, document.title]`),
  ['pt-BR', 'pt-BR', 4, 'Entrar · Brainstorm'], 'página de login carrega os textos e o seletor de idioma sem sessão');
const submitLogin = (u, p) => ev(`(() => { document.querySelector('#login-user').value = '${u}'; document.querySelector('#login-password').value = '${p}'; document.querySelector('#login-form').requestSubmit(); })()`);
await submitLogin('e2e', 'errada'); await sleep(1600);
assert.equal(await ev(`document.querySelector('#login-error').hidden ? '' : document.querySelector('#login-error').textContent`), 'Usuário ou senha incorretos.', 'senha errada avisa');
await submitLogin('e2e', 'senha-e2e'); await sleep(1200);
assert.equal(await ev(`location.pathname`), '/', 'senha certa entra no app');
await cmd('Page.navigate', { url: BASE + '/#/map/demo' });
await sleep(1500);
const v0 = (await getMap()).version;
assert.equal(await ev(`document.querySelector('#toolbar').hidden`), true, 'barra só aparece depois de clicar no nó');

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
await ev(`document.querySelector('#style-pop [data-prop="color"] [data-value="#14b8a6"]').click()`);
await ev(`document.querySelector('#style-pop [data-prop="shape"] [data-value="rect"]').click()`);
await sleep(900);
const rec = (await getMap()).root.children.find(c => c.text === 'Recursos');
assert.equal(rec.color, '#14b8a6');
assert.equal(rec.shape, 'rect');
assert.equal(await ev(`[...document.querySelectorAll('#viewport path')].filter(p => p.getAttribute('stroke') === '#14b8a6').length`), 3, 'descendentes herdam a cor');

// painel de estilo: abas Forma/Borda/Linha, sem preenchimento, cor personalizada, nuvem, contorno do ramo
const recNode = async () => (await getMap()).root.children.find(c => c.text === 'Recursos');
const pick = (panel, prop, value) => ev(`document.querySelector('#style-pop [data-panel="${panel}"] [data-prop="${prop}"] [data-value="${value}"]').click()`);
const tab = (name) => ev(`document.querySelector('#style-pop [data-tab="${name}"]').click()`);
const recG = `[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Recursos'))`;
const shown = (sel) => ev(`!document.querySelector('${sel}').hidden`);
await pick('shape', 'shape', 'cloud');
assert.equal(await ev(`!!${recG}.querySelector('path.cloud')`), true, 'forma nuvem');
await pick('shape', 'color', 'none');
await sleep(900);
assert.equal((await recNode()).fillNone, true, 'sem preenchimento');
// (o '+' abre o seletor nativo de cor, que não roda no headless: aplica a cor direto pelo input)
await ev(`(() => { const i = document.querySelector('#custom-color'); i.value = '#123456'; i.dispatchEvent(new Event('change')); })()`);
await sleep(900);
assert.equal((await recNode()).color, '#123456', 'cor personalizada');
assert.equal((await recNode()).fillNone, false, 'cor volta a preencher');
assert.equal(await ev(`!!document.querySelector('#style-pop [data-panel="shape"] [data-prop="color"] [data-value="#123456"]')`), true, 'cor personalizada vira amostra');
await ev(`document.querySelector('#boundary').click()`);
await sleep(900);
assert.equal((await recNode()).boundary, true);
assert.equal(await ev(`!!document.querySelector('#viewport .boundary')`), true, 'contorno do ramo');
await tab('border');
assert.equal(await shown('#style-pop [data-panel="border"]'), true, 'aba borda');
assert.equal(await shown('#style-pop [data-panel="shape"]'), false);
await pick('border', 'borderColor', '#e5383b');
await pick('border', 'borderWidth', 'thick');
await pick('border', 'borderStyle', 'dashed');
await sleep(900);
let rn = await recNode();
assert.deepEqual([rn.borderColor, rn.borderWidth, rn.borderStyle], ['#e5383b', 'thick', 'dashed']);
assert.equal(await ev(`(() => { const p = ${recG}.querySelector('path.cloud'); return p.getAttribute('stroke') + ' ' + !!p.getAttribute('stroke-dasharray'); })()`), '#e5383b true', 'borda desenhada');
await tab('line');
await pick('line', 'lineColor', '#2f5bea');
await pick('line', 'lineStyle', 'dashed');
await sleep(900);
assert.equal(await ev(`[...document.querySelectorAll('#viewport path.edge')].filter(p => p.getAttribute('stroke') === '#2f5bea' && p.getAttribute('stroke-dasharray')).length`), 1, 'linha do pai estilizada');
await pick('line', 'lineStyle', 'dashed');  // clicar no ativo volta ao padrão
await sleep(900);
assert.equal((await recNode()).lineStyle, null);
await tab('shape');

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
assert.equal(await ev(`${recBox}.querySelector('.toggle text')?.textContent`), String((await getMap()).root.children.find(c => c.text.startsWith('Recursos')).children.length), 'recolhido mostra o número de filhos');
await ev(`${recBox}.querySelector('.toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await sleep(900);
assert.equal(await ev(`${recBox}.querySelector('.toggle text')`), null, 'expandido: só o círculo, sem texto');

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

// ligar nós: botão "Ligar" em Q2, mover até Time mostra a prévia, clicar cria a seta; clicar nela + Del apaga; Ctrl+Z volta
const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];
const clickAnchor = async (side) => {
  const [x, y] = await ev(`(() => { const r = document.querySelector('.link-anchor[data-side="${side}"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y);
};
await clickNode('Q2');
await ev(`document.querySelector('#link-btn').click()`);
const [tx, ty] = center(await rect('Time'));
// sem escolher o lado: nenhum lado ativo, sem prévia, e clicar no destino não liga
assert.equal(await ev(`document.querySelectorAll('.link-anchor.active').length`), 0, 'nenhum lado pré-selecionado');
await mouse('mouseMoved', tx, ty);
assert.equal(await ev(`!!document.querySelector('#viewport .link-preview')`), false, 'sem prévia antes de escolher o lado');
await mouse('mousePressed', tx, ty); await mouse('mouseReleased', tx, ty);
await sleep(300);
assert.equal((await getMap()).links?.length ?? 0, 0, 'clicar no destino sem lado não liga');
assert.equal(await ev(`document.querySelectorAll('.link-anchor:not([hidden])').length`), 4, 'continua no modo ligar');
await clickAnchor('left');
await mouse('mouseMoved', tx, ty);
assert.equal(await ev(`!!document.querySelector('#viewport .link-preview')`), true, 'prévia depois de escolher o lado');
await mouse('mousePressed', tx, ty);
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
await clickAnchor('left');
const [qx, qy] = center(await rect('Recursos'));  // longe dos "+" de Q2
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
  ['child', 'sibling', 'collapse', 'focus', 'link', 'copy', 'cut', 'paste', 'delete']);
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
// ponto vazio do cabeçalho (não cai em botão nem no nome, que mudam de largura)
const headerPoint = () => ev(`(() => { for (let x = 400; x < 1300; x += 10) if (document.elementFromPoint(x, 25)?.classList.contains('topbar')) return [x, 25]; })()`);
await clickNode('Q2');
await ev(`document.querySelector('#more-btn').click()`);
assert.equal(await visible('#node-menu'), true);
const [hx, hy] = await headerPoint(); await mouse('mousePressed', hx, hy); await mouse('mouseReleased', hx, hy);  // cabeçalho (espaço vazio)
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
assert.equal(await ev(`document.querySelector('#toolbar').hidden`), true, 'navegar pelo teclado não abre a barra');
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
assert.ok(Array.isArray(await bend()), 'curva gravada');
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

// pontos de conexão: só no modo "Ligar" aparecem os 4 "+" no nó de origem; escolhe o lado e clica no destino
const hoverOn = async (prefix) => { const [x, y] = center(await rect(prefix)); await mouse('mouseMoved', x, y); await sleep(50); };
const anchorsShown = () => ev(`[...document.querySelectorAll('.link-anchor')].filter(b => !b.hidden).map(b => b.dataset.side).sort()`);
await clickNode('Cronograma');
assert.deepEqual(await anchorsShown(), [], 'sem "+" fora do modo ligar');
await hoverOn('Cronograma');
assert.deepEqual(await anchorsShown(), [], 'hover não mostra "+"');
await ev(`document.querySelector('#more-btn').click()`);
await menu('link');
assert.deepEqual(await anchorsShown(), ['bottom', 'left', 'right', 'top'], '4 possibilidades de conexão');
const anchorTop = await ev(`(() => { const r = document.querySelector('.link-anchor[data-side="top"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const [ax, ay] = center(anchorTop);
await mouse('mousePressed', ax, ay); await mouse('mouseReleased', ax, ay);  // escolhe o lado de cima
assert.equal(await ev(`document.querySelector('.link-anchor[data-side="top"]').classList.contains('active')`), true);
const recTop = await rect('Recursos');
const [rx, ry] = [recTop.x + recTop.w / 2, recTop.y + 2];  // perto do topo de Recursos
await mouse('mouseMoved', rx, ry);
assert.equal(await ev(`document.querySelectorAll('#viewport .anchor-dot').length`), 4, 'destino mostra os 4 pontos');
await mouse('mousePressed', rx, ry); await mouse('mouseReleased', rx, ry);
await sleep(900);
const newLink = (await getMap()).links.at(-1);
const cron = (await getMap()).root.children.find(c => c.text === 'Cronograma');
assert.equal(newLink.from, cron.id);
assert.deepEqual([newLink.fromSide, newLink.toSide], ['top', 'top'], 'lados gravados');
assert.deepEqual(await anchorsShown(), [], '"+" somem ao terminar');

// mover o destino da ligação: arrastar a ponta da seta selecionada para outro nó; Ctrl+Z desfaz
await ev(`document.querySelector('#viewport .link-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
const endTo = await ev(`(() => { const r = document.querySelector('#viewport .link-end[data-which="to"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const [ex0, ey0] = center(endTo), [ox, oy] = center(await rect('Orçamento'));
await mouse('mousePressed', ex0, ey0);
for (let i = 1; i <= 5; i++) { await mouse('mouseMoved', ex0 + (ox - ex0) * i / 5, ey0 + (oy - ey0) * i / 5); await sleep(30); }
assert.equal(await ev(`!!document.querySelector('#viewport .link-target')`), true, 'novo destino destacado');
await mouse('mouseReleased', ox, oy);
await sleep(900);
const orc = (await recursos()).children.find(c => c.text === 'Orçamento');
const first = (await getMap()).links[0];
assert.equal(first.to, orc.id, 'destino movido');
assert.ok(first.toSide, 'lado de chegada gravado');
await key('z', 2);
await sleep(900);
assert.notEqual((await getMap()).links[0].to, orc.id, 'desfazer volta ao destino antigo');

// barra da ligação: cor, pontas inicial/final, inverter, rótulo e excluir
const linkBar = (sel) => ev(`!document.querySelector('${sel}').hidden`);
const clickSel = (sel) => ev(`document.querySelector('${sel}').click()`);
const link0 = async () => (await getMap()).links[0];
await ev(`document.querySelector('#viewport .link-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
assert.equal(await linkBar('#link-toolbar'), true, 'barra da ligação aparece');
assert.equal(await visible('#toolbar'), false, 'barra do nó some');
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
assert.equal(await ev(`document.querySelector('#viewport path.link').getAttribute('stroke')`), '#e5383b', 'cor aplicada');
assert.match(await ev(`document.querySelector('#viewport path.link').getAttribute('marker-start')`), /dot-open/, 'ponta inicial desenhada');
await clickSel('#link-swap');
await sleep(900);
l0 = await link0();
assert.deepEqual([l0.startMarker, l0.endMarker], ['diamond', 'dot-open'], 'inverter troca as pontas');
promptAnswer = 'depende de';
await clickSel('#link-more');
await clickSel('#link-menu [data-action="label"]');
await sleep(900);
assert.equal((await link0()).label, 'depende de', 'rótulo gravado');
assert.equal(await ev(`document.querySelector('#viewport .link-label')?.textContent`), 'depende de', 'rótulo desenhado');
const nLinks = (await getMap()).links.length;
await clickSel('#link-more');
await clickSel('#link-menu [data-action="delete"]');
await sleep(900);
assert.equal((await getMap()).links.length, nLinks - 1, 'excluir ligação pelo menu');
assert.equal(await linkBar('#link-toolbar'), false, 'barra some ao excluir');

// estilo em qualquer nó: borda num nó sublinhado vira caixa vazada; cor vira caixa preenchida
const timeG = `[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Time'))`;
await clickNode('Time');
await ev(`document.querySelector('#style-btn').click()`);
await tab('border');
await pick('border', 'borderColor', '#8b3fd9');
assert.equal(await ev(`(() => { const r = ${timeG}.querySelector('rect[stroke]'); return r && r.getAttribute('stroke') + ' ' + r.getAttribute('fill'); })()`), '#8b3fd9 transparent', 'borda em nó comum vira caixa');
await tab('shape');
await pick('shape', 'color', '#2f5bea');
assert.equal(await ev(`${timeG}.querySelector('rect[stroke]').getAttribute('fill')`), '#2f5bea', 'cor em nó comum preenche');
await key('Escape');
await sleep(900);

// redimensionar: bolinha no canto do nó selecionado muda a largura; texto quebra; duplo clique volta ao automático
const timeNode = async () => (await recursos()).children.find(c => c.text.startsWith('Equipe') || c.text === 'Time');
await clickNode('Time');
await key('F2'); await typeText('Equipe do projeto e responsabilidades'); await key('Enter');
await sleep(300);
await clickNode('Equipe');
const rh = await ev(`(() => { const r = document.querySelector('#viewport .resize-handle').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const [rx0, ry0] = center(rh);
const wBefore = (await rect('Equipe')).w;
// Time fica no lado esquerdo: a bolinha está no canto de fora (esquerda) e arrastar para a direita estreita
await mouse('mousePressed', rx0, ry0);
for (let i = 1; i <= 5; i++) { await mouse('mouseMoved', rx0 + 20 * i, ry0); await sleep(30); }
await mouse('mouseReleased', rx0 + 100, ry0);
await sleep(900);
const tn = await timeNode();
assert.ok(tn.width && tn.width < wBefore, `largura gravada menor (${tn.width} < ${wBefore})`);
assert.ok(await ev(`[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Equipe')).querySelectorAll('tspan').length`) > 1, 'texto quebra em linhas');
await ev(`document.querySelector('#viewport .resize-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
await sleep(900);
assert.equal((await timeNode()).width, undefined, 'duplo clique volta ao automático');
await key('z', 2);
await sleep(900);
assert.ok((await timeNode()).width, 'desfazer restaura a largura');
assert.equal(await ev(`!!document.querySelector('#viewport .link-handle')`), false, 'bolinha não cria mais ligação');

// imagem no nó: botão da barra abre o painel; escolher arquivo envia ao servidor e mostra no nó; remover tira
const orcNode = async () => (await recursos()).children.find(c => c.text === 'Orçamento');
await clickNode('Orçamento');
await ev(`document.querySelector('#image-btn').click()`);
assert.equal(await ev(`!document.querySelector('#image-pop').hidden`), true, 'painel de imagem abre');
await ev(`(async () => {
  const c = document.createElement('canvas'); c.width = 40; c.height = 30;
  c.getContext('2d').fillRect(0, 0, 40, 30);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'quadro.png', { type: 'image/png' }));
  const input = document.querySelector('#image-input'); input.files = dt.files; input.dispatchEvent(new Event('change'));
})()`);
await sleep(1500);
const img = (await orcNode()).image;
assert.ok(img && /^[a-f0-9]{32}\.png$/.test(img.id), 'imagem gravada no nó');
assert.deepEqual([img.w, img.h], [40, 30], 'tamanho natural guardado');
const href = await ev(`[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Orçamento')).querySelector('image')?.getAttribute('href')`);
assert.ok(href?.endsWith(img.id), 'imagem desenhada no nó');
assert.equal(await ev(`fetch('${href}').then(r => r.status)`), 200, 'servidor entrega a imagem');
await ev(`document.querySelector('#image-btn').click()`);
await ev(`document.querySelector('#image-remove').click()`);
await sleep(900);
assert.equal((await orcNode()).image, undefined, 'remover imagem');
await key('z', 2);
await sleep(900);
assert.ok((await orcNode()).image, 'desfazer volta a imagem');

// anexos: botão 📎 abre a lista; adicionar vários; selo com contagem no nó; baixar; remover; desfazer
await clickNode('Orçamento');
await ev(`document.querySelector('#attach-btn').click()`);
assert.equal(await ev(`!document.querySelector('#attach-pop').hidden`), true, 'painel de anexos abre');
await ev(`(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['ata da reunião'], 'ata.txt', { type: 'text/plain' }));
  dt.items.add(new File([new Uint8Array([37, 80, 68, 70])], 'plano.pdf', { type: 'application/pdf' }));
  const input = document.querySelector('#attach-input'); input.files = dt.files; input.dispatchEvent(new Event('change'));
})()`);
await sleep(1500);
let atts = (await orcNode()).attachments;
assert.deepEqual(atts?.map(a => a.name), ['ata.txt', 'plano.pdf'], 'anexos gravados');
const orcG = `[...document.querySelectorAll('.node')].find(g => g.textContent.startsWith('Orçamento'))`;
assert.equal(await ev(`document.querySelector('#viewport .attach-badge[data-id="' + ${orcG}.dataset.id + '"]')?.textContent`), '2', 'selo com o número de anexos');
const links = await ev(`[...document.querySelectorAll('#attach-list a[download]')].map(a => [a.getAttribute('download'), a.getAttribute('href')])`);
assert.equal(links.length, 2, 'lista com links de download');
assert.equal(links[0][0], 'ata.txt');
assert.equal(await ev(`fetch('${links[0][1]}').then(r => r.headers.get('content-disposition'))`), 'attachment', 'anexo baixa como arquivo');
await ev(`document.querySelector('#attach-list [data-remove]').click()`);
await sleep(900);
assert.deepEqual((await orcNode()).attachments.map(a => a.name), ['plano.pdf'], 'remover anexo');
await key('z', 2);
await sleep(900);
assert.equal((await orcNode()).attachments.length, 2, 'desfazer volta o anexo');
await key('Escape');
await clickNode('Q2');
await ev(`document.querySelector('#viewport .attach-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
assert.equal(await ev(`!document.querySelector('#attach-pop').hidden`), true, 'clicar no selo abre os anexos');
assert.equal(await ev(`document.querySelectorAll('#attach-list li').length`), 2);
await key('Escape');

// comentários: botão 💬 abre o painel; Enter envia; ícone no nó; digitar no campo não dispara atalhos; apagar; desfazer; Alt+Shift+C
await clickNode('Orçamento');
await ev(`document.querySelector('#comment-btn').click()`);
assert.equal(await ev(`!document.querySelector('#comment-pop').hidden`), true, 'painel de comentários abre');
assert.equal(await ev(`document.activeElement?.id`), 'comment-input', 'campo recebe o foco');
await key('x');  // letra no campo não pode começar a editar o nó
assert.equal(await ev(`document.querySelector('#editor').hidden`), true, 'atalhos do mapa não disparam no campo');
await ev(`document.querySelector('#comment-input').value = ''`);
await typeText('Revisar valores');
await key('Enter');
await sleep(900);
assert.deepEqual((await orcNode()).comments?.map(c => c.text), ['Revisar valores'], 'comentário gravado');
assert.ok((await orcNode()).comments[0].at, 'com data/hora');
assert.equal(await ev(`document.querySelectorAll('#comment-list li').length`), 1, 'lista mostra o comentário');
assert.equal(await ev(`!!${orcG}.querySelector('.comment-icon')`), true, 'ícone de comentário no nó');
assert.equal(await ev(`document.querySelector('#comment-input').value`), '', 'campo limpo após enviar');
await ev(`document.querySelector('#comment-list [data-del]').click()`);
await sleep(900);
assert.equal((await orcNode()).comments, undefined, 'apagar comentário');
await ev(`document.activeElement.blur()`);  // Ctrl+Z dentro do campo é o desfazer do próprio campo
await key('z', 2);
await sleep(900);
assert.equal((await orcNode()).comments.length, 1, 'desfazer volta o comentário');
await ev(`document.activeElement.blur()`);
await key('Escape');
assert.equal(await ev(`document.querySelector('#comment-pop').hidden`), true);
await clickNode('Orçamento');
await key('c', 1 | 8);  // Alt+Shift+C
assert.equal(await ev(`!document.querySelector('#comment-pop').hidden`), true, 'atalho Alt+Shift+C abre comentários');
await ev(`document.activeElement.blur()`);
await key('Escape');
await clickNode('Q2');
await ev(`${orcG}.querySelector('.comment-icon').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
assert.equal(await ev(`!document.querySelector('#comment-pop').hidden`), true, 'clicar no ícone abre os comentários');
await ev(`document.activeElement.blur()`);
await key('Escape');

// estilo de texto: negrito, itálico, tamanho, cor; Ctrl+B alterna negrito
const orcFont = () => ev(`${orcG}.querySelector('text').getAttribute('style')`);
await clickNode('Orçamento');
const wPlain = (await rect('Orçamento')).w;
await ev(`document.querySelector('#text-btn').click()`);
assert.equal(await ev(`!document.querySelector('#text-pop').hidden`), true, 'painel de texto abre');
await ev(`document.querySelector('#text-pop [data-toggle="textBold"]').click()`);
await ev(`document.querySelector('#text-pop [data-toggle="textItalic"]').click()`);
await ev(`document.querySelector('#text-pop [data-prop="textSize"] [data-value="large"]').click()`);
await ev(`document.querySelector('#text-pop [data-prop="textColor"] [data-value="#e5383b"]').click()`);
await sleep(900);
let on = await orcNode();
assert.deepEqual([on.textBold, on.textItalic, on.textSize, on.textColor], [true, true, 'large', '#e5383b']);
assert.match(await orcFont(), /italic 700 18px/, 'fonte aplicada');
assert.equal(await ev(`${orcG}.querySelector('text').getAttribute('fill')`), '#e5383b', 'cor do texto');
assert.ok((await rect('Orçamento')).w > wPlain, 'texto maior alarga o nó');
await ev(`document.querySelector('#text-pop [data-prop="textSize"] [data-value=""]').click()`);
await sleep(900);
assert.equal((await orcNode()).textSize, null, 'Médio volta ao padrão');
await key('Escape');
await clickNode('Orçamento');
await key('b', 2);
await sleep(900);
assert.equal((await orcNode()).textBold, null, 'Ctrl+B volta ao padrão (não negrito)');

// link (URL) no nó: só http(s); ícone 🔗 no nó abre em nova aba; remover
await clickNode('Orçamento');
await ev(`document.querySelector('#url-btn').click()`);
assert.equal(await ev(`!document.querySelector('#url-pop').hidden`), true, 'painel de link abre');
assert.equal(await ev(`document.activeElement?.id`), 'url-input', 'campo recebe o foco');
await typeText('javascript:alert(1)');
await key('Enter');
await sleep(300);
assert.equal((await orcNode()).url, undefined, 'javascript: recusado');
assert.equal(await ev(`!document.querySelector('#url-error').hidden`), true, 'mostra o erro');
await ev(`document.querySelector('#url-input').value = ''`);
await typeText('exemplo.com/docs');
await key('Enter');
await sleep(900);
assert.equal((await orcNode()).url, 'https://exemplo.com/docs', 'endereço normalizado e gravado');
assert.equal(await ev(`!!${orcG}.querySelector('.url-icon')`), true, 'ícone de link no nó');
await ev(`window.open = (u, t, f) => { window.__opened = [u, t, f]; }`);
await ev(`${orcG}.querySelector('.url-icon').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
assert.deepEqual(await ev(`window.__opened`), ['https://exemplo.com/docs', '_blank', 'noopener,noreferrer'], 'clicar abre em nova aba');
await clickNode('Orçamento');
await ev(`document.querySelector('#url-btn').click()`);
await ev(`document.querySelector('#url-remove').click()`);
await sleep(900);
assert.equal((await orcNode()).url, undefined, 'remover link');
await ev(`document.activeElement.blur()`);
await key('Escape');

// modo foco: Ctrl+. mostra só o ramo; Esc sai; menu "Focar neste ramo"; botão "Sair do foco"
await clickNode('Cronograma');
await key('.', 2);
await sleep(300);
assert.equal(await ev(`!document.querySelector('#focus-bar').hidden`), true, 'barra do foco aparece');
const inFocus = await texts();
assert.ok(inFocus.some(t => t.startsWith('Cronograma')), 'ramo focado aparece');
assert.ok(!inFocus.some(t => t.startsWith('Recursos')), 'outros ramos somem');
await key('Escape');
await sleep(300);
assert.equal(await ev(`document.querySelector('#focus-bar').hidden`), true, 'Esc sai do foco');
assert.ok((await texts()).some(t => t.startsWith('Recursos')), 'mapa inteiro de volta');
await clickNode('Cronograma');
await ev(`document.querySelector('#more-btn').click()`);
await menu('focus');
await sleep(300);
assert.ok(!(await texts()).some(t => t.startsWith('Recursos')), 'menu "Focar neste ramo"');
await key('Tab'); await typeText('Novo no foco'); await key('Enter');  // edição continua funcionando no foco
await sleep(900);
assert.ok((await getMap()).root.children.find(c => c.text.startsWith('Cronograma')).children.some(c => c.text === 'Novo no foco'));
await ev(`document.querySelector('#focus-exit').click()`);
await sleep(300);
assert.equal(await ev(`document.querySelector('#focus-bar').hidden`), true, 'botão sai do foco');

// modo outline: lista editável; Enter cria item; Tab/Shift+Tab recua; Backspace no vazio apaga; Esc volta ao mapa
const cronNode = async () => (await getMap()).root.children.find(c => c.text.startsWith('Cronograma'));
await ev(`document.querySelector('#outline-btn').click()`);
assert.equal(await ev(`!document.querySelector('#outline-view').hidden`), true, 'outline aparece');
assert.equal(await ev(`getComputedStyle(document.querySelector('#canvas')).display`), 'none', 'mapa some');
const countVisible = (n) => 1 + (n.collapsed ? 0 : n.children.reduce((a, c) => a + countVisible(c), 0));
assert.equal(await ev(`document.querySelectorAll('#outline-view input').length`), countVisible((await getMap()).root), 'uma linha por nó visível');
const q2 = (await cronNode()).children.find(c => c.text === 'Q2');
await ev(`(() => { const i = document.querySelector('#outline-view [data-id="${q2.id}"] > .row input'); i.focus(); i.setSelectionRange(99, 99); })()`);
await key('Enter');
assert.equal(await ev(`document.activeElement.value`), '', 'Enter cria item vazio com foco');
await typeText('Q3');
await key('Enter');
await key('Backspace');  // item vazio: apaga e volta para o anterior
await sleep(900);
assert.deepEqual((await cronNode()).children.map(c => c.text).filter(t => /^Q\d$/.test(t)), ['Q1', 'Q2', 'Q3'], 'Q3 criado, vazio apagado');
assert.equal(await ev(`document.activeElement.value`), 'Q3', 'foco volta para o item anterior');
await key('Tab');
await sleep(900);
assert.deepEqual((await cronNode()).children.find(c => c.text === 'Q2').children.map(c => c.text), ['Q3'], 'Tab recua para dentro de Q2');
await key('Tab', 8);
await sleep(900);
assert.ok((await cronNode()).children.some(c => c.text === 'Q3'), 'Shift+Tab desrecua');
await ev(`(() => { const i = document.activeElement; i.value = 'Q3 revisado'; })()`);
await key('ArrowUp');  // sair da linha confirma o texto
await sleep(900);
assert.ok((await cronNode()).children.some(c => c.text === 'Q3 revisado'), 'edição de texto no outline');
await key('Escape');
assert.equal(await ev(`document.querySelector('#outline-view').hidden`), true, 'Esc volta ao mapa');
assert.ok((await texts()).includes('Q3 revisado'), 'mapa mostra o item novo');

// exportar: Markdown, PNG (imagem de verdade) e PDF (impressão do navegador)
await ev(`(() => {
  window.__downloads = [];
  HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push([this.download, this.href]); };
  window.print = () => { window.__printed = true; };
})()`);
await ev(`document.querySelector('#export-btn').click()`);
assert.equal(await ev(`!document.querySelector('#export-menu').hidden`), true, 'menu exportar abre');
await ev(`document.querySelector('#export-menu [data-export="md"]').click()`);
await sleep(300);
let dl = await ev(`window.__downloads.at(-1)`);
assert.match(dl[0], /\.md$/, 'arquivo .md');
const md = await ev(`fetch('${dl[1]}').then(r => r.text())`);
assert.match(md, /^# Planejamento/, 'título no Markdown');
assert.match(md, /\n- Recursos/, 'ramos no Markdown');
await ev(`document.querySelector('#export-btn').click()`);
await ev(`document.querySelector('#export-menu [data-export="png"]').click()`);
await sleep(2500);
dl = await ev(`window.__downloads.at(-1)`);
assert.match(dl[0], /\.png$/, 'arquivo .png');
const png = await ev(`fetch('${dl[1]}').then(r => r.arrayBuffer()).then(b => [b.byteLength, [...new Uint8Array(b.slice(0, 4))]])`);
assert.ok(png[0] > 5000, `PNG com conteúdo (${png[0]} bytes)`);
assert.deepEqual(png[1], [137, 80, 78, 71], 'assinatura PNG');
await ev(`document.querySelector('#export-btn').click()`);
await ev(`document.querySelector('#export-menu [data-export="pdf"]').click()`);
await sleep(300);
assert.equal(await ev(`window.__printed`), true, 'PDF abre a impressão');
assert.equal(await ev(`document.querySelector('#export-menu').hidden`), true, 'menu fecha');

// revisão M4: Esc num nó recém-criado não deixa passo vazio no desfazer
const q1Text = async () => (await getMap()).root.children.find(c => c.text.startsWith('Cronograma')).children[0].text;
await clickNode('Q1');
await key('F2'); await typeText('Q1 editado'); await key('Enter');
await key('Tab'); await key('Escape');  // cria e descarta um filho
await key('z', 2);
await sleep(900);
assert.equal(await q1Text(), 'Q1', 'primeiro Ctrl+Z desfaz a última mudança real');

// revisão M6: começar a editar com tecla morta (acento) não perde o acento
await clickNode('Q1');
await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 });
await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 });
await typeText('á');
assert.equal(await ev(`document.querySelector('#editor').value`), 'á', 'acento vai para a edição');
await key('Escape');

// revisão M2: com erro ao salvar, sair do mapa pergunta; cancelar mantém no mapa com a alteração pendente
await ev(`(() => { window.__realFetch = window.fetch; window.fetch = (u, o) => (o?.method === 'PUT' ? Promise.reject(new Error('offline')) : window.__realFetch(u, o)); })()`);
await clickNode('Q1');
await key('F2'); await typeText('Q1 offline'); await key('Enter');
await sleep(900);
assert.match(await ev(`document.querySelector('#status').textContent`), /Erro ao salvar/);
dialogAccept = false;
await ev(`location.hash = '#/'`);
await sleep(500);
dialogAccept = true;
assert.equal(await ev(`document.body.dataset.view`), 'editor', 'cancelar mantém no mapa');
assert.match(await ev(`location.hash`), /^#\/map\//, 'endereço volta para o mapa');
assert.ok((await texts()).includes('Q1 offline'), 'alteração continua na tela');
await ev(`window.fetch = window.__realFetch`);
await sleep(6000);  // nova tentativa a cada 5 s
assert.equal(await q1Text(), 'Q1 offline', 'alteração salva quando a rede volta');

// histórico de versões: painel lista versões; restaurar a mais antiga traz o mapa inicial; Ctrl+Z volta
const recKids = async () => (await recursos()).children.map(c => c.text);
const recBefore = await recKids();
await ev(`document.querySelector('#history-btn').click()`);
await sleep(500);
assert.equal(await ev(`!document.querySelector('#history-panel').hidden`), true, 'painel de histórico abre');
assert.ok(await ev(`document.querySelectorAll('#history-list li').length`) >= 1, 'lista versões');
dialogAccept = true;
await ev(`[...document.querySelectorAll('#history-list [data-restore]')].at(-1).click()`);  // a mais antiga
await sleep(1200);
assert.deepEqual(await recKids(), ['Time', 'Orçamento'], 'versão antiga restaurada');
assert.equal(await ev(`document.querySelector('#history-panel').hidden`), true, 'painel fecha');
await key('z', 2);
await sleep(900);
assert.deepEqual(await recKids(), recBefore, 'Ctrl+Z desfaz a restauração');

// mostrar este ramo como: organograma / lista / mapa pelo menu ⋯ do nó
const recNow = async () => (await getMap()).root.children.find(c => c.text.startsWith('Recursos'));
const branchAs = async (v) => {
  await clickNode('Recursos');
  await ev(`document.querySelector('#more-btn').click()`);
  assert.equal(await ev(`!document.querySelector('#branch-layout-row').hidden`), true, 'opção no menu');
  await ev(`document.querySelector('#branch-layout-row [data-value="${v}"]').click()`);
  await sleep(900);
};
await branchAs('org');
assert.equal((await recNow()).branchLayout, 'org');
const recR2 = await rect('Recursos'), orcR2 = await rect('Orçamento');
assert.ok(orcR2.y > recR2.y + recR2.h - 4, 'filhos abaixo do ramo (organograma)');
assert.ok(await ev(`[...document.querySelectorAll('#viewport path.edge')].some(p => / C/.test(p.getAttribute('d')) && p.getAttribute('d').split(' ').length > 2)`));
await branchAs('list');
assert.equal((await recNow()).branchLayout, 'list');
await branchAs('');
assert.equal((await recNow()).branchLayout, null, 'Mapa volta ao padrão');
await clickNode('Planejamento');
await ev(`document.querySelector('#more-btn').click()`);
assert.equal(await ev(`document.querySelector('#branch-layout-row').hidden`), true, 'raiz não tem a opção');
await key('Escape');

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

// apresentação: ▶ entra; → avança para o ramo; ← volta; Esc sai
const nSlides = (await getMap()).root.children.length + 1;
await ev(`document.querySelector('#present-btn').click()`);
await sleep(400);
assert.equal(await ev(`document.body.classList.contains('presenting')`), true, 'entra na apresentação');
assert.equal(await ev(`document.querySelector('#present-count').textContent`), `1 / ${nSlides}`);
await key('ArrowRight');
await sleep(300);
assert.equal(await ev(`document.querySelector('#present-count').textContent`), `2 / ${nSlides}`, '→ avança');
const firstBranch = (await getMap()).root.children[0].text;
const onSlide = await texts();
assert.ok(onSlide.includes(firstBranch) && !onSlide.includes((await getMap()).root.text), 'slide mostra só o ramo');
assert.equal(await ev(`!!document.querySelector('.selected-ring')`), false, 'sem seleção na apresentação');
await key('ArrowLeft');
await sleep(300);
assert.equal(await ev(`document.querySelector('#present-count').textContent`), `1 / ${nSlides}`, '← volta');
await key('Escape');
await sleep(300);
assert.equal(await ev(`document.body.classList.contains('presenting')`), false, 'Esc sai');

// duplicar e lixeira: menu do mapa duplica e abre a cópia; mover para a lixeira; restaurar; duplicar/apagar pela lista; apagar de vez
dialogAccept = true;
const mapIds = async () => (await (await fetch(BASE + '/api/maps')).json()).map(m => m.id);
const trashIds = async () => (await (await fetch(BASE + '/api/trash')).json()).map(m => m.id);
await ev(`document.querySelector('#map-menu-btn').click()`);
assert.equal(await ev(`!document.querySelector('#map-menu').hidden`), true, 'menu do mapa abre');
await ev(`document.querySelector('#map-menu [data-map-action="duplicate"]').click()`);
await sleep(1500);
const copyId = await ev(`location.hash.split('/').pop()`);
assert.notEqual(copyId, 'demo', 'abre a cópia');
assert.match(await ev(`document.querySelector('#title').textContent`), /\(cópia\)$/);
await ev(`document.querySelector('#map-menu-btn').click()`);
await ev(`document.querySelector('#map-menu [data-map-action="trash"]').click()`);
await sleep(1200);
assert.equal(await ev(`document.body.dataset.view`), 'list', 'volta para a lista');
assert.ok(!(await mapIds()).includes(copyId) && (await trashIds()).includes(copyId), 'cópia na lixeira');
assert.match(await ev(`document.querySelector('#trash summary').textContent`), /Lixeira \(1\)/);
await ev(`document.querySelector('#trash').open = true`);
await ev(`document.querySelector('#trash-list [data-restore="${copyId}"]').click()`);
await sleep(800);
assert.ok((await mapIds()).includes(copyId), 'restaurado');
await ev(`document.querySelector('#maps [data-duplicate="demo"]').click()`);
await sleep(800);
const extra = (await mapIds()).filter(id => id !== 'demo' && id !== copyId);
assert.equal(extra.length, 1, 'duplicar pela lista');
await ev(`document.querySelector('#maps [data-delete="${extra[0]}"]').click()`);
await sleep(800);
assert.ok((await trashIds()).includes(extra[0]), 'apagar pela lista vai para a lixeira');
await ev(`document.querySelector('#trash').open = true`);
await ev(`document.querySelector('#trash-list [data-purge="${extra[0]}"]').click()`);
await sleep(800);
assert.ok(!(await trashIds()).includes(extra[0]), 'apagar de vez');

// quadros (lousa): novo quadro pela lista; renomear pelo título; aparece na lista como quadro; reabre
await ev(`location.hash = '#/'`);
await sleep(800);
await ev(`document.querySelector('#new-board').click()`);
await sleep(1200);
assert.equal(await ev(`document.body.dataset.view`), 'board', 'abre a lousa');
const boardId = await ev(`location.hash.match(/^#\\/board\\/(.+)$/)?.[1]`);
assert.ok(boardId, 'endereço do quadro');
assert.equal(await ev(`getComputedStyle(document.querySelector('#board-canvas')).display`), 'block', 'lousa visível');
await ev(`document.querySelector('#title').click()`);
assert.equal(await ev(`document.activeElement?.className`), 'inline-input', 'nome do quadro vira campo no topo');
await typeText('Nome descartado');
await key('Escape');
assert.equal(await ev(`document.querySelector('#title').textContent`), 'Quadro sem título', 'Esc desiste');
await ev(`document.querySelector('#title').click()`);
await typeText('Rascunho de ideias');
await key('Enter');
await sleep(900);
const boardDoc = await (await fetch(BASE + `/api/maps/${boardId}`)).json();
assert.deepEqual([boardDoc.type, boardDoc.title, boardDoc.elements], ['board', 'Rascunho de ideias', []], 'renomeado e salvo');
assert.equal(await ev(`document.querySelector('#title').textContent`), 'Rascunho de ideias');
await ev(`location.hash = '#/'`);
await sleep(800);
assert.equal(await ev(`document.querySelector('#maps a[href="#/board/${boardId}"]')?.textContent`), 'Rascunho de ideias', 'quadro na lista');
assert.equal(await ev(`document.querySelector('#maps a[href="#/board/${boardId}"]').closest('li').classList.contains('board')`), true);
await ev(`location.hash = '#/board/${boardId}'`);
await sleep(800);
assert.equal(await ev(`document.body.dataset.view`), 'board', 'reabre o quadro');

// lousa: desenhar com as ferramentas (teclas 2–7), volta para seleção, desfazer/refazer, zoom e mover a tela
const boardEls = async () => (await (await fetch(BASE + `/api/maps/${boardId}`)).json()).elements;
const cv = await ev(`(() => { const r = document.querySelector('#board-canvas').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
const dragOn = async (x1, y1, x2, y2, steps = 5) => {
  await mouse('mousePressed', cv.x + x1, cv.y + y1);
  for (let i = 1; i <= steps; i++) await mouse('mouseMoved', cv.x + x1 + (x2 - x1) * i / steps, cv.y + y1 + (y2 - y1) * i / steps + (i % 2) * 3);
  await mouse('mouseReleased', cv.x + x2, cv.y + y2);
};
await key('2');
assert.equal(await ev(`document.querySelector('#board-tools [data-tool="rectangle"]').classList.contains('active')`), true, 'tecla 2 = retângulo');
await dragOn(350, 100, 510, 200);
await sleep(900);
let els = await boardEls();
assert.equal(els.length, 1);
assert.equal(els[0].type, 'rectangle');
assert.ok(Math.abs(els[0].w - 160) < 2 && Math.abs(els[0].h - 100) < 4, `tamanho do arrasto (${els[0].w}×${els[0].h})`);
assert.equal(await ev(`document.querySelector('#board-tools [data-tool="select"]').classList.contains('active')`), true, 'volta para seleção');
await key('2');
await mouse('mousePressed', cv.x + 650, cv.y + 420); await mouse('mouseReleased', cv.x + 650, cv.y + 420);
await key('4'); await dragOn(550, 100, 670, 180);
await key('3'); await dragOn(700, 100, 800, 180);
await key('5'); await dragOn(350, 260, 550, 300);
await sleep(700); await key('6'); await dragOn(350, 330, 550, 330);
await key('7'); await dragOn(600, 260, 750, 320, 10);
await sleep(900);
els = await boardEls();
assert.deepEqual(els.map(e => e.type), ['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'freedraw'], 'clique sem arrastar não cria; cada ferramenta cria seu tipo');
assert.ok(els[5].points.length >= 6, 'lápis guarda o traço');
assert.equal(await ev(`document.querySelectorAll('#board-root .el').length`), 6, 'tudo desenhado');
await key('z', 2);
await sleep(900);
assert.equal((await boardEls()).length, 5, 'Ctrl+Z desfaz');
await key('z', 2 | 8);
await sleep(900);
assert.equal((await boardEls()).length, 6, 'Ctrl+Shift+Z refaz');
await ev(`document.querySelector('#board-zoom-in').click()`);
assert.notEqual(await ev(`document.querySelector('#board-zoom').textContent`), '100%', 'zoom');
const tBefore = await ev(`document.querySelector('#board-root').getAttribute('transform')`);
await key('h');
await dragOn(900, 400, 950, 450);
assert.notEqual(await ev(`document.querySelector('#board-root').getAttribute('transform')`), tBefore, 'mãozinha move a tela');
assert.equal((await boardEls()).length, 6, 'mover a tela não cria elementos');

// lousa: selecionar, mover, painel de estilo, redimensionar, duplicar, apagar, seleção por área, camadas
const elBox = (id) => ev(`(() => { const r = document.querySelector('#board-root .el[data-id="${id}"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const selCount = () => ev(`document.querySelectorAll('#board-root .sel-item').length`);
const click = async (x, y, mods = 0) => { await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods }); await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods }); };
const dragScreen = async (x1, y1, x2, y2) => { await mouse('mousePressed', x1, y1); for (let i = 1; i <= 4; i++) await mouse('mouseMoved', x1 + (x2 - x1) * i / 4, y1 + (y2 - y1) * i / 4); await mouse('mouseReleased', x2, y2); };
await key('v');
els = await boardEls();
const rectId = els[0].id;
let rb = await elBox(rectId);
await click(rb.x + 2, rb.y + rb.h / 2);  // borda esquerda do retângulo
assert.equal(await selCount(), 1, 'clicar na borda seleciona');
assert.equal(await ev(`!document.querySelector('#board-props').hidden`), true, 'painel de estilo aparece');
await click(rb.x + rb.w / 2, rb.y + rb.h / 2);  // miolo vazio: solta a seleção
assert.equal(await selCount(), 0, 'miolo vazio não seleciona');
await click(rb.x + 2, rb.y + rb.h / 2);
const x0 = (await boardEls())[0].x;
await dragScreen(rb.x + 2, rb.y + rb.h / 2, rb.x + 42, rb.y + rb.h / 2 + 20);
await sleep(900);
assert.ok((await boardEls()).find(e => e.id === rectId).x > x0 + 20, 'arrastar move');
await ev(`document.querySelector('#board-props [data-prop="strokeColor"] [data-value="#e03131"]').click()`);
await ev(`document.querySelector('#board-props [data-prop="backgroundColor"] [data-value="#a5d8ff"]').click()`);
await ev(`document.querySelector('#board-props [data-prop="fillStyle"] [data-value="solid"]').click()`);
await ev(`document.querySelector('#board-props [data-prop="strokeWidth"] [data-value="4"]').click()`);
await ev(`(() => { const r = document.querySelector('#board-opacity'); r.value = 50; r.dispatchEvent(new Event('change')); })()`);
await sleep(900);
let re = (await boardEls()).find(e => e.id === rectId);
assert.deepEqual([re.strokeColor, re.backgroundColor, re.fillStyle, re.strokeWidth, re.opacity], ['#e03131', '#a5d8ff', 'solid', 4, 50], 'painel aplica o estilo');
const wBefore2 = re.w;
const hd = await ev(`(() => { const r = document.querySelector('#board-root .handle[data-handle="se"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
await dragScreen(hd[0], hd[1], hd[0] + 40, hd[1] + 30);
await sleep(900);
assert.ok((await boardEls()).find(e => e.id === rectId).w > wBefore2 + 20, 'alça redimensiona');
await key('d', 2);
await sleep(900);
assert.equal((await boardEls()).length, 7, 'Ctrl+D duplica');
await key('Delete');
await sleep(900);
assert.equal((await boardEls()).length, 6, 'Delete apaga a cópia selecionada');
await key('Escape');
els = await boardEls();
const [eb, db] = [await elBox(els[1].id), await elBox(els[2].id)];  // elipse e losango
const pad = 15;
await dragScreen(Math.min(eb.x, db.x) - pad, Math.min(eb.y, db.y) - pad, Math.max(eb.x + eb.w, db.x + db.w) + pad, Math.max(eb.y + eb.h, db.y + db.h) + pad);
assert.equal(await selCount(), 2, 'seleção por área');
await key(']', 2 | 8);
await sleep(900);
assert.deepEqual((await boardEls()).slice(-2).map(e => e.id), [els[1].id, els[2].id], 'Ctrl+Shift+] traz para frente');
await key('[', 2);
await sleep(900);
assert.deepEqual((await boardEls()).slice(-3, -1).map(e => e.id), [els[1].id, els[2].id], 'Ctrl+[ desce uma camada');
await ev(`document.querySelector('#board-props [data-act="forward"]').click()`);
await sleep(900);
assert.deepEqual((await boardEls()).slice(-2).map(e => e.id), [els[1].id, els[2].id], 'botão sobe uma camada');
await key('a', 2);
assert.equal(await selCount(), 6, 'Ctrl+A seleciona tudo');
await key('Escape');
assert.equal(await selCount(), 0, 'Esc solta a seleção');

// lousa: texto, borracha, exportar SVG/PNG, atalhos
const dbl = async (x, y) => { for (const clickCount of [1, 2]) { await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount }); await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount }); } };
const nEls = (await boardEls()).length;
await key('8');
await click(cv.x + 900, cv.y + 300);
assert.equal(await ev(`!document.querySelector('#board-text').hidden`), true, 'tecla 8 + clique abre o texto');
assert.equal(await ev(`document.activeElement?.id`), 'board-text');
await typeText('Olá quadro');
await key('Escape');
await sleep(900);
let txEl = (await boardEls()).at(-1);
assert.deepEqual([txEl.type, txEl.text], ['text', 'Olá quadro'], 'texto criado');
assert.ok(txEl.w > 20 && txEl.h > 10, 'texto medido');
assert.equal(await ev(`[...document.querySelectorAll('#board-root text')].some(t => t.textContent === 'Olá quadro')`), true, 'texto desenhado');
const tb = await elBox(txEl.id);
await dbl(tb.x + tb.w / 2, tb.y + tb.h / 2);
assert.equal(await ev(`document.querySelector('#board-text').value`), 'Olá quadro', 'duplo clique edita');
await ev(`document.querySelector('#board-text').setSelectionRange(99, 99)`);
await typeText('!');
await key('Escape');
await sleep(900);
assert.equal((await boardEls()).at(-1).text, 'Olá quadro!', 'edição salva');
await dbl(cv.x + 1000, cv.y + 500);  // vazio: novo texto
assert.equal(await ev(`!document.querySelector('#board-text').hidden`), true);
await key('Escape');  // vazio: descarta
await sleep(500);
assert.equal((await boardEls()).length, nEls + 1, 'texto vazio não é criado');
const lineId = (await boardEls()).find(e => e.type === 'line').id;
await key('e');
const lb = await elBox(lineId);
await dragScreen(lb.x + lb.w / 2, lb.y - 25, lb.x + lb.w / 2, lb.y + lb.h + 25);  // atravessa a linha  // atravessa a linha horizontal em y = 330
await sleep(900);
assert.ok(!(await boardEls()).some(e => e.id === lineId), 'borracha apaga o que atravessa');
assert.equal((await boardEls()).length, nEls, 'só a linha saiu');
await ev(`(() => { window.__downloads = []; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push([this.download, this.href]); }; })()`);
await ev(`document.querySelector('#export-btn').click()`);
assert.equal(await ev(`getComputedStyle(document.querySelector('#export-menu [data-export="md"]')).display`), 'none', 'quadro não exporta Markdown');
await ev(`document.querySelector('#export-menu [data-export="svg"]').click()`);
await sleep(800);
let bdl = await ev(`window.__downloads.at(-1)`);
assert.match(bdl[0], /\.svg$/);
const svgText = await ev(`fetch('${bdl[1]}').then(r => r.text())`);
assert.match(svgText, /^<svg/, 'SVG válido');
assert.ok(svgText.includes('Olá quadro!') && !svgText.includes('sel-item'), 'SVG com o texto e sem a seleção');
await ev(`document.querySelector('#export-btn').click()`);
await ev(`document.querySelector('#export-menu [data-export="png"]').click()`);
await sleep(2000);
bdl = await ev(`window.__downloads.at(-1)`);
assert.match(bdl[0], /\.png$/);
assert.deepEqual(await ev(`fetch('${bdl[1]}').then(r => r.arrayBuffer()).then(b => [...new Uint8Array(b.slice(0, 4))])`), [137, 80, 78, 71], 'PNG do quadro');
await key('?');
assert.equal(await ev(`!document.querySelector('#board-help').hidden`), true, '? mostra os atalhos');
await key('Escape');
assert.equal(await ev(`document.querySelector('#board-help').hidden`), true);

// quadro: Enter quebra a linha (como num editor de texto) sem a primeira linha sumir; Esc confirma; sem borda
await key('8');
await click(cv.x + 900, cv.y + 420);
assert.equal(await ev(`getComputedStyle(document.querySelector('#board-text')).outlineStyle`), 'none', 'sem borda tracejada');
await typeText('Linha um');
await key('Enter');
assert.equal(await ev(`document.querySelector('#board-text').hidden`), false, 'Enter não fecha');
await typeText('linha dois');
await key('Enter');
await typeText('linha três');
assert.equal(await ev(`document.querySelector('#board-text').value`), 'Linha um\nlinha dois\nlinha três', 'Enter quebra a linha');
assert.equal(await ev(`document.querySelector('#board-text').scrollTop`), 0, 'primeira linha continua visível');
for (let i = 4; i <= 7; i++) { await key('Enter'); await typeText(String(i)); }
assert.ok(await ev(`(() => { const t = document.querySelector('#board-text'); return t.scrollHeight <= t.clientHeight + 1; })()`), 'caixa mostra todas as linhas');
for (let i = 0; i < 4; i++) { await key('Backspace'); await key('Backspace'); }
await key('Escape');
await sleep(900);
let lastTxt = (await boardEls()).at(-1);
assert.deepEqual([lastTxt.type, lastTxt.text], ['text', 'Linha um\nlinha dois\nlinha três'], 'Esc confirma as três linhas');
assert.equal(await ev(`[...document.querySelectorAll('#board-root .el[data-id="${lastTxt.id}"] tspan')].length`), 3, 'desenhado em três linhas');
const lt = await elBox(lastTxt.id);
await dbl(lt.x + lt.w / 2, lt.y + 5);
await ev(`document.querySelector('#board-text').setSelectionRange(99, 99)`);
await typeText('!');
await key('Enter', 2);  // Ctrl+Enter também confirma
await sleep(900);
assert.equal((await boardEls()).at(-1).text, 'Linha um\nlinha dois\nlinha três!', 'Ctrl+Enter confirma');
// texto grande: a caixa de edição cabe as letras da Kalam e não rola (antes o texto "pulava" para cima)
await ev(`document.querySelector('#board-props [data-prop="fontSize"] [data-value="36"]').click()`);
const big = await elBox(lastTxt.id);
assert.ok(big.x > 0 && big.y + big.h < 700, 'texto continua na tela');
assert.equal(await ev(`document.querySelector('#board-text').hidden`), true);
await dbl(big.x + 10, big.y + big.h / 2);
assert.equal(await ev(`document.querySelector('#board-text').value`), lastTxt.text.replace(/!?$/, '!'), 'editando o texto grande');
assert.ok(await ev(`(() => { const t = document.querySelector('#board-text'); return t.scrollHeight <= t.clientHeight; })()`), 'caixa cabe o texto grande');
assert.equal(await ev(`(() => { const t = document.querySelector('#board-text'); t.scrollTop = 30; t.dispatchEvent(new Event('scroll')); return t.scrollTop; })()`), 0, 'caixa não rola');
await key('Escape');
await ev(`document.querySelector('#board-props [data-prop="fontSize"] [data-value="20"]').click()`);
await sleep(900);
await ev(`document.querySelector('#board-props [data-prop="textAlign"] [data-value="center"]').click()`);
await sleep(900);
assert.equal((await boardEls()).at(-1).textAlign, 'center', 'alinhamento salvo');
assert.equal(await ev(`document.querySelector('#board-root .el[data-id="${lastTxt.id}"] text').getAttribute('text-anchor')`), 'middle', 'texto centralizado');
const wHand = (await boardEls()).at(-1).w;
await ev(`document.querySelector('#board-props [data-prop="fontFamily"] [data-value="code"]').click()`);
await sleep(900);
const codeTxt = (await boardEls()).at(-1);
assert.equal(codeTxt.fontFamily, 'code', 'família da fonte salva');
assert.notEqual(codeTxt.w, wHand, 'largura medida de novo com a nova fonte');
assert.match(await ev(`document.querySelector('#board-root .el[data-id="${lastTxt.id}"] text').getAttribute('font-family')`), /monospace/, 'texto em fonte de código');
await ev(`document.querySelector('#board-props [data-prop="fontFamily"] [data-value="hand"]').click()`);
await ev(`(() => { window.prompt = () => 'example.com/doc'; window.__opened = []; window.open = (u) => { window.__opened.push(u); }; })()`);
await ev(`document.querySelector('#board-props [data-act="link"]').click()`);
await sleep(900);
assert.equal((await boardEls()).at(-1).link, 'https://example.com/doc', 'link salvo (com https)');
const lbx = await ev(`(() => { const r = document.querySelector('#board-root .link-badge').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
await click(lbx[0], lbx[1]);
assert.deepEqual(await ev(`window.__opened`), ['https://example.com/doc'], 'clicar no ícone abre o link');
await ev(`window.prompt = () => 'javascript:alert(1)'; window.alert = () => {}`);
await key('k', 2);
await sleep(900);
assert.equal((await boardEls()).at(-1).link, 'https://example.com/doc', 'endereço inválido não entra');

// quadro: cada ferramenta mostra a letra do atalho no canto do botão
const hint = (t) => ev(`getComputedStyle(document.querySelector('#board-tools [data-tool="${t}"]'), '::after').content`);
assert.deepEqual(await Promise.all(['hand', 'select', 'rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'eraser'].map(hint)),
  ['"H"', '"V"', '"R"', '"D"', '"O"', '"A"', '"L"', '"P"', '"T"', '"E"'], 'letras de atalho nos botões');

// quadro: menus do topo fecham ao clicar fora e ao clicar de novo no próprio botão
const shownSel = (sel) => ev(`!document.querySelector('${sel}').hidden`);
await ev(`document.querySelector('#map-menu-btn').click()`);
assert.equal(await shownSel('#map-menu'), true, 'menu do quadro abre');
await click(cv.x + 1100, cv.y + 560);  // lousa vazia
assert.equal(await shownSel('#map-menu'), false, 'clicar fora fecha o menu do quadro');
const mb = await ev(`(() => { const r = document.querySelector('#map-menu-btn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
await click(mb[0], mb[1]);
assert.equal(await shownSel('#map-menu'), true);
await click(mb[0], mb[1]);
assert.equal(await shownSel('#map-menu'), false, 'clicar de novo no ⋯ fecha');
await ev(`document.querySelector('#export-btn').click()`);
await click(mb[0], mb[1]);
assert.equal(await shownSel('#export-menu'), false, 'abrir um menu do topo fecha o outro');
assert.equal(await shownSel('#map-menu'), true);
await click(cv.x + 1300, cv.y + 150);  // outro ponto: dois cliques no mesmo lugar viram duplo clique (texto novo)
await key('?');
assert.equal(await shownSel('#board-help'), true);
await click(cv.x + 1100, cv.y + 560);
assert.equal(await shownSel('#board-help'), false, 'clicar fora fecha os atalhos');

// quadro: menu "mais ferramentas" e balde de tinta
await ev(`document.querySelector('#board-more-btn').click()`);
assert.equal(await shownSel('#board-more'), true, 'menu mais ferramentas abre');
await click(cv.x + 1300, cv.y + 150);
assert.equal(await shownSel('#board-more'), false, 'clicar fora fecha o menu mais');
await key('2');
await dragScreen(cv.x + 1050, cv.y + 500, cv.x + 1200, cv.y + 600);
await sleep(900);
const emptyRect = (await boardEls()).at(-1);
assert.equal(emptyRect.type, 'rectangle');
await ev(`document.querySelector('#board-more-btn').click()`);
await ev(`document.querySelector('#board-more [data-tool="bucket"]').click()`);
assert.equal(await shownSel('#board-more'), false, 'escolher fecha o menu');
assert.equal(await ev(`document.querySelector('#board-more-btn').classList.contains('active')`), true, 'botão ⋯ ativo com o balde');
assert.equal(await ev(`document.querySelector('#board-more-btn use').getAttribute('href')`), '#i-bucket-droplet', '⋯ mostra o ícone do balde');
await ev(`document.querySelector('#board-props [data-prop="backgroundColor"] [data-value="#ffec99"]').click()`);
await click(cv.x + 1125, cv.y + 550);  // miolo vazio do retângulo
await sleep(900);
assert.equal((await boardEls()).find(e => e.id === emptyRect.id).backgroundColor, '#ffec99', 'balde pinta o fundo');
await key('v');
await key('b');
assert.equal(await ev(`document.querySelector('#board-tools [data-tool="bucket"]').classList.contains('active')`), true, 'tecla B = balde');
await key('v');

// quadro: seleção de laço (contorno livre em volta do retângulo pintado)
await key('q');
assert.equal(await ev(`document.querySelector('#board-more-btn use').getAttribute('href')`), '#i-lasso', 'tecla Q = laço');
const loop = [[1030, 480], [1220, 480], [1220, 620], [1030, 620], [1030, 490]];
await mouse('mousePressed', cv.x + loop[0][0], cv.y + loop[0][1]);
for (const [x, y] of loop.slice(1)) await mouse('mouseMoved', cv.x + x, cv.y + y);
assert.equal(await ev(`document.querySelectorAll('#board-root path.marquee').length`), 1, 'contorno do laço aparece');
await mouse('mouseReleased', cv.x + 1030, cv.y + 490);
assert.equal(await selCount(), 1, 'laço seleciona o que fica dentro');
assert.equal(await ev(`document.querySelector('#board-canvas').dataset.tool`), 'select', 'depois do laço volta para seleção');
await key('Escape');

// quadro: ponteiro laser deixa um rastro que some e não vira elemento
const nBeforeLaser = (await boardEls()).length;
await key('k');
assert.equal(await ev(`document.querySelector('#board-more-btn use').getAttribute('href')`), '#i-laser', 'tecla K = laser');
await mouse('mousePressed', cv.x + 700, cv.y + 560);
for (let i = 1; i <= 5; i++) await mouse('mouseMoved', cv.x + 700 + i * 30, cv.y + 560 + (i % 2) * 20);
assert.equal(await ev(`document.querySelectorAll('#board-root path.laser').length`), 1, 'rastro do laser aparece');
await mouse('mouseReleased', cv.x + 850, cv.y + 560);
await sleep(1400);
assert.equal(await ev(`document.querySelectorAll('#board-root path.laser').length`), 0, 'rastro some sozinho');
assert.equal((await boardEls()).length, nBeforeLaser, 'laser não cria elementos');
await key('v');

// quadro: inserir imagem (seletor de arquivo e colar), desenhada, salva e embutida no SVG exportado
const pngFile = `(async () => { const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#e03131'; x.fillRect(0, 0, 80, 40);
  return new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'teste.png', { type: 'image/png' }); })()`;
const nBeforeImg = (await boardEls()).length;
await ev(`(async () => { const dt = new DataTransfer(); dt.items.add(await ${pngFile});
  const i = document.querySelector('#board-image-input'); i.files = dt.files; i.dispatchEvent(new Event('change')); })()`);
await sleep(1500);
let imgEl = (await boardEls()).at(-1);
assert.deepEqual([imgEl.type, imgEl.w, imgEl.h], ['image', 80, 40], 'imagem inserida com o tamanho natural');
assert.equal((await fetch(BASE + `/api/maps/${boardId}/files/${imgEl.fileId}`)).headers.get('content-type'), 'image/png', 'arquivo salvo no servidor');
assert.equal(await ev(`document.querySelectorAll('#board-root image').length`), 1, 'imagem desenhada');
assert.equal(await selCount(), 1, 'imagem nova fica selecionada');
await ev(`(async () => { const dt = new DataTransfer(); dt.items.add(await ${pngFile}); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt })); })()`);
await sleep(1500);
assert.equal((await boardEls()).length, nBeforeImg + 2, 'Ctrl+V cola imagem');
await ev(`document.querySelector('#export-btn').click()`);
await ev(`document.querySelector('#export-menu [data-export="svg"]').click()`);
await sleep(800);
const imgSvg = await ev(`fetch(window.__downloads.at(-1)[1]).then(r => r.text())`);
assert.ok(imgSvg.includes('href="data:image/png') && !imgSvg.includes('/api/maps/'), 'SVG exportado com a imagem embutida');

// quadro: nota adesiva (N) — clique cria já editando, texto quebra na largura, duplo clique reedita
const nBeforeNote = (await boardEls()).length;
await key('n');
await click(cv.x + 500, cv.y + 300);
assert.equal(await ev(`document.activeElement?.id`), 'board-text', 'nota já abre para digitar');
assert.equal(await ev(`document.querySelectorAll('#board-root .note-bg').length`), 1, 'nota aparece durante a digitação');
await typeText('Uma nota adesiva com um texto comprido que precisa quebrar sozinho dentro dela');
assert.equal(await ev(`getComputedStyle(document.querySelector('#board-text')).whiteSpace`), 'pre-wrap', 'caixa quebra na largura da nota');
await key('Escape');
await sleep(900);
const note = (await boardEls()).at(-1);
assert.deepEqual([note.type, note.w, (await boardEls()).length], ['note', 200, nBeforeNote + 1], 'nota salva');
assert.ok(await ev(`document.querySelectorAll('#board-root .el[data-id="${note.id}"] tspan').length`) > 1, 'texto quebrado em várias linhas');
const nb = await elBox(note.id);
await dbl(nb.x + nb.w / 2, nb.y + nb.h / 2);
assert.equal(await ev(`document.querySelector('#board-text').value`), note.text, 'duplo clique reedita a nota');
await key('Escape');

// quadro: clicar fora conclui a nota/texto sem perder o que foi digitado (antes: criava outro e sumia)
for (const [tool, x] of [['n', 300], ['t', 800]]) {
  const before = (await boardEls()).length;
  await key(tool);
  await click(cv.x + x, cv.y + 150);
  await typeText('123');
  await sleep(500);
  await click(cv.x + x + 250, cv.y + 450);  // fora
  await sleep(900);
  const els = await boardEls();
  assert.deepEqual([els.length, els.at(-1).text], [before + 1, '123'], `clicar fora salva (${tool})`);
  assert.equal(await ev(`document.querySelector('#board-text').hidden`), true);
}

// recarregar volta onde parou: posição/zoom e seleção (quadro e mapa)
await key('a', 2);
await ev(`document.querySelector('#board-zoom-in').click()`);
const boardT = await ev(`document.querySelector('#board-root').getAttribute('transform')`), boardSel = await selCount();
await sleep(900); await cmd('Page.reload'); await sleep(1500);
assert.equal(await ev(`document.querySelector('#board-root').getAttribute('transform')`), boardT, 'quadro volta na mesma posição e zoom');
assert.equal(await selCount(), boardSel, 'quadro volta com a mesma seleção');
await ev(`location.hash = '#/map/demo'`); await sleep(800);
await ev(`document.querySelector('#zoom-in').click()`);
await clickNode('Recursos');
const mapT = await ev(`document.querySelector('#viewport').getAttribute('transform')`);
await sleep(900); await cmd('Page.reload'); await sleep(1500);
assert.equal(await ev(`document.querySelector('#viewport').getAttribute('transform')`), mapT, 'mapa volta na mesma posição e zoom');
assert.ok((await ev(`document.querySelector('.selected-ring').parentNode.textContent`)).startsWith('Recursos'), 'mapa volta com o mesmo nó selecionado');

// pastas: criar, entrar, subpasta, documento novo nasce na pasta, voltar cai na pasta, renomear, apagar (conteúdo sobe)
const tree = async () => (await fetch(BASE + '/api/folders')).json();
const listNames = () => ev(`[...document.querySelectorAll('#maps li > a')].map(a => a.textContent)`);
await ev(`location.hash = '#/'`); await sleep(800);
await ev(`window.prompt = () => 'Trabalho'; document.querySelector('#new-folder').click()`); await sleep(800);
const work = (await tree()).folders.find(f => f.name === 'Trabalho');
assert.ok(work && work.parent === null, 'pasta criada no Início');
assert.ok((await listNames()).includes('Trabalho'), 'pasta aparece na lista');
await ev(`document.querySelector('#maps li.folder a').click()`); await sleep(800);
assert.equal(await ev(`location.hash`), `#/folder/${work.id}`, 'entra na pasta');
assert.equal(await ev(`document.querySelector('#empty').textContent`), 'Pasta vazia.');
await ev(`window.prompt = () => 'Clientes'; document.querySelector('#new-folder').click()`); await sleep(800);
const cli = (await tree()).folders.find(f => f.name === 'Clientes');
assert.equal(cli.parent, work.id, 'subpasta dentro de Trabalho');
await ev(`location.hash = '#/folder/${cli.id}'`); await sleep(800);
assert.equal(await ev(`document.querySelector('#list-title').textContent`), 'Meus mapas›Trabalho›Clientes', 'trilha');
await ev(`document.querySelector('#new-map').click()`); await sleep(1200);
const newMapId = await ev(`location.hash.match(/^#\\/map\\/(.+)$/)?.[1]`);
assert.equal((await tree()).place[newMapId], cli.id, 'mapa novo nasce na pasta aberta');
assert.equal(await ev(`document.querySelector('.brand').getAttribute('href')`), `#/folder/${cli.id}`, 'voltar leva para a pasta do mapa');
await ev(`document.querySelector('.brand').click()`); await sleep(800);
assert.equal((await listNames()).length, 1, 'mapa listado dentro da pasta');
await ev(`location.hash = '#/folder/${work.id}'`); await sleep(800);
await ev(`window.prompt = () => 'Clientes VIP'; document.querySelector('#maps li.folder [data-rename-folder]').click()`); await sleep(800);
assert.equal((await tree()).folders.find(f => f.id === cli.id).name, 'Clientes VIP', 'renomeia');
await ev(`location.hash = '#/'`); await sleep(800);
const rootDocs = (await listNames()).length;
await ev(`window.confirm = () => true; [...document.querySelectorAll('#maps li.folder')].find(li => li.textContent.startsWith('Trabalho')).querySelector('[data-delete-folder]').click()`); await sleep(800);
const t2 = await tree();
assert.ok(!t2.folders.some(f => f.id === work.id), 'pasta apagada');
assert.equal(t2.folders.find(f => f.id === cli.id).parent, null, 'subpasta sobe para o Início');
assert.equal(t2.place[newMapId], cli.id, 'mapa continua na subpasta');
assert.equal((await listNames()).length, rootDocs, 'Clientes VIP no lugar de Trabalho');

// pastas: mover pelo menu e arrastando; pasta não entra nela mesma
const vip = (await tree()).folders.find(f => f.name === 'Clientes VIP');
const rootDocId = await ev(`document.querySelector('#maps li:not(.folder)').dataset.drag.split(':')[1]`);
await ev(`document.querySelector('#maps li:not(.folder) [data-move-doc]').click()`);
assert.equal(await shownSel('#move-menu'), true, 'menu Mover para abre');
assert.equal(await ev(`document.querySelector('#move-menu [data-to=""]').disabled`), true, 'pasta atual desabilitada');
await ev(`document.querySelector('#move-menu [data-to="${vip.id}"]').click()`); await sleep(800);
assert.equal((await tree()).place[rootDocId], vip.id, 'menu move o documento');
assert.equal(await shownSel('#move-menu'), false);
await ev(`document.querySelector('#maps li.folder [data-move-folder]').click()`);
assert.equal(await ev(`document.querySelector('#move-menu [data-to="${vip.id}"]').disabled`), true, 'pasta não pode ir para dentro dela mesma');
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
assert.equal((await tree()).folders.find(f => f.id === vip.id).parent, dest.id, 'arrastar pasta sobre pasta move');
await ev(`location.hash = '#/folder/${vip.id}'`); await sleep(800);
await ev(`(() => { const dt = new DataTransfer();
  document.querySelector('#maps li:not(.folder)').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  const home = document.querySelector('#list-title a[data-drop=""]');
  home.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  home.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); })()`);
await sleep(800);
assert.equal(Object.values((await tree()).place).filter(v => v === vip.id).length, 1, 'soltar na trilha leva o documento para o Início');

// pastas: clicar no nome da pasta aberta (título) edita ali mesmo; Esc desiste, Enter salva
await ev(`location.hash = '#/folder/${dest.id}'`); await sleep(800);
await ev(`document.querySelector('#list-title .crumb-current').click()`);
assert.equal(await ev(`document.activeElement?.className`), 'inline-input', 'nome vira campo de edição');
await typeText('Rascunho');
await key('Escape'); await sleep(800);
assert.equal((await tree()).folders.find(f => f.id === dest.id).name, 'Destino', 'Esc desiste');
await ev(`document.querySelector('#list-title .crumb-current').click()`);
await typeText('Projetos');
await key('Enter'); await sleep(800);
assert.equal((await tree()).folders.find(f => f.id === dest.id).name, 'Projetos', 'Enter salva o novo nome');
assert.equal(await ev(`document.querySelector('#list-title .crumb-current').textContent`), 'Projetos');

// mapa: clicar no nome no topo edita ali mesmo (é o texto do nó central)
await ev(`location.hash = '#/map/demo'`); await sleep(800);
await ev(`document.querySelector('#title').click()`);
await typeText('Planejamento 2027');
await key('Enter'); await sleep(900);
assert.equal((await getMap()).root.text, 'Planejamento 2027', 'nome do mapa salvo');
assert.equal(await ev(`document.querySelector('#title').textContent`), 'Planejamento 2027');

// área de transferência do sistema (eventos copy/paste): mapa copia ramo como lista com recuo; texto colado vira tópicos
const clipEvent = (type, data = {}) => ev(`(() => { const dt = new DataTransfer();
  for (const [k, v] of Object.entries(${JSON.stringify(data)})) dt.setData(k, v);
  const e = new ClipboardEvent('${type}', { clipboardData: dt, bubbles: true, cancelable: true });
  document.dispatchEvent(e);
  return { prevented: e.defaultPrevented, types: [...dt.types], text: dt.getData('text/plain'), json: dt.getData('application/x-galho-board') || dt.getData('application/x-galho-branch') }; })()`);
await clickNode('Planejamento 2027');
const mcopy = await clipEvent('copy');
assert.ok(mcopy.prevented && mcopy.json && mcopy.text.startsWith('Planejamento 2027\n  '), 'copiar ramo: Galho + lista com recuo');
const kidsBefore = (await getMap()).root.children.length;
await clipEvent('paste', { 'text/plain': 'Ideia A\n  Detalhe A1\nIdeia B' });
await sleep(900);
const rootKids = (await getMap()).root.children;
assert.equal(rootKids.length, kidsBefore + 2, 'texto colado vira tópicos');
assert.deepEqual(rootKids.find(c => c.text === 'Ideia A').children.map(c => c.text), ['Detalhe A1'], 'recuo vira filho');
await clipEvent('paste', { 'application/x-galho-branch': '{"text": 1}' });
await sleep(500);
assert.equal((await getMap()).root.children.length, kidsBefore + 2, 'ramo inválido é ignorado');

// quadro: copiar elementos para o sistema e colar (também depois de recarregar); texto de fora vira texto
await ev(`location.hash = '#/board/${boardId}'`); await sleep(1200);
await key('a', 2);
const nSel = await selCount(), nBoard = (await boardEls()).length;
const bcopy = await clipEvent('copy');
assert.ok(bcopy.prevented && JSON.parse(bcopy.json).length === nSel, 'copiar elementos para o sistema');
await cmd('Page.reload'); await sleep(1500);
await clipEvent('paste', { 'application/x-galho-board': bcopy.json });
await sleep(900);
assert.equal((await boardEls()).length, nBoard + nSel, 'colar depois de recarregar');
await clipEvent('paste', { 'text/plain': 'Texto colado' });
await sleep(900);
assert.deepEqual([(await boardEls()).at(-1).type, (await boardEls()).at(-1).text], ['text', 'Texto colado'], 'texto de fora vira texto');
await clipEvent('paste', { 'application/x-galho-board': '[{"type":"script","x":0,"y":0}]' });
await sleep(500);
assert.equal((await boardEls()).length, nBoard + nSel + 1, 'elemento desconhecido é ignorado');

// Ctrl+X recorta: no sistema (evento cut) e pela tecla (cópia interna); colar devolve
const nCut = (await boardEls()).length, cutId = (await boardEls()).at(-1).id;
await key('a', 2);
await key('Escape');
const lastBox = await elBox(cutId);
await click(lastBox.x + lastBox.w / 2, lastBox.y + lastBox.h / 2);
const bcut = await clipEvent('cut');
await sleep(900);
assert.ok(bcut.prevented && JSON.parse(bcut.json)[0].id === cutId, 'recortar copia para o sistema');
assert.equal((await boardEls()).length, nCut - 1, 'recortar apaga');
await clipEvent('paste', { 'application/x-galho-board': bcut.json });
await sleep(900);
assert.equal((await boardEls()).length, nCut, 'colar devolve o recortado');
await key('x', 2);
await sleep(900);
assert.equal((await boardEls()).length, nCut - 1, 'Ctrl+X pela tecla também recorta');
await ev(`location.hash = '#/map/demo'`); await sleep(1000);
await clickNode('Ideia B');
await clipEvent('cut');
await sleep(900);
assert.ok(!(await getMap()).root.children.some(c => c.text === 'Ideia B'), 'mapa: recortar apaga o ramo');

// colar em outro documento leva junto os arquivos (imagem do quadro; imagem e anexo do nó)
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
await clipEvent('paste', { 'application/x-galho-board': qcopy.json });
await sleep(1200);
const qbImg = (await (await fetch(BASE + '/api/maps/qb')).json()).elements[0];
assert.ok(qbImg && qbImg.fileId !== qaFile && !('fileSrc' in qbImg), 'imagem colada ganha arquivo próprio no outro quadro');
assert.equal((await fetch(BASE + `/api/maps/qb/files/${qbImg.fileId}`)).status, 200, 'arquivo existe no quadro de destino');
await fetch(BASE + '/api/maps/ma', { method: 'PUT', body: JSON.stringify({ version: 0, root: { id: 'ra', text: 'Origem', children: [] } }) });
const maImg = await upTo('ma', 'n.png'), maAtt = await upTo('ma', 'doc.png');
await fetch(BASE + '/api/maps/ma', { method: 'PUT', body: JSON.stringify({ version: 1, root: { id: 'ra', text: 'Origem', children: [
  { id: 'na', text: 'Com arquivos', side: 'right', children: [], image: { id: maImg, w: 1, h: 1 }, attachments: [{ id: maAtt, name: 'doc.png', size: 70 }] }] } }) });
await ev(`location.hash = '#/map/ma'`); await sleep(1200);
await clickNode('Com arquivos');
const mcopy2 = await clipEvent('copy');
await ev(`location.hash = '#/map/demo'`); await sleep(1200);
await clickNode('Planejamento 2027');
await clipEvent('paste', { 'application/x-galho-branch': mcopy2.json });
await sleep(1500);
const pasted = (await getMap()).root.children.find(c => c.text === 'Com arquivos');
assert.ok(pasted && pasted.image.id !== maImg && pasted.attachments[0].id !== maAtt && !('src' in pasted), 'ramo colado ganha arquivos próprios');
assert.equal((await fetch(BASE + `/api/maps/demo/files/${pasted.attachments[0].id}`)).status, 200, 'anexo existe no mapa de destino');

// texto não se desloca ao entrar na edição: primeira linha de tinta igual (±1 px) no desenho e na caixa
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
  await click(cv.x + 1250, cv.y + 120);  // solta a seleção (sem a moldura na foto)
  await sleep(500);
  const tid = (await ev(`[...document.querySelectorAll('#board-root .el')].at(-1).dataset.id`));
  const tb = await elBox(tid);
  const viewTop = await inkTop(tb);
  await dbl(tb.x + tb.w / 2, tb.y + tb.h / 2);
  await ev(`document.querySelector('#board-text').style.caretColor = 'transparent'`);
  const editTop = await inkTop(tb);
  assert.ok(viewTop >= 0 && Math.abs(editTop - viewTop) <= 1, `texto (${fam}) no mesmo lugar ao editar: ${viewTop} vs ${editTop}`);
  await key('Escape');
  await key('Delete');
  await sleep(300);
}

// editando um texto existente, a moldura tracejada acompanha os caracteres incluídos/apagados
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
assert.ok(w1 > w0 + 50, `moldura cresce ao digitar: ${w0} → ${w1}`);
for (let i = 0; i < 9; i++) await key('Backspace');
assert.ok(await selW() < w1 - 30, 'moldura diminui ao apagar');
const selH = () => ev(`document.querySelector('#board-root .sel-item').getBoundingClientRect().height`);
const h0 = await selH();
await key('Enter');
assert.ok(await selH() > h0 + 15, 'moldura cresce com o Enter');
await typeText('linha 2');
await key('Escape');

// lista: busca em todas as pastas (sem acento/maiúscula) e ordenação lembrada
await ev(`location.hash = '#/'`); await sleep(1000);
await ev(`document.querySelector('#search').focus()`);
await typeText('clientes vip');
await sleep(300);
assert.deepEqual(await ev(`[...document.querySelectorAll('#maps li')].map(li => [li.classList.contains('folder'), li.querySelector('a').firstChild.nextSibling.textContent, li.querySelector('.where')?.textContent])`),
  [[true, 'Clientes VIP', 'Meus mapas › Projetos']], 'busca acha a subpasta e mostra onde ela está');
await key('Escape');
assert.equal(await ev(`document.querySelector('#search').value`), '', 'Esc limpa a busca');
assert.equal(await ev(`document.querySelectorAll('#maps .where').length`), 0, 'sem busca, volta a lista da pasta');
const folderOrder = () => ev(`[...document.querySelectorAll('#maps li.folder > a')].map(a => a.textContent)`);
await ev(`(() => { const s = document.querySelector('#sort'); s.value = 'za'; s.dispatchEvent(new Event('change')); })()`);
const za = await folderOrder();
assert.deepEqual(za, [...za].sort((a, b) => b.localeCompare(a, 'pt-BR')), 'Nome (Z–A)');
await cmd('Page.reload'); await sleep(1500);
assert.equal(await ev(`document.querySelector('#sort').value`), 'za', 'ordenação lembrada depois de recarregar');
await ev(`(() => { const s = document.querySelector('#sort'); s.value = 'recent'; s.dispatchEvent(new Event('change')); })()`);

// busca também na lixeira (pelo nome), mesmo dentro de uma pasta
await fetch(BASE + '/api/maps/lixo-teste', { method: 'PUT', body: JSON.stringify({ version: 0, type: 'board', title: 'Lixo de teste', elements: [] }) });
await fetch(BASE + '/api/maps/lixo-teste', { method: 'DELETE' });
await ev(`location.hash = '#/folder/${dest.id}'`); await sleep(1000);
await ev(`document.querySelector('#search').focus()`);
await typeText('lixo de');
await sleep(300);
assert.equal(await shownSel('#trash'), true, 'lixeira aparece na busca');
assert.equal(await ev(`document.querySelector('#trash').open`), true, 'aberta');
assert.deepEqual(await ev(`[...document.querySelectorAll('#trash-list li span')].map(s => s.textContent)`), ['Lixo de teste'], 'só o que bate com a busca');
assert.equal(await shownSel('#empty'), false, 'sem "nada encontrado" quando só a lixeira tem resultado');
await key('Escape');
assert.equal(await shownSel('#trash'), false, 'sem busca, dentro da pasta, lixeira some');

// apagar mapa/quadro pergunta antes; cancelar não apaga
await fetch(BASE + '/api/maps/pergunta', { method: 'PUT', body: JSON.stringify({ version: 0, type: 'board', title: 'Pergunta', elements: [] }) });
await ev(`location.hash = '#/'`); await sleep(1000);
await ev(`window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return false; }; document.querySelector('#maps [data-delete="pergunta"]').click()`); await sleep(600);
assert.match(await ev(`window.__asked[0]`), /^Apagar o quadro "Pergunta"\?/, 'pergunta com o nome');
assert.equal((await fetch(BASE + '/api/maps/pergunta')).status, 200, 'cancelar não apaga');
await ev(`window.confirm = () => true; document.querySelector('#maps [data-delete="pergunta"]').click()`); await sleep(800);
assert.equal((await fetch(BASE + '/api/maps/pergunta')).status, 404, 'confirmar apaga (vai para a lixeira)');

// colagens forjadas (outro site pode pôr qualquer coisa na área de transferência): nada quebra o desenho,
// nada inválido é salvo e o documento continua editável
await fetch(BASE + '/api/maps/secb', { method: 'PUT', body: JSON.stringify({ version: 0, type: 'board', title: 'Seguro', elements: [{ ...elBase, id: 'ok1', type: 'rectangle', x: 300, y: 200, w: 80, h: 60 }] }) });
const secEls = async () => (await (await fetch(BASE + '/api/maps/secb')).json()).elements;
const secDom = () => ev(`document.querySelectorAll('#board-root .el').length`);
await ev(`location.hash = '#/board/secb'`); await sleep(1200);
for (const bad of ['[{"id":"1","type":"text","x":0,"y":0}]', '[{"id":"1","type":"arrow","x":0,"y":0}]', JSON.stringify([{ id: '1', type: 'text', x: 0, y: 0, text: 'a'.repeat(1000001) }])]) {
  await clipEvent('paste', { 'application/x-galho-board': bad });
  await sleep(700);
  assert.deepEqual([(await secEls()).length, await secDom()], [1, 1], 'colagem forjada recusada: ' + bad.slice(0, 40));
}
await clipEvent('paste', { 'application/x-galho-board': '[{"id":"1","type":"rectangle","x":0,"y":0,"link":5}]' });
await sleep(900);
const secPasted = (await secEls()).at(-1);
assert.deepEqual([(await secEls()).length, await secDom(), secPasted.type, 'link' in secPasted], [2, 2, 'rectangle', false], 'link inválido sai e o resto é colado');
await key('ArrowRight');
await sleep(900);
assert.equal((await secEls()).at(-1).x, secPasted.x + 1, 'quadro continua salvando depois das colagens forjadas');

await fetch(BASE + '/api/maps/secm', { method: 'PUT', body: JSON.stringify({ version: 0, layout: 'map', root: { id: 'sr', text: 'Seguro', children: [] } }) });
const secMap = async () => (await (await fetch(BASE + '/api/maps/secm')).json()).root;
const secNodes = () => ev(`document.querySelectorAll('#viewport .node').length`);
await ev(`location.hash = '#/map/secm'`); await sleep(1200);
await clipEvent('paste', { 'application/x-galho-branch': '{"text":"a","children":[{"text":"b","children":[],"shape":"rect","color":5}]}' });
await sleep(900);
const secA = (await secMap()).children[0];
assert.deepEqual([secA.text, secA.children[0].text, secA.children[0].shape, 'color' in secA.children[0]], ['a', 'b', 'rect', false], 'cor inválida sai do ramo colado');
assert.equal(await secNodes(), 3, 'mapa continua desenhado depois da colagem forjada');
await clickNode('Seguro');
await clipEvent('paste', { 'application/x-galho-branch': '{"text":"cor","children":[],"borderColor":"url(https://attacker.example/p.gif)","lineColor":"#e5383b"}' });
await sleep(900);
const secCor = (await secMap()).children.find(c => c.text === 'cor');
assert.deepEqual(['borderColor' in secCor, secCor.lineColor], [false, '#e5383b'], 'cor url(...) não é guardada; a hexadecimal fica');
await clickNode('cor');
await ev(`document.querySelector('#style-btn').click()`);
assert.equal(await ev(`document.querySelectorAll('#style-pop [style*="url("], #viewport [stroke*="url(h"], #viewport [fill*="url(h"]').length`), 0, 'nenhuma cor url(...) chega ao painel nem ao desenho');
await clipEvent('paste', { 'application/x-galho-branch': JSON.stringify({ text: 'x'.repeat(1000001), children: [] }) });
await sleep(700);
assert.equal(await secNodes(), 4, 'ramo grande demais é recusado');
await key('Escape');
await key('Tab');
await typeText('depois');
await key('Enter');
await sleep(900);
assert.ok((await secMap()).children.find(c => c.text === 'cor').children.some(c => c.text === 'depois'), 'mapa continua salvando depois das colagens forjadas');

// seletor de idioma: a escolha fica guardada e a página recarrega; sem dicionário para o idioma, a interface segue em português
await ev(`location.hash = '#/'`); await sleep(800);
assert.deepEqual(await ev(`[...document.querySelectorAll('#lang option')].map(o => o.textContent)`), ['Português (Brasil)', 'English', 'Español', '日本語']);
assert.equal(await ev(`document.querySelector('#lang').title`), 'Idioma');
const pickLang = async (code) => {
  await ev(`(() => { window.sameDocument = true; const s = document.querySelector('#lang'); s.value = '${code}'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(1500);
  return ev(`[window.sameDocument ?? 'reloaded', localStorage.getItem('galho:lang'), document.querySelector('#lang').value, document.documentElement.lang]`);
};
assert.deepEqual(await pickLang('ja'), ['reloaded', 'ja', 'ja', 'ja'], 'escolher outro idioma guarda a escolha e recarrega');
assert.deepEqual(await ev(`[document.querySelector('#new-map').textContent, document.querySelector('#search').placeholder, document.querySelector('#logout-btn').title]`),
  ['Novo mapa', 'Buscar mapas, quadros e pastas', 'Sair'], 'idioma ainda sem dicionário: interface em português');
assert.ok((await ev(`document.querySelector('#trash summary').textContent`)).startsWith('Lixeira ('), 'textos montados em JS também caem no português');
assert.deepEqual(await pickLang('pt-BR'), ['reloaded', 'pt-BR', 'pt-BR', 'pt-BR'], 'volta para o português');

// Sair: encerra a sessão e volta para a página de login
await ev(`location.hash = '#/'`); await sleep(800);
assert.equal(await ev(`!document.querySelector('#logout-btn').hidden`), true, 'botão Sair aparece com login ativo');
await ev(`document.querySelector('#logout-btn').click()`); await sleep(1200);
assert.equal(await ev(`location.pathname`), '/login.html', 'Sair volta para o login');
assert.equal(await ev(`fetch('/api/maps').then(r => r.status)`), 401, 'sessão encerrada');

assert.deepEqual(logs, [], 'sem erros no console');
console.log('E2E OK');
process.exit(0);
