// Markdown seguro: todo texto do usuário é escapado; só saem tags geradas aqui.
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// URL aceita: http(s), mailto, âncora ou relativa. Controles são removidos (o navegador também os ignora).
const safeUrl = u => {
  u = u.trim().split(' ')[0].replace(/[\x00-\x20\x7f]/g, '');
  return /^(https?:|mailto:|#|\/|\.\.?\/|[^:]*$)/i.test(u) ? u : null;
};
const openA = u => `<a href="${u}" target="_blank" rel="noopener noreferrer">`;

// Recebe texto já escapado. Código e links viram marcadores (\0n\0) até o fim, para não sofrerem mais regras.
function fmt(t, stash) {
  const keep = h => `\0${stash.push(h) - 1}\0`;
  t = t.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  t = t.replace(/!?\[([^\][]*)\]\(([^)]*)\)/g, (_, label, url) => {
    const u = safeUrl(url);
    return (u === null ? '' : keep(openA(u))) + fmt(label, stash) + (u === null ? '' : keep('</a>'));
  });
  t = t.replace(/https?:\/\/(?:[^\s&\0]|&amp;)*[^\s&\0.,;:!?)]/g, u => keep(openA(u) + u + '</a>'));
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(?!\s)(.+?)\*/g, '<em>$1</em>');
  return t.replace(/(^|\W)_(?!\s)([^_]+?)_(?!\w)/g, '$1<em>$2</em>');
}

function inline(raw) {
  const stash = [];
  return fmt(esc(raw), stash).replace(/\0(\d+)\0/g, (_, n) => stash[n]);
}

const ITEM = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const HR = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^```([\w+-]*)/;
const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
const isSep = row => row.includes('-') && cells(row).every(c => /^:?-+:?$/.test(c));
const isBlockStart = l => FENCE.test(l) || /^#{1,6}\s/.test(l) || l.startsWith('>') || HR.test(l) || ITEM.test(l);

function list(items) {
  const base = items[0];
  const tag = /\d/.test(base.mark) ? 'ol' : 'ul';
  let h = `<${tag}>`;
  while (items.length) {
    const it = items.shift();
    const kids = [];
    while (items.length && items[0].indent > it.indent) kids.push(items.shift());
    const task = /^\[( |x|X)\]\s+(.*)$/.exec(it.text);
    const body = task
      ? `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ${inline(task[2])}`
      : inline(it.text);
    h += `<li>${body}${kids.length ? list(kids) : ''}</li>`;
  }
  return h + `</${tag}>`;
}

function blocks(lines, depth = 0) {
  let html = '';
  let i = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      html += `<pre class="front-matter"><code>${esc(lines.slice(1, end).join('\n'))}</code></pre>`;
      i = end + 1;
    }
  }
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (!l.trim()) { i++; continue; }
    if ((m = FENCE.exec(l))) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      i++;
      html += `<pre><code${m[1] ? ` class="lang-${m[1]}"` : ''}>${esc(code.join('\n'))}</code></pre>`;
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
      html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
      i++;
    } else if (HR.test(l)) {
      html += '<hr>';
      i++;
    } else if (l.startsWith('>') && depth < 20) { // limite evita estouro de pilha
      const q = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++) q.push(lines[i].replace(/^>\s?/, ''));
      html += `<blockquote>${blocks(q, depth + 1)}</blockquote>`;
    } else if (ITEM.test(l)) {
      const items = [];
      for (; i < lines.length && (m = ITEM.exec(lines[i])); i++) items.push({ indent: m[1].length, mark: m[2], text: m[3] });
      html += list(items);
    } else if (l.includes('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
      const align = cells(lines[i + 1]).map(c => (c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : c.startsWith(':') ? 'left' : ''));
      const row = (r, tag) => '<tr>' + cells(r).map((c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`).join('') + '</tr>';
      const head = row(l, 'th');
      let body = '';
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) body += row(lines[i], 'td');
      html += `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
    } else {
      const p = [];
      for (; i < lines.length && lines[i].trim() && (!p.length || !isBlockStart(lines[i])); i++) p.push(lines[i]);
      html += `<p>${inline(p.join('\n'))}</p>`;
    }
  }
  return html;
}

export function renderMarkdown(src) {
  return blocks(String(src).replace(/\0/g, '').replace(/\r\n?/g, '\n').split('\n'));
}

const split = s => (s === '' ? [] : s.split('\n'));

// ponytail: O(n·m) — trocar por Myers se skills passarem de ~2 000 linhas
export function diffLines(a, b) {
  const x = split(a), y = split(b);
  const n = x.length, m = y.length;
  if (n * m > 4_000_000) return null;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w); // dp[i*w+j] = LCS de x[i:] e y[j:]
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] = x[i] === y[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) out.push({ op: 'same', text: x[i++] }), j++;
    else if (j >= m || (i < n && dp[(i + 1) * w + j] >= dp[i * w + j + 1])) out.push({ op: 'del', text: x[i++] });
    else out.push({ op: 'add', text: y[j++] });
  }
  return out;
}
