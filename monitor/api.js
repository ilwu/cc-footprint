'use strict';

// ── HTTP API ─────────────────────────────────────────────────────────
// Who reads what: /session/:sid the statusline; /context/:sid and /sessions
// the plugin (and install.ps1); /status, /status/:pid and /config are for
// looking at by hand. The statusline parses /session with bash regexes, so
// its keys must stay unique across the whole answer and flat.

const context = require('./context');

// `m` is the monitor's state (see app.js): the measured trees and when they
// were measured, the window widths, the MCP servers outside every session,
// the counters. Figures older than `staleMs` (the process query keeps
// failing) are not passed on: an old figure would pass for a current one.
function createHandler({ port, m, config, i18n, sessions, transcripts, plugin, collectSoon, staleMs }) {
  // A page in a browser can reach this port by pointing a name of its own at
  // 127.0.0.1 (DNS rebinding), and would read every session's name and
  // folder. Its requests carry that name as Host, so only our own are
  // answered; "l" is what statusline.sh sends, the shortest that will do.
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, 'l']);
  const fresh = () => m.lastMeasuredAt > 0 && Date.now() - m.lastMeasuredAt < staleMs;

  function statusFor(pid) {
    const ok = fresh();
    const d = ok && pid !== undefined ? m.store.get(pid) : undefined;
    let claudeTotal = 0;
    if (ok) for (const v of m.store.values()) claudeTotal += v.mem;
    return {
      ...(d || { mem: null }),
      claude_total: ok ? claudeTotal : null,
      system_pct: ok ? m.systemPct : null,
      // This session's own MCP servers; the ones outside every session are
      // the machine's
      mcp_total: d ? d.mcp_mem : 0,
      mcp_count: d ? d.mcp_count : 0,
      mcp_outside: ok ? m.outside.length : 0,
      mcp_outside_mem: ok ? m.outside.reduce((sum, s) => sum + s.mem, 0) : 0,
      plugin: plugin.installed,
      cols: m.cols.get(pid) || null,
      display: config.display(),
    };
  }

  function answer(req, res) {
    res.setHeader('Content-Type', 'application/json');
    const host = req.headers.host;
    if (host !== undefined && !hosts.has(host.toLowerCase())) {
      res.writeHead(403);
      return res.end('{}');
    }

    // GET /status — every session tree, and how the monitor is doing (a
    // format that changed shows here as failed rows or no measurement for a
    // while, where the statusline only loses a figure)
    if (req.url === '/status') {
      const trees = {};
      for (const [pid, d] of m.store) trees[pid] = d;
      return res.end(JSON.stringify({
        ...m.stats, last_collect_at: m.lastCollectAt || null, last_measured_at: m.lastMeasuredAt || null,
        fresh: fresh(), config_broken: config.broken, sessions: trees,
      }));
    }

    // GET /sessions — every running session with its memory, largest first
    if (req.url === '/sessions') {
      sessions.scan();
      const list = [];
      for (const [sid, pid] of sessions.pids) {
        const d = fresh() ? m.store.get(pid) : undefined;
        if (!d) continue; // a session file left behind by a process that is gone
        list.push({
          session: sid, pid, ...sessions.info.get(sid),
          mem: d.mem, self: d.self, procs: d.procs, mcp_mem: d.mcp_mem, mcp_count: d.mcp_count,
        });
      }
      list.sort((a, b) => b.mem - a.mem);
      const { claude_total, system_pct, mcp_outside, mcp_outside_mem } = statusFor();
      return res.end(JSON.stringify({
        sessions: list, claude_total, system_pct, mcp_outside, mcp_outside_mem, outside: fresh() ? m.outside : [],
        // The language the plugin is to speak (it has no way to tell itself)
        lang: i18n.resolve(config.values.lang),
      }));
    }

    // GET /session/:sessionId — what the statusline calls
    const s = req.url.match(/^\/session\/([0-9a-fA-F-]+)$/);
    if (s) {
      config.refresh();
      plugin.check();
      const pid = sessions.pidFor(s[1]);
      // Session started after the last collect: refresh now so the next
      // statusline render has data instead of waiting a full interval.
      if (pid !== undefined && !m.store.has(pid)) collectSoon();
      const status = statusFor(pid);
      const c = config.values;
      if (c.remote && pid !== undefined) status.remote_control = sessions.remoteControl(pid);
      if (c.ctx_grow || c.ctx_src || c.ctx_mcp) {
        const sum = context.summarize(transcripts.read(s[1]));
        if (sum) {
          status.ctx_turn = sum.turn;
          status.ctx_src = sum.src;
          status.ctx_src_pct = sum.src_pct;
          status.ctx_mcp_pct = sum.mcp_pct;
        }
      }
      return res.end(JSON.stringify(status));
    }

    // GET /context/:sessionId — everything the session's context is made of
    const c = req.url.match(/^\/context\/([0-9a-fA-F-]+)$/);
    if (c) {
      return res.end(JSON.stringify(context.detail(transcripts.read(c[1]))));
    }

    // GET /status/:pid — single session + summary + display config
    const p = req.url.match(/^\/status\/(\d+)$/);
    if (p) {
      return res.end(JSON.stringify(statusFor(parseInt(p[1]))));
    }

    // GET /config — current display config
    if (req.url === '/config') {
      config.refresh();
      return res.end(JSON.stringify({
        items: config.items, config: config.values, display: config.display(),
        lang: i18n.resolve(config.values.lang), langs: i18n.codes,
      }));
    }

    res.writeHead(404);
    res.end('{}');
  }

  return (req, res) => {
    try {
      answer(req, res);
    } catch (e) {
      // An odd request or file costs that one answer, not the monitor
      console.error('[http]', req.url, e.message);
      if (!res.headersSent) res.writeHead(500);
      res.end('{}');
    }
  };
}

module.exports = { createHandler };
