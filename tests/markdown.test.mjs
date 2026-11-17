import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown as r, diffLines } from '../static/markdown.js';

test('headings and paragraphs', () => {
  assert.equal(r('# T'), '<h1>T</h1>');
  assert.equal(r('###### s'), '<h6>s</h6>');
  assert.equal(r('a\nb\n\nc'), '<p>a\nb</p><p>c</p>');
});

test('inline formatting', () => {
  assert.equal(r('**n**'), '<p><strong>n</strong></p>');
  assert.equal(r('*i* and _j_'), '<p><em>i</em> and <em>j</em></p>');
  assert.equal(r('`a *b*`'), '<p><code>a *b*</code></p>');
  assert.equal(r('snake_case_name'), '<p>snake_case_name</p>');
});

test('code blocks, quotes and rules', () => {
  assert.equal(r('```py\nx = "<1>"\n```'), '<pre><code class="lang-py">x = &quot;&lt;1&gt;&quot;</code></pre>');
  assert.equal(r('> x'), '<blockquote><p>x</p></blockquote>');
  assert.equal(r('---'), '<hr>');
});

test('lists, nesting and tasks', () => {
  assert.equal(r('- a\n* b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(r('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(r('- a\n  - b\n- c'), '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
  assert.equal(r('- [ ] a\n- [x] b'),
    '<ul><li><input type="checkbox" disabled> a</li><li><input type="checkbox" disabled checked> b</li></ul>');
});

test('links, autolinks, images and tables', () => {
  assert.equal(r('[t](https://a.b)'), '<p><a href="https://a.b" target="_blank" rel="noopener noreferrer">t</a></p>');
  assert.match(r('see https://x.y now'), /<a href="https:\/\/x\.y" target="_blank" rel="noopener noreferrer">https:\/\/x\.y<\/a> now/);
  assert.equal(r('![alt](https://i.png)'), '<p><a href="https://i.png" target="_blank" rel="noopener noreferrer">alt</a></p>');
  assert.equal(r('|a|b|\n|:-|-:|\n|1|2|'),
    '<table><thead><tr><th style="text-align:left">a</th><th style="text-align:right">b</th></tr></thead>' +
    '<tbody><tr><td style="text-align:left">1</td><td style="text-align:right">2</td></tr></tbody></table>');
});

test('front matter', () => {
  assert.equal(r('---\nname: x\n---\n# T'), '<pre class="front-matter"><code>name: x</code></pre><h1>T</h1>');
});

test('escapes raw html', () => {
  assert.equal(r('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.ok(!r('<img src=x onerror=alert(1)>').includes('<img'));
});

test('filters dangerous urls', () => {
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:1', ' javascript:1', 'data:text/html,x', 'java\tscript:1']) {
    const h = r(`[x](${u})`);
    assert.ok(!h.includes('<a'), u);
    assert.ok(h.includes('x'), u);
  }
  const q = r('[x](https://a.b/"onmouseover="1)');
  assert.ok(q.includes('&quot;') && !/<a [^>]*"onmouseover=/.test(q));
});

test('renders 100 KB fast', () => {
  const chunk = '# H\n\ntext **b** *i* `c` [l](https://a.b)\n\n- a\n  - b\n\n```\ncode\n```\n\n|a|b|\n|-|-|\n|1|2|\n\n';
  const src = chunk.repeat(Math.ceil(100000 / chunk.length));
  const t = performance.now();
  r(src);
  assert.ok(performance.now() - t < 200);
});

test('pathological inputs stay fast and never throw', () => {
  for (const src of ['._a'.repeat(33000), '.*a'.repeat(33000), '[a'.repeat(50000)]) {
    const t = performance.now();
    r(src);
    assert.ok(performance.now() - t < 200);
  }
  assert.equal(typeof r('>'.repeat(100000) + ' x'), 'string');
});

test('diffLines', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nx\nc'),
    [{ op: 'same', text: 'a' }, { op: 'del', text: 'b' }, { op: 'add', text: 'x' }, { op: 'same', text: 'c' }]);
  assert.ok(diffLines('a\nb', 'a\nb').every(d => d.op === 'same'));
  assert.deepEqual(diffLines('', 'a'), [{ op: 'add', text: 'a' }]);
  const big = Array(2001).fill('x').join('\n');
  assert.equal(diffLines(big, big), null);
});
