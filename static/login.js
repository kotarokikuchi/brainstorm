import { LANGS, lang, setLang, t, applyI18n } from './i18n.js';

applyI18n();
const form = document.querySelector('#login-form'), error = document.querySelector('#login-error');
const langSelect = document.querySelector('#lang');
langSelect.append(...LANGS.map(l => new Option(l.name, l.code)));
langSelect.value = lang;
langSelect.onchange = () => { setLang(langSelect.value); location.reload(); };
const MESSAGES = { 401: t('login.wrongCredentials'), 429: t('login.tooManyAttempts') };
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  error.hidden = true;
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ user: form.user.value, password: form.password.value }),
    });
    if (r.ok) { location.href = '/'; return; }
    error.textContent = MESSAGES[r.status] ?? t('login.failed', { status: r.status });
  } catch {
    error.textContent = t('login.noConnection');
  }
  error.hidden = false;
  button.disabled = false;
  form.password.select();
});
