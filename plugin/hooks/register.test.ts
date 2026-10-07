import { expect, mock, test } from 'claude-code/testing'

import type { View } from '../types'
import { allot, compactNotice, groupParts, summaryLine, timeLeft, tokens, turnNotice } from './notices'
import { LANGS, padTo, strings, width } from './strings'

const VIEW: View = {
  at: 0,
  sessionId: 'abc',
  tokens: 120_000,
  window: 200_000,
  compactAt: 160_000,
  autoCompact: true,
  turn: 4_000,
  parts: [
    { name: 'files', tokens: 60_000, pct: 50 },
    { name: 'output', tokens: 30_000, pct: 25 },
  ],
  limits: [],
  sessions: [
    {
      session: 'abc',
      pid: 1,
      cwd: 'C:\\work\\api',
      name: '',
      mem: 838_860_800,
      self: 524_288_000,
      procs: 4,
      mcp_mem: 209_715_200,
      mcp_count: 2,
    },
  ],
  memoryTotal: 2_147_483_648,
  outside: [],
  hasMonitor: true,
  lang: 'en',
}

test('token counts read short', () => {
  expect(tokens(950)).toBe('950')
  expect(tokens(15_400)).toBe('15k')
  expect(tokens(1_000_000)).toBe('1.0M')
})

test('time left reads as days, hours or minutes, and not at all once past', () => {
  const minute = 60_000
  expect(timeLeft(45 * minute, 0)).toBe('45m')
  expect(timeLeft(133 * minute, 0)).toBe('2h13m')
  expect(timeLeft((4 * 24 + 21) * 60 * minute, 0)).toBe('4d21h')
  expect(timeLeft(0, minute)).toBe(null)
  expect(timeLeft(null, 0)).toBe(null)
})

test('a turn that adds little to the context is not announced', () => {
  expect(turnNotice(null, VIEW)).toBe(null)
})

test('a turn that adds 5% of the window is announced with what grew most', () => {
  const base = {
    tokens: 90_000,
    parts: [
      { name: 'files', tokens: 32_000, pct: 36 },
      { name: 'output', tokens: 28_000, pct: 31 },
    ],
  }
  const said = turnNotice(base, { ...VIEW, turn: 30_000 })
  expect(said).toBe('Context +30k this turn (15% of the window), mostly file reads')
})

test('with no parts from the start of the turn, nothing is blamed', () => {
  const said = turnNotice({ tokens: 90_000, parts: [] }, { ...VIEW, turn: 30_000 })
  expect(said).toBe('Context +30k this turn (15% of the window)')
})

test('without the tray app the growth is counted from the engine own figures', () => {
  const said = turnNotice({ tokens: 100_000, parts: [] }, { ...VIEW, turn: null, parts: [] })
  expect(said).toBe('Context +20k this turn (10% of the window)')
})

test('the compaction warning starts at 85% of the way to the threshold', () => {
  expect(compactNotice(VIEW)).toBe(null)
  expect(compactNotice({ ...VIEW, tokens: 140_000 })).toBe(
    'Context is 88% of the way to auto-compaction (20k left). /compact before starting something big.',
  )
  expect(compactNotice({ ...VIEW, tokens: 140_000, compactAt: null })).toBe(null)
})

test('the one-line summary covers context, largest parts and memory', () => {
  expect(summaryLine(VIEW)).toBe(
    'Context 60% (120k of 200k), +4k this turn. Largest: files 50%, output 25%. Memory: 800M of 2.0G across 1 session.',
  )
})

test('parts fold into kinds that keep their colour, MCP servers under one', () => {
  const groups = groupParts([
    { name: 'output', tokens: 50, pct: 50 },
    { name: 'chrome', tokens: 20, pct: 20 },
    { name: 'base', tokens: 15, pct: 15 },
    { name: 'github', tokens: 10, pct: 10 },
    { name: 'system', tokens: 5, pct: 5 },
  ])
  expect(groups.map(group => [group.key, group.label, group.pct])).toEqual([
    ['output', "Claude's output", 50],
    ['mcp', 'MCP tools (chrome, github)', 30],
    ['system', 'System & tools setup', 20],
  ])
  expect(groups[0]?.color).toBe('#3987e5')
  expect(groupParts([])).toEqual([])
})

test('the kind the tray app sends decides, so a server named like a built-in is still MCP', () => {
  const groups = groupParts([
    { id: 'files', kind: 'files', name: 'files', tokens: 60, pct: 60 },
    { id: 'mcp:web', kind: 'mcp', name: 'web', tokens: 40, pct: 40 },
  ])
  expect(groups.map(group => [group.key, group.label, group.pct])).toEqual([
    ['files', 'File reads', 60],
    ['mcp', 'MCP tools (web)', 40],
  ])
})

test('two servers with one short name are told apart by their id', () => {
  const part = (id: string, tokens: number) => ({ id, kind: 'mcp', name: 'chrome', tokens, pct: 0 })
  const base = { tokens: 100_000, parts: [part('mcp:claude-in-chrome', 1_000), part('mcp:chrome', 50_000)] }
  // The first grew by 29k, the second not at all
  const said = turnNotice(base, { ...VIEW, turn: 30_000, parts: [part('mcp:claude-in-chrome', 30_000), part('mcp:chrome', 50_000)] })
  expect(said).toBe('Context +30k this turn (15% of the window), mostly the chrome MCP server')
})

test('the stacked bar is exactly as wide as asked', () => {
  const groups = groupParts([
    { name: 'output', tokens: 34, pct: 34 },
    { name: 'shell', tokens: 33, pct: 33 },
    { name: 'files', tokens: 33, pct: 33 },
  ])
  const widths = allot(groups, 10)
  expect(widths.reduce((sum, n) => sum + n, 0)).toBe(10)
  expect(widths[0]).toBe(4)
  expect(allot(groups, 0)).toEqual([0, 0, 0])
})

test('the end of a turn that bloated the context raises one toast', async ($, on) => {
  const toasts: string[] = []
  mock.clock(on)
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('session.id', () => ({ value: 'abc' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 120_000, window: 200_000, percent: 60 }, rateLimits: [] },
  }))
  on('http.fetch', (_, e) => {
    const body = e.url.endsWith('/sessions')
      ? { sessions: VIEW.sessions, claude_total: VIEW.memoryTotal }
      : { tokens: 120_000, turn: 30_000, parts: VIEW.parts }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  expect(toasts).toEqual(['Context +30k this turn (15% of the window)'])
})

test('a subagent turn raises nothing', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete({
    answer: 'done',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    agentId: 'sub',
  })

  expect(toasts).toEqual([])
})

test('the pane draws the context, the limits and every session on each surface', async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 'abc' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 120_000, window: 200_000, percent: 60 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 34, resetsAt: new Date(133 * 60_000).toISOString() }],
    },
  }))
  on('http.fetch', (_, e) => {
    const body = e.url.endsWith('/sessions')
      ? {
          sessions: VIEW.sessions,
          claude_total: VIEW.memoryTotal,
          outside: [
            { pid: 7, name: 'chrome-native-host', mem: 44_040_192, age: 7 * 86_400_000 },
            { pid: 8, name: 'mcp-server-git', mem: 18_874_368, age: 3 * 3_600_000 },
          ],
        }
      : { tokens: 120_000, turn: 4_000, parts: [...VIEW.parts, { name: 'search', tokens: 30, pct: 0 }] }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'cc-footprint',
      surface,
      component: 'Pane',
      requestId: 'footprint',
      props: {
        title: 'Footprint',
        isFocused: false,
        bodyColumns: 60,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: /120k of 200k used \(60%\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /4k this turn/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /What fills it \(the 120k in use\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /File reads\s+67%\s+60k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Claude's output\s+33%\s+30k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Search & web/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /resets in 2h13m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /800M this session, 2\.0G across 1 session/ })).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: /claude 500M \+ 3 child processes 300M, 2 MCP servers 200M of it/ }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /api\s+\(2 MCP servers 200M\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 MCP servers outside every session: 60M/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /42M chrome-native-host\s+up 7d/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /18M mcp-server-git\s+up 3h/ })).toBeDefined()
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    await ui.unmount()
  }
})

test('an open pane reads again on a timer; /footprint again closes it and stops that', async ($, on) => {
  const clock = mock.clock(on)
  let reads = 0
  on('session.id', () => ({ value: 'abc' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 120_000, window: 200_000, percent: 60 }, rateLimits: [] },
  }))
  on('http.fetch', (_, e) => {
    if (e.url.endsWith('/sessions')) reads += 1

    return { value: { status: 200, ok: true, headers: {}, text: 'null' } }
  })
  let closes = 0
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => {
    closes += 1

    return { value: undefined }
  })
  const footprint = () =>
    $.command.run({
      command: 'footprint',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 200 },
    })

  expect((await footprint()).text).toBe('Footprint pane opened.')
  expect(reads).toBe(1)

  await clock.advance(30_000)
  expect(reads).toBe(2)
  await clock.advance(30_000)
  expect(reads).toBe(3)

  expect((await footprint()).text).toBe('Footprint pane closed.')
  expect(closes).toBe(1)
  await clock.advance(120_000)
  expect(reads).toBe(3)
})

test('/footprint answers in one line when the session cannot be read', async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 'abc' }))
  on('session.usage', () => {
    throw new Error('no usage')
  })

  const said = await $.command.run({
    command: 'footprint',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })

  expect(said.text).toBe('Footprint could not read this session.')
})

test('figures of an unforeseen shape leave the pane one line and the way to read again', async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 'abc' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 120_000, window: 200_000, percent: 60 }, rateLimits: [] },
  }))
  on('http.fetch', (_, e) => {
    // A session with neither a name nor a folder to call it by
    const body = e.url.endsWith('/sessions') ? { sessions: [{ session: 'abc', pid: 1, mem: 1 }], claude_total: 1 } : null

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({
    plugin: 'cc-footprint',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'footprint',
    props: {
      title: 'Footprint',
      isFocused: false,
      bodyColumns: 60,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  })
  expect(await ui.find({ type: 'Text', text: /could not be drawn/ })).toBeDefined()
  expect(await ui.find({ key: 'refresh' })).toBeDefined()
  await ui.unmount()
})

test('every language the monitor offers has its words here', () => {
  expect(LANGS.sort()).toEqual(['en', 'ja', 'ko', 'zh-CN', 'zh-TW'])
  // One the plugin lacks falls back to English
  expect(strings('xx').opened).toBe('Footprint pane opened.')
})

test('wide characters take two columns, so a column of them stays aligned', () => {
  expect(width('File reads')).toBe(10)
  expect(width('讀檔')).toBe(4)
  expect(width('コンテキスト')).toBe(12)
  expect(width('파일 읽기')).toBe(9)
  expect(width(padTo('讀檔', 8))).toBe(8)
})

test('the toasts and the summary speak the language the tray app names', () => {
  const said = turnNotice(null, { ...VIEW, turn: 30_000, lang: 'zh-TW' })
  expect(said).toBe('本輪 context +30k（視窗的 15%）')
  expect(compactNotice({ ...VIEW, tokens: 150_000, lang: 'ja' })).toContain('/compact')
  expect(summaryLine({ ...VIEW, lang: 'ko' })).toContain('세션 1개')
})

test('the pane is drawn in the tray app language, its legend aligned by columns', async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 'abc' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 120_000, window: 200_000, percent: 60 }, rateLimits: [] },
  }))
  on('http.fetch', (_, e) => {
    const body = e.url.endsWith('/sessions')
      ? { sessions: VIEW.sessions, claude_total: VIEW.memoryTotal, lang: 'ja' }
      : { tokens: 120_000, turn: 4_000, parts: VIEW.parts }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({
    plugin: 'cc-footprint',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'footprint',
    props: { title: 'Footprint', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /コンテキストウィンドウ/ })).toBeDefined()
  // The legend in Japanese (padTo, tested above, aligns its columns)
  const files = await ui.find({ type: 'Text', text: /ファイル読み込み/ })
  const output = await ui.find({ type: 'Text', text: /Claude の出力/ })
  expect(files).toBeDefined()
  expect(output).toBeDefined()
  expect(await ui.find({ key: 'refresh' })).toBeDefined()
  await ui.unmount()
})

test('with the tray app gone, the last language it named is kept', async ($, on) => {
  const kept = new Map<string, unknown>([['lang', 'zh-CN']])
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => {
    kept.set(e.key, e.value)

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no room' } }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 120_000, window: 200_000, percent: 60 }, rateLimits: [] },
  }))
  on('http.fetch', () => {
    throw new Error('connection refused')
  })
  mock.clock(on)

  const said = await $.command.run({
    command: 'footprint',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(said.text).toContain('上下文 60%')
  expect(said.text).toContain('cc-footprint 后台程序没有运行')
})
