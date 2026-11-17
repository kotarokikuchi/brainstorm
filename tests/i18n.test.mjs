// Dicionários de idioma: toda chave usada existe, nenhuma sobra, e as traduções batem com o pt-BR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../static/', import.meta.url);
const files = (ext) => readdirSync(dir).filter(f => f.endsWith(ext)).map(f => [f, readFileSync(new URL(f, dir), 'utf8')]);
const ptBR = (await import('../static/locales/pt-BR.js')).default;
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

// chaves usadas: t('...') nos .js e data-i18n*="..." nos .html
const used = new Map(), dynamic = [];
for (const [name, src] of files('.js')) {
  for (const m of src.matchAll(/\bt\('([^']+)'/g)) used.set(m[1], name);
  // chave montada em tempo de execução escaparia desta conferência (o i18n.js, que define o t, fica de fora)
  if (name !== 'i18n.js') dynamic.push(...(src.match(/\bt\((?!')[^\n]{0,30}/g) ?? []).map(c => `${name}: ${c}`));
}
for (const [name, src] of files('.html')) {
  for (const m of src.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]*)"/g)) used.set(m[1], name);
}

test('every key used in the code and in the HTML exists in pt-BR', () => {
  assert.ok(used.size > 100, 'a busca encontrou as chaves');
  assert.deepEqual([...used].filter(([k]) => !(k in ptBR)).map(([k, f]) => `${k} (${f})`), []);
  assert.deepEqual(dynamic, [], 't() só com chave literal');
});

test('pt-BR has no unused keys', () => {
  assert.deepEqual(Object.keys(ptBR).filter(k => !used.has(k)), []);
});

test('every locale has the same keys and placeholders as pt-BR, and no empty text', async () => {
  for (const f of readdirSync(new URL('locales/', dir)).filter(f => f.endsWith('.js'))) {
    const dict = (await import(`../static/locales/${f}`)).default;
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(ptBR).sort(), `${f}: mesmas chaves do pt-BR`);
    for (const [k, v] of Object.entries(dict)) {
      assert.ok(typeof v === 'string' && v.trim(), `${f}: ${k} vazio`);
      assert.deepEqual(placeholders(v), placeholders(ptBR[k]), `${f}: ${k} usa os mesmos {campos}`);
    }
  }
});

test('language detection: saved choice > browser language > English', async () => {
  const { pick } = await import('../static/i18n.js');
  assert.equal(pick('ja', ['pt-BR']), 'ja', 'saved choice wins');
  assert.equal(pick('xx', ['pt-PT']), 'pt-BR', 'invalid saved choice is ignored');
  assert.equal(pick(null, ['de-DE', 'es-AR']), 'es', 'first supported browser language');
  assert.equal(pick(null, ['en-US']), 'en');
  assert.equal(pick(null, ['de-DE']), 'en', 'unsupported browser language falls back to English');
  assert.equal(pick(null, []), 'en');
});
