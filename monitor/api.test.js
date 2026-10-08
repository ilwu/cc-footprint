'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ITEMS } = require('./config');
const { createHandler } = require('./api');

const SID = '11111111-2222-3333-4444-555555555555';
const MB = 1048576;

// The monitor's parts, faked: a measured session, one MCP server outside
function fakes({ measuredAgo = 1000 } = {}) {
  const now = Date.now();
  const m = {
    store: new Map([[10, { mem: 300 * MB, self: 200 * MB, procs: 3, mcp_mem: 50 * MB, mcp_count: 1, updatedAt: now }]]),
    cols: new Map([[10, 120]]),
    outside: [{ pid: 70, name: 'chrome-native-host', mem: 40 * MB, age: 3600000 }],
    systemPct: 55,
    lastCollectAt: now - measuredAgo,
    lastMeasuredAt: now - measuredAgo,
    stats: { rows_read: 4, rows_failed: 0, transcripts: 1, collect_errors: 0 },
  };
  const values = Object.fromEntries(ITEMS.map(i => [i.id, true]));
  const config = { items: ITEMS, values, broken: false, refresh() {}, display: () => ITEMS.filter(i => values[i.id]).map(i => i.id) };
  const sessions = {
    pids: new Map([[SID, 10]]), info: new Map([[SID, { cwd: '/w/api', name: 'api' }]]),
    scan() {}, pidFor: sid => (sid === SID ? 10 : undefined), remoteControl: pid => pid === 10,
  };
  // A context of 12k: 10k base, 1.5k file reads, 0.5k an MCP server
  const ctx = { size: 12000, out: 0, turnStart: 10000, cats: { base: 10000, files: 1500, 'mcp:chrome': 500 } };
  const transcripts = { read: sid => (sid === SID ? ctx : null) };
  const plugin = { installed: true, check() {} };
  const i18n = { codes: ['en', 'ja'], resolve: setting => (setting === 'ja' ? 'ja' : 'en') };
  return { port: 19823, m, config, i18n, sessions, transcripts, plugin, collectSoon() {}, staleMs: 180000 };
}

function ask(handler, url, host = 'l') {
  const res = { status: 200, headers: {}, body: '', headersSent: false };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = code => { res.status = code; res.headersSent = true; };
  res.end = body => { res.body = body || ''; };
  handler({ url, headers: host === null ? {} : { host } }, res);
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null, raw: res.body };
}

test('/session answers with the session, the machine and the context', () => {
  const r = ask(createHandler(fakes()), '/session/' + SID);
  assert.equal(r.status, 200);
  assert.equal(r.json.mem, 300 * MB);
  assert.equal(r.json.claude_total, 300 * MB);
  assert.equal(r.json.system_pct, 55);
  assert.equal(r.json.mcp_total, 50 * MB);
  assert.equal(r.json.mcp_outside, 1);
  assert.equal(r.json.mcp_outside_mem, 40 * MB);
  assert.equal(r.json.cols, 120);
  assert.equal(r.json.plugin, true);
  assert.equal(r.json.ctx_turn, 2000);
  assert.equal(r.json.ctx_src, 'files');
  assert.equal(r.json.ctx_mcp_pct, 4);
  assert.equal(r.json.remote_control, true);
  assert.deepEqual(r.json.display, ITEMS.map(i => i.id));
});

// statusline.sh reads this answer with bash regexes, each taking the first
// match of "key": — so every key it reads must be in the answer once, with
// a plain value (a nested object could carry the same key again)
test('every key the statusline reads is in /session once, flat', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'statusline', 'statusline.sh'), 'utf8');
  const keys = [...script.matchAll(/\[\[ "\$resp" =~ \\"(\w+)\\":/g)].map(m => m[1]);
  assert.ok(keys.length >= 10, `found only ${keys.length} keys in statusline.sh`);

  const r = ask(createHandler(fakes()), '/session/' + SID);
  for (const key of keys) {
    const hits = r.raw.split(`"${key}":`).length - 1;
    assert.equal(hits, 1, `"${key}": appears ${hits} times in ${r.raw}`);
    // A value or a list of values (display); never an object with keys of its own
    const v = r.json[key];
    const flat = Array.isArray(v) ? v.every(x => typeof x !== 'object') : typeof v !== 'object' || v === null;
    assert.ok(flat, `"${key}" is not flat`);
  }
});

test('figures measured too long ago are not passed on', () => {
  const r = ask(createHandler(fakes({ measuredAgo: 600000 })), '/session/' + SID);
  assert.equal(r.json.mem, null);
  assert.equal(r.json.claude_total, null);
  assert.equal(r.json.system_pct, null);
  assert.equal(r.json.mcp_outside, 0);
  // What does not come from the measurement still does
  assert.equal(r.json.ctx_turn, 2000);

  const s = ask(createHandler(fakes({ measuredAgo: 600000 })), '/sessions');
  assert.deepEqual(s.json.sessions, []);
  assert.deepEqual(s.json.outside, []);
});

test('/sessions lists the sessions and the MCP servers outside them', () => {
  const r = ask(createHandler(fakes()), '/sessions');
  assert.deepEqual(r.json.sessions, [{
    session: SID, pid: 10, cwd: '/w/api', name: 'api', mem: 300 * MB, self: 200 * MB, procs: 3, mcp_mem: 50 * MB, mcp_count: 1,
  }]);
  assert.equal(r.json.outside[0].name, 'chrome-native-host');
  assert.equal(r.json.lang, 'en');

  const f = fakes();
  f.config.values.lang = 'ja';
  assert.equal(ask(createHandler(f), '/sessions').json.lang, 'ja');
});

test('/context gives every part with what it is', () => {
  const r = ask(createHandler(fakes()), '/context/' + SID);
  assert.deepEqual(r.json.parts.map(p => [p.id, p.kind, p.name]), [
    ['base', 'base', 'base'], ['files', 'files', 'files'], ['mcp:chrome', 'mcp', 'chrome'],
  ]);
  assert.equal(ask(createHandler(fakes()), '/context/aaaaaaaa-0000-0000-0000-000000000000').json, null);
});

test('only our own Host is answered; other paths are a 404', () => {
  const h = createHandler(fakes());
  assert.equal(ask(h, '/sessions', '127.0.0.1:19823').status, 200);
  assert.equal(ask(h, '/sessions', 'LOCALHOST:19823').status, 200);
  assert.equal(ask(h, '/sessions', null).status, 200);
  assert.equal(ask(h, '/sessions', 'evil.example:19823').status, 403);
  assert.equal(ask(h, '/sessions', '127.0.0.1').status, 403);
  assert.equal(ask(h, '/session/not-hex!').status, 404);
  assert.equal(ask(h, '/nope').status, 404);
});

test('a request that throws is a 500, not the end of the monitor', () => {
  const broken = fakes();
  broken.transcripts.read = () => { throw new Error('disk'); };
  const r = ask(createHandler(broken), '/context/' + SID);
  assert.equal(r.status, 500);
});
