// Configurações: chaves de LLM e backup no Wasabi/S3. O servidor nunca devolve um segredo, só o final mascarado.
import { t, fmtDateTime } from './i18n.js';
import { fmtSize } from './model.js';

const $ = (s) => document.querySelector(s);
const PROVIDERS = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Google Gemini', deepseek: 'DeepSeek', openrouter: 'OpenRouter' };
// regiões do Wasabi (docs.wasabi.com, "service URLs"): escolher uma preenche o endpoint
const WASABI = {
  'us-east-1': 'N. Virginia', 'us-east-2': 'N. Virginia', 'us-central-1': 'Texas', 'us-west-1': 'Oregon', 'us-west-2': 'San Jose',
  'ca-central-1': 'Toronto', 'eu-central-1': 'Amsterdam', 'eu-central-2': 'Frankfurt', 'eu-west-1': 'London', 'eu-west-2': 'Paris',
  'eu-west-3': 'London', 'eu-south-1': 'Milan', 'ap-northeast-1': 'Tokyo', 'ap-northeast-2': 'Osaka', 'ap-southeast-1': 'Singapore',
  'ap-southeast-2': 'Sydney',
};

async function call(method, path, body) {
  try {
    const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    const data = r.status === 204 ? null : await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };  // rede fora do ar: nunca rejeita
  }
}
const errorText = (r) => (r.status === 409 ? t('settings.busy') : t('settings.error', { detail: r.data?.error ?? (r.status ? `HTTP ${r.status}` : 'network error') }));
function say(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
}
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const secretPlaceholder = (hint, empty) => (hint ? t('settings.secretSaved', { hint }) : empty);

export function openSettings(section) {
  document.body.dataset.view = 'settings';
  $('#settings-llm').hidden = section !== 'llm';
  $('#settings-backup').hidden = section !== 'backup';
  return section === 'llm' ? loadLlm() : loadBackup();
}

// ---------- LLM ----------
async function loadLlm() {
  const r = await call('GET', '/api/settings/llm');
  if (r.ok) $('#llm-list').replaceChildren(...r.data.map(llmRow));
}

function llmRow(p) {
  const name = PROVIDERS[p.id] ?? t('settings.llm.custom');
  const key = el('input', { type: 'password', autocomplete: 'new-password', spellcheck: false, maxLength: 500, placeholder: secretPlaceholder(p.keyHint, t('settings.llm.keyPlaceholder')) });
  const model = el('input', { value: p.model, maxLength: 200, spellcheck: false, placeholder: t('settings.llm.modelPlaceholder') });
  const base = el('input', { value: p.baseUrl, maxLength: 500, spellcheck: false, placeholder: 'http://localhost:11434/v1' });
  const msg = el('span', { className: 'settings-msg', role: 'status' });
  const save = el('button', { className: 'primary', textContent: t('common.save') });
  const remove = el('button', { className: 'danger-link', textContent: t('settings.remove'), hidden: !p.configured });
  const badge = el('span', { className: 'settings-badge' + (p.configured ? ' on' : ''), textContent: p.configured ? t('settings.llm.configured') : t('settings.llm.notConfigured') });
  // LLM padrão: um só, e só entre os que têm chave
  const radio = el('input', { type: 'radio', name: 'llm-default', checked: !!p.default, disabled: !p.configured });
  const pick = el('label', { className: 'llm-default', title: p.configured ? '' : t('settings.llm.defaultNeedsKey') }, radio, el('span', { textContent: t('settings.llm.default') }));
  const li = el('li', { className: 'settings-card settings-grid' + (p.default ? ' is-default' : '') },
    el('div', { className: 'settings-head settings-wide' }, el('strong', { textContent: name }), el('span', { className: 'settings-head-end' }, pick, badge)),
    el('label', {}, el('span', { textContent: t('settings.llm.key') }), key),
    el('label', {}, el('span', { textContent: t('settings.llm.model') }), model));
  li.dataset.id = p.id;
  if (p.id === 'custom') li.append(el('label', { className: 'settings-wide' }, el('span', { textContent: t('settings.llm.baseUrl') }), base));
  li.append(el('div', { className: 'settings-actions settings-wide' }, save, remove, msg));
  radio.onchange = async () => {
    const r = await call('PUT', `/api/settings/llm/${p.id}`, { default: true });
    if (!r.ok) { say(msg, errorText(r), true); radio.checked = false; return; }
    await loadLlm();  // os outros cartões perdem a marca
    say($(`#llm-list [data-id="${p.id}"] .settings-msg`), t('settings.llm.defaultSaved', { name }));
  };
  save.onclick = async () => {
    const body = { model: model.value.trim(), ...(p.id === 'custom' ? { baseUrl: base.value.trim() } : {}), ...(key.value.trim() ? { key: key.value } : {}) };
    const r = await call('PUT', `/api/settings/llm/${p.id}`, body);
    if (!r.ok) { say(msg, errorText(r), true); return; }
    const row = llmRow(r.data);
    li.replaceWith(row);
    say(row.querySelector('.settings-msg'), t('settings.saved'));
  };
  remove.onclick = async () => {
    if (!confirm(t('settings.llm.removeConfirm', { name }))) return;
    const r = await call('DELETE', `/api/settings/llm/${p.id}`);
    if (!r.ok) { say(msg, errorText(r), true); return; }
    const row = llmRow({ id: p.id, configured: false, keyHint: '', model: '', baseUrl: '' });
    li.replaceWith(row);
    say(row.querySelector('.settings-msg'), t('settings.llm.removed'));
  };
  return li;
}

// ---------- Backup ----------
const regions = $('#wasabi-regions');
regions.replaceChildren(...Object.entries(WASABI).map(([code, city]) => el('option', { value: code, label: `Wasabi · ${city}` })));
$('#backup-region').addEventListener('input', (e) => {
  if (WASABI[e.target.value]) $('#backup-endpoint').value = `https://s3.${e.target.value}.wasabisys.com`;
});
// nome do arquivo → data (UTC): brainstorm-2026-11-17-093000.tar.gz
const whenOf = (name) => {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return m ? fmtDateTime(new Date(Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]))) : name;
};
let backupView = null;

async function loadBackup() {
  const r = await call('GET', '/api/settings/backup');
  if (!r.ok) return;
  showBackup(r.data);
  say($('#backup-msg'), '');
  loadList();
}

function showBackup(v) {
  backupView = v;
  $('#backup-region').value = v.region;
  $('#backup-endpoint').value = v.endpoint;
  $('#backup-bucket').value = v.bucket;
  $('#backup-prefix').value = v.prefix;
  $('#backup-access').value = v.accessKey;
  $('#backup-secret').value = '';
  $('#backup-secret').placeholder = secretPlaceholder(v.secretHint, t('settings.backup.secretPlaceholder'));
  $('#backup-interval').value = String(v.interval);
  $('#backup-keep').value = v.keep;
  $('#backup-enabled').checked = v.enabled;
  showStatus();
}

function showStatus() {
  const v = backupView, s = v.status, lines = [];
  if (!v.configured) lines.push(t('settings.backup.notConfigured'));
  else lines.push(s.lastSuccess ? t('settings.backup.lastSuccess', { when: fmtDateTime(new Date(s.lastSuccess)) }) : t('settings.backup.never'));
  if (s.lastError) lines.push(t('settings.backup.lastError', { when: fmtDateTime(new Date(s.lastAttempt)), error: s.lastError }));
  $('#backup-status').classList.remove('error');  // o erro de uma ação anterior não pinta o status novo
  $('#backup-status').replaceChildren(...lines.map((l, i) => el('span', { className: i ? 'error' : '', textContent: l })));
  $('#backup-run').disabled = !v.configured;
}

async function loadList() {
  const list = $('#backup-list'), msg = $('#backup-list-msg');
  list.replaceChildren();
  if (!backupView.configured) { say(msg, ''); return; }
  say(msg, t('settings.backup.loading'));
  const r = await call('GET', '/api/backup/list');
  if (!r.ok) { say(msg, errorText(r), true); return; }
  say(msg, r.data.length ? '' : t('settings.backup.empty'));
  list.replaceChildren(...r.data.map((b) => {
    const restore = el('button', { textContent: t('common.restore') });
    restore.onclick = () => restoreBackup(b.name);
    return el('li', { className: 'settings-card backup-item' }, el('span', { textContent: whenOf(b.name) }), el('small', { textContent: fmtSize(b.size) }), restore);
  }));
}

$('#backup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const secret = $('#backup-secret').value.trim();
  const body = {
    endpoint: $('#backup-endpoint').value.trim(), region: $('#backup-region').value.trim(), bucket: $('#backup-bucket').value.trim(),
    prefix: $('#backup-prefix').value.trim(), accessKey: $('#backup-access').value.trim(), interval: Number($('#backup-interval').value),
    keep: Number($('#backup-keep').value), enabled: $('#backup-enabled').checked, ...(secret ? { secretKey: secret } : {}),
  };
  const r = await call('PUT', '/api/settings/backup', body);
  if (!r.ok) { say($('#backup-msg'), r.status === 400 ? t('settings.backup.invalid') : errorText(r), true); return; }
  showBackup(r.data);
  say($('#backup-msg'), t('settings.backup.saved'));
  loadList();
});

// botões que esperam o servidor ficam desligados até a resposta (backup e restore são síncronos)
async function busy(text, work) {
  const buttons = document.querySelectorAll('#settings-backup button');
  for (const b of buttons) b.disabled = true;
  say($('#backup-status'), text);
  try { return await work(); } finally {
    for (const b of buttons) b.disabled = false;
    $('#backup-run').disabled = !backupView?.configured;
    // nenhuma resposta substituiu o texto de andamento: volta ao status guardado
    if ($('#backup-status').textContent === text) backupView ? showStatus() : say($('#backup-status'), '');
  }
}

$('#backup-run').onclick = () => busy(t('settings.backup.running'), async () => {
  const r = await call('POST', '/api/backup/run');
  await loadBackup();  // status novo (sucesso ou erro, que fica guardado) e a lista
  if (!r.ok && r.status !== 502) say($('#backup-status'), errorText(r), true);
});

function restoreBackup(name) {
  if (!confirm(t('settings.backup.restoreConfirm', { when: whenOf(name) }))) return;
  return busy(t('settings.backup.restoring'), async () => {
    const r = await call('POST', '/api/backup/restore', { name });
    if (r.ok) { location.reload(); return; }  // tudo mudou: as outras abas também recarregam (/api/events)
    say($('#backup-status'), errorText(r), true);
  });
}
