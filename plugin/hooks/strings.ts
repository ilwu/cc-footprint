// The plugin's words in each language. English is the model: every other
// language is typed against it, so one that lacks a phrase does not
// type-check. A language the monitor names and this table lacks is shown
// in English. The monitor's own words (the tray menu) are in
// monitor/i18n/; the two share no phrase, only the language codes.

const en = {
  // The kinds of content the pane tells apart, as the legend names them
  kinds: {
    output: "Claude's output",
    think: 'Thinking',
    shell: 'Command output',
    files: 'File reads',
    mcp: 'MCP tools',
    web: 'Search & web',
    agents: 'Subagents & tools',
    prompts: 'Prompts & summaries',
    system: 'System & tools setup',
  },
  mcpWith: (names: string) => `MCP tools (${names})`,
  // A part in words, for "mostly ..."
  words: {
    output: "Claude's own output",
    think: 'thinking',
    files: 'file reads',
    shell: 'command output',
    search: 'search results',
    web: 'web pages',
    agents: 'subagent reports',
    prompts: 'your prompts',
    tools: 'tool results',
    summary: 'the compaction summary',
    system: 'engine reminders',
    base: 'system prompt and tools',
  } as Record<string, string>,
  mcpServer: (name: string) => `the ${name} MCP server`,
  servers: (n: number) => `${n} MCP server${n === 1 ? '' : 's'}`,
  sessions: (n: number) => `${n} session${n === 1 ? '' : 's'}`,

  // Toasts
  turn: (grown: string, share: number, what: string | null) =>
    `Context +${grown} this turn (${share}% of the window)${what === null ? '' : `, mostly ${what}`}`,
  nearCompact: (pct: number, left: string) =>
    `Context is ${pct}% of the way to auto-compaction (${left} left). /compact before starting something big.`,
  compacted: (before: string | null, after: string | null) =>
    `Context compacted${before !== null && after !== null ? `: ${before} → ${after}` : ''}`,

  // The one-line summary, where no pane can be drawn
  summaryContext: (pct: number, used: string, window: string, turn: string | null) =>
    `Context ${pct}% (${used} of ${window})${turn === null ? '' : `, +${turn} this turn`}.`,
  summaryLargest: (list: string) => `Largest: ${list}.`,
  summaryMemory: (mem: string, total: string, sessions: string) => `Memory: ${mem} of ${total} across ${sessions}.`,
  summaryNoMonitor: 'The cc-footprint tray app is not running, so memory and the breakdown are unknown.',
  summaryNothing: 'No figures yet: this session has had no response so far.',

  // /footprint
  opened: 'Footprint pane opened.',
  closed: 'Footprint pane closed.',
  cannotRead: 'Footprint could not read this session.',

  // The pane
  refresh: 'Refresh',
  nothingYet: 'Nothing read yet.',
  cannotDraw: 'The figures could not be drawn.',
  contextWindow: 'Context window',
  noResponse: 'No response yet in this context window.',
  used: (used: string, window: string, pct: number) => `${used} of ${window} used (${pct}%)`,
  thisTurn: (arrow: string, n: string) => `${arrow}${n} this turn`,
  compactAt: (at: string, left: string) => `auto-compact at ${at}, ${left} to go`,
  compactOff: 'auto-compact is off',
  whatFills: (inUse: string | null) => `What fills it${inUse === null ? '' : ` (the ${inUse} in use)`}`,
  noBreakdown: 'No breakdown yet.',
  limits: 'Usage limits',
  resetsIn: (left: string) => ` · resets in ${left}`,
  memory: 'Memory',
  thisSession: (mem: string, total: string, sessions: string) => `${mem} this session, ${total} across ${sessions}`,
  children: (self: string, n: number, mem: string) => `claude ${self} + ${n} child process${n === 1 ? '' : 'es'} ${mem}`,
  ofIt: (servers: string, mem: string) => `, ${servers} ${mem} of it`,
  outside: (servers: string, mem: string) => `${servers} outside every session: ${mem}`,
  up: (age: string) => `up ${age}`,
  noMonitor: 'The cc-footprint tray app is not running: no memory figures, no breakdown.',
}

export type Strings = typeof en

const zhTW: Strings = {
  kinds: {
    output: 'Claude 的輸出',
    think: '思考',
    shell: '指令輸出',
    files: '讀檔',
    mcp: 'MCP 工具',
    web: '搜尋與網頁',
    agents: '子代理與工具',
    prompts: '提示與摘要',
    system: '系統與工具設定',
  },
  mcpWith: names => `MCP 工具（${names}）`,
  words: {
    output: 'Claude 自己的輸出',
    think: '思考',
    files: '讀檔',
    shell: '指令輸出',
    search: '搜尋結果',
    web: '網頁',
    agents: '子代理的回報',
    prompts: '你的提示',
    tools: '工具結果',
    summary: '壓縮摘要',
    system: '系統提醒',
    base: '系統提示與工具定義',
  },
  mcpServer: name => `${name} 這個 MCP server`,
  servers: n => `${n} 個 MCP server`,
  sessions: n => `${n} 個 session`,
  turn: (grown, share, what) => `本輪 context +${grown}（視窗的 ${share}%）${what === null ? '' : `，主要是${what}`}`,
  nearCompact: (pct, left) => `Context 已到自動壓縮門檻的 ${pct}%（還剩 ${left}）。開始大工作前先 /compact。`,
  compacted: (before, after) => `Context 已壓縮${before !== null && after !== null ? `：${before} → ${after}` : ''}`,
  summaryContext: (pct, used, window, turn) => `Context ${pct}%（${used} / ${window}）${turn === null ? '' : `，本輪 +${turn}`}。`,
  summaryLargest: list => `最大來源：${list}。`,
  summaryMemory: (mem, total, sessions) => `記憶體：${mem}，${sessions}共 ${total}。`,
  summaryNoMonitor: 'cc-footprint 背景程式沒有在跑，記憶體和組成明細未知。',
  summaryNothing: '還沒有數字：這個 session 還沒有任何回應。',
  opened: 'Footprint 面板已開啟。',
  closed: 'Footprint 面板已關閉。',
  cannotRead: 'Footprint 讀不到這個 session。',
  refresh: '重新整理',
  nothingYet: '還沒讀到資料。',
  cannotDraw: '數字無法顯示。',
  contextWindow: 'Context 視窗',
  noResponse: '這個 context 視窗還沒有回應。',
  used: (used, window, pct) => `已用 ${used} / ${window}（${pct}%）`,
  thisTurn: (arrow, n) => `本輪 ${arrow}${n}`,
  compactAt: (at, left) => `${at} 自動壓縮，還差 ${left}`,
  compactOff: '自動壓縮已關閉',
  whatFills: inUse => `組成${inUse === null ? '' : `（已用的 ${inUse}）`}`,
  noBreakdown: '還沒有組成明細。',
  limits: '用量額度',
  resetsIn: left => ` · ${left} 後重置`,
  memory: '記憶體',
  thisSession: (mem, total, sessions) => `本 session ${mem}，${sessions}共 ${total}`,
  children: (self, n, mem) => `claude ${self} + ${n} 個子行程 ${mem}`,
  ofIt: (servers, mem) => `，其中 ${servers} ${mem}`,
  outside: (servers, mem) => `不屬於任何 session 的 ${servers}：${mem}`,
  up: age => `已跑 ${age}`,
  noMonitor: 'cc-footprint 背景程式沒有在跑：沒有記憶體數字和組成明細。',
}

const zhCN: Strings = {
  kinds: {
    output: 'Claude 的输出',
    think: '思考',
    shell: '命令输出',
    files: '读取文件',
    mcp: 'MCP 工具',
    web: '搜索与网页',
    agents: '子代理与工具',
    prompts: '提示与摘要',
    system: '系统与工具设置',
  },
  mcpWith: names => `MCP 工具（${names}）`,
  words: {
    output: 'Claude 自己的输出',
    think: '思考',
    files: '读取文件',
    shell: '命令输出',
    search: '搜索结果',
    web: '网页',
    agents: '子代理的汇报',
    prompts: '你的提示',
    tools: '工具结果',
    summary: '压缩摘要',
    system: '系统提醒',
    base: '系统提示与工具定义',
  },
  mcpServer: name => `${name} 这个 MCP 服务器`,
  servers: n => `${n} 个 MCP 服务器`,
  sessions: n => `${n} 个会话`,
  turn: (grown, share, what) => `本轮上下文 +${grown}（窗口的 ${share}%）${what === null ? '' : `，主要是${what}`}`,
  nearCompact: (pct, left) => `上下文已达自动压缩阈值的 ${pct}%（还剩 ${left}）。开始大任务前先 /compact。`,
  compacted: (before, after) => `上下文已压缩${before !== null && after !== null ? `：${before} → ${after}` : ''}`,
  summaryContext: (pct, used, window, turn) => `上下文 ${pct}%（${used} / ${window}）${turn === null ? '' : `，本轮 +${turn}`}。`,
  summaryLargest: list => `最大来源：${list}。`,
  summaryMemory: (mem, total, sessions) => `内存：${mem}，${sessions}共 ${total}。`,
  summaryNoMonitor: 'cc-footprint 后台程序没有运行，内存和组成明细未知。',
  summaryNothing: '还没有数据：这个会话还没有任何回复。',
  opened: 'Footprint 面板已打开。',
  closed: 'Footprint 面板已关闭。',
  cannotRead: 'Footprint 读取不到这个会话。',
  refresh: '刷新',
  nothingYet: '还没有读到数据。',
  cannotDraw: '数据无法显示。',
  contextWindow: '上下文窗口',
  noResponse: '这个上下文窗口还没有回复。',
  used: (used, window, pct) => `已用 ${used} / ${window}（${pct}%）`,
  thisTurn: (arrow, n) => `本轮 ${arrow}${n}`,
  compactAt: (at, left) => `${at} 时自动压缩，还差 ${left}`,
  compactOff: '自动压缩已关闭',
  whatFills: inUse => `组成${inUse === null ? '' : `（已用的 ${inUse}）`}`,
  noBreakdown: '还没有组成明细。',
  limits: '用量额度',
  resetsIn: left => ` · ${left} 后重置`,
  memory: '内存',
  thisSession: (mem, total, sessions) => `本会话 ${mem}，${sessions}共 ${total}`,
  children: (self, n, mem) => `claude ${self} + ${n} 个子进程 ${mem}`,
  ofIt: (servers, mem) => `，其中 ${servers} ${mem}`,
  outside: (servers, mem) => `不属于任何会话的 ${servers}：${mem}`,
  up: age => `已运行 ${age}`,
  noMonitor: 'cc-footprint 后台程序没有运行：没有内存数据和组成明细。',
}

const ja: Strings = {
  kinds: {
    output: 'Claude の出力',
    think: '思考',
    shell: 'コマンド出力',
    files: 'ファイル読み込み',
    mcp: 'MCP ツール',
    web: '検索と Web',
    agents: 'サブエージェントとツール',
    prompts: 'プロンプトと要約',
    system: 'システムとツール定義',
  },
  mcpWith: names => `MCP ツール（${names}）`,
  words: {
    output: 'Claude 自身の出力',
    think: '思考',
    files: 'ファイル読み込み',
    shell: 'コマンド出力',
    search: '検索結果',
    web: 'Web ページ',
    agents: 'サブエージェントの報告',
    prompts: 'あなたのプロンプト',
    tools: 'ツールの結果',
    summary: '圧縮の要約',
    system: 'システムのリマインダー',
    base: 'システムプロンプトとツール定義',
  },
  mcpServer: name => `MCP サーバー ${name}`,
  servers: n => `MCP サーバー ${n} 個`,
  sessions: n => `${n} セッション`,
  turn: (grown, share, what) => `今回のターンでコンテキスト +${grown}（ウィンドウの ${share}%）${what === null ? '' : `、主に${what}`}`,
  nearCompact: (pct, left) => `コンテキストが自動圧縮の ${pct}% に達しました（残り ${left}）。大きな作業の前に /compact を。`,
  compacted: (before, after) => `コンテキストを圧縮しました${before !== null && after !== null ? `：${before} → ${after}` : ''}`,
  summaryContext: (pct, used, window, turn) => `コンテキスト ${pct}%（${used} / ${window}）${turn === null ? '' : `、今回 +${turn}`}。`,
  summaryLargest: list => `大きいもの：${list}。`,
  summaryMemory: (mem, total, sessions) => `メモリ：${mem}（${sessions}で計 ${total}）。`,
  summaryNoMonitor: 'cc-footprint のバックグラウンドプログラムが動いていないため、メモリと内訳は不明です。',
  summaryNothing: 'まだ数値がありません。このセッションにはまだ応答がありません。',
  opened: 'Footprint パネルを開きました。',
  closed: 'Footprint パネルを閉じました。',
  cannotRead: 'Footprint はこのセッションを読み取れませんでした。',
  refresh: '更新',
  nothingYet: 'まだ何も読み取っていません。',
  cannotDraw: '数値を表示できませんでした。',
  contextWindow: 'コンテキストウィンドウ',
  noResponse: 'このコンテキストウィンドウにはまだ応答がありません。',
  used: (used, window, pct) => `${window} 中 ${used} 使用（${pct}%）`,
  thisTurn: (arrow, n) => `今回 ${arrow}${n}`,
  compactAt: (at, left) => `${at} で自動圧縮、あと ${left}`,
  compactOff: '自動圧縮はオフです',
  whatFills: inUse => `内訳${inUse === null ? '' : `（使用中の ${inUse}）`}`,
  noBreakdown: 'まだ内訳がありません。',
  limits: '使用量の上限',
  resetsIn: left => ` · ${left} 後にリセット`,
  memory: 'メモリ',
  thisSession: (mem, total, sessions) => `このセッション ${mem}、${sessions}で計 ${total}`,
  children: (self, n, mem) => `claude ${self} + 子プロセス ${n} 個 ${mem}`,
  ofIt: (servers, mem) => `、うち ${servers} ${mem}`,
  outside: (servers, mem) => `どのセッションにも属さない ${servers}：${mem}`,
  up: age => `稼働 ${age}`,
  noMonitor: 'cc-footprint のバックグラウンドプログラムが動いていません。メモリと内訳はありません。',
}

const ko: Strings = {
  kinds: {
    output: 'Claude의 출력',
    think: '생각',
    shell: '명령 출력',
    files: '파일 읽기',
    mcp: 'MCP 도구',
    web: '검색 및 웹',
    agents: '서브에이전트 및 도구',
    prompts: '프롬프트 및 요약',
    system: '시스템 및 도구 정의',
  },
  mcpWith: names => `MCP 도구 (${names})`,
  words: {
    output: 'Claude 자신의 출력',
    think: '생각',
    files: '파일 읽기',
    shell: '명령 출력',
    search: '검색 결과',
    web: '웹 페이지',
    agents: '서브에이전트 보고',
    prompts: '내 프롬프트',
    tools: '도구 결과',
    summary: '압축 요약',
    system: '시스템 알림',
    base: '시스템 프롬프트와 도구 정의',
  },
  mcpServer: name => `MCP 서버 ${name}`,
  servers: n => `MCP 서버 ${n}개`,
  sessions: n => `세션 ${n}개`,
  turn: (grown, share, what) => `이번 턴 컨텍스트 +${grown} (창의 ${share}%)${what === null ? '' : `, 주로 ${what}`}`,
  nearCompact: (pct, left) => `컨텍스트가 자동 압축 기준의 ${pct}%에 도달했습니다 (${left} 남음). 큰 작업 전에 /compact 하세요.`,
  compacted: (before, after) => `컨텍스트 압축됨${before !== null && after !== null ? `: ${before} → ${after}` : ''}`,
  summaryContext: (pct, used, window, turn) => `컨텍스트 ${pct}% (${used} / ${window})${turn === null ? '' : `, 이번 턴 +${turn}`}.`,
  summaryLargest: list => `큰 항목: ${list}.`,
  summaryMemory: (mem, total, sessions) => `메모리: ${mem} (${sessions} 합계 ${total}).`,
  summaryNoMonitor: 'cc-footprint 백그라운드 프로그램이 실행 중이 아니라 메모리와 구성을 알 수 없습니다.',
  summaryNothing: '아직 수치가 없습니다: 이 세션에 아직 응답이 없습니다.',
  opened: 'Footprint 패널을 열었습니다.',
  closed: 'Footprint 패널을 닫았습니다.',
  cannotRead: 'Footprint가 이 세션을 읽지 못했습니다.',
  refresh: '새로 고침',
  nothingYet: '아직 읽은 것이 없습니다.',
  cannotDraw: '수치를 표시할 수 없습니다.',
  contextWindow: '컨텍스트 창',
  noResponse: '이 컨텍스트 창에는 아직 응답이 없습니다.',
  used: (used, window, pct) => `${window} 중 ${used} 사용 (${pct}%)`,
  thisTurn: (arrow, n) => `이번 턴 ${arrow}${n}`,
  compactAt: (at, left) => `${at}에서 자동 압축, ${left} 남음`,
  compactOff: '자동 압축 꺼짐',
  whatFills: inUse => `구성${inUse === null ? '' : ` (사용 중 ${inUse})`}`,
  noBreakdown: '아직 구성 정보가 없습니다.',
  limits: '사용 한도',
  resetsIn: left => ` · ${left} 후 초기화`,
  memory: '메모리',
  thisSession: (mem, total, sessions) => `이 세션 ${mem}, ${sessions} 합계 ${total}`,
  children: (self, n, mem) => `claude ${self} + 자식 프로세스 ${n}개 ${mem}`,
  ofIt: (servers, mem) => `, 그중 ${servers} ${mem}`,
  outside: (servers, mem) => `어느 세션에도 속하지 않은 ${servers}: ${mem}`,
  up: age => `실행 ${age}`,
  noMonitor: 'cc-footprint 백그라운드 프로그램이 실행 중이 아닙니다: 메모리 수치와 구성이 없습니다.',
}

const TABLES: Record<string, Strings> = { en, 'zh-TW': zhTW, 'zh-CN': zhCN, ja, ko }

/** The table for a language code, English for one this plugin lacks. */
export function strings(lang: string | null | undefined): Strings {
  return (lang && TABLES[lang]) || en
}

export const LANGS = Object.keys(TABLES)

/**
 * Columns a string takes in a terminal: two for the wide characters of
 * Chinese, Japanese and Korean (and full-width forms), one for the rest.
 * `.length` counts UTF-16 units and would misalign a column of them.
 */
export function width(s: string): number {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    const wide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0x303e) || (c >= 0x3041 && c <= 0x33ff) ||
      (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xa000 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x20000 && c <= 0x3fffd)
    n += wide ? 2 : 1
  }

  return n
}

/** `s` padded with spaces to `cols` columns on screen. */
export function padTo(s: string, cols: number): string {
  return s + ' '.repeat(Math.max(0, cols - width(s)))
}
