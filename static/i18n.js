// Idiomas da interface. Dicionários em locales/<código>.js (objeto plano chave → texto);
// pt-BR é a base: cobre qualquer chave que falte no idioma escolhido.
import ptBR from './locales/pt-BR.js';

export const LANGS = [
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'ja', name: '日本語' },
];
const STORE = 'galho:lang', codes = LANGS.map(l => l.code);

// escolha guardada > idioma do navegador (pt* → pt-BR, en* → en...) > pt-BR
function pick() {
  try { const s = localStorage.getItem(STORE); if (codes.includes(s)) return s; } catch { /* sem armazenamento */ }
  for (const n of navigator.languages ?? []) {
    const c = codes.find(c => n.toLowerCase().startsWith(c.slice(0, 2)));
    if (c) return c;
  }
  return 'pt-BR';
}
export const lang = pick();
let dict = ptBR;
if (lang !== 'pt-BR') {
  try { dict = (await import(`./locales/${lang}.js`)).default; } catch { /* dicionário ausente: fica em pt-BR */ }
}

export const t = (key, params = {}) => (dict[key] ?? ptBR[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
// só guarda; quem chama recarrega a página
export function setLang(code) { try { localStorage.setItem(STORE, code); } catch { /* idem */ } }

// data-i18n → texto; data-i18n-title / -placeholder / -aria-label → o atributo
export function applyI18n(root = document) {
  for (const e of root.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
  for (const a of ['title', 'placeholder', 'aria-label']) {
    for (const e of root.querySelectorAll(`[data-i18n-${a}]`)) e.setAttribute(a, t(e.getAttribute(`data-i18n-${a}`)));
  }
  document.documentElement.lang = lang;
}
export const fmtDateTime = (date) => date.toLocaleString(lang);
