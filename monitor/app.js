'use strict';

const http = require('http');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const collector = require('./collectors');
const context = require('./context');
const proctree = require('./proctree');

const PORT = 19823;
const INTERVAL = 60000;
const HOME = process.env.USERPROFILE || process.env.HOME;
const CONFIG_DIR = path.join(HOME, '.cc-footprint');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// ── Item Registry ────────────────────────────────────────────────────
// Each item defines: id, label, the menu group it sits in, default enabled.
// Statusline reads `display` array from API to know what to render.
// To add a new item: add a line to its group here.
// A label must not hold "&": a Windows menu reads it as a shortcut mark
// and does not draw it.
const ITEMS = [
  { id: 'sys_mem',    label: 'System Memory',             group: 'memory',  default: true  },
  { id: 'claude_mem', label: 'Claude Memory',             group: 'memory',  default: true  },
  { id: 'mcp_mem',    label: 'MCP Memory',                group: 'memory',  default: true  },
  { id: 'ctx',        label: 'Context Window',            group: 'usage',   default: true  },
  { id: 'ctx_grow',   label: 'Context: Growth This Turn', group: 'usage',   default: true  },
  { id: 'ctx_src',    label: 'Context: Top Source',       group: 'usage',   default: false },
  { id: 'ctx_mcp',    label: 'Context: MCP Share',        group: 'usage',   default: true  },
  { id: 'five_hour',  label: '5h Usage',                  group: 'usage',   default: true  },
  { id: 'week',       label: 'Weekly Usage',              group: 'usage',   default: true  },
  { id: 'resets',     label: 'Limit Reset Countdown',     group: 'usage',   default: true  },
  { id: 'cost',       label: 'Session Cost ($)',          group: 'usage',   default: false },
  { id: 'session_id', label: 'Session ID',                group: 'session', default: true  },
  { id: 'path',       label: 'Project Path',              group: 'session', default: true  },
  { id: 'model',      label: 'Model + Effort',            group: 'session', default: false },
  { id: 'lines',      label: 'Lines +/-',                 group: 'session', default: false },
  { id: 'duration',   label: 'Session Duration',          group: 'session', default: false },
  { id: 'plugin_hint', label: '/footprint Hint',           group: 'session', default: true  },
];

// ── Config ───────────────────────────────────────────────────────────
let config = {};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      // A file holding null or a list is as good as one that does not parse
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) config = saved;
    }
  } catch {}
  // Apply defaults for missing items
  for (const item of ITEMS) {
    if (config[item.id] === undefined) {
      config[item.id] = item.default;
    }
  }
}

function saveConfig() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[config] save failed:', e.message);
  }
}

// The tray writes the config file; where there is no tray the person
// edits it by hand, so a change on disk is picked up on the next request.
let configMtime = 0;
function refreshConfig() {
  try {
    const mtime = fs.statSync(CONFIG_FILE).mtimeMs;
    if (mtime !== configMtime) {
      configMtime = mtime;
      loadConfig();
    }
  } catch {}
}

function getDisplay() {
  return ITEMS.filter(i => config[i.id]).map(i => i.id);
}

// ── State ────────────────────────────────────────────────────────────
const store = new Map(); // pid -> { mem, updatedAt }
let systemMemPct = null;
// Whether the Claude Code plugin is installed and enabled for the user;
// null when nobody can tell. The statusline nudges towards it otherwise.
// Whether our plugin is enabled for the user, read from Claude Code's own
// settings. Re-read when the file changes, so the statusline hint flips on
// the render after an install or uninstall rather than a minute later.
let pluginInstalled = null;
let settingsMtime = 0;
const CLAUDE_SETTINGS = path.join(HOME, '.claude', 'settings.json');

function checkPlugin() {
  try {
    const mtime = fs.statSync(CLAUDE_SETTINGS).mtimeMs;
    if (mtime === settingsMtime) return;
    settingsMtime = mtime;
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8').replace(/^﻿/, ''));
    const enabled = settings.enabledPlugins || {};
    pluginInstalled = Object.keys(enabled).some(k => k.startsWith('cc-footprint@') && enabled[k] === true);
  } catch {
    settingsMtime = 0;
    pluginInstalled = null;
  }
}
// MCP servers outside every session's tree (see proctree.js), largest first
let mcpOutside = []; // [{ pid, name, mem, age }]
const windowCols = new Map(); // pid -> estimated terminal columns

// ── Helpers ──────────────────────────────────────────────────────────
function fmtMem(bytes) {
  const mb = bytes / 1048576;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + 'GB' : Math.round(mb) + 'MB';
}

// ── Collector ────────────────────────────────────────────────────────
// The platform's collector lists the processes (collectors/); proctree.js
// adds up each session's tree from that table.
function collect() {
  lastCollectAt = Date.now();
  checkPlugin();

  // Drop transcript state of sessions that have ended
  scanSessions();
  for (const sid of sessionUsage.keys()) {
    if (!sessionPids.has(sid)) sessionUsage.delete(sid);
  }

  const pids = new Set(sessionPids.values());
  const started = new Map(sessionStart);
  collector.collect(pids, (err, seen) => {
    if (err) {
      console.error('[collect] failed:', err.message);
      return;
    }
    // An empty table means the query failed, not that everything exited
    if (!seen.table.length) return;

    const now = Date.now();
    // How long ago each session on file started: proctree tells by it a
    // session from a process that was handed the pid of one that is gone
    const ages = new Map();
    for (const pid of pids) ages.set(pid, started.has(pid) ? now - started.get(pid) : undefined);
    const measured = proctree.measure(seen.table, ages, seen.clock);
    store.clear();
    for (const [pid, r] of measured.sessions) store.set(pid, { ...r, updatedAt: now });
    // A width that could not be read this time keeps its last value
    for (const [pid, cols] of seen.cols) windowCols.set(pid, cols);
    for (const pid of windowCols.keys()) {
      if (!store.has(pid)) windowCols.delete(pid);
    }
    systemMemPct = seen.systemPct;
    mcpOutside = measured.outside;

    updateTray();
  });
}

// ── Session → PID ────────────────────────────────────────────────────
// Claude Code writes ~/.claude/sessions/<pid>.json containing the
// sessionId, so the statusline can look itself up by session_id instead
// of walking the process tree.
const SESSIONS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'sessions');
const sessionPids = new Map(); // sessionId -> pid
const sessionInfo = new Map(); // sessionId -> { cwd, name }
const sessionStart = new Map(); // pid -> when its file says the session started (epoch ms)

function scanSessions() {
  sessionPids.clear();
  sessionInfo.clear();
  sessionStart.clear();
  let files;
  try { files = fs.readdirSync(SESSIONS_DIR); } catch { return; }
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
      if (!s.sessionId || !s.pid) continue;
      const startedAt = typeof s.startedAt === 'number' ? s.startedAt : undefined;
      if (startedAt !== undefined) sessionStart.set(s.pid, startedAt);
      // A session that was killed leaves its file behind. Should the same
      // id be in two files, the later start is the process that is running.
      const known = sessionPids.get(s.sessionId);
      if (known !== undefined && (sessionStart.get(known) || 0) > (startedAt || 0)) continue;
      sessionPids.set(s.sessionId, s.pid);
      sessionInfo.set(s.sessionId, { cwd: s.cwd || '', name: s.name || '' });
    } catch {}
  }
}

function pidForSession(sid) {
  let pid = sessionPids.get(sid);
  if (pid === undefined) {
    scanSessions(); // new session, or sessionId changed after /clear or resume
    pid = sessionPids.get(sid);
  }
  return pid;
}

// ── Context composition from the transcript ──────────────────────────
// What the main conversation's window is filled with and how much the
// current turn added (see context.js), worked out by tailing the session's
// transcript .jsonl: only newly appended bytes are read. Subagents have
// windows of their own, so only the main transcript counts.
const PROJECTS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'projects');
const sessionUsage = new Map(); // sessionId -> { file, offset, rest, ctx }

function findTranscript(sid) {
  let dirs;
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return null; }
  for (const d of dirs) {
    const p = path.join(PROJECTS_DIR, d, sid + '.jsonl');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function processLine(st, line) {
  // Responses, prompts and tool results, and compaction boundaries
  if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"') && !line.includes('"compact_boundary"')) return;
  let j;
  try { j = JSON.parse(line); } catch { return; }
  context.track(st.ctx, j);
}

function tailTranscript(st) {
  let fd;
  try {
    fd = fs.openSync(st.file, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < st.offset) {
      // Rewritten from the start: read it all again
      st.offset = 0; st.rest = Buffer.alloc(0); st.ctx = context.create();
    }
    if (size === st.offset) return;
    const buf = Buffer.alloc(size - st.offset);
    const n = fs.readSync(fd, buf, 0, buf.length, st.offset);
    st.offset += n;
    const data = Buffer.concat([st.rest, buf.subarray(0, n)]);
    const end = data.lastIndexOf(10) + 1; // only complete lines
    st.rest = data.subarray(end);
    for (const line of data.toString('utf8', 0, end).split('\n')) {
      // One row of an unforeseen shape costs that row, not the ones after it
      if (line) try { processLine(st, line); } catch {}
    }
  } catch {
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

// The session's context state, read up to date; null with no transcript
function readUsage(sid) {
  let st = sessionUsage.get(sid);
  if (!st) {
    const file = findTranscript(sid);
    if (!file) return null;
    st = { file, offset: 0, rest: Buffer.alloc(0), ctx: context.create() };
    sessionUsage.set(sid, st);
  }
  tailTranscript(st);
  return st;
}

// Throttled so a stale session file can't make every render spawn PowerShell
let lastCollectAt = 0;
function collectSoon() {
  if (Date.now() - lastCollectAt < 10000) return;
  collect();
}

// ── HTTP API ─────────────────────────────────────────────────────────
function statusFor(pid) {
  const d = pid !== undefined ? store.get(pid) : undefined;
  let claudeTotal = 0;
  for (const v of store.values()) claudeTotal += v.mem;
  return {
    ...(d || { mem: null }),
    claude_total: claudeTotal,
    system_pct: systemMemPct,
    // This session's own MCP servers; the ones outside every session are
    // the machine's
    mcp_total: d ? d.mcp_mem : 0,
    mcp_count: d ? d.mcp_count : 0,
    mcp_outside: mcpOutside.length,
    mcp_outside_mem: mcpOutside.reduce((sum, s) => sum + s.mem, 0),
    plugin: pluginInstalled,
    cols: windowCols.get(pid) || null,
    display: getDisplay(),
  };
}

// A page in a browser can reach this port by pointing a name of its own at
// 127.0.0.1 (DNS rebinding), and would read every session's name and
// folder. Its requests carry that name as Host, so only our own are
// answered; "l" is what statusline.sh sends, the shortest that will do.
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, 'l']);

const server = http.createServer((req, res) => {
  try {
    answer(req, res);
  } catch (e) {
    // An odd request or file costs that one answer, not the monitor
    console.error('[http]', req.url, e.message);
    if (!res.headersSent) res.writeHead(500);
    res.end('{}');
  }
});

function answer(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const host = req.headers.host;
  if (host !== undefined && !HOSTS.has(host.toLowerCase())) {
    res.writeHead(403);
    return res.end('{}');
  }

  // GET /status — all sessions
  if (req.url === '/status') {
    const obj = {};
    for (const [pid, d] of store) obj[pid] = d;
    return res.end(JSON.stringify(obj));
  }

  // GET /sessions — every running session with its memory, largest first
  if (req.url === '/sessions') {
    scanSessions();
    const sessions = [];
    for (const [sid, pid] of sessionPids) {
      const d = store.get(pid);
      if (!d) continue; // a session file left behind by a process that is gone
      sessions.push({
        session: sid, pid, ...sessionInfo.get(sid),
        mem: d.mem, self: d.self, procs: d.procs, mcp_mem: d.mcp_mem, mcp_count: d.mcp_count,
      });
    }
    sessions.sort((a, b) => b.mem - a.mem);
    const { claude_total, system_pct, mcp_outside, mcp_outside_mem } = statusFor();
    return res.end(JSON.stringify({ sessions, claude_total, system_pct, mcp_outside, mcp_outside_mem, outside: mcpOutside }));
  }

  // GET /session/:sessionId — what the statusline calls
  const s = req.url.match(/^\/session\/([0-9a-fA-F-]+)$/);
  if (s) {
    refreshConfig();
    checkPlugin();
    const pid = pidForSession(s[1]);
    // Session started after the last collect: refresh now so the next
    // statusline render has data instead of waiting a full interval.
    if (pid !== undefined && !store.has(pid)) collectSoon();
    const status = statusFor(pid);
    if (config.ctx_grow || config.ctx_src || config.ctx_mcp) {
      const usage = readUsage(s[1]);
      const ctx = usage && context.summarize(usage.ctx);
      if (ctx) {
        status.ctx_turn = ctx.turn;
        status.ctx_src = ctx.src;
        status.ctx_src_pct = ctx.src_pct;
        status.ctx_mcp_pct = ctx.mcp_pct;
      }
    }
    return res.end(JSON.stringify(status));
  }

  // GET /context/:sessionId — everything the session's context is made of
  const c = req.url.match(/^\/context\/([0-9a-fA-F-]+)$/);
  if (c) {
    const usage = readUsage(c[1]);
    return res.end(JSON.stringify(usage ? context.detail(usage.ctx) : null));
  }

  // GET /status/:pid — single session + summary + display config
  const m = req.url.match(/^\/status\/(\d+)$/);
  if (m) {
    return res.end(JSON.stringify(statusFor(parseInt(m[1]))));
  }

  // GET /config — current display config
  if (req.url === '/config') {
    refreshConfig();
    return res.end(JSON.stringify({ items: ITEMS, config, display: getDisplay() }));
  }

  res.writeHead(404);
  res.end('{}');
}

// ── System Tray ──────────────────────────────────────────────────────
let systray = null;
// The footprint, drawn by scripts/make-icon.py: an .ico in five sizes for
// Windows, a .png for the macOS menu bar. systray2 takes it as base64.
const iconBase64 = fs
  .readFileSync(path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'))
  .toString('base64');

const statusItem = { title: 'Collecting...', tooltip: 'Collecting...', checked: false, enabled: false };
// Item toggle menu entries — built from ITEMS registry
const toggleItems = ITEMS.map(item => ({
  title: item.label,
  tooltip: `Toggle ${item.label}`,
  checked: !!config[item.id],
  enabled: true,
}));
const exitItem = { title: 'Exit', tooltip: 'Exit cc-footprint', checked: false, enabled: true };

function updateTray() {
  if (!systray) return;
  // One short line: the menu is as wide as its widest row. A claude process
  // without a session file is in the total, as in the statusline's, but is
  // no session.
  const pids = new Set(sessionPids.values());
  let sessions = 0, total = 0;
  for (const [pid, d] of store) {
    total += d.mem;
    if (pids.has(pid)) sessions++;
  }
  const text = sessions === 0
    ? 'No active sessions'
    : `${sessions} session${sessions === 1 ? '' : 's'} · ${fmtMem(total)}`;
  statusItem.title = text;
  statusItem.tooltip = text;
  try {
    systray.sendAction({ type: 'update-item', item: statusItem });
  } catch {}
}

async function startTray() {
  if (process.platform === 'linux') {
    console.log(`[tray] none on Linux: choose items by editing ${CONFIG_FILE}`);
    return;
  }
  let SysTray;
  try {
    SysTray = require('systray2').default;
  } catch {
    console.log('[tray] systray2 not installed, running headless');
    return;
  }

  // Sync toggle states with loaded config
  for (let i = 0; i < ITEMS.length; i++) {
    toggleItems[i].checked = !!config[ITEMS[i].id];
  }

  // The toggles, a separator before each group
  const items = [statusItem];
  ITEMS.forEach((item, i) => {
    if (i === 0 || item.group !== ITEMS[i - 1].group) items.push(SysTray.separator);
    items.push(toggleItems[i]);
  });
  items.push(SysTray.separator, exitItem);

  // Under our own name first; the helper's own name where that cannot run
  for (const renamed of [true, false]) {
    try {
      await openTray(SysTray, items, renamed);
      console.log('[tray] ready');
      // The first measurement may have come in while the helper started
      if (systemMemPct !== null) updateTray();
      return;
    } catch (e) {
      console.error(`[tray] failed${renamed ? ' under our own name, trying the helper as shipped' : ''}:`, e.message);
      systray = null;
    }
  }
}

// The program that draws the icon ships inside systray2 as
// tray_windows_release.exe (tray_darwin_release on macOS), and with no
// version resource that file name is what Task Manager, Activity Monitor
// and the taskbar's icon settings show. It is run from a copy named after
// this tool.
const TRAY_HELPER = {
  win32: { shipped: /^tray_windows/, own: 'cc-footprint.exe' },
  darwin: { shipped: /^tray_darwin/, own: 'cc-footprint' },
}[process.platform];

// Returns null when the copy cannot be made
function ownTrayHelper(shipped) {
  const own = path.join(CONFIG_DIR, TRAY_HELPER.own);
  try {
    const from = fs.statSync(shipped);
    let to = null;
    try { to = fs.statSync(own); } catch {}
    // A copy in use by a tray still running cannot be replaced, nor need be
    if (!to || to.size !== from.size || to.mtimeMs < from.mtimeMs) {
      fs.copyFileSync(shipped, own);
      if (process.platform !== 'win32') fs.chmodSync(own, 0o755);
    }
    return own;
  } catch {
    return null;
  }
}

async function openTray(SysTray, items, renamed) {
  // systray2 offers no way to name the helper, so its spawn is redirected
  // for as long as it takes to start
  const spawn = childProcess.spawn;
  if (renamed && TRAY_HELPER) {
    childProcess.spawn = (file, ...rest) =>
      spawn(TRAY_HELPER.shipped.test(path.basename(file)) ? (ownTrayHelper(file) || file) : file, ...rest);
  }
  let tray;
  try {
    tray = new SysTray({
      menu: {
        icon: iconBase64,
        title: '',
        tooltip: 'cc-footprint',
        items,
      },
      debug: false,
      copyDir: false,
    });
    await tray.ready();
  } finally {
    childProcess.spawn = spawn;
  }
  // Only now is it the tray to update: an action sent to a helper that
  // never answers would wait on it for good
  systray = tray;

  systray.onClick(action => {
    // Exit
    if (action.item === exitItem) {
      systray.kill(false);
      server.close();
      process.exit(0);
    }
    // Toggle items
    const idx = toggleItems.indexOf(action.item);
    if (idx >= 0) {
      const itemDef = ITEMS[idx];
      config[itemDef.id] = !config[itemDef.id];
      toggleItems[idx].checked = config[itemDef.id];
      saveConfig();
      try {
        systray.sendAction({ type: 'update-item', item: toggleItems[idx] });
      } catch {}
      console.log(`[config] ${itemDef.id} = ${config[itemDef.id]}`);
    }
  });
}

// ── Main ─────────────────────────────────────────────────────────────
if (!collector) {
  console.error(`cc-footprint does not run on ${process.platform} yet`);
  process.exit(1);
}
loadConfig();
saveConfig();
collector.prepare(CONFIG_DIR);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`cc-footprint  http://127.0.0.1:${PORT}`);
  // The icon is an extra: a helper that fails to start, or starts and never
  // answers, must not hold up the measuring
  startTray().catch(e => console.error('[tray]', e.message));
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
