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
  { id: 'mcp_use',    label: 'MCP Usage Share',           group: 'usage',   default: true  },
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
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
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
let mcpOrphans = 0;   // MCP servers whose parent process is gone
let mcpOrphanMem = 0; // their memory in bytes
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
  collector.collect(pids, (err, seen) => {
    if (err) {
      console.error('[collect] failed:', err.message);
      return;
    }
    // An empty table means the query failed, not that everything exited
    if (!seen.table.length) return;

    const now = Date.now();
    const measured = proctree.measure(seen.table, pids, seen.clock);
    store.clear();
    for (const [pid, r] of measured.sessions) store.set(pid, { ...r, updatedAt: now });
    // A width that could not be read this time keeps its last value
    for (const [pid, cols] of seen.cols) windowCols.set(pid, cols);
    for (const pid of windowCols.keys()) {
      if (!store.has(pid)) windowCols.delete(pid);
    }
    systemMemPct = seen.systemPct;
    mcpOrphans = measured.orphans;
    mcpOrphanMem = measured.orphanMem;

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

function scanSessions() {
  sessionPids.clear();
  sessionInfo.clear();
  let files;
  try { files = fs.readdirSync(SESSIONS_DIR); } catch { return; }
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
      if (s.sessionId && s.pid) {
        sessionPids.set(s.sessionId, s.pid);
        sessionInfo.set(s.sessionId, { cwd: s.cwd || '', name: s.name || '' });
      }
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

// ── Session usage from transcripts ───────────────────────────────────
// Two things Claude Code does not pass to the statusline are derived by
// tailing the session's transcript .jsonl files (only newly appended
// bytes are read):
//
// - MCP usage share: the share of the session's cost-weighted usage that
//   went to requests which consumed an MCP tool result — the rule /usage
//   applies per MCP server, scoped here to one session (its subagents
//   included).
// - Context composition: what the main conversation's window is filled
//   with and how much the current turn added (see context.js). Subagents
//   have windows of their own, so only the main transcript counts.
const PROJECTS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'projects');
const sessionUsage = new Map(); // sessionId -> { main, subDir, files: Map(path -> file state) }

// $ per million tokens: [input, output, cache read, 5m cache write, 1h cache write].
// Only the ratios matter, and mostly when a session mixes models
// (e.g. a cheaper subagent model).
const MODEL_PRICE = [
  [/haiku/,  [1, 5, 0.10, 1.25, 2]],
  [/sonnet/, [2, 10, 0.20, 2.50, 4]],
  [/opus/,   [4, 20, 0.20, 5, 8]],
  [/fable/,  [10, 50, 0.25, 12.50, 20]],
];
const DEFAULT_PRICE = MODEL_PRICE[2][1];

function weigh(u, model) {
  let p = DEFAULT_PRICE;
  for (const [re, price] of MODEL_PRICE) if (re.test(model || '')) { p = price; break; }
  const w1h = (u.cache_creation || {}).ephemeral_1h_input_tokens || 0;
  const w5m = (u.cache_creation_input_tokens || 0) - w1h;
  return p[0] * (u.input_tokens || 0) + p[1] * (u.output_tokens || 0)
    + p[2] * (u.cache_read_input_tokens || 0) + p[3] * w5m + p[4] * w1h;
}

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
  const isAssistant = line.includes('"type":"assistant"');
  // Context tracking also needs prompts and compaction boundaries
  const forContext = st.ctx && (line.includes('"type":"user"') || line.includes('"compact_boundary"'));
  if (!isAssistant && !forContext && !line.includes('"tool_result"')) return;
  let j;
  try { j = JSON.parse(line); } catch { return; }
  if (st.ctx) context.track(st.ctx, j);
  const msg = j.message;
  if (!msg) return;

  if (j.type === 'assistant' && msg.usage && msg.id) {
    // One API response spans several lines (one per content block), each
    // repeating the usage so far — keep the latest per message id.
    let m = st.msgs.get(msg.id);
    if (!m) {
      m = { w: 0, mcp: st.pending };
      st.pending = false;
      st.msgs.set(msg.id, m);
    }
    const w = weigh(msg.usage, msg.model);
    st.total += w - m.w;
    if (m.mcp) st.mcp += w - m.w;
    m.w = w;
    for (const c of msg.content || []) {
      if (c.type === 'tool_use' && c.name.startsWith('mcp__')) st.mcpIds.add(c.id);
    }
  } else if (j.type === 'user' && Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (c.type === 'tool_result' && st.mcpIds.delete(c.tool_use_id)) st.pending = true;
    }
  }
}

function tailTranscript(s, file) {
  let st = s.files.get(file);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    if (!st || size < st.offset) {
      st = { offset: 0, rest: Buffer.alloc(0), msgs: new Map(), mcpIds: new Set(), pending: false, total: 0, mcp: 0,
             ctx: file === s.main ? context.create() : null };
      s.files.set(file, st);
    }
    if (size === st.offset) return;
    const buf = Buffer.alloc(size - st.offset);
    const n = fs.readSync(fd, buf, 0, buf.length, st.offset);
    st.offset += n;
    const data = Buffer.concat([st.rest, buf.subarray(0, n)]);
    const end = data.lastIndexOf(10) + 1; // only complete lines
    st.rest = data.subarray(end);
    for (const line of data.toString('utf8', 0, end).split('\n')) {
      if (line) processLine(st, line);
    }
  } catch {
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

// The session's transcript state, read up to date; null with no transcript
function readUsage(sid) {
  let s = sessionUsage.get(sid);
  if (!s) {
    const main = findTranscript(sid);
    if (!main) return null;
    s = { main, subDir: path.join(path.dirname(main), sid, 'subagents'), files: new Map() };
    sessionUsage.set(sid, s);
  }
  tailTranscript(s, s.main);
  try {
    for (const f of fs.readdirSync(s.subDir)) {
      if (f.endsWith('.jsonl')) tailTranscript(s, path.join(s.subDir, f));
    }
  } catch {}
  return s;
}

function mainContext(s) {
  const st = s.files.get(s.main);
  return st ? st.ctx : null;
}

// Percentage (0-100), or null when the session has no usage yet
function mcpUsePct(s) {
  let total = 0, mcp = 0;
  for (const st of s.files.values()) { total += st.total; mcp += st.mcp; }
  return total > 0 ? Math.round(100 * mcp / total) : null;
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
    // This session's own MCP servers; orphans are counted machine-wide
    mcp_total: d ? d.mcp_mem : 0,
    mcp_count: d ? d.mcp_count : 0,
    mcp_orphans: mcpOrphans,
    mcp_orphan_mem: mcpOrphanMem,
    plugin: pluginInstalled,
    cols: windowCols.get(pid) || null,
    display: getDisplay(),
  };
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

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
    const { claude_total, system_pct, mcp_orphans, mcp_orphan_mem } = statusFor();
    return res.end(JSON.stringify({ sessions, claude_total, system_pct, mcp_orphans, mcp_orphan_mem }));
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
    if (config.mcp_use || config.ctx_grow || config.ctx_src) {
      const usage = readUsage(s[1]);
      if (config.mcp_use) status.mcp_use = usage ? mcpUsePct(usage) : null;
      const ctx = usage && context.summarize(mainContext(usage));
      if (ctx) {
        status.ctx_turn = ctx.turn;
        status.ctx_src = ctx.src;
        status.ctx_src_pct = ctx.src_pct;
      }
    }
    return res.end(JSON.stringify(status));
  }

  // GET /context/:sessionId — everything the session's context is made of
  const c = req.url.match(/^\/context\/([0-9a-fA-F-]+)$/);
  if (c) {
    const usage = readUsage(c[1]);
    return res.end(JSON.stringify(usage ? context.detail(mainContext(usage)) : null));
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
});

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
  // One short line: the menu is as wide as its widest row. A process
  // without a session file (the Chrome native host) is in the total, as in
  // the statusline's, but is no session.
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
  try {
    systray = new SysTray({
      menu: {
        icon: iconBase64,
        title: '',
        tooltip: 'cc-footprint',
        items,
      },
      debug: false,
      copyDir: false,
    });
    await systray.ready();
  } finally {
    childProcess.spawn = spawn;
  }

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

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`cc-footprint  http://127.0.0.1:${PORT}`);
  await startTray();
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
