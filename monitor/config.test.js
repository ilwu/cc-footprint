'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ITEMS, createConfig } = require('./config');

const fileIn = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-config-')), 'config.json');

test('a missing file is the defaults, the language following the system', () => {
  const c = createConfig(fileIn());
  c.load();
  assert.equal(c.broken, false);
  assert.deepEqual(c.values, { ...Object.fromEntries(ITEMS.map(i => [i.id, i.default])), lang: 'auto' });
});

test('the items a file lacks take their defaults; the ones it has are kept', () => {
  const file = fileIn();
  fs.writeFileSync(file, JSON.stringify({ cost: true, lang: 'ja' }));
  const c = createConfig(file);
  c.load();
  assert.equal(c.values.cost, true);
  assert.equal(c.values.lang, 'ja');
  assert.equal(c.values.ctx, true);
});

test('a file that does not parse is left as it is, and the last good settings stay in use', () => {
  const file = fileIn();
  fs.writeFileSync(file, JSON.stringify({ cost: true }));
  const c = createConfig(file);
  c.load();

  const typo = '{ "cost": true,, }';
  fs.writeFileSync(file, typo);
  c.load();
  assert.equal(c.broken, true);
  assert.equal(c.values.cost, true);           // not the default (false)
  assert.equal(fs.readFileSync(file, 'utf8'), typo);
});

test('a choice made in the tray is saved over a broken file, whose text is kept beside it', () => {
  const file = fileIn();
  fs.writeFileSync(file, 'null');
  const c = createConfig(file);
  c.load();
  assert.equal(c.broken, true);

  c.values.cost = true;
  c.save();
  assert.equal(fs.readFileSync(file + '.broken', 'utf8'), 'null');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).cost, true);
  assert.equal(c.broken, false);
});
