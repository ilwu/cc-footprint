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
function createSessions(dir, { retryMs = 5000 } = {}) {
  const self = {
    pids: new Map(),  // sessionId -> pid
    info: new Map(),  // sessionId -> { cwd, name }
    start: new Map(), // pid -> when its file says the session started (epoch ms)
  };
  let lastScanAt = 0;

  self.scan = () => {
    self.pids.clear();
    self.info.clear();
    self.start.clear();
    let files;
    try { files = fs.readdirSync(dir); } catch { return; }
    for (const f of files) {
      if (!/^\d+\.json$/.test(f)) continue;
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (!s.sessionId || !s.pid) continue;
        const startedAt = typeof s.startedAt === 'number' ? s.startedAt : undefined;
        if (startedAt !== undefined) self.start.set(s.pid, startedAt);
        // A session that was killed leaves its file behind. Should the same
        // id be in two files, the later start is the process that is running.
        const known = self.pids.get(s.sessionId);
        if (known !== undefined && (self.start.get(known) || 0) > (startedAt || 0)) continue;
        self.pids.set(s.sessionId, s.pid);
        self.info.set(s.sessionId, { cwd: s.cwd || '', name: s.name || '' });
      } catch {}
    }
  };

  // Whether the session is reachable by Remote Control now: its file holds
  // a bridgeSessionId while it is on and null once it is turned off. Read
  // afresh on every call, so that the statusline follows a switch at its
  // next render; null when the file cannot be read.
  self.remoteControl = pid => {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, `${pid}.json`), 'utf8'));
      return !!s.bridgeSessionId;
    } catch {
      return null;
    }
  };

  self.pidFor = (sid, now = Date.now()) => {
    let pid = self.pids.get(sid);
    if (pid === undefined && now - lastScanAt >= retryMs) {
      lastScanAt = now;
      self.scan();
      pid = self.pids.get(sid);
    }
    return pid;
  };

  return self;
}

module.exports = { createSessions };
