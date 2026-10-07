'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSessions } = require('./sessions');

function dirWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-sessions-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test('session files map each session to its process, with its folder, name and start', () => {
  const dir = dirWith({
    '10.json': JSON.stringify({ pid: 10, sessionId: 'aa', cwd: '/w/api', name: 'api', startedAt: 1000 }),
    '20.json': JSON.stringify({ pid: 20, sessionId: 'bb' }),
    '30.json': '{ not json',
    'notes.txt': 'not a session',
  });
  const s = createSessions(dir);
  s.scan();

  assert.deepEqual([...s.pids], [['aa', 10], ['bb', 20]]);
  assert.deepEqual(s.info.get('aa'), { cwd: '/w/api', name: 'api' });
  assert.deepEqual(s.info.get('bb'), { cwd: '', name: '' });
  assert.deepEqual([...s.start], [[10, 1000]]);
});

test('a session id in two files is the process that started later', () => {
  // A killed session left 10.json; resuming it wrote 20.json
  const dir = dirWith({
    '20.json': JSON.stringify({ pid: 20, sessionId: 'aa', startedAt: 5000 }),
    '10.json': JSON.stringify({ pid: 10, sessionId: 'aa', startedAt: 1000 }),
  });
  const s = createSessions(dir);
  s.scan();

  assert.equal(s.pids.get('aa'), 20);
});

test('an unknown session has the files read again, but not on every request', () => {
  const dir = dirWith({});
  const s = createSessions(dir, { retryMs: 5000 });
  assert.equal(s.pidFor('aa', 100000), undefined);

  fs.writeFileSync(path.join(dir, '10.json'), JSON.stringify({ pid: 10, sessionId: 'aa' }));
  assert.equal(s.pidFor('aa', 101000), undefined); // within 5 s of the last look
  assert.equal(s.pidFor('aa', 105000), 10);
});

test('a missing sessions folder is no session at all', () => {
  const s = createSessions(path.join(os.tmpdir(), 'ccf-no-such-dir-' + process.pid));
  s.scan();
  assert.equal(s.pids.size, 0);
});
