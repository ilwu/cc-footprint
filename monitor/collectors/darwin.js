'use strict';

// ── macOS collector ──────────────────────────────────────────────────
// One ps call lists every process with all the table needs; a process
// spawn costs little here. System memory comes from vm_stat, because
// os.freemem() on macOS counts only pages nothing has ever touched and so
// calls the machine nearly full all the time.

const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const mcp = require('./mcp');

const PS_COLUMNS = 'pid=,ppid=,rss=,etime=,tty=,command=';

function run(file, args) {
  return execFileSync(file, args, { timeout: 10000, maxBuffer: 16 * 1024 * 1024 }).toString();
}

// "[[dd-]hh:]mm:ss", as ps prints a process's age -> seconds
function elapsedSeconds(text) {
  const m = text.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+m[3]) * 60 + (+m[4]);
}

// The output of `ps -axww -o <PS_COLUMNS>`: rss in KB, the command line
// last so that its spaces do no harm. Also which tty each process reads.
function parsePs(text, now) {
  const table = [];
  const ttys = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, rssKb, etime, tty, command] = m;
    table.push({
      pid: +pid,
      ppid: +ppid,
      mem: rssKb * 1024,
      born: now - elapsedSeconds(etime) * 1000,
      name: path.basename(command.split(' ')[0]),
      mcp: mcp.label(command) || null,
    });
    if (tty !== '??') ttys.set(+pid, '/dev/' + tty);
  }
  return { table, ttys };
}

// Memory in use, 0-100, from vm_stat: what Activity Monitor adds up as
// used — active, wired and compressed pages — over the machine's memory.
function parseVmStat(text, totalBytes) {
  const page = +(text.match(/page size of (\d+) bytes/) || [])[1] || 4096;
  const pages = key => +(text.match(new RegExp('^' + key + ':\\s+(\\d+)', 'm')) || [])[1] || 0;
  const used = (pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) * page;
  return totalBytes > 0 ? Math.round((100 * used) / totalBytes) : null;
}

function terminalCols(tty) {
  try {
    const size = run('stty', ['-f', tty, 'size']).trim().split(' ');
    return parseInt(size[1]) || 0;
  } catch {
    return 0;
  }
}

function prepare() {}

// done(err, { table, clock, cols, systemPct }); see collectors/index.js
function collect(sessionPids, done) {
  let seen;
  try {
    const now = Date.now();
    const { table, ttys } = parsePs(run('ps', ['-axww', '-o', PS_COLUMNS]), now);
    const cols = new Map();
    for (const p of table) {
      if (p.name !== 'claude' && !sessionPids.has(p.pid)) continue;
      const tty = ttys.get(p.pid);
      const width = tty ? terminalCols(tty) : 0;
      if (width > 0) cols.set(p.pid, width);
    }
    seen = { table, clock: now, cols, systemPct: parseVmStat(run('vm_stat', []), os.totalmem()) };
  } catch (e) {
    return done(e);
  }
  done(null, seen);
}

module.exports = { prepare, collect, parsePs, parseVmStat, elapsedSeconds };
