import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Outside, Part, Session, View } from '../types'
import {
  NEAR_COMPACT,
  REARM,
  age,
  allot,
  compactNotice,
  compactShare,
  groupParts,
  memory,
  summaryLine,
  timeLeft,
  tokens,
  turnNotice,
} from './notices'
import type { TurnBase } from './notices'
import { padTo, strings, width } from './strings'

// The cc-footprint tray app: it measures each session's process and reads
// the transcripts, neither of which a hooks module can do itself.
const MONITOR = 'http://127.0.0.1:19823'
const PANE = 'footprint'
const NOTICE_MS = 8000
// How often an open pane reads again. The tray app measures once a minute,
// so this keeps the pane within half a minute of the statusline.
const REFRESH_MS = 30_000

const view = atom({ plugin: 'cc-footprint', key: 'view' } as const, null)

type MonitorContext = { tokens: number; turn: number; parts: Part[] }
type MonitorSessions = {
  sessions: Session[]
  claude_total: number
  outside?: Outside[]
  lang?: string
}

/** One of the tray app's answers, or null when it is not running. */
async function ask<T>($: EngineInterface, path: string): Promise<T | null> {
  try {
    const answer = await $.http.fetch(MONITOR + path)

    return answer.ok ? (JSON.parse(answer.text) as T | null) : null
  } catch {
    return null
  }
}

/** Reads everything the pane draws: the engine's figures and the tray app's. */
async function snapshot($: EngineInterface): Promise<View> {
  const [sessionId, usage, at] = await Promise.all([
    $.session.id(),
    $.session.usage({ breakdown: 'summary' }),
    $.clock.now(),
  ])
  const [context, sessions] = await Promise.all([
    ask<MonitorContext>($, `/context/${sessionId}`),
    ask<MonitorSessions>($, '/sessions'),
  ])
  const breakdown = usage.context.breakdown

  return {
    lang: await language($, sessions?.lang),
    at,
    sessionId,
    tokens: usage.context.tokens ?? context?.tokens ?? null,
    window: usage.context.window,
    compactAt: breakdown?.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null,
    autoCompact: breakdown?.isAutoCompactEnabled ?? null,
    turn: context?.turn ?? null,
    parts: context?.parts ?? [],
    limits: usage.rateLimits.map(limit => {
      const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)

      return { kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: Number.isNaN(resetsAt) ? null : resetsAt }
    }),
    sessions: sessions?.sessions ?? [],
    memoryTotal: sessions?.claude_total ?? null,
    outside: sessions?.outside ?? [],
    hasMonitor: context !== null || sessions !== null,
  }
}

/**
 * The language to speak. The tray app says which (the plugin has no way to
 * tell the system's own); while it is down the last one it said is kept,
 * so that the pane does not turn English, and English before it ever said.
 */
async function language($: EngineInterface, said: string | undefined): Promise<string> {
  try {
    if (said !== undefined) {
      await $.store.set('lang', said)

      return said
    }
    const kept = await $.store.get('lang')

    return typeof kept === 'string' ? kept : 'en'
  } catch {
    return said ?? 'en'
  }
}

/** Reads a fresh view and hands it to the pane. */
async function load($: EngineInterface): Promise<View> {
  const now = await snapshot($)
  await update($, view, () => now)

  return now
}

const LIMITS: Record<string, string> = { five_hour: '5h', seven_day: 'Week', spend_limit: 'Spend' }

function folder(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export const register: Register = on => {
  // Where the context stood when the current turn began. A reload forgets
  // it, which costs that one turn its "mostly ..." and nothing else.
  let base: TurnBase | null = null
  let hasWarned = false
  // Ticks while the pane is open. A reload forgets it, and the pane then
  // reads at the end of each turn until /footprint is run again.
  let refresher: Timer | null = null
  let isOpen = false

  // Every hook here keeps its own failures to itself: none of this is worth
  // a session's start, a turn's end or a compaction.
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'footprint',
        description: "Show what fills this session's context and which session holds the RAM",
      })
    } catch {
      // No /footprint this session; the toasts need no command
    }

    return next(e)
  })

  // /footprint opens the pane, and closes it when it is open: outside the
  // fullscreen layout the terminal reports no clicks, so the close mark
  // cannot be pressed. Escape at an empty prompt closes it too.
  on('command.run', { command: 'footprint' }, async $ => {
    try {
      if (isOpen) {
        // Our own close raises no hook of ours, so the timer stops here
        refresher?.cancel()
        refresher = null
        isOpen = false
        await $.ui.close({ id: PANE })

        return { text: strings(await language($, undefined)).closed }
      }
      const now = await load($)
      const opened = await $.ui.open({ id: PANE, title: 'Footprint', closeOnEscape: true })
      isOpen = opened.isPlaced
      if (opened.isPlaced && refresher === null) {
        refresher = $.clock.every(REFRESH_MS, () => {
          // A read that fails leaves the pane as it was until the next one
          load($).catch(() => undefined)
        })
      }

      return { text: opened.isPlaced ? strings(now.lang).opened : summaryLine(now) }
    } catch {
      return { text: strings(await language($, undefined)).cannotRead }
    }
  })

  on('ui.close', { id: PANE }, ($, e, next) => {
    try {
      refresher?.cancel()
    } catch {
      // A timer that will not stop only reads into a closed pane
    }
    refresher = null
    isOpen = false

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      const [sessionId, usage] = await Promise.all([$.session.id(), $.session.usage()])
      const context = await ask<MonitorContext>($, `/context/${sessionId}`)
      base = { tokens: usage.context.tokens ?? context?.tokens ?? null, parts: context?.parts ?? [] }
    } catch {
      base = null
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // A subagent's turn fills its own window, not this one
    if (e.agentId !== undefined) return done

    try {
      const now = await load($)
      const grew = turnNotice(base, now)
      if (grew !== null) $.ui.toast(grew, { timeoutMs: NOTICE_MS })

      const share = compactShare(now)
      if (share >= NEAR_COMPACT && !hasWarned) {
        const near = compactNotice(now)
        if (near !== null) $.ui.toast(near, { timeoutMs: NOTICE_MS })
        hasWarned = true
      } else if (share < REARM) {
        hasWarned = false
      }
    } catch {
      // A notice is never worth failing the end of a turn over
    }

    return done
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    try {
      if (e.agentId === undefined && e.trigger !== 'precompute' && !('skip' in done)) {
        const { tokensBefore, tokensAfter } = done
        const s = strings(await language($, undefined))
        const before = tokensBefore === undefined ? null : tokens(tokensBefore)
        const after = tokensAfter === undefined ? null : tokens(tokensAfter)
        $.ui.toast(s.compacted(before, after), { timeoutMs: NOTICE_MS })
        hasWarned = false
      }
    } catch {
      // The compaction stands whether or not it is announced
    }

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    // The last language known, for what is drawn before anything is read
    const said = (await read($, view).catch(() => null))?.lang ?? 'en'
    const refresh = <Button key="refresh" label={strings(said).refresh} onPress={() => load($)} />

    try {
      const now = await read($, view)

      if (now === null) {
        return (
          <Box flexDirection="column">
            <Text dimColor>{strings(said).nothingYet}</Text>
            {refresh}
          </Box>
        )
      }
      const s = strings(now.lang)

      const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 80
      const wide = Math.max(10, Math.min(60, columns))
      const narrow = Math.max(8, Math.min(24, columns - 34))
      const own = now.sessions.find(one => one.session === now.sessionId)
      // Left behind by a session, or another program's (Chrome's bridge, the
      // desktop app): memory no session of ours is using
      const outsideMem = now.outside.reduce((sum, one) => sum + one.mem, 0)
      const outsideWidth = now.outside.reduce((most, one) => Math.max(most, width(one.name)), 0)
      // What this session's memory is besides the claude process itself
      const children =
        own?.self !== undefined && own.procs !== undefined && own.procs > 1
          ? s.children(memory(own.self), own.procs - 1, memory(own.mem - own.self)) +
            (own.mcp_count ? s.ofIt(s.servers(own.mcp_count), memory(own.mcp_mem ?? 0)) : '')
          : null

      // A ratio against its limit: the filled part in ink, the rest a dim
      // track along the baseline. Half a cell high, so two meters on
      // neighbouring rows stay two bars instead of merging into one shape.
      const meter = (pct: number, cells: number) => {
        const filled = Math.max(0, Math.min(cells, Math.round((pct * cells) / 100)))

        return (
          <Box>
            {filled > 0 && <Text>{'▄'.repeat(filled)}</Text>}
            {filled < cells && <Text dimColor>{'▁'.repeat(cells - filled)}</Text>}
          </Box>
        )
      }

      const used = now.tokens !== null && now.window > 0 ? (100 * now.tokens) / now.window : 0
      const isNear = compactShare(now) >= NEAR_COMPACT
      const notes: string[] = []
      if (now.turn !== null && now.turn !== 0) {
        notes.push(s.thisTurn(now.turn > 0 ? '↑' : '↓', tokens(Math.abs(now.turn))))
      }
      if (now.compactAt !== null && now.tokens !== null) {
        notes.push(s.compactAt(tokens(now.compactAt), tokens(Math.max(0, now.compactAt - now.tokens))))
      } else if (now.autoCompact === false) {
        notes.push(s.compactOff)
      }

      // One bar for everything in use, a colour per kind of content; the
      // legend names each colour, largest first, in text ink
      const groups = groupParts(now.parts, s)
      const widths = allot(groups, wide)
      const segments = groups.map((group, i) => ({ group, cells: widths[i] ?? 0 })).filter(one => one.cells > 0)
      // A kind too small to round to 1% is in the bar's total but gets no row
      const legend = groups.filter(group => group.pct >= 1).sort((a, b) => b.tokens - a.tokens)
      const labelWidth = legend.reduce((most, group) => Math.max(most, width(group.label)), 0)

      return (
        <Box flexDirection="column">
          <Text bold>{s.contextWindow}</Text>
          {now.tokens === null ? (
            <Text dimColor>{s.noResponse}</Text>
          ) : (
            <Box flexDirection="column">
              {meter(used, wide)}
              <Text>{s.used(tokens(now.tokens), tokens(now.window), Math.round(used))}</Text>
              {notes.length > 0 && (
                <Text dimColor={!isNear} bold={isNear}>
                  {notes.join(' · ')}
                </Text>
              )}
            </Box>
          )}

          {groups.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>{s.whatFills(now.tokens === null ? null : tokens(now.tokens))}</Text>
              <Box>
                {segments.map(one => (
                  <Text color={one.group.color}>{'█'.repeat(one.cells)}</Text>
                ))}
              </Box>
              {legend.map(group => (
                <Box>
                  <Text color={group.color}>■ </Text>
                  <Text>
                    {padTo(group.label, labelWidth)} {String(group.pct).padStart(3)}% {tokens(group.tokens).padStart(5)}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
          {groups.length === 0 && now.hasMonitor && <Text dimColor>{s.noBreakdown}</Text>}

          {now.limits.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>{s.limits}</Text>
              {now.limits.map(limit => {
                const left = timeLeft(limit.resetsAt, now.at)

                return (
                  <Box>
                    <Text>{(LIMITS[limit.kind] ?? limit.kind).padEnd(5)} </Text>
                    {meter(limit.percentUsed, narrow)}
                    <Text>
                      {' '}
                      {String(Math.round(limit.percentUsed)).padStart(3)}%{left === null ? '' : s.resetsIn(left)}
                    </Text>
                  </Box>
                )
              })}
            </Box>
          )}

          <Box flexDirection="column" marginTop={1}>
            <Text bold>{s.memory}</Text>
            {own !== undefined && now.memoryTotal !== null && (
              <Text>{s.thisSession(memory(own.mem), memory(now.memoryTotal), s.sessions(now.sessions.length))}</Text>
            )}
            {children !== null && <Text dimColor>{children}</Text>}
            {now.sessions.map(one => (
              <Text dimColor={one.session !== now.sessionId}>
                {one.session === now.sessionId ? '›' : ' '} {memory(one.mem).padStart(5)} {one.name || folder(one.cwd)}
                {one.mcp_count ? `  (${s.servers(one.mcp_count)} ${memory(one.mcp_mem ?? 0)})` : ''}
              </Text>
            ))}
            {now.outside.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold>{s.outside(s.servers(now.outside.length), memory(outsideMem))}</Text>
                {now.outside.map(one => (
                  <Text dimColor>
                    {'  '}
                    {memory(one.mem).padStart(5)} {padTo(one.name, outsideWidth)}  {s.up(age(one.age))}
                  </Text>
                ))}
              </Box>
            )}
            {!now.hasMonitor && (
              <Text dimColor>{s.noMonitor}</Text>
            )}
          </Box>

          <Box marginTop={1}>{refresh}</Box>
        </Box>
      )
    } catch {
      // Figures of a shape this was not written for: say so, and keep the
      // way to read again
      return (
        <Box flexDirection="column">
          <Text dimColor>{strings(said).cannotDraw}</Text>
          {refresh}
        </Box>
      )
    }
  })
}
