'use strict';

// ── Linux collector ──────────────────────────────────────────────────
// The process table comes straight from /proc with plain file reads, so
// listing every process spawns nothing. Only a session's terminal width
// needs a command (stty), and only for the few session processes.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const mcp = require('./mcp');

// Two kernel constants /proc does not carry. They are 100 and 4096 on
// virtually every Linux; getconf settles it where they are not.
function getconf(name, fallback) {
  try {
    const n = parseInt(execFileSync('getconf', [name], { timeout: 1000 }).toString());
    return n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

let ticksPerSecond = 100;
let pageSize = 4096;

function prepare() {
  ticksPerSecond = getconf('CLK_TCK', 100);
  pageSize = getconf('PAGESIZE', 4096);
}

// One /proc/<pid>/stat line. The name sits in parentheses and may itself
// hold spaces or parentheses, so the fields are counted from the last ")".
function parseStat(text) {
  const open = text.indexOf('('), close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  // rest[0] is field 3 (state): ppid is field 4, starttime 22, rss 24
  const rest = text.slice(close + 2).split(' ');
  return {
    name: text.slice(open + 1, close),
    ppid: parseInt(rest[1]) || 0,
    startTicks: parseInt(rest[19]) || 0,
    rssPages: parseInt(rest[21]) || 0,
  };
}

// When the machine booted, in epoch ms: process start times count from it
function bootTime(procDir) {
  const m = fs.readFileSync(path.join(procDir, 'stat'), 'utf8').match(/^btime (\d+)/m);
  return m ? parseInt(m[1]) * 1000 : 0;
}

function readTable(procDir) {
  const boot = bootTime(procDir);
  const table = [];
  for (const entry of fs.readdirSync(procDir)) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = parseStat(fs.readFileSync(path.join(procDir, entry, 'stat'), 'utf8'));
      if (!stat) continue;
      // Arguments are NUL-separated; a kernel thread has none
      const cmdline = fs.readFileSync(path.join(procDir, entry, 'cmdline'), 'utf8');
      table.push({
        pid: parseInt(entry),
        ppid: stat.ppid,
        mem: stat.rssPages * pageSize,
        born: boot + Math.round(stat.startTicks * 1000 / ticksPerSecond),
        name: stat.name,
        mcp: mcp.label(cmdline) || null,
      });
    } catch {} // the process exited between the listing and the read
  }
  return table;
}

// Memory in use, 0-100. MemAvailable counts reclaimable cache as free,
// which MemFree does not.
function systemPct(procDir) {
  const info = fs.readFileSync(path.join(procDir, 'meminfo'), 'utf8');
  const kb = key => {
    const m = info.match(new RegExp('^' + key + ':\\s+(\\d+)', 'm'));
    return m ? parseInt(m[1]) : 0;
  };
  const total = kb('MemTotal');
  return total > 0 ? Math.round((1 - kb('MemAvailable') / total) * 100) : null;
}

// Columns of the terminal a process reads from, 0 when it has none
function terminalCols(procDir, pid) {
  try {
    const tty = fs.readlinkSync(path.join(procDir, String(pid), 'fd', '0'));
    if (!/^\/dev\/(pts\/\d+|tty\w*)$/.test(tty)) return 0;
    const size = execFileSync('stty', ['-F', tty, 'size'], { timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] });
    return parseInt(size.toString().trim().split(' ')[1]) || 0;
  } catch {
    return 0;
  }
}

// done(err, { table, clock, cols, systemPct }); see collectors/index.js
function collect(sessionPids, done, procDir = '/proc') {
  let seen;
  try {
    const table = readTable(procDir);
    const cols = new Map();
    for (const p of table) {
      if (p.name !== 'claude' && !sessionPids.has(p.pid)) continue;
      const width = terminalCols(procDir, p.pid);
      if (width > 0) cols.set(p.pid, width);
    }
    seen = { table, clock: Date.now(), cols, systemPct: systemPct(procDir) };
  } catch (e) {
    return done(e);
  }
  done(null, seen);
}

module.exports = { prepare, collect, parseStat };
