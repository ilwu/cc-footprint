'use strict';

// One list of items lives in five places: ITEMS (config.js, which the tray
// menu is built from), the statusline's `has` checks and its fallback list,
// and the config.json defaults in both READMEs. Nothing generates one from
// another, so this keeps them the same.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ITEMS } = require('./config');

const root = path.join(__dirname, '..');
// Line ends as checked out (CRLF on Windows) made LF
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const ids = ITEMS.map(i => i.id);

test('every item is rendered by the statusline, and the statusline renders no other', () => {
  const script = read('statusline/statusline.sh');
  // Code only: the comments say "has" too
  const code = script.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
  const rendered = new Set([...code.matchAll(/\bhas (\w+)/g)].map(m => m[1]));
  assert.deepEqual([...rendered].sort(), [...ids].sort());
});

test("the statusline's list for a monitor that is down holds items only", () => {
  const script = read('statusline/statusline.sh');
  const m = script.match(/^\s*display='([^']*)'/m);
  assert.ok(m, 'no fallback display list found');
  for (const id of m[1].split(',').map(s => s.replace(/"/g, ''))) assert.ok(ids.includes(id), `${id} is no item`);
});

for (const readme of ['README.md', 'README.zh-TW.md']) {
  test(`${readme} shows the config.json defaults as they are`, () => {
    const block = read(readme).match(/```json\n(\{[\s\S]*?"sys_mem"[\s\S]*?\})\n```/);
    assert.ok(block, 'no config.json block found');
    assert.deepEqual(JSON.parse(block[1]), { ...Object.fromEntries(ITEMS.map(i => [i.id, i.default])), lang: 'auto' });
  });
}

test('no menu label holds "&", which a Windows menu would eat', () => {
  for (const item of ITEMS) assert.ok(!item.label.includes('&'), item.label);
});
