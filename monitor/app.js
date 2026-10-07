'use strict';

// The monitor: every INTERVAL it measures each session's process tree,
// and it answers the statusline and the plugin over HTTP. This file only
// wires the parts together:
//   config.js        the items and their on/off settings
//   i18n.js          the monitor's words in the person's language (i18n/)
//   sessions.js      session id -> pid, from Claude Code's session files
//   transcripts.js   context composition, from the transcripts
//   plugin-state.js  whether our plugin is enabled
//   collectors/      the process table, per platform
//   proctree.js      the table -> each session's tree, MCP servers
//   api.js           the HTTP API
//   tray.js          the tray / menu bar icon

const http = require('http');
const path = require('path');
const collector = require('./collectors');
const proctree = require('./proctree');
const { createConfig } = require('./config');
const { createI18n } = require('./i18n');
const { createSessions } = require('./sessions');
const { createTranscripts } = require('./transcripts');
const { createPluginState } = require('./plugin-state');
const { createHandler } = require('./api');
const { createTray } = require('./tray');

const PORT = 19823;
const INTERVAL = 60000;
const HOME = process.env.USERPROFILE || process.env.HOME;
const CONFIG_DIR = path.join(HOME, '.cc-footprint');
const CLAUDE_DIR = path.join(HOME, '.claude');

if (!collector) {
  console.error(`cc-footprint does not run on ${process.platform} yet`);
  process.exit(1);
}

// What the last measurement found, and how the monitor is doing
const m = {
  store: new Map(),     // pid -> { mem, self, procs, mcp_mem, mcp_count, updatedAt }
  cols: new Map(),      // pid -> estimated terminal columns
  outside: [],          // MCP servers outside every session's tree, largest first
  systemPct: null,
  lastCollectAt: 0,
  lastMeasuredAt: 0,
  stats: { rows_read: 0, rows_failed: 0, transcripts: 0, collect_errors: 0 },
};

const config = createConfig(path.join(CONFIG_DIR, 'config.json'));
const i18n = createI18n();
const sessions = createSessions(path.join(CLAUDE_DIR, 'sessions'));
const transcripts = createTranscripts(path.join(CLAUDE_DIR, 'projects'), { stats: m.stats });
const plugin = createPluginState(path.join(CLAUDE_DIR, 'settings.json'));

// ── Collection ───────────────────────────────────────────────────────
// The platform's collector lists the processes; proctree.js adds up each
// session's tree from that table.
let collecting = false;
function collect() {
  // A slow PowerShell must not have a second collection overtake it and its
  // older table land last
  if (collecting) return;
  collecting = true;
  m.lastCollectAt = Date.now();
  plugin.check();

  // Forget the transcripts of sessions that have ended
  sessions.scan();
  transcripts.prune(new Set(sessions.pids.keys()));

  const pids = new Set(sessions.pids.values());
  const started = new Map(sessions.start);
  try {
    collector.collect(pids, done);
  } catch (e) {
    done(e);
  }
  function done(err, seen) {
    collecting = false;
    if (err) {
      m.stats.collect_errors++;
      console.error('[collect] failed:', err.message);
      return;
    }
    // An empty table means the query failed, not that everything exited
    if (!seen.table.length) { m.stats.collect_errors++; return; }

    const now = Date.now();
    // How long ago each session on file started: proctree tells by it a
    // session from a process that was handed the pid of one that is gone
    const ages = new Map();
    for (const pid of pids) ages.set(pid, started.has(pid) ? now - started.get(pid) : undefined);
    const measured = proctree.measure(seen.table, ages, seen.clock);
    m.store.clear();
    for (const [pid, r] of measured.sessions) m.store.set(pid, { ...r, updatedAt: now });
    // A width that could not be read this time keeps its last value
    for (const [pid, cols] of seen.cols) m.cols.set(pid, cols);
    for (const pid of m.cols.keys()) {
      if (!m.store.has(pid)) m.cols.delete(pid);
    }
    m.systemPct = seen.systemPct;
    m.outside = measured.outside;
    m.lastMeasuredAt = now;

    tray.update();
  }
}

// Throttled so a stale session file can't make every render spawn PowerShell
function collectSoon() {
  if (Date.now() - m.lastCollectAt < 10000) return;
  collect();
}

// ── Main ─────────────────────────────────────────────────────────────
const server = http.createServer(createHandler({
  port: PORT, m, config, i18n, sessions, transcripts, plugin, collectSoon, staleMs: 3 * INTERVAL,
}));
const tray = createTray({
  config, i18n, m, sessions, configDir: CONFIG_DIR,
  onExit: () => { server.close(); process.exit(0); },
});

config.load();
config.save();
collector.prepare(CONFIG_DIR);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`cc-footprint  http://127.0.0.1:${PORT}`);
  // The icon is an extra: a helper that fails to start, or starts and never
  // answers, must not hold up the measuring
  tray.start().catch(e => console.error('[tray]', e.message));
  collect();
  setInterval(collect, INTERVAL);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} in use, already running?`);
    process.exit(1);
  }
  throw err;
});
