/** One thing the context holds, as the tray app's /context answers it. */
export type Part = { name: string; tokens: number; pct: number }

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
  /** MCP servers left running by a process that is gone, and their memory. */
  orphans: number
  orphanMem: number
  hasMonitor: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cc-footprint': { view: View | null }
  }
}
