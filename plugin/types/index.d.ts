/**
 * One thing the context holds, as the tray app's /context answers it.
 * `name` is for showing and may repeat; `id` is unique; `kind` is a
 * built-in category's name or "mcp" for every MCP server. An older tray app
 * sends neither of the last two.
 */
export type Part = { name: string; tokens: number; pct: number; id?: string; kind?: string }

/**
 * One running Claude Code session, as the tray app's /sessions answers it.
 * `mem` is the whole process tree; an older tray app sends nothing more.
 */
export type Session = {
  session: string
  pid: number
  cwd: string
  name: string
  mem: number
  /** The claude process alone. */
  self?: number
  /** Processes in the tree, the claude process among them. */
  procs?: number
  /** The session's own MCP servers: their memory and how many. */
  mcp_mem?: number
  mcp_count?: number
}

/**
 * An MCP server outside every session's process tree, as the tray app's
 * /sessions lists them: left behind by a session that is gone, or started
 * by something else (Chrome's bridge to its extension, the desktop app).
 * `mem` is its whole subtree, `age` how long it has run, in milliseconds.
 */
export type Outside = { pid: number; name: string; mem: number; age: number }

/** A rate-limit window; `resetsAt` is epoch milliseconds, null when unknown. */
export type Limit = { kind: string; percentUsed: number; resetsAt: number | null }

/**
 * Everything the pane draws, read at one moment. A figure nobody could give
 * is null: the engine before its first response, or the tray app not running.
 */
export type View = {
  at: number
  sessionId: string
  tokens: number | null
  window: number
  compactAt: number | null
  /** Whether auto-compaction is on; null when the engine did not say. */
  autoCompact: boolean | null
  turn: number | null
  parts: Part[]
  limits: Limit[]
  sessions: Session[]
  memoryTotal: number | null
  /** MCP servers outside every session, largest first. */
  outside: Outside[]
  hasMonitor: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cc-footprint': { view: View | null }
  }
}
