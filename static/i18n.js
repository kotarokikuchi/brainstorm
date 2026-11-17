// UI languages. Dictionaries live in locales/<code>.js (flat key → text object);
// pt-BR is the base: it fills in any key missing from the chosen language.
import ptBR from './locales/pt-BR.js';

export const LANGS = [
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'ja', name: '日本語' },
];
const STORE = 'brainstorm:lang', codes = LANGS.map(l => l.code);

// saved choice > browser language (pt* → pt-BR, en* → en...) > English
export function pick(stored, languages = []) {
  if (codes.includes(stored)) return stored;
  for (const n of languages) {
    const c = codes.find(c => n.toLowerCase().startsWith(c.slice(0, 2)));
    if (c) return c;
  }
  return 'en';
}
function saved() { try { return localStorage.getItem(STORE); } catch { return null; /* no storage available */ } }
export const lang = pick(saved(), navigator.languages);
let dict = ptBR;
if (lang !== 'pt-BR') {
  try { dict = (await import(`./locales/${lang}.js`)).default; } catch { /* missing dictionary: stay on pt-BR */ }
}

export const t = (key, params = {}) => (dict[key] ?? ptBR[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
// only stores it; the caller reloads the page
export function setLang(code) { try { localStorage.setItem(STORE, code); } catch { /* same */ } }

// data-i18n → text; data-i18n-title / -placeholder / -aria-label → the attribute
export function applyI18n(root = document) {
  for (const e of root.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
  for (const a of ['title', 'placeholder', 'aria-label']) {
    for (const e of root.querySelectorAll(`[data-i18n-${a}]`)) e.setAttribute(a, t(e.getAttribute(`data-i18n-${a}`)));
  }
  document.documentElement.lang = lang;
}
export const fmtDateTime = (date) => date.toLocaleString(lang);
