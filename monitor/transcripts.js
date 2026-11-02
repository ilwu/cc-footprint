'use strict';

// ── Context composition from the transcript ──────────────────────────
// What the main conversation's window is filled with and how much the
// current turn added (see context.js), worked out by tailing the session's
// transcript .jsonl: only newly appended bytes are read. Subagents have
// windows of their own, so only the main transcript counts.
//
// The file is read asynchronously: on Windows an open can be held up for
// seconds (something on the machine checking the file), and a synchronous
// one would stop every answer of the monitor for as long.

const fs = require('fs');
const path = require('path');
const context = require('./context');

// projectsDir: ~/.claude/projects. A long session's file is read at most
// `chunk` bytes at a time, each piece after an await, so that requests are
// answered in between. A transcript not found is looked for again at most
// every `retryMs`. `stats` counts rows and transcripts.
function createTranscripts(projectsDir, { chunk = 4 * 1048576, retryMs = 5000, stats = {} } = {}) {
  const tails = new Map();   // sessionId -> { file, offset, rest, ctx, queue }
  const missed = new Map();  // sessionId -> when it was last looked for in vain
  const count = k => { stats[k] = (stats[k] || 0) + 1; };

  async function find(sid) {
    let dirs;
    try { dirs = await fs.promises.readdir(projectsDir); } catch { return null; }
    const hits = await Promise.all(dirs.map(d => {
      const p = path.join(projectsDir, d, sid + '.jsonl');
      return fs.promises.access(p).then(() => p, () => null);
    }));
    return hits.find(Boolean) || null;
  }

  function processLine(st, line) {
    // Responses, prompts and tool results, and compaction boundaries
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"') && !line.includes('"compact_boundary"')) return;
    let j;
    try { j = JSON.parse(line); } catch { count('rows_failed'); return; }
    context.track(st.ctx, j);
    count('rows_read');
  }

  // Reads what was appended since the last time, to the end of the file
  async function tail(st) {
    let fh;
    try {
      fh = await fs.promises.open(st.file, 'r');
      for (;;) {
        const { size } = await fh.stat();
        if (size < st.offset) {
          // Rewritten from the start: read it all again
          st.offset = 0; st.rest = Buffer.alloc(0); st.ctx = context.create();
        }
        if (size === st.offset) return;
        const buf = Buffer.alloc(Math.min(size - st.offset, chunk));
        const { bytesRead: n } = await fh.read(buf, 0, buf.length, st.offset);
        if (!n) return;
        st.offset += n;
        const data = Buffer.concat([st.rest, buf.subarray(0, n)]);
        const end = data.lastIndexOf(10) + 1; // only complete lines
        st.rest = data.subarray(end);
        for (const line of data.toString('utf8', 0, end).split('\n')) {
          // One row of an unforeseen shape costs that row, not the ones after it
          if (line) try { processLine(st, line); } catch { count('rows_failed'); }
        }
      }
    } catch {
      // A file that cannot be read now keeps what was read of it, and is
      // tried again at the next ask
    } finally {
      if (fh) await fh.close().catch(() => {});
    }
  }

  async function update(st, sid, now) {
    // Forgotten (the session ended) while this waited its turn
    if (tails.get(sid) !== st) return;
    if (!st.file) {
      const file = await find(sid);
      if (!file) {
        missed.set(sid, now);
        if (tails.get(sid) === st) tails.delete(sid);
        return;
      }
      missed.delete(sid);
      st.file = file;
      count('transcripts');
    }
    await tail(st);
  }

  return {
    // The session's context state, read up to date; null with no
    // transcript. It resolves once the file has been read through, which
    // for a long file or an open that is held up takes a while: the caller
    // decides how long to wait (api.js), and what is read meanwhile is
    // there for the next ask.
    read(sid, now = Date.now()) {
      let st = tails.get(sid);
      if (!st) {
        const at = missed.get(sid);
        if (at !== undefined && now - at < retryMs) return Promise.resolve(null);
        st = { file: null, offset: 0, rest: Buffer.alloc(0), ctx: context.create(), queue: Promise.resolve() };
        tails.set(sid, st);
      }
      // One read of the file at a time, each after the one before: a read
      // under way may have looked at the size before this ask came
      const run = st.queue.then(() => update(st, sid, now));
      st.queue = run.catch(() => {});
      return run.then(() => (st.file ? st.ctx : null));
    },
    // Forget the sessions that have ended
    prune(live, now = Date.now()) {
      for (const sid of tails.keys()) if (!live.has(sid)) tails.delete(sid);
      for (const [sid, at] of missed) if (now - at >= retryMs) missed.delete(sid);
    },
  };
}

module.exports = { createTranscripts };
