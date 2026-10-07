# cc-footprint

A background service (a system tray app on Windows, a menu bar icon on macOS, headless on Linux) plus a statusline script, showing each Claude Code session's memory and context. Runs on Windows, Linux and macOS.

## Architecture

```
monitor/app.js (Node.js)              statusline/statusline.sh (Bash)
├─ Tray icon (systray2)               ├─ Run by Claude Code after every reply
├─ HTTP API :19823                    ├─ /dev/tcp GET /session/<sid> (~35 ms)
├─ Process table every 60 s           ├─ Assembles items + ANSI colors + wraps
│   collectors/win32.js (CIM)
│   collectors/linux.js (/proc)
│   collectors/darwin.js (ps + vm_stat)
├─ session→PID: ~/.claude/sessions/<pid>.json
├─ MCP$ share + context composition: tail ~/.claude/projects/**/<sid>.jsonl
│   (MCP$ includes subagents/; composition reads the main thread only,
│    algorithm in monitor/context.js)
└─ Config: ~/.cc-footprint/           └─ Monitor down: only what Claude Code itself reports
```

## Critical constraints

- **The statusline must be fast** — the docs say only "300 ms debounce", and a new update cancels a script still running; too slow and nothing shows.
- **Spawning a process on Windows is expensive** — PowerShell ~500–900 ms, curl ~650 ms, cat ~230 ms.
- **Session memory = the whole process tree** — a collector only lists processes (pid, ppid, memory, start time, whether the command line looks like an MCP server); adding up the tree and deciding MCP servers, in a session's tree or outside every session, happens in `monitor/proctree.js` (pure functions, tested by `node --test` in `monitor/`). A collector for another platform just has to produce the same table.
- **MCP server detection**: the command line mentions `mcp`, `modelcontextprotocol` or `chrome-native-host` (Chrome's bridge to its extension; the pattern and the server's short name are in `collectors/mcp.js`) and the process has been alive for 30 s or more (so a tool shell that happens to mention the word is not one). One outside every session's tree is listed as `outside`, a wrapper chain once; whose parent it has does not matter.
- **Platform differences live only in `monitor/collectors/`** — one file per platform, all producing the same table (the interface is in `collectors/index.js`); nothing else branches on the platform. Linux has no tray, so items are toggled by editing `~/.cc-footprint/config.json` (app.js re-reads it when the mtime changes).
- **`.sh` files are always LF** (set in `.gitattributes`) — a CRLF bash script simply breaks on Linux.
- **statusline.sh must run on bash 3.2** (what macOS ships) — `read -t` takes whole seconds only; a literal `{` in a regex is written `[{]`; a `\/` in the replacement of `${var//pat/rep}` is copied literally, so use a variable; there is no `EPOCHSECONDS` or `printf %(%s)T`, so macOS falls back to `date +%s` (forks are cheap there). Verify changes with `docker run --rm bash:3.2`.
- **`os.freemem()` is wrong on macOS** (it counts only never-touched pages) — system memory comes from `vm_stat`.
- **The installers share `scripts/`** — `statusline-setting.js` edits settings.json and `remove-global-rule.js` removes the marked block from CLAUDE.md; both `install.ps1` and `install.sh` call them. Do not write a second copy.
- **`wmic` is gone** (Windows 11 24H2+) — process data comes from the Get-CimInstance script embedded in `collectors/win32.js`; system memory from Node's `os` module.
- **A monitor that is down must not stall the statusline** — under MSYS a refused connection takes 2 s to come back, so after a failure statusline.sh asks again only every 30 s (`/tmp/claude-sl-monitor.down` holds the time of the failure). Checking or writing a file costs ~5 ms there, so nothing is written while the monitor answers. While it is down the items it measures are left out, not shown from a cache: an old figure would pass for a current one.
- **No curl in statusline.sh** — use `/dev/tcp`.
- **No `$(...)` in statusline.sh** — each fork costs ~30 ms under MSYS; helpers set globals instead (`FMT` / `PC` / `BAR` / `RESP`).
- **Spawn as little as possible** — bash regex instead of sed/grep.
- **Wrap to the `COLUMNS` Claude Code passes in** — the statusline process gets the live terminal width that way (`tput cols` always says 80 inside a pipe). The width the monitor measures is only a fallback for when `COLUMNS` is missing: on Windows it is window pixels / 8, an overestimate, and up to 60 s stale.
- **Never measure display width with `${#s}` alone** — Claude Code starts the statusline with no locale set, so bash counts bytes and a 10-column bar counts as 30. The second argument of `add_item` is an ASCII stand-in for bars and arrows, and `width()` converts (CJK counts as 2 columns).
- **systray2: `update-item`, never `update-menu`** — update-menu breaks onClick.

## Adding a display item

1. `monitor/app.js` — add one line to the ITEMS array (the tray menu picks it up).
2. `statusline/statusline.sh` — add the regex parse and an `if has xxx; then add_item ...` render.
3. That's all; no other file changes.

## Global optimization (browser subagent)

`claude/agents/browser.md` and `claude/global-rule.md` are an **optional** global optimization. The installers never apply it — they list it at the end, and when `CLAUDECODE` is set they print instructions for the AI running them (ask the user first, merge rather than overwrite). The manual steps are in the README under "Hand browser work to a subagent". `global-rule.md` carries its own `cc-footprint:browser-agent` start/end markers, which is how the uninstaller removes just that block. Edit the rule or the agent only in the source files under `claude/`.

## Installing without overwriting the user's setup

- `settings.json` is always edited by node (key order and formatting survive), never with `ConvertTo-Json`.
- An existing `statusline.sh` / `statusLine` that is not ours is backed up as `.bak` before writing. Ours is recognized by `cc-footprint` in the first 5 lines of statusline.sh, and by `statusLine.command` being `bash` followed by that script's absolute path (`scripts/statusline-setting.js` builds the command, quoting a path that has a space in it).
- The uninstaller removes only what belongs to this tool.

## Key commands

```bash
# Run the monitor
cd monitor && node app.js

# Query the API
curl http://127.0.0.1:19823/session/<session_id>

# Run the statusline with a stand-in for Claude Code's input
echo '{"session_id":"test",...}' | bash statusline/statusline.sh

# To capture the JSON Claude Code really sends, point statusLine in
# settings.json at a script that saves its stdin (e.g. /tmp/sl-last-input.json)

# Unit tests (process tree, collectors, context)
cd monitor && node --test

# The whole flow (install → measure → statusline → uninstall) on Linux, in
# Docker (from PowerShell on Windows: Git Bash rewrites the -v paths)
docker run --rm -v "<repo>:/repo:ro" node:22-bookworm bash /repo/test/smoke.sh

# The same script runs in CI on all three platforms (SMOKE_SERVICE=1 goes
# through systemd or launchd). On Windows it is CI-only: the uninstaller ends
# whatever holds port 19823, the machine's own monitor included.
# No Mac hardware: the menu bar icon is not visible in CI and is unverified
```

## Plugin (mod)

`plugin/` is a Claude Code function-hooks plugin: the statusline stays lean, and the details move to toasts (a turn that bloats the context, the approach to auto-compaction, a finished compaction) and the `/footprint` pane.

- Data: the monitor's `/context/:sid` (composition, growth this turn) and `/sessions` (memory per session), plus the engine's `$.session.usage()` (window, auto-compact threshold, limits). It must degrade when the monitor is down; a hook must never fail.
- Pure logic in `hooks/notices.ts`, hooks and the pane in `hooks/register.tsx`, the `$.state` type contract in `types/index.d.ts`.
- The pane's data is read at the end of every turn, on `/footprint`, and on Refresh; while the pane is open also every 30 s (`$.clock.every`, cancelled on `ui.close`).
- Verify with `claude plugin validate plugin` and `claude plugin test plugin`. Type-check with the tsconfig described in the d.ts header.
- The API is early access and changes between Claude Code versions; the types in the current version's `claude-code.d.ts` are authoritative (loading the plugin-authoring skill writes it out).
- Develop with hot reload under `~/.claude/dev-mods/<session>/cc-footprint/`, then copy back to `plugin/`.
- Install: `install.ps1` / `install.sh` register this clone as a marketplace and install the plugin from it (`-NoPlugin` / `--no-plugin` skip that), so the plugin loads in place and `git pull` + `/reload-plugins` is the update; the uninstallers remove the plugin and the marketplace registration.
- Publishing: `.claude-plugin/marketplace.json` at the repo root makes the repo its own marketplace (`/plugin marketplace add ilwu/cc-footprint`). Bump `version` in both `plugin/.claude-plugin/plugin.json` and the marketplace file together; `claude plugin validate . --strict` checks the marketplace, `claude plugin validate plugin --strict` the plugin.
