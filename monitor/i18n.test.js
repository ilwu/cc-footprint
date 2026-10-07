'use strict';

// The language tables in i18n/ say the same things in every language: a
// language added by a file, or a key added to English, fails here until
// every table has it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ITEMS } = require('./config');
const { createI18n, fromLocale } = require('./i18n');

const dir = path.join(__dirname, 'i18n');
const tables = Object.fromEntries(fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  .map(f => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]));
const en = tables.en;
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
// A count's form for 1 is English grammar: other languages need not have it
const required = Object.keys(en).filter(k => !k.endsWith('_one'));

for (const [code, table] of Object.entries(tables)) {
  test(`${code}: every key English has, no other, with the same placeholders`, () => {
    for (const key of required) assert.ok(typeof table[key] === 'string' && table[key], `${code} lacks ${key}`);
    for (const key of Object.keys(table)) {
      const base = key.endsWith('_one') ? key.slice(0, -4) : key;
      assert.ok(base in en, `${code} has ${key}, which English does not`);
      assert.deepEqual(placeholders(table[key]), placeholders(en[base]), `${code} ${key}`);
    }
  });

  test(`${code}: no "&", which a Windows menu would eat`, () => {
    for (const [key, text] of Object.entries(table)) assert.ok(!text.includes('&'), `${code} ${key}: ${text}`);
  });
}

test('every item has its label in English, and every English key is used', () => {
  for (const item of ITEMS) assert.equal(en['item.' + item.id], item.label);
  const tray = fs.readFileSync(path.join(__dirname, 'tray.js'), 'utf8');
  for (const key of Object.keys(en)) {
    if (key === '_name' || key.startsWith('item.')) continue;
    const base = key.endsWith('_one') ? key.slice(0, -4) : key;
    assert.ok(tray.includes(`'${base}'`), `${key} is not used in tray.js`);
  }
  assert.deepEqual(Object.keys(en).filter(k => k.startsWith('item.')).sort(), ITEMS.map(i => 'item.' + i.id).sort());
});

test('the system locale picks a table, Chinese by its script, anything else English', () => {
  const codes = Object.keys(tables);
  const cases = {
    'zh-TW': 'zh-TW', 'zh-Hant-TW': 'zh-TW', 'zh-HK': 'zh-TW', 'zh-Hant': 'zh-TW',
    'zh-CN': 'zh-CN', 'zh-Hans-TW': 'zh-CN', 'zh-SG': 'zh-CN', zh: 'zh-CN',
    'ja-JP': 'ja', 'ko-KR': 'ko', 'en-US': 'en', 'en-US-POSIX': 'en', '': 'en',
    'de-DE': 'de', 'de-AT': 'de', 'fr-FR': 'fr', 'fr-CA': 'fr', 'es-ES': 'es', 'es-MX': 'es', 'pt-BR': 'en', 'it-IT': 'en',
  };
  for (const [locale, code] of Object.entries(cases)) assert.equal(fromLocale(locale, codes), code, locale);
});

test('a setting of "auto" follows the system; a code wins; a code with no table falls back', () => {
  const i18n = createI18n({ osLocale: 'ja-JP' });
  assert.equal(i18n.resolve('auto'), 'ja');
  assert.equal(i18n.resolve(undefined), 'ja');
  assert.equal(i18n.resolve('ko'), 'ko');
  assert.equal(i18n.resolve('xx'), 'ja');
  assert.equal(i18n.codes[0], 'en');
});

test('a count of 1 takes the form for 1 where the language has one', () => {
  const i18n = createI18n({ osLocale: 'en' });
  assert.equal(i18n.t('en', 'status.sessions', { n: 1, mem: '1GB' }), '1 session · 1GB');
  assert.equal(i18n.t('en', 'status.sessions', { n: 2, mem: '1GB' }), '2 sessions · 1GB');
  assert.equal(i18n.t('ja', 'status.sessions', { n: 1, mem: '1GB' }), '1 セッション · 1GB');
  // A key no table has is shown as itself rather than as nothing
  assert.equal(i18n.t('ja', 'no.such.key'), 'no.such.key');
});
