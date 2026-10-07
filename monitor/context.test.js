'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const context = require('./context');

const feed = rows => {
  const c = context.create();
  for (const r of rows) context.track(c, r);
  return c;
};
const answer = (id, input, output, content = [], thinking = 0) => ({
  type: 'assistant',
  message: { id, role: 'assistant', content, usage: { input_tokens: input, output_tokens: output, output_tokens_details: { thinking_tokens: thinking } } },
});
const prompt = text => ({ type: 'user', message: { role: 'user', content: text } });
const result = (id, length) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(length) }] } });
const call = (id, name) => ({ type: 'tool_use', id, name, input: {} });
const parts = c => Object.fromEntries(context.detail(c).parts.map(p => [p.name, p.tokens]));

// The first rows of a real session, every text replaced by as many "x" and
// every id by a counter (test/fixtures/README.md). Its figures are what the
// rows themselves gave before they were replaced.
test('a real transcript: what fills the window and what this turn added', () => {
  const rows = fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'transcript.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  const c = feed(rows);

  assert.deepEqual(context.summarize(c), { turn: 29814, src: 'files', src_pct: 22, mcp_pct: 0 });
  assert.deepEqual(parts(c), {
    base: 41405, files: 25635, think: 14087, output: 13513, system: 13122,
    shell: 5270, search: 2763, agents: 846, tools: 767, prompts: 131,
  });
  // The parts add up to the window in use
  const sum = context.detail(c).parts.reduce((s, p) => s + p.tokens, 0);
  assert.ok(Math.abs(sum - c.size) <= context.detail(c).parts.length);
});

test('growth goes to the previous answer first, the rest to what followed it by length', () => {
  const c = feed([
    prompt('hello'),
    answer('m1', 10000, 1000, [call('t1', 'Read'), call('t2', 'mcp__claude-in-chrome__read_page')], 400),
    result('t1', 300),
    result('t2', 100),
    answer('m2', 15000, 50),
  ]);

  // 5000 grown: 1000 the answer (400 of it thinking), 3000 the file, 1000 the page
  assert.deepEqual(parts(c), { base: 10000, files: 3000, output: 600, think: 400, chrome: 1000 }); // the label drops "claude-in-"
  assert.deepEqual(context.summarize(c), { turn: 5050, src: 'files', src_pct: 20, mcp_pct: 7 });
});

test('a compaction leaves the base and a summary, and starts the turn again', () => {
  const c = feed([
    prompt('hello'),
    answer('m1', 10000, 100, [call('t1', 'Read')]),
    result('t1', 400),
    answer('m2', 50000, 100),
    { type: 'system', subtype: 'compact_boundary' },
    { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary' } },
    answer('m3', 14000, 200),
  ]);

  assert.deepEqual(parts(c), { base: 10000, summary: 4000 });
  assert.equal(context.summarize(c).turn, 200);
});

test('a window that shrinks without a compaction loses thinking first, then the rest in proportion', () => {
  const c = feed([
    prompt('hello'),
    answer('m1', 10000, 3000, [call('t1', 'Bash')], 2000),
    result('t1', 100),
    answer('m2', 20000, 0),
    answer('m3', 17000, 0),
  ]);

  // 3000 off: the 2000 of thinking, then 1000 off shell (7000) and output (1000)
  assert.deepEqual(parts(c), { base: 10000, shell: 6125, output: 875 });
  assert.equal(context.summarize(c).turn, 7000);
});

test("another agent's message is not the person's prompt, and does not start a turn", () => {
  const c = feed([
    prompt('hello'),
    answer('m1', 10000, 0),
    { type: 'user', origin: { kind: 'agent' }, message: { role: 'user', content: 'x'.repeat(10) } },
    answer('m2', 11000, 0),
  ]);

  assert.deepEqual(parts(c), { base: 10000, agents: 1000 });
  assert.equal(context.summarize(c).turn, 1000);
});

test('one response over several rows is stepped over once', () => {
  const c = feed([
    prompt('hello'),
    answer('m1', 10000, 10, [{ type: 'thinking', thinking: '' }]),
    answer('m1', 10000, 500, [call('t1', 'Read')]),
    result('t1', 10),
    answer('m2', 12000, 0),
  ]);

  assert.deepEqual(parts(c), { base: 10000, output: 500, files: 1500 });
});
