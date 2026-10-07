'use strict';

// ── Session context composition ──────────────────────────────────────
// What a session's context window is filled with, worked out from the
// rows of its main transcript.
//
// Every API response reports the size of the context it was answered over
// (uncached + cache-written + cache-read input tokens). The growth from one
// response to the next is exactly what was added in between: the earlier
// response itself — its output tokens, thinking included, since thinking
// stays in the window — plus whatever followed it, tool results and
// prompts. The API does not count those separately, so the rest of the
// growth is split among them by length.

const IMAGE_CHARS = 6000; // an image block costs roughly 1.5k tokens

function categoryOf(tool) {
  if (tool.startsWith('mcp__')) return 'mcp:' + (tool.split('__')[1] || '');
  if (tool === 'Read' || tool === 'NotebookRead') return 'files';
  if (tool === 'Bash' || tool === 'PowerShell' || tool === 'BashOutput') return 'shell';
  if (tool === 'Grep' || tool === 'Glob') return 'search';
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'web';
  if (tool === 'Agent' || tool === 'Task') return 'agents';
  return 'tools';
}

function lengthOf(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const b of content) {
    if (b.type === 'text') n += (b.text || '').length;
    else if (b.type === 'image') n += IMAGE_CHARS;
    else n += JSON.stringify(b).length;
  }
  return n;
}

// Short name the statusline can print: mcp:claude-in-chrome -> chrome
function labelOf(cat) {
  if (cat === 'thinking') return 'think';
  if (!cat.startsWith('mcp:')) return cat;
  return cat.slice(4)
    .replace(/^(claude[-_]in[-_]|claude[-_]ai[-_]|mcp[-_])|[-_]mcp$/gi, '')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, 12) || 'mcp';
}

function create() {
  return {
    size: 0,          // context size of the latest response
    out: 0, think: 0, // that response's output tokens (not in `size` yet)
    lastId: null,
    seen: new Set(),  // response ids already stepped over
    tools: new Map(), // tool_use id -> category, until its result arrives
    pending: [],      // [category, length] of rows added since the latest response
    cats: {},         // category -> tokens; sums to `size`
    turnStart: 0,     // context size when the current turn began
    compacted: false,
  };
}

function add(cats, cat, n) {
  if (n > 0) cats[cat] = (cats[cat] || 0) + n;
}

// The window got smaller without a compaction: the engine dropped
// something. A model switch drops thinking, so that goes first; anything
// beyond it comes off the rest in proportion.
function shrink(cats, n) {
  const t = Math.min(n, cats.thinking || 0);
  if (t) cats.thinking -= t;
  n -= t;
  if (n <= 0) return;
  const rest = Object.keys(cats).filter(k => k !== 'base');
  const total = rest.reduce((s, k) => s + cats[k], 0);
  const cut = Math.min(n, total);
  if (total > 0) for (const k of rest) cats[k] -= cats[k] * cut / total;
  cats.base = Math.max(0, (cats.base || 0) - (n - cut));
}

// A new response arrived, answered over `size` tokens of context
function step(c, size) {
  if (!c.size) {
    // System prompt, tool schemas, memory files and the first prompt
    c.cats = { base: size };
    c.turnStart = size;
  } else if (c.compacted) {
    const base = Math.min(c.cats.base || 0, size);
    c.cats = { base, summary: size - base };
    c.turnStart = size;
  } else if (size < c.size) {
    shrink(c.cats, c.size - size);
  } else {
    let grown = size - c.size;
    const out = Math.min(grown, c.out), think = Math.min(out, c.think);
    add(c.cats, 'thinking', think);
    add(c.cats, 'output', out - think);
    grown -= out;
    const total = c.pending.reduce((s, p) => s + p[1], 0);
    if (!total) add(c.cats, 'system', grown); // reminders the engine injects
    else for (const [cat, n] of c.pending) add(c.cats, cat, grown * n / total);
  }
  c.compacted = false;
  c.pending = [];
  c.size = size;
  c.out = 0;
  c.think = 0;
}

// Feed one parsed transcript row
function track(c, j) {
  if (j.isSidechain) return;
  if (j.type === 'system') {
    if (j.subtype === 'compact_boundary') c.compacted = true;
    return;
  }
  const msg = j.message;
  if (!msg) return;

  if (j.type === 'assistant') {
    const u = msg.usage;
    if (!u || !msg.id) return;
    const size = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    if (!size) return; // synthetic rows (API errors) carry no usage
    // One response spans several rows, each repeating the usage so far
    if (!c.seen.has(msg.id)) {
      c.seen.add(msg.id);
      step(c, size);
      c.lastId = msg.id;
    }
    if (msg.id === c.lastId) {
      c.out = Math.max(c.out, u.output_tokens || 0);
      c.think = Math.max(c.think, (u.output_tokens_details || {}).thinking_tokens || 0);
    }
    for (const b of msg.content || []) {
      if (b.type === 'tool_use') c.tools.set(b.id, categoryOf(b.name || ''));
    }
  } else if (j.type === 'user') {
    // A message from another agent or a background task is not the person's
    const own = j.isMeta ? 'system'
      : (j.origin && j.origin.kind && j.origin.kind !== 'human') ? 'agents' : 'prompts';
    let startsTurn = !j.isMeta && !j.isCompactSummary;
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b.type === 'tool_result') {
          startsTurn = false;
          c.pending.push([c.tools.get(b.tool_use_id) || 'tools', lengthOf(b.content)]);
          c.tools.delete(b.tool_use_id);
        } else {
          c.pending.push([own, lengthOf([b])]);
        }
      }
    } else {
      c.pending.push([own, lengthOf(msg.content)]);
    }
    // The latest response's output joins the window with the next request
    if (startsTurn) c.turnStart = c.size + c.out;
  }
}

// Every category with its tokens, largest first. `name` is for showing and
// may repeat (a short MCP server name); `id` is the category itself, unique;
// `kind` is what it is: one of the built-in names, or "mcp" for every
// server, so that a reader never has to guess it from the name (a server
// called "web" is still an MCP server).
function detail(c) {
  if (!c || !c.size) return null;
  const parts = Object.entries(c.cats)
    .filter(([, v]) => v >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({
      id: k, kind: k.startsWith('mcp:') ? 'mcp' : labelOf(k), name: labelOf(k),
      tokens: Math.round(v), pct: Math.round(100 * v / c.size),
    }));
  return { tokens: c.size + c.out, turn: c.size + c.out - c.turnStart, parts };
}

// What the statusline shows: this turn's growth, the largest source, and
// the share of what is in use that MCP tool results take (every server
// together). `base` and `system` are left out of the ranking — the person
// cannot do anything about them mid-session.
function summarize(c) {
  const d = detail(c);
  if (!d) return null;
  const top = d.parts.find(p => p.kind !== 'base' && p.kind !== 'system' && p.pct > 0);
  let mcp = 0;
  for (const [k, v] of Object.entries(c.cats)) if (k.startsWith('mcp:')) mcp += v;
  return { turn: d.turn, src: top ? top.name : null, src_pct: top ? top.pct : null, mcp_pct: Math.round(100 * mcp / c.size) };
}

module.exports = { create, track, detail, summarize };
