'use strict';

// ── Session → PID ────────────────────────────────────────────────────
// Claude Code writes ~/.claude/sessions/<pid>.json containing the
// sessionId, so the statusline can look itself up by session_id instead
// of walking the process tree.

const fs = require('fs');
const path = require('path');

// A session the files do not name yet (it has just started, or its id
// changed after /clear or resume) has them read again, but not on every
// render: at most every `retryMs`.
//
// The files are read asynchronously: on Windows an open can be held up for
// seconds (something on the machine checking the file), and a synchronous
// one would stop every answer of the monitor for as long.
function createSessions(dir, { retryMs = 5000 } = {}) {
  const self = {
    pids: new Map(),  // sessionId -> pid
    info: new Map(),  // sessionId -> { cwd, name }
    start: new Map(), // pid -> when its file says the session started (epoch ms)
  };
  let lastScanAt = 0;
  let scanning = null;

  async function readAll() {
    let files = [];
    try { files = await fs.promises.readdir(dir); } catch {}
    const names = files.filter(f => /^\d+\.json$/.test(f));
    const bodies = await Promise.all(names.map(f => fs.promises.readFile(path.join(dir, f), 'utf8').catch(() => null)));

    const pids = new Map(), info = new Map(), start = new Map();
    for (const body of bodies) {
      try {
        const s = JSON.parse(body);
        if (!s.sessionId || !s.pid) continue;
        const startedAt = typeof s.startedAt === 'number' ? s.startedAt : undefined;
        if (startedAt !== undefined) start.set(s.pid, startedAt);
        // A session that was killed leaves its file behind. Should the same
        // id be in two files, the later start is the process that is running.
        const known = pids.get(s.sessionId);
        if (known !== undefined && (start.get(known) || 0) > (startedAt || 0)) continue;
        pids.set(s.sessionId, s.pid);
        info.set(s.sessionId, { cwd: s.cwd || '', name: s.name || '' });
      } catch {}
    }
    // Swapped in whole, so that an answer given while the files are being read sees the
    // last full scan rather than a half-filled one
    self.pids = pids;
    self.info = info;
    self.start = start;
  }

  // One scan at a time: while an open is held up, those that ask meanwhile
  // wait for the scan under way rather than start more
  self.scan = () => {
    if (!scanning) scanning = readAll().finally(() => { scanning = null; });
    return scanning;
  };

  // Whether the session is reachable by Remote Control now: its file holds
  // a bridgeSessionId while it is on and null once it is turned off. Read
  // afresh on every call, so that the statusline follows a switch at its
  // next render; null when the file cannot be read.
  self.remoteControl = async pid => {
    try {
      const s = JSON.parse(await fs.promises.readFile(path.join(dir, `${pid}.json`), 'utf8'));
      return !!s.bridgeSessionId;
    } catch {
      return null;
    }
  };

  self.pidFor = async (sid, now = Date.now()) => {
    if (!self.pids.has(sid) && now - lastScanAt >= retryMs) {
      lastScanAt = now;
      await self.scan();
    }
    return self.pids.get(sid);
  };

  return self;
}

module.exports = { createSessions };
