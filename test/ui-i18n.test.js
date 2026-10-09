import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('every language translates the same dashboard labels', async () => {
  const source = await readFile(new URL('../public/ui-i18n.js', import.meta.url), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  const { STRINGS, translate } = context.window.SignalI18n;
  const keys = Object.keys(STRINGS['en-US']).sort();
  const expected = ['en-US', 'es-419', 'fr', 'de', 'ja', 'pt-BR', 'hi', 'ko', 'zh-CN', 'it', 'nl'];
  assert.deepEqual(Object.keys(STRINGS), expected);

  for (const lang of expected) {
    assert.deepEqual(Object.keys(STRINGS[lang]).sort(), keys, `${lang} is missing a label`);
    for (const key of keys) {
      assert.equal(typeof STRINGS[lang][key], 'string');
      assert.ok(STRINGS[lang][key].trim().length > 0, `${lang}.${key} is empty`);
    }
  }

  assert.equal(translate('en-US', 'searchPlaceholder'), 'Search headlines');
  assert.equal(translate('es-419', 'briefing'), 'Tu resumen');
  assert.equal(translate('ja', 'showMoreRemaining', { n: 4 }), 'さらに表示（残り 4 件）');
  assert.equal(translate('de', 'updated'), 'aktualisiert');
  assert.equal(translate('nope', 'save'), 'Save');
  assert.equal(translate('fr', 'resultCount', { n: 2, m: 9 }), '2 sur 9 éléments');
  for (const lang of expected) {
    assert.equal(STRINGS[lang].footer.includes('app-react.html'), false, `${lang} footer still links to React`);
    assert.equal(/react/i.test(STRINGS[lang].footer), false, `${lang} footer still mentions React`);
  }
});

test('language changes translate the page without putting locale into the timestamp', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /src="ui-i18n\.js"/);
  assert.match(html, /function applyI18n\(/);
  assert.match(html, /applyI18n\(\);\s*refresh\(\);/);
  assert.match(html, /statusClock = new Date\(\)\.toLocaleTimeString\('en-US'\)/);
  assert.match(html, /\$\{t\('updated'\)\} \$\{statusClock\}/);
  assert.doesNotMatch(html, /statusEl\.textContent = `[^`]*region/);
  assert.doesNotMatch(html, /statusEl\.textContent = `[^`]*language/);
  assert.match(html, /@media \(max-width: 767px\)[\s\S]*#topicBar \{\s*display: none !important;/);
  assert.match(html, /@media \(max-width: 767px\)[\s\S]*\.mast \.search-row \{\s*display: none !important;/);
  assert.match(html, /id="searchToggle"/);
  assert.match(html, /id="searchOverlay"/);
  assert.match(html, /class="result-meta"/);
  assert.match(html, /id="regionMenu"/);
  assert.match(html, /id="languageMenu"/);
  assert.match(html, /class="locale-trigger is-set"/);
  assert.match(html, /box-shadow:\s*0 10px 25px -5px rgba\(0,\s*0,\s*0,\s*0\.1\), 0 8px 10px -6px rgba\(0,\s*0,\s*0,\s*0\.1\)/);
  assert.match(html, /background-color:\s*#e0e7ff/);
  assert.match(html, /background-color:\s*#f3f4f6/);
  assert.equal(html.includes('app-react.html'), false);
  assert.equal(html.includes('href="app-react.html"'), false);
});
