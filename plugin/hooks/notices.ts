import type { Part, View } from '../types'
import { strings } from './strings'
import type { Strings } from './strings'

/** A turn that adds this share of the window is worth a toast. */
export const BIG_TURN = 0.05
/** Warn once the context is this far along to the auto-compact point... */
export const NEAR_COMPACT = 0.85
/** ...and arm the warning again once it has fallen back below this. */
export const REARM = 0.7

/** Where the context stood when a turn began. */
export type TurnBase = { tokens: number | null; parts: Part[] }

export function tokens(n: number): string {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`

  return `${Math.round(n)}`
}

export function memory(bytes: number): string {
  const mb = bytes / 1_048_576

  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${Math.round(mb)}M`
}

/** `2h13m`, `4d21h`, `45m`; null when the reset is unknown or already past. */
export function timeLeft(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null
  const minutes = Math.floor((resetsAt - now) / 60_000)
  if (minutes <= 0) return null

  return duration(minutes)
}

/** How long something has been running: `7d`, `3h`, `12m`, `<1m`. */
export function age(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`

  return `${minutes}m`
}

function duration(minutes: number): string {
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d${Math.floor((minutes % 1440) / 60)}h`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h${minutes % 60}m`

  return `${minutes}m`
}

/** What the pane draws for one kind of content: several parts under one colour. */
export type Group = { key: string; label: string; color: string; tokens: number; pct: number }

// The kinds of content the pane tells apart, in the order the bar stacks
// them. Each keeps its colour whatever its size; the eight hues are one
// validated categorical palette in its documented order, and what nobody
// can act on mid-session (the system prompt, tool definitions, reminders)
// is neutral. Their names are in strings.ts.
const GROUPS: readonly { key: keyof Strings['kinds']; color: string; of: readonly string[] }[] = [
  { key: 'output', color: '#3987e5', of: ['output'] },
  { key: 'think', color: '#d95926', of: ['think'] },
  { key: 'shell', color: '#199e70', of: ['shell'] },
  { key: 'files', color: '#c98500', of: ['files'] },
  { key: 'mcp', color: '#d55181', of: [] },
  { key: 'web', color: '#008300', of: ['search', 'web'] },
  { key: 'agents', color: '#9085e9', of: ['agents', 'tools'] },
  { key: 'prompts', color: '#e66767', of: ['prompts', 'summary'] },
  { key: 'system', color: '#898781', of: ['base', 'system'] },
]

const BUILT_IN = new Set(GROUPS.flatMap(group => group.of))

/**
 * What a part is: the tray app says so; one too old to say is taken for an
 * MCP server when its name is none of the built-in ones.
 */
export function kindOf(part: Part): string {
  return part.kind ?? (BUILT_IN.has(part.name) ? part.name : 'mcp')
}

/** What tells two parts apart: the same short name can be two servers. */
const idOf = (part: Part): string => part.id ?? part.name

/**
 * The parts folded into the kinds the pane draws, in stacking order, a kind
 * holding nothing left out. MCP servers share one kind, named in its label.
 */
export function groupParts(parts: readonly Part[], s: Strings = strings('en')): Group[] {
  const total = parts.reduce((sum, part) => sum + part.tokens, 0)
  if (total <= 0) return []
  const servers = parts.filter(part => kindOf(part) === 'mcp')

  return GROUPS.map(group => {
    const own = group.key === 'mcp' ? servers : parts.filter(part => group.of.includes(kindOf(part)))
    const sum = own.reduce((all, part) => all + part.tokens, 0)
    const names = servers.slice(0, 2).map(part => part.name).join(', ') + (servers.length > 2 ? ', ...' : '')
    const label = group.key === 'mcp' && servers.length > 0 ? s.mcpWith(names) : s.kinds[group.key]

    return { key: group.key, label, color: group.color, tokens: sum, pct: Math.round((100 * sum) / total) }
  }).filter(group => group.tokens > 0)
}

/**
 * Splits `cells` among the groups by size so the bar is exactly `cells`
 * wide: whole cells first, the leftover to the largest remainders.
 */
export function allot(groups: readonly Group[], cells: number): number[] {
  const total = groups.reduce((sum, group) => sum + group.tokens, 0)
  if (total <= 0 || cells <= 0) return groups.map(() => 0)
  const exact = groups.map(group => (group.tokens * cells) / total)
  const given = exact.map(Math.floor)
  let left = cells - given.reduce((sum, n) => sum + n, 0)
  const byRemainder = exact.map((n, i) => [n - Math.floor(n), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of byRemainder) {
    if (left <= 0) break
    given[i] = (given[i] ?? 0) + 1
    left -= 1
  }

  return given
}

/** A part in words. */
export function describe(part: Part, s: Strings = strings('en')): string {
  return kindOf(part) === 'mcp' ? s.mcpServer(part.name) : (s.words[kindOf(part)] ?? part.name)
}

/**
 * The toast for a turn that added a lot to the context, or null for a turn
 * that did not. Names what grew most when it explains most of the growth.
 */
export function turnNotice(base: TurnBase | null, now: View): string | null {
  const before = base?.tokens ?? null
  const grown = now.turn ?? (before !== null && now.tokens !== null ? now.tokens - before : null)
  if (grown === null || now.window <= 0 || grown < BIG_TURN * now.window) return null
  const s = strings(now.lang)

  let top: Part | null = null
  let most = 0
  // Without the parts at the turn's start every part would look new
  if (base !== null && base.parts.length > 0) {
    for (const part of now.parts) {
      const was = base.parts.find(one => idOf(one) === idOf(part))?.tokens ?? 0
      if (part.tokens - was > most) {
        most = part.tokens - was
        top = part
      }
    }
  }
  const what = top !== null && most >= grown * 0.4 ? describe(top, s) : null

  return s.turn(tokens(grown), Math.round((100 * grown) / now.window), what)
}

/** How far along to the auto-compact point the context is, 0 when unknown. */
export function compactShare(now: View): number {
  return now.compactAt !== null && now.compactAt > 0 && now.tokens !== null ? now.tokens / now.compactAt : 0
}

/** The warning that auto-compaction is near, or null while it is not. */
export function compactNotice(now: View): string | null {
  const share = compactShare(now)
  if (share < NEAR_COMPACT || now.compactAt === null || now.tokens === null) return null

  return strings(now.lang).nearCompact(Math.round(share * 100), tokens(Math.max(0, now.compactAt - now.tokens)))
}

/** The whole view in one line, for where no pane can be drawn. */
export function summaryLine(now: View): string {
  const s = strings(now.lang)
  const said: string[] = []
  if (now.tokens !== null) {
    const turn = now.turn !== null && now.turn > 0 ? tokens(now.turn) : null
    said.push(s.summaryContext(Math.round((100 * now.tokens) / now.window), tokens(now.tokens), tokens(now.window), turn))
  }
  const top = now.parts.filter(part => part.pct >= 1).slice(0, 3)
  if (top.length > 0) said.push(s.summaryLargest(top.map(part => `${part.name} ${part.pct}%`).join(', ')))
  const own = now.sessions.find(one => one.session === now.sessionId)
  if (own !== undefined && now.memoryTotal !== null) {
    said.push(s.summaryMemory(memory(own.mem), memory(now.memoryTotal), s.sessions(now.sessions.length)))
  }
  if (!now.hasMonitor) said.push(s.summaryNoMonitor)

  return said.length > 0 ? said.join(' ') : s.summaryNothing
}
