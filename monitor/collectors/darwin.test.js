'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const darwin = require('./darwin');

const NOW = 1_700_000_000_000;

test('elapsed time reads in every form ps prints it', () => {
  assert.equal(darwin.elapsedSeconds('03:04'), 184);
  assert.equal(darwin.elapsedSeconds('02:03:04'), 7384);
  assert.equal(darwin.elapsedSeconds('1-02:03:04'), 93784);
  assert.equal(darwin.elapsedSeconds('-'), 0);
});

test('the ps listing becomes the table, command lines with spaces included', () => {
  const text = [
    '    1     0  12345 12-03:04:05 ??       /sbin/launchd',
    '  268     1 355264    01:02:03 ttys001  claude',
    '  300   268  40960       05:00 ttys001  node /Users/me/x/node_modules/.bin/server-mcp --port 3000',
    '  301   268   8192       00:30 ??       /bin/sh -c grep mcp notes.txt',
    'garbage line',
  ].join('\n');
  const { table, ttys } = darwin.parsePs(text, NOW);
  assert.equal(table.length, 4);
  assert.deepEqual(table[1], {
    pid: 268, ppid: 1, mem: 355264 * 1024, born: NOW - 3723 * 1000, name: 'claude', mcp: false,
  });
  assert.equal(table[2].name, 'node');
  assert.equal(table[2].mcp, true);
  assert.equal(table[3].name, 'sh');
  assert.equal(table[3].mcp, true); // the age rule in proctree.js sorts that out
  assert.equal(ttys.get(268), '/dev/ttys001');
  assert.equal(ttys.has(1), false);
});

test('vm_stat adds up what Activity Monitor calls used', () => {
  const text = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                              100000.',
    'Pages active:                            200000.',
    'Pages inactive:                          150000.',
    'Pages speculative:                        10000.',
    'Pages wired down:                        100000.',
    'Pages occupied by compressor:             50000.',
    '',
  ].join('\n');
  const total = 16 * 1024 * 1024 * 1024;
  // (200000 + 100000 + 50000) pages of 16 KB = 5.6 GB of 16 GB
  assert.equal(darwin.parseVmStat(text, total), 33);
  assert.equal(darwin.parseVmStat(text, 0), null);
});
