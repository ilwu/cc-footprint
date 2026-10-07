'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { measure } = require('./proctree');

const MB = 1048576;
const NOW = 1000000;
const OLD = NOW - 600000; // started ten minutes ago

// pid, ppid, MB, born, name, mcp (the server's short name, null for the rest)
const row = (pid, ppid, mb, born, name, mcp = null) => ({ pid, ppid, mem: mb * MB, born, name, mcp });

test('a session is its claude process plus everything under it', () => {
  const { sessions } = measure([
    row(10, 1, 400, OLD, 'claude.exe'),
    row(11, 10, 20, OLD + 1, 'cmd.exe'),
    row(12, 11, 90, OLD + 2, 'pwsh.exe'),
    row(20, 1, 300, OLD, 'claude.exe'),
    row(99, 1, 500, OLD, 'chrome.exe'),
  ], new Map(), NOW);

  assert.deepEqual(sessions.get(10), { mem: 510 * MB, self: 400 * MB, procs: 3, mcp_mem: 0, mcp_count: 0 });
  assert.deepEqual(sessions.get(20), { mem: 300 * MB, self: 300 * MB, procs: 1, mcp_mem: 0, mcp_count: 0 });
  assert.equal(sessions.has(99), false);
});

test('an MCP server behind a wrapper counts once, with its whole subtree', () => {
  const { sessions, outside } = measure([
    row(10, 1, 400, OLD, 'claude.exe'),
    row(11, 10, 5, OLD + 1, 'cmd.exe', 'some-mcp'),   // cmd /c npx some-mcp
    row(12, 11, 40, OLD + 2, 'node.exe', 'some-mcp'), // npx
    row(13, 12, 80, OLD + 3, 'node.exe', 'some-mcp'), // the server
    row(14, 10, 60, OLD + 1, 'python.exe', 'mcp_server_time'),
  ], new Map(), NOW);

  const s = sessions.get(10);
  assert.equal(s.mcp_count, 2);
  assert.equal(s.mcp_mem, 185 * MB);
  assert.equal(s.mem, 585 * MB);
  assert.deepEqual(outside, []);
});

test('a shell that only mentions mcp for a moment is not a server', () => {
  const { sessions } = measure([
    row(10, 1, 400, OLD, 'claude.exe'),
    row(11, 10, 30, NOW - 2000, 'bash.exe', 'mcp'), // grep mcp ...
  ], new Map(), NOW);

  const s = sessions.get(10);
  assert.equal(s.mcp_count, 0);
  assert.equal(s.mem, 430 * MB); // still part of the session's memory
});

test('a session nested under another is measured on its own', () => {
  const { sessions } = measure([
    row(10, 1, 400, OLD, 'claude.exe'),
    row(11, 10, 20, OLD + 1, 'bash.exe'),
    row(12, 11, 300, OLD + 2, 'claude.exe'),
    row(13, 12, 50, OLD + 3, 'node.exe'),
  ], new Map(), NOW);

  assert.equal(sessions.get(10).mem, 420 * MB);
  assert.equal(sessions.get(12).mem, 350 * MB);
});

test('a reused pid does not adopt an older stranger', () => {
  const { sessions } = measure([
    row(10, 1, 400, OLD, 'claude.exe'),
    row(11, 10, 900, OLD - 5000, 'unrelated.exe'), // older than its "parent"
  ], new Map(), NOW);

  assert.equal(sessions.get(10).mem, 400 * MB);
});

test('a session file makes a node process a session; the desktop app is not one', () => {
  const { sessions, outside } = measure([
    row(10, 1, 350, OLD, 'node.exe'),     // npm-installed CLI
    row(20, 1, 600, OLD, 'Claude.exe'),   // desktop app
    row(21, 20, 70, OLD + 1, 'node.exe', 'mcp-server-git'), // its MCP server
  ], new Map([[10, undefined]]), NOW);

  assert.deepEqual([...sessions.keys()], [10]);
  // The desktop app's server is outside every session of ours
  assert.deepEqual(outside, [{ pid: 21, name: 'mcp-server-git', mem: 70 * MB, age: 600000 - 1 }]);
});

test('a session file whose pid went to a later process does not make that process a session', () => {
  const { sessions } = measure([
    row(10, 1, 800, NOW - 120000, 'chrome.exe'), // took the pid two minutes ago
    row(11, 10, 700, NOW - 110000, 'chrome.exe'),
    row(20, 1, 350, OLD, 'node.exe'),            // a live npm-installed CLI
  ], new Map([
    [10, 3600000],        // its file: a session that started an hour ago
    [20, 600000 - 3000],  // its file: started three seconds after the process
  ]), NOW);

  assert.deepEqual([...sessions.keys()], [20]);
});

test('MCP servers outside every session are listed once per wrapper chain, largest first', () => {
  const { outside } = measure([
    row(10, 1, 400, OLD, 'claude.exe'),
    row(31, 7777, 5, OLD, 'cmd.exe', 'some-mcp'),     // left behind: parent 7777 is gone
    row(32, 31, 120, OLD + 1, 'node.exe', 'some-mcp'),
    row(40, 8888, 60, OLD, 'node.exe', 'mcp-server-git'),
    row(50, 9999, 70, NOW - 1000, 'bash.exe', 'mcp'), // too young to be a server
  ], new Map(), NOW);

  assert.deepEqual(outside, [
    { pid: 31, name: 'some-mcp', mem: 125 * MB, age: 600000 },
    { pid: 40, name: 'mcp-server-git', mem: 60 * MB, age: 600000 },
  ]);
});

test("Chrome's bridge is an MCP server outside every session, not a session of its own", () => {
  const { sessions, outside } = measure([
    row(10, 1, 400, OLD, 'claude.exe'),
    row(60, 1, 500, OLD, 'chrome.exe'),
    row(70, 60, 8, OLD + 1, 'cmd.exe', 'chrome-native-host'),      // chrome-native-host.bat
    row(71, 70, 34, OLD + 2, 'claude.exe', 'chrome-native-host'),  // claude --chrome-native-host
  ], new Map(), NOW);

  assert.deepEqual([...sessions.keys()], [10]);
  assert.deepEqual(outside, [{ pid: 70, name: 'chrome-native-host', mem: 42 * MB, age: 600000 - 1 }]);
});

test('a claude that names MCP on its command line is a session that uses MCP, not a server', () => {
  const { sessions, outside } = measure([
    row(10, 1, 150, OLD, 'claude.exe', 'mcp-config'), // claude -p --mcp-config x.json
  ], new Map(), NOW);

  assert.deepEqual([...sessions.keys()], [10]);
  assert.deepEqual(outside, []);
});

test('a session under an MCP server outside every session is counted once, as a session', () => {
  const { sessions, outside } = measure([
    row(20, 1, 30, OLD, 'node.exe', 'claude-code-mcp'),
    row(21, 20, 400, OLD + 1, 'claude.exe'),
  ], new Map(), NOW);

  assert.equal(sessions.get(21).mem, 400 * MB);
  assert.deepEqual(outside.map(o => [o.name, o.mem]), [['claude-code-mcp', 30 * MB]]);
});

test('claude serving itself as an MCP server is a server, not a session', () => {
  const { sessions, outside } = measure([
    row(10, 1, 400, OLD, 'claude.exe'),
    row(11, 10, 200, OLD + 1, 'claude.exe', 'claude mcp serve'), // in this session's .mcp.json
    row(20, 1, 180, OLD, 'claude.exe', 'claude mcp serve'),      // the desktop app's
  ], new Map(), NOW);

  assert.deepEqual([...sessions.keys()], [10]);
  assert.equal(sessions.get(10).mcp_count, 1);
  assert.equal(sessions.get(10).mcp_mem, 200 * MB);
  assert.deepEqual(outside.map(o => o.name), ['claude mcp serve']);
});
