'use strict';

// ── Context composition from the transcript ──────────────────────────
// What the main conversation's window is filled with and how much the
// current turn added (see context.js), worked out by tailing the session's
// transcript .jsonl: only newly appended bytes are read. Subagents have
// windows of their own, so only the main transcript counts.

const fs = require('fs');
const path = require('path');
const context = require('./context');

// projectsDir: ~/.claude/projects. A long session's file is read at most
// `chunk` bytes at a time, the rest on later turns of the event loop, so
// that requests are answered in between. A transcript not found is looked
// for again at most every `retryMs`. `stats` counts rows and transcripts.
function createTranscripts(projectsDir, { chunk = 4 * 1048576, retryMs = 5000, stats = {} } = {}) {
  const tails = new Map();   // sessionId -> { file, offset, rest, ctx, behind, catchingUp }
  const missed = new Map();  // sessionId -> when it was last looked for in vain
  const count = k => { stats[k] = (stats[k] || 0) + 1; };

  function find(sid, now) {
    const at = missed.get(sid);
    if (at !== undefined && now - at < retryMs) return null;
    let dirs;
    try { dirs = fs.readdirSync(projectsDir); } catch { return null; }
    for (const d of dirs) {
      const p = path.join(projectsDir, d, sid + '.jsonl');
      if (fs.existsSync(p)) { missed.delete(sid); return p; }
    }
    missed.set(sid, now);
    return null;
  }

  function processLine(st, line) {
    // Responses, prompts and tool results, and compaction boundaries
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"') && !line.includes('"compact_boundary"')) return;
    let j;
    try { j = JSON.parse(line); } catch { count('rows_failed'); return; }
    context.track(st.ctx, j);
    count('rows_read');
  }

  function tail(st) {
    let fd;
    try {
      fd = fs.openSync(st.file, 'r');
      const size = fs.fstatSync(fd).size;
      if (size < st.offset) {
        // Rewritten from the start: read it all again
        st.offset = 0; st.rest = Buffer.alloc(0); st.ctx = context.create();
      }
      st.behind = false;
      if (size === st.offset) return;
      const buf = Buffer.alloc(Math.min(size - st.offset, chunk));
      const n = fs.readSync(fd, buf, 0, buf.length, st.offset);
      st.offset += n;
      st.behind = st.offset < size;
      const data = Buffer.concat([st.rest, buf.subarray(0, n)]);
      const end = data.lastIndexOf(10) + 1; // only complete lines
      st.rest = data.subarray(end);
      for (const line of data.toString('utf8', 0, end).split('\n')) {
        // One row of an unforeseen shape costs that row, not the ones after it
        if (line) try { processLine(st, line); } catch { count('rows_failed'); }
      }
    } catch {
      st.behind = false;
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    }
    if (st.behind && !st.catchingUp) {
      st.catchingUp = true;
      setImmediate(() => { st.catchingUp = false; tail(st); });
    }
  }

  return {
    // The session's context state, read up to date; null with no
    // transcript, and while a long file is still being read, rather than
    // a figure of half of it
    read(sid, now = Date.now()) {
      let st = tails.get(sid);
      if (!st) {
        const file = find(sid, now);
        if (!file) return null;
        st = { file, offset: 0, rest: Buffer.alloc(0), ctx: context.create(), behind: false, catchingUp: false };
        tails.set(sid, st);
        count('transcripts');
      }
      if (!st.catchingUp) tail(st);
      return st.behind ? null : st.ctx;
    },
    // Forget the sessions that have ended
    prune(live, now = Date.now()) {
      for (const sid of tails.keys()) if (!live.has(sid)) tails.delete(sid);
      for (const [sid, at] of missed) if (now - at >= retryMs) missed.delete(sid);
    },
  };
}

module.exports = { createTranscripts };
