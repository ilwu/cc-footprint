'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const context = require('./context');
const { createTranscripts } = require('./transcripts');

const SID = '11111111-2222-3333-4444-555555555555';
const rows = [
  { type: 'user', message: { role: 'user', content: 'hello' } },
  { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }], usage: { input_tokens: 10000, output_tokens: 0 } } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(100) }] } },
  { type: 'assistant', message: { id: 'm2', content: [], usage: { input_tokens: 12000, output_tokens: 0 } } },
].map(r => JSON.stringify(r) + '\n');

function project() {
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-projects-'));
  fs.mkdirSync(path.join(projects, '-work-api'));
  return { projects, file: path.join(projects, '-work-api', SID + '.jsonl') };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('appended rows are read as they come, a half-written row once it is whole', () => {
  const { projects, file } = project();
  const stats = {};
  const t = createTranscripts(projects, { stats });

  fs.writeFileSync(file, rows[0] + rows[1] + rows[2].slice(0, 30));
  assert.equal(context.summarize(t.read(SID)).turn, 0);

  fs.appendFileSync(file, rows[2].slice(30) + rows[3]);
  assert.deepEqual(context.summarize(t.read(SID)), { turn: 2000, src: 'files', src_pct: 17, mcp_pct: 0 });
  assert.deepEqual(stats, { transcripts: 1, rows_read: 4 });
});

test('a long file is read in pieces, and gives no figure until it is read through', async () => {
  const { projects, file } = project();
  fs.writeFileSync(file, rows.join(''));
  const t = createTranscripts(projects, { chunk: 64 });

  assert.equal(t.read(SID), null); // the first 64 bytes only
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(context.summarize(t.read(SID)).turn, 2000);
});

test('a file rewritten from the start is read again from the start', () => {
  const { projects, file } = project();
  fs.writeFileSync(file, rows.join(''));
  const t = createTranscripts(projects);
  assert.equal(context.summarize(t.read(SID)).turn, 2000);

  fs.writeFileSync(file, rows[0] + rows[1]);
  assert.equal(context.summarize(t.read(SID)).turn, 0);
});

test('a row that is not JSON is counted and skipped, the rows after it kept', () => {
  const { projects, file } = project();
  fs.writeFileSync(file, rows[0] + rows[1] + '{"type":"user", broken\n' + rows[2] + rows[3]);
  const stats = {};
  const t = createTranscripts(projects, { stats });

  assert.equal(context.summarize(t.read(SID)).turn, 2000);
  assert.equal(stats.rows_failed, 1);
});

test('a transcript not there yet is looked for again only after a while', () => {
  const { projects, file } = project();
  const t = createTranscripts(projects, { retryMs: 5000 });
  assert.equal(t.read(SID, 100000), null);

  fs.writeFileSync(file, rows.join(''));
  assert.equal(t.read(SID, 101000), null);
  assert.notEqual(t.read(SID, 105000), null);
});

test('the sessions that ended are forgotten', () => {
  const { projects, file } = project();
  fs.writeFileSync(file, rows.join(''));
  const stats = {};
  const t = createTranscripts(projects, { stats });
  t.read(SID);
  t.prune(new Set());
  t.read(SID);

  assert.equal(stats.transcripts, 2); // opened afresh
});
