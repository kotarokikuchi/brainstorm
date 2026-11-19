// README screenshots: own server (temp data, login on) + headless Chrome in English.
// Usage (from the repo root): node tools/screenshots.mjs [out-dir]   (default: screenshots/)
// Needs Node 22+ and google-chrome on the PATH. All data is fictional; nothing leaves this machine.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'screenshots';
mkdirSync(outDir, { recursive: true });
const PORT = 8826, CDP = 9426, BASE = `http://127.0.0.1:${PORT}`, W = 1280, H = 800;
const tmp = mkdtempSync(join(tmpdir(), 'shots-'));
const server = spawn('python3', ['-c', 'import sys; from pathlib import Path; from app import make_server; make_server(Path(sys.argv[1]), int(sys.argv[2]), auth=("demo", "a-long-demo-password")).serve_forever()', join(tmp, 'data'), String(PORT)], { stdio: 'ignore' });
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP}`, '--lang=en-US', '--accept-lang=en-US', `--window-size=${W},${H}`, '--hide-scrollbars', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore', env: { ...process.env, LANGUAGE: 'en_US' } });
process.on('exit', () => { chrome.kill(); server.kill(); rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });
setTimeout(() => { console.error('timeout'); process.exit(1); }, 150000).unref();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); break; } catch { await sleep(200); } }
for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/login.html'); break; } catch { await sleep(100); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let seq = 0; const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
const cmd = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
const shot = async (name) => { writeFileSync(join(outDir, name + '.png'), Buffer.from((await cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); console.log('shot', name); };
const go = async (hash, ms = 1200) => { await ev(`location.hash = ${JSON.stringify(hash)}`); await sleep(ms); };
await cmd('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// ---------- login ----------
await cmd('Page.navigate', { url: BASE + '/' }); await sleep(1500);
await ev(`document.querySelector('#login-user').value = 'demo'; document.querySelector('#login-password').value = 'a-long-demo-password'; document.activeElement.blur()`);
await shot('login');
await ev(`document.querySelector('#login-form').requestSubmit()`); await sleep(1500);

// ---------- demo data (through the page, which holds the session) ----------
const put = (path, body) => ev(`fetch(${JSON.stringify('/api' + path)}, { method: 'PUT', body: ${JSON.stringify(JSON.stringify(body))} }).then(r => { if (!r.ok) throw new Error(${JSON.stringify(path)} + ' ' + r.status); return r.status; })`);
const post = (path, body) => ev(`fetch(${JSON.stringify('/api' + path)}, { method: 'POST', body: ${JSON.stringify(JSON.stringify(body))} }).then(r => r.status)`);
let n = 0; const id = () => 'n' + (++n);
const node = (text, children = [], extra = {}) => ({ id: id(), text, children, ...extra });
const branch = (side, color, text, kids) => node(text, kids.map(k => (typeof k === 'string' ? node(k) : k)), { side, color });

await put('/maps/launch', { version: 0, layout: 'map', links: [], root: node('Product launch', [
  branch('right', '#2f5bea', 'Research', ['User interviews', node('Competitors', [node('Pricing'), node('Positioning')]), 'Survey results']),
  branch('right', '#1e8e4e', 'Product', [node('MVP scope', [node('Must have'), node('Nice to have')]), 'Beta testers', node('Roadmap', [], { url: 'https://example.com/roadmap' })]),
  branch('right', '#c2410c', 'Risks', ['Timeline', 'Budget']),
  branch('left', '#9333ea', 'Marketing', ['Landing page', node('Launch post', [], { comments: [{ id: 'c1', text: 'Draft by Friday', at: '2026-11-18T10:00:00Z' }] }), 'Newsletter', 'Demo video']),
  branch('left', '#d97706', 'Team', ['Design', 'Engineering', 'Support']),
  branch('left', '#0891b2', 'Timeline', ['Private beta — March', 'Public launch — May']),
]) });
await put('/maps/okrs', { version: 0, layout: 'org', links: [], root: node('Q1 goals', [branch(null, '#2f5bea', 'Growth', ['Sign-ups', 'Activation']), branch(null, '#1e8e4e', 'Quality', ['Bug backlog', 'Test coverage'])]) });
await put('/maps/reading', { version: 0, layout: 'list', links: [], root: node('Reading list', [node('Books'), node('Articles'), node('Talks')]) });

const base = { strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'hachure', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100 };
let seed = 100; const el = (type, x, y, w, h, extra = {}) => ({ id: 'e' + (++seed), type, x, y, w, h, ...base, seed: seed * 7919, ...extra });
const text = (x, y, t, extra = {}) => el('text', x, y, t.length * 11, 28, { text: t, fontSize: 20, fontFamily: 'hand', textAlign: 'left', ...extra });
const arrow = (x, y, dx, dy, extra = {}) => el('arrow', x, y, 0, 0, { points: [[0, 0], [dx, dy]], ...extra });
const OX = 290, OY = 230;
await put('/maps/flow', { version: 0, type: 'board', title: 'Sign-up flow', elements: [
  text(OX, OY - 70, 'Sign-up flow', { fontSize: 32, w: 220, h: 42 }),
  el('ellipse', OX, OY + 20, 150, 80, { backgroundColor: '#dbeafe', fillStyle: 'solid', strokeColor: '#2f5bea' }), text(OX + 38, OY + 46, 'Visitor', { strokeColor: '#2f5bea' }),
  arrow(OX + 160, OY + 60, 80, 0),
  el('rectangle', OX + 250, OY + 20, 170, 80, { backgroundColor: '#dcfce7', strokeColor: '#1e8e4e' }), text(OX + 280, OY + 46, 'Landing page', { strokeColor: '#1e8e4e' }),
  arrow(OX + 430, OY + 60, 80, 0),
  el('diamond', OX + 520, OY - 5, 170, 130, { backgroundColor: '#fef3c7', fillStyle: 'cross-hatch', strokeColor: '#d97706' }), text(OX + 568, OY + 46, 'Sign up?', { strokeColor: '#b45309' }),
  arrow(OX + 605, OY + 135, 0, 90), text(OX + 618, OY + 165, 'yes', { fontSize: 16 }),
  el('rectangle', OX + 520, OY + 235, 170, 80, { backgroundColor: '#ede9fe', fillStyle: 'solid', strokeColor: '#7c3aed' }), text(OX + 556, OY + 261, 'Onboarding', { strokeColor: '#7c3aed' }),
  arrow(OX + 510, OY + 275, -80, 0),
  el('rectangle', OX + 250, OY + 235, 170, 80, { strokeStyle: 'dashed' }), text(OX + 282, OY + 261, 'First project'),
  arrow(OX + 700, OY + 60, 90, 0, { strokeStyle: 'dashed', strokeColor: '#c2410c' }), text(OX + 720, OY + 28, 'no', { fontSize: 16, strokeColor: '#c2410c' }),
  el('note', OX + 800, OY, 150, 120, { text: 'Send a reminder e-mail after 3 days', fontSize: 16, fontFamily: 'hand', textAlign: 'left', backgroundColor: '#fff3a3' }),
  el('note', OX, OY + 215, 190, 120, { text: 'Measure: time from sign-up to first project', fontSize: 16, fontFamily: 'hand', textAlign: 'left', backgroundColor: '#ffd8a8' }),
  el('freedraw', OX + 255, OY + 345, 0, 0, { strokeColor: '#c2410c', points: Array.from({ length: 34 }, (_, i) => [i * 5, Math.round(Math.sin(i / 2.2) * 5)]) }),
] });
await put('/maps/wire', { version: 0, type: 'board', title: 'Home page wireframe', elements: [el('rectangle', 300, 120, 400, 240)] });

const skillV1 = `---
name: code-review
description: Review a pull request for correctness and clarity
---

# Code review

## When to use

When the user asks for a review of a diff or a pull request.

## Instructions

1. Read the whole diff before commenting.
2. Report bugs first, style last.
`;
const skillV2 = `---
name: code-review
description: Review a pull request for correctness, security and clarity
---

# Code review

## When to use

When the user asks for a review of a diff, a branch or a pull request.

## Instructions

1. Read the **whole diff** before commenting.
2. Report bugs first, then security issues, style last.
3. For each finding, give the \`file:line\` and a concrete failure scenario.

> Never approve code you did not read.

| Severity  | Meaning                    |
|-----------|----------------------------|
| Critical  | Data loss or security hole |
| Important | Wrong behaviour            |
| Minor     | Readability                |

## Checklist

- [x] Tests cover the change
- [ ] Error paths handled
`;
await put('/maps/review', { version: 0, type: 'skill', title: 'Code review', tags: ['review', 'engineering'], content: skillV1 });
await post('/maps/review/history', { label: 'v1 – first draft' });
await put('/maps/review', { version: 1, type: 'skill', title: 'Code review', tags: ['review', 'engineering', 'security'], content: skillV2 });
await put('/maps/commit', { version: 0, type: 'skill', title: 'Commit messages', tags: ['git', 'writing'], content: '# Commit messages\n' });
await put('/maps/meeting', { version: 0, type: 'skill', title: 'Meeting notes', tags: ['writing'], content: '# Meeting notes\n' });

await put('/folders', { version: 0, folders: [{ id: 'work', name: 'Work', parent: null }, { id: 'clients', name: 'Clients', parent: 'work' }, { id: 'personal', name: 'Personal', parent: null }, { id: 'prompts', name: 'Prompt library', parent: null }],
  place: { okrs: 'work', wire: 'work', reading: 'personal', commit: 'prompts', meeting: 'prompts' } });
for (const [pid, body] of [['anthropic', { key: 'sk-ant-demo-000000000000a9F2', model: 'claude-opus-5-5' }], ['deepseek', { key: 'sk-demo-00000000000077Q1', model: 'deepseek-chat' }], ['anthropic', { default: true }]]) await put('/settings/llm/' + pid, body);
await put('/settings/backup', { endpoint: 'https://s3.eu-central-2.wasabisys.com', region: 'eu-central-2', bucket: 'my-brainstorm-backups', prefix: 'brainstorm/', accessKey: 'DEMOACCESSKEY0000', secretKey: 'demo-secret-key-0000000000000000QRST', interval: 24, keep: 14, enabled: false });

// ---------- screens ----------
await ev(`localStorage.setItem('brainstorm:lang', 'en')`);
await cmd('Page.navigate', { url: BASE + '/' }); await sleep(1800);
await shot('list');

await go('#/map/launch', 1800);
await shot('map');
await ev(`document.querySelector('#outline-btn').click()`); await sleep(600);
await shot('outline');
await ev(`document.querySelector('#outline-btn').click()`); await sleep(300);
await go('#/map/okrs', 1500);
await shot('map-org');

await go('#/board/flow', 2000);
// select one element so the style panel shows
for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x: 290 + 522, y: 52 + 230 + 275, button: 'left', clickCount: 1 });
await sleep(600);
await shot('board');

await go('#/skill/review', 1500);
await shot('skill');
await ev(`document.querySelector('#skill-versions-btn').click()`); await sleep(800);
await ev(`document.querySelector('#skill-version-list [data-compare]').click()`); await sleep(800);
await shot('skill-versions');

await go('#/settings/llm', 1200);
await shot('settings-llm');
// demo: the bucket listing and the last-success time are stubbed in the page, so nothing leaves this machine
await ev(`(() => { const real = window.fetch.bind(window); window.fetch = async (url, opts = {}) => {
  const path = String(url), method = opts.method ?? 'GET';
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path.endsWith('/api/backup/list')) return json(['2026-11-19-030000', '2026-11-18-030000', '2026-11-17-030000', '2026-11-16-030000'].map((d, i) => ({ name: 'brainstorm-' + d + '.tar.gz', size: 1482000 - i * 37000, modified: '2026-11-19T03:00:00Z' })));
  if (path.endsWith('/api/settings/backup') && method === 'GET') { const v = await (await real(url, opts)).json(); v.enabled = true; v.status = { ...v.status, lastSuccess: '2026-11-19T03:00:04Z' }; return json(v); }
  return real(url, opts);
}; })()`);
await go('#/settings/backup', 1500);
await shot('settings-backup');
process.exit(0);
