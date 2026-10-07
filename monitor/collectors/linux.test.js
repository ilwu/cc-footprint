'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const linux = require('./linux');

// A /proc made of plain files, so the reader runs on any platform
function fakeProc(procs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-'));
  fs.writeFileSync(path.join(dir, 'stat'), 'cpu  1 2 3\nbtime 1700000000\nprocesses 5\n');
  fs.writeFileSync(path.join(dir, 'meminfo'), 'MemTotal:       16000000 kB\nMemFree:          500000 kB\nMemAvailable:    4000000 kB\n');
  fs.mkdirSync(path.join(dir, 'self')); // a non-numeric entry, to be skipped
  for (const p of procs) {
    const d = path.join(dir, String(p.pid));
    fs.mkdirSync(d);
    // fields 3..24: state ppid pgrp session tty tpgid flags minflt cminflt majflt
    // cmajflt utime stime cutime cstime priority nice threads itrealvalue
    // starttime vsize rss
    const rest = ['S', p.ppid, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 1, 0, p.startTicks, 999999, p.rssPages];
    fs.writeFileSync(path.join(d, 'stat'), `${p.pid} (${p.name}) ${rest.join(' ')} 0 0\n`);
    fs.writeFileSync(path.join(d, 'cmdline'), (p.argv || []).join('\0'));
  }
  return dir;
}

test('a stat line is read past a name with spaces and parentheses', () => {
  const stat = linux.parseStat('42 (my (odd) name) S 7 42 42 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 1234 5000 300 0');
  assert.deepEqual(stat, { name: 'my (odd) name', ppid: 7, startTicks: 1234, rssPages: 300 });
  assert.equal(linux.parseStat('garbage'), null);
});

test('the table carries memory, start time and the MCP mark for every process', (t, done) => {
  const dir = fakeProc([
    { pid: 10, ppid: 1, name: 'claude', startTicks: 500, rssPages: 1000, argv: ['claude'] },
    { pid: 11, ppid: 10, name: 'node', startTicks: 600, rssPages: 200, argv: ['node', '/x/server-mcp/index.js'] },
    { pid: 12, ppid: 2, name: 'kworker/0:1', startTicks: 5, rssPages: 0 },
  ]);

  linux.collect(new Set(), (err, seen) => {
    assert.equal(err, null);
    const byPid = new Map(seen.table.map(p => [p.pid, p]));
    assert.equal(seen.table.length, 3);
    assert.deepEqual(byPid.get(10), {
      pid: 10, ppid: 1, mem: 1000 * 4096, born: 1700000000000 + 5000, name: 'claude', mcp: null,
    });
    assert.equal(byPid.get(11).mcp, 'server-mcp');
    assert.equal(byPid.get(11).born, 1700000000000 + 6000);
    assert.equal(byPid.get(12).mcp, null);
    assert.equal(seen.systemPct, 75); // 4 GB available of 16
    assert.equal(seen.cols.size, 0);  // no terminal behind a plain file
    fs.rmSync(dir, { recursive: true, force: true });
    done();
  }, dir);
});

test('a /proc that cannot be read is an error, not an empty table', (t, done) => {
  linux.collect(new Set(), err => {
    assert.ok(err);
    done();
  }, path.join(os.tmpdir(), 'no-such-proc-dir'));
});
