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
// `now` shares it), mcp the short name of the MCP server the command line
// names (collectors/mcp.js) or null. A platform's collector only has to
// list processes.
//
// MCP servers outside every session's tree are listed too: the ones a
// session that is gone left running, and the ones something else started
// (Chrome's bridge to its extension, the desktop app's servers). They hold
// memory no session of ours is using.

// A tool's shell can carry "mcp" on its command line for a moment (a grep,
// a build); an MCP server lives as long as its session does.
const MCP_MIN_AGE_MS = 30000;

// The CLI's own binary. The comparison is case-sensitive on purpose: the
// desktop app's "Claude.exe" is a different program. The same binary runs
// as Chrome's bridge (claude --chrome-native-host), which is no session.
// Any other mention of MCP on its command line (--mcp-config) is a session
// that uses MCP servers, not one.
function isCli(p) {
  return (p.name === 'claude.exe' || p.name === 'claude') && p.mcp !== 'chrome-native-host';
}

// A session's file dates its start a few seconds after its process began.
// A process more than this much younger than that date is not the session:
// the file was left behind and the pid has gone to something else.
const PID_REUSE_SLACK_MS = 60000;

// sessionAges: pid -> how long ago, in ms, the session file of that pid says
// its session started (undefined where the file does not say)
function measure(procs, sessionAges, now) {
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
  const isSession = p => {
    if (!sessionAges.has(p.pid)) return false;
    const age = sessionAges.get(p.pid);
    return age === undefined || now - p.born + PID_REUSE_SLACK_MS >= age;
  };
  const roots = procs.filter(p => isCli(p) || isSession(p));
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

  // MCP servers outside every session's tree, each with its subtree: a
  // server behind a wrapper (cmd -> npx -> node) is listed once, as the
  // wrapper, whose command line names the server as well.
  const loose = p => isServer(p) && !owned.has(p.pid) && !rootPids.has(p.pid);
  const outside = [];
  for (const p of procs) {
    if (!loose(p)) continue;
    const parent = byPid.get(p.ppid);
    if (parent && loose(parent) && isChildOf(p, parent)) continue;
    let mem = 0;
    const stack = [p];
    const seen = new Set([p.pid]);
    while (stack.length) {
      const q = stack.pop();
      mem += q.mem;
      for (const k of kids.get(q.pid) || []) {
        // A session under it is counted as that session, not twice
        if (seen.has(k.pid) || owned.has(k.pid) || rootPids.has(k.pid) || !isChildOf(k, q)) continue;
        seen.add(k.pid);
        stack.push(k);
      }
    }
    outside.push({ pid: p.pid, name: p.mcp, mem, age: now - p.born });
  }
  outside.sort((a, b) => b.mem - a.mem);

  return { sessions, outside };
}

module.exports = { measure, MCP_MIN_AGE_MS };
