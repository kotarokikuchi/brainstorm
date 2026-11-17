// Skill: documento Markdown usado como skill de um LLM (editor com preview, tags e versões)
import { t, fmtDateTime } from './i18n.js';
import { renderMarkdown, diffLines } from './markdown.js';

let deps = null;   // {api, scheduleSave, flushSave, setStatus, resetSave, loadPlace}
let skill = null;

const $ = (s) => document.querySelector(s);
const MODE = 'galho:skillMode', MODES = ['edit', 'split', 'preview'];
let mode = 'split', raf = 0, bound = false;

export const initSkill = (d) => { deps = d; };
export const currentSkill = () => skill;
export function closeSkill() { skill = null; }

export const newSkill = (id, title, content) => ({ id, version: 0, type: 'skill', title, tags: [], content });

export const skillPlace = () => ({ mode, scroll: $('#skill-text').scrollTop, cursor: $('#skill-text').selectionStart });

function setMode(m) {
  mode = m;
  $('#skill-view').dataset.mode = m;
  for (const b of document.querySelectorAll('.skill-modes button')) b.classList.toggle('active', b.dataset.mode === m);
  try { localStorage.setItem(MODE, m); } catch { /* armazenamento bloqueado */ }
  if (m !== 'edit') renderPreview();
}

function renderPreview() {
  if (skill) $('#skill-preview').innerHTML = renderMarkdown(skill.content);  // saída já escapada pelo renderMarkdown
}

function renderTags() {
  const chips = skill.tags.map((tag) => {
    const chip = document.createElement('span');
    chip.className = 'skill-tag';
    chip.append(tag);
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.title = x.ariaLabel = t('skill.removeTag', { tag });
    x.onclick = () => { skill.tags = skill.tags.filter((g) => g !== tag); renderTags(); deps.scheduleSave(skill); };
    chip.append(x);
    return chip;
  });
  $('#skill-tag-list').replaceChildren(...chips);
}

function addTag(raw) {
  if (!skill) return;
  const tag = raw.trim().toLowerCase().slice(0, 40).trim();
  if (!tag || skill.tags.includes(tag) || skill.tags.length >= 30) return;
  skill.tags.push(tag);
  renderTags();
  deps.scheduleSave(skill);
}

function closeCompare() {
  $('#skill-view').classList.remove('comparing');
  $('#skill-diff').hidden = true;
}

async function loadVersions() {
  const doc = skill;
  const r = await deps.api('GET', `/${doc.id}/history`);
  if (skill !== doc) return;
  const items = r.ok ? await r.json() : [];
  $('#skill-no-versions').hidden = items.length > 0;
  $('#skill-version-list').replaceChildren(...items.map((v) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const when = document.createElement('strong');
    when.textContent = v.label || fmtDateTime(new Date(v.saved));
    const small = document.createElement('small');
    small.textContent = (v.label ? `${fmtDateTime(new Date(v.saved))} · ` : '') + t('skill.chars', { n: v.nodes });
    info.append(when, small);
    const cmp = document.createElement('button');
    cmp.dataset.compare = v.version;
    cmp.textContent = t('skill.compare');
    const res = document.createElement('button');
    res.dataset.restore = v.version;
    res.textContent = t('common.restore');
    li.append(info, cmp, res);
    return li;
  }));
}

async function versionBody(v) {
  const doc = skill;
  const r = await deps.api('GET', `/${doc.id}/history/${v}`);
  const body = r.ok ? await r.json() : null;
  return skill === doc ? body : null;
}

function bind() {
  bound = true;
  const text = $('#skill-text');
  for (const b of document.querySelectorAll('.skill-modes button')) b.onclick = () => setMode(b.dataset.mode);
  text.addEventListener('input', () => {
    if (!skill) return;
    skill.content = text.value;
    deps.scheduleSave(skill);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(renderPreview);
  });
  text.addEventListener('keydown', (e) => {
    if (!skill || e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    document.execCommand('insertText', false, '  ');  // mantém o desfazer nativo do campo
  });
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view === 'skill' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      deps.flushSave();
    }
  });
  const input = $('#skill-tag-input');
  input.addEventListener('keydown', (e) => {
    if (!skill || e.isComposing || e.keyCode === 229) return;  // Enter que confirma a conversão do IME
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input.value); input.value = ''; }
    else if (e.key === 'Backspace' && !input.value && skill.tags.length) { skill.tags.pop(); renderTags(); deps.scheduleSave(skill); }
  });
  input.addEventListener('blur', () => { addTag(input.value); input.value = ''; });
  $('#skill-save-version').onclick = async () => {
    if (!skill) return;
    const label = prompt(t('skill.versionLabelPrompt'));
    if (label === null) return;
    const doc = skill;
    await deps.flushSave();
    if (skill !== doc) return;
    const r = await deps.api('POST', `/${skill.id}/history`, label.trim() ? { label: label.trim() } : {});
    if (!r.ok || skill !== doc) return;
    deps.setStatus(t('skill.versionSaved'));
    if (!$('#skill-versions').hidden) loadVersions();
  };
  $('#skill-versions-btn').onclick = async () => {
    const panel = $('#skill-versions');
    if (!skill) return;
    if (panel.hidden) await loadVersions();
    panel.hidden = !panel.hidden;
    $('#skill-versions-btn').classList.toggle('active', !panel.hidden);
  };
  $('#skill-close-compare').onclick = closeCompare;
  $('#skill-version-list').addEventListener('click', async (e) => {
    const v = e.target.closest('[data-compare], [data-restore]');
    if (!v || !skill) return;
    if (v.dataset.restore && !confirm(t('history.restoreConfirm'))) return;
    const old = await versionBody(v.dataset.compare ?? v.dataset.restore);
    if (!old) return;
    if (v.dataset.restore) {
      skill.content = old.content ?? '';
      skill.tags = old.tags ?? [];
      skill.title = old.title ?? skill.title;
      $('#title').textContent = skill.title;
      text.value = skill.content;
      renderTags();
      renderPreview();
      closeCompare();
      deps.scheduleSave(skill);
      return;
    }
    const diff = diffLines(old.content ?? '', skill.content);
    const box = $('#skill-diff-lines');
    if (!diff) box.replaceChildren(Object.assign(document.createElement('p'), { textContent: t('skill.diffTooLarge'), className: 'skill-diff-msg' }));
    else box.replaceChildren(...diff.map((l) => {
      const row = document.createElement('div');
      row.className = `diff-line ${l.op}`;
      const gutter = document.createElement('span');
      gutter.textContent = { add: '+', del: '−', same: '' }[l.op];
      row.append(gutter, Object.assign(document.createElement('code'), { textContent: l.text || ' ' }));
      return row;
    }));
    $('#skill-view').classList.add('comparing');
    $('#skill-diff').hidden = false;
  });
}

export async function openSkill(id) {
  const r = await deps.api('GET', `/${id}`);
  if (!r.ok) {
    if (r.status === 500) alert(t('map.openError'));
    location.hash = '#/';
    return;
  }
  const doc = await r.json();
  if (doc.type !== 'skill') { location.hash = `#/${doc.type}/${id}`; return; }
  if (!bound) bind();
  skill = doc;
  skill.tags ??= [];
  deps.resetSave();
  document.body.dataset.view = 'skill';
  deps.setStatus(t('status.saved'));
  $('#title').textContent = skill.title;
  const place = deps.loadPlace(id);
  let saved = null;
  try { saved = localStorage.getItem(MODE); } catch { /* idem */ }
  const text = $('#skill-text');
  text.value = skill.content ?? '';
  closeCompare();
  $('#skill-versions').hidden = true;
  $('#skill-versions-btn').classList.remove('active');
  $('#skill-tag-input').value = '';
  renderTags();
  setMode([saved].find((m) => MODES.includes(m)) ?? 'split');
  text.scrollTop = Number.isFinite(place?.scroll) ? place.scroll : 0;
  if (Number.isFinite(place?.cursor)) text.setSelectionRange(place.cursor, place.cursor);
}

export function renameSkill(title) {
  if (!skill || !title || title === skill.title) return;
  skill.title = title;
  document.querySelector('#title').textContent = title;
  deps.scheduleSave(skill);
}
