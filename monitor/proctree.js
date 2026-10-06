'use strict';

// ── Session process trees ────────────────────────────────────────────
// A session's memory is more than its claude process: every MCP server it
// starts is a child process, and so is each shell a tool runs in. Given the
// machine's process table, this adds up the whole tree under each Claude
// Code process and picks out the MCP servers in it.
//
// The table is platform-neutral, one row per process:
//   { pid, ppid, mem, born, name, mcp }
// mem is resident bytes, born the start time in ms (any epoch, as long as
// `now` shares it), mcp whether the command line names an MCP server. A
// platform's collector only has to list processes.

// A tool's shell can carry "mcp" on its command line for a moment (a grep,
// a build); an MCP server lives as long as its session does.
const MCP_MIN_AGE_MS = 30000;

// The CLI's own binary. The comparison is case-sensitive on purpose: the
// desktop app's "Claude.exe" is a different program.
function isCli(name) {
  return name === 'claude.exe' || name === 'claude';
}

function measure(procs, sessionPids, now) {
  const byPid = new Map();
  const kids = new Map();
  for (const p of procs) {
    byPid.set(p.pid, p);
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p);
  }

  // A pid is handed out again once its process is gone, so a "child" older
  // than its parent is a stranger that happens to carry the same number.
  const isChildOf = (k, p) => k.pid !== p.pid && k.born >= p.born;
  const isServer = p => p.mcp && now - p.born >= MCP_MIN_AGE_MS;

  // A session whose CLI was installed through npm runs as node, so the
  // session files count as much as the name.
  const roots = procs.filter(p => isCli(p.name) || sessionPids.has(p.pid));
  const rootPids = new Set(roots.map(p => p.pid));
  const owned = new Set(); // every pid inside some root's tree
  const sessions = new Map();

  for (const root of roots) {
    const r = { mem: root.mem, self: root.mem, procs: 1, mcp_mem: 0, mcp_count: 0 };
    const stack = [[root, false]];
    while (stack.length) {
      const [p, inServer] = stack.pop();
      for (const k of kids.get(p.pid) || []) {
        // Another Claude Code process under this one is measured on its own
        if (rootPids.has(k.pid) || owned.has(k.pid) || !isChildOf(k, p)) continue;
        owned.add(k.pid);
        const server = inServer || isServer(k);
        r.mem += k.mem;
        r.procs++;
        if (server) {
          r.mcp_mem += k.mem;
          // A server behind a wrapper (cmd -> npx -> node) is one server
          if (!inServer) r.mcp_count++;
        }
        stack.push([k, server]);
      }
    }
    sessions.set(root.pid, r);
  }

  // MCP servers still running after the process that started them is gone.
  // One whose parent is alive belongs to some other program.
  let orphans = 0, orphanMem = 0;
  for (const p of procs) {
    if (!isServer(p) || owned.has(p.pid) || rootPids.has(p.pid)) continue;
    const parent = byPid.get(p.ppid);
    if (parent && isChildOf(p, parent)) continue;
    orphans++;
    const stack = [p];
    const seen = new Set([p.pid]);
    while (stack.length) {
      const q = stack.pop();
      orphanMem += q.mem;
      for (const k of kids.get(q.pid) || []) {
        if (seen.has(k.pid) || !isChildOf(k, q)) continue;
        seen.add(k.pid);
        stack.push(k);
      }
    }
  }

  return { sessions, orphans, orphanMem };
}

module.exports = { measure, MCP_MIN_AGE_MS };
