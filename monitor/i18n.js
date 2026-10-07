'use strict';

// ── The monitor's own words, in the person's language ────────────────
// One JSON per language in i18n/, named by its code (en, zh-TW, ...). A
// language is added by adding a file: the tray's Language menu lists every
// file, under the name the file gives itself (`_name`). English is the
// fallback for a key a file lacks and for a locale no file matches.
// A key ending in `_one` is the form for a count of 1, where a language
// has one (English does; the others need none).

const fs = require('fs');
const path = require('path');

function loadTables(dir) {
  const tables = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { tables[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {}
  }
  return tables;
}

// A locale (zh-Hant-TW, ja-JP, ko, en-US-POSIX, ...) -> the code of a table
// we have, or 'en'. Chinese goes by its script: traditional where it says
// so or is the region's (Taiwan, Hong Kong, Macau), simplified otherwise;
// another language goes by its region where there is a table for that,
// else by the language (pt-PT -> pt-BR).
function fromLocale(locale, codes) {
  if (!locale) return 'en';
  const parts = String(locale).replace(/_/g, '-').split('-');
  const lang = parts[0].toLowerCase();
  const exact = codes.find(c => c.toLowerCase() === parts.slice(0, 2).join('-').toLowerCase());
  if (lang === 'zh') {
    const rest = parts.slice(1).map(p => p.toLowerCase());
    const traditional = rest.includes('hant') || (!rest.includes('hans') && rest.some(p => ['tw', 'hk', 'mo'].includes(p)));
    const code = traditional ? 'zh-TW' : 'zh-CN';
    return codes.includes(code) ? code : 'en';
  }
  if (exact) return exact;
  // The language alone, or the one table of it for another region
  // (pt-PT reads pt-BR rather than English)
  return codes.find(c => c.toLowerCase() === lang) || codes.find(c => c.toLowerCase().split('-')[0] === lang) || 'en';
}

// dir: the folder of tables; osLocale: the system's, as Intl reports it
function createI18n({ dir = path.join(__dirname, 'i18n'), osLocale } = {}) {
  const tables = loadTables(dir);
  const codes = Object.keys(tables).sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));
  const system = fromLocale(osLocale === undefined ? Intl.DateTimeFormat().resolvedOptions().locale : osLocale, codes);

  return {
    codes,
    system,
    // The name a language goes by, in itself
    name: code => (tables[code] && tables[code]._name) || code,
    // The language a setting ("auto", or a code) comes to
    resolve: setting => (setting && setting !== 'auto' && tables[setting] ? setting : system),
    t(code, key, vars = {}) {
      const table = tables[code] || {};
      const en = tables.en || {};
      const one = vars.n === 1 ? key + '_one' : null;
      const text = (one && (table[one] ?? (code === 'en' ? en[one] : undefined))) ?? table[key] ?? en[key] ?? key;
      return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
    },
  };
}

module.exports = { createI18n, fromLocale };
