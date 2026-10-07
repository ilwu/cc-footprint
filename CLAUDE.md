# cc-footprint

A background service (a system tray app on Windows, a menu bar icon on macOS, headless on Linux) plus a statusline script, showing each Claude Code session's memory and context. Runs on Windows, Linux and macOS.

## Architecture

```
monitor/ (Node.js)                    statusline/statusline.sh (Bash)
├─ app.js: wiring + the 60 s loop     ├─ Run by Claude Code after every reply
├─ api.js: HTTP :19823                ├─ /dev/tcp GET /session/<sid> (~35 ms)
├─ tray.js: tray icon (systray2)      ├─ Assembles items + ANSI colors + wraps
├─ config.js: ITEMS + config.json
├─ collectors/: the process table, every 60 s
│   collectors/win32.js (CIM)
│   collectors/linux.js (/proc)
│   collectors/darwin.js (ps + vm_stat)
├─ sessions.js: session→PID, ~/.claude/sessions/<pid>.json
├─ plugin-state.js: is our plugin enabled (settings.json)
├─ proctree.js: the table → each session's tree, MCP servers
├─ transcripts.js: tail ~/.claude/projects/**/<sid>.jsonl
│   (the main thread only) → context.js: the composition
└─ Config: ~/.cc-footprint/           └─ Monitor down: only what Claude Code itself reports
```

Each module but `app.js` is a factory taking its paths and the state it needs, so that a test can point it at a temporary directory. HTTP API (`api.js`), and who reads it: `/session/:sid` the statusline; `/context/:sid` and `/sessions` the plugin (`/sessions` also `install.ps1`, to report what it found); `/status`, `/status/:pid` and `/config` nobody here, for looking at by hand. Requests must carry our own Host header (DNS rebinding).

## What Claude Code gives us

None of these formats is documented; `test/fixtures/` holds a capture of each, with how it was taken (its README). When a release changes one, capture again and rerun the tests.

- **Statusline stdin** — read with bash regexes at the top of `statusline.sh`. Keys that occur more than once (`used_percentage` is in `context_window` and in each rate limit) must be looked for inside their own object.
- **Session files** `~/.claude/sessions/<pid>.json` — `pid`, `sessionId`, `cwd`, `name`, `startedAt` (epoch ms, a few seconds after the process began; a process much younger than it is a reused pid). A killed session leaves its file behind.
- **Transcripts** — the rows `context.js` reads are listed in its `track()`. `transcripts.js` pre-filters lines by substring (`"type":"assistant"`), which relies on Claude Code writing compact JSON.
- **settings.json** — `statusLine` (ours: see "Installing without overwriting") and `enabledPlugins["cc-footprint@…"]`, which drives the statusline's `/footprint` hint.

## Critical constraints

- **The statusline must be fast** — the docs say only "300 ms debounce", and a new update cancels a script still running; too slow and nothing shows.
- **Spawning a process on Windows is expensive** — PowerShell ~500–900 ms, curl ~650 ms, cat ~230 ms.
- **Session memory = the whole process tree** — a collector only lists processes (pid, ppid, memory, start time, the MCP server's name if the command line names one); adding up the tree and deciding MCP servers, in a session's tree or outside every session, happens in `monitor/proctree.js` (pure functions, tested by `node --test` in `monitor/`). A collector for another platform just has to produce the same table.
- **MCP server detection**: the command line mentions `mcp`, `modelcontextprotocol` or `chrome-native-host` (Chrome's bridge to its extension; the pattern and the server's short name are in `collectors/mcp.js`) and the process has been alive for 30 s or more (so a tool shell that happens to mention the word is not one). One outside every session's tree is listed as `outside`, a wrapper chain once; whose parent it has does not matter.
- **Listing processes is the only per-platform code** — one collector per platform under `monitor/collectors/`, all producing the same table (the interface is in `collectors/index.js`). The other platform branches are in `tray.js` (none on Linux, an .ico or a .png, the helper's name) and the `date` fallback in `statusline.sh` on macOS; add none elsewhere. Linux has no tray, so items are toggled by editing `~/.cc-footprint/config.json` (config.js re-reads it when the mtime changes).
- **`.sh` files are always LF** (set in `.gitattributes`) — a CRLF bash script simply breaks on Linux.
- **`.sh` files the README runs are executable** — git on Windows (`core.fileMode=false`) never sets the bit, so a new one needs `git update-index --chmod=+x <file>`. `test/smoke.sh` runs the installers as `./install.sh`, so CI fails when the bit is lost.
- **statusline.sh must run on bash 3.2** (what macOS ships) — `read -t` takes whole seconds only; a literal `{` in a regex is written `[{]`; a `\/` in the replacement of `${var//pat/rep}` is copied literally, so use a variable; an escaped quote inside `${var#pattern}` misbehaves, so put the pattern in a variable; there is no `EPOCHSECONDS` or `printf %(%s)T`, so macOS falls back to `date +%s` (forks are cheap there). Verify changes with `bash:3.2` (Key commands).
- **`os.freemem()` is wrong on macOS** (it counts only never-touched pages) — system memory comes from `vm_stat`.
- **The installers share `scripts/`** — `statusline-file.js` puts statusline.sh in place and backs up one of the person's own, `statusline-setting.js` edits settings.json, `optional.js` prints the closing list of optional optimizations, `remove-global-rule.js` removes the marked block from CLAUDE.md. Do not write a second copy in PowerShell or bash; what stays in each installer is what differs by platform (prerequisites, start at login, stopping the monitor).
- **The installers stop only our monitor** — the process on port 19823 whose command line runs `monitor/app.js`; another program there is named and left alone.
- **`.ps1` files run on Windows PowerShell 5.1** — under `$ErrorActionPreference = "Stop"` it turns a native command's first line on a redirected stderr into an exception, so native commands whose output is kept go through `Invoke-Native` (defined at the top of each). Keep them ASCII outside comments: 5.1 reads a BOM-less file in the system code page.
- **`wmic` is gone** (Windows 11 24H2+) — process data comes from the Get-CimInstance script embedded in `collectors/win32.js`; system memory from Node's `os` module.
- **A monitor that is down must not stall the statusline** — under MSYS a refused connection takes 2 s to come back, so after a failure statusline.sh asks again only every 30 s (`/tmp/claude-sl-monitor.down` holds the time of the failure). Checking or writing a file costs ~5 ms there, so nothing is written while the monitor answers. While it is down the items it measures are left out, not shown from a cache: an old figure would pass for a current one.
- **No curl in statusline.sh** — use `/dev/tcp`.
- **No `$(...)` in statusline.sh** — each fork costs ~30 ms under MSYS; helpers set globals instead (`FMT` / `PC` / `BAR` / `RESP`).
- **Spawn as little as possible** — bash regex instead of sed/grep.
- **The monitor's answer is parsed with regexes too** — its keys must stay unique across the whole `/session` answer and flat.
- **Wrap to the `COLUMNS` Claude Code passes in** — the statusline process gets the live terminal width that way (`tput cols` always says 80 inside a pipe). The width the monitor measures is only a fallback for when `COLUMNS` is missing: on Windows it is window pixels / 8, an overestimate, and up to 60 s stale.
- **Never measure display width with `${#s}` alone** — Claude Code starts the statusline with no locale set, so bash counts bytes and a 10-column bar counts as 30. The second argument of `add_item` is an ASCII stand-in for bars and arrows, and `width()` converts (CJK counts as 2 columns).
- **systray2: `update-item`, never `update-menu`** — update-menu breaks onClick.
- **No prices** — nothing here may depend on what a token costs: prices change and this tool cannot follow them. The cost shown is the one Claude Code reports.

## Adding a display item

1. `monitor/config.js` — one line in the ITEMS array (the tray menu picks it up); a label must not hold `&`. If the monitor supplies the figure, add it to `statusFor()` or the `/session` handler in `api.js` under a key no other field contains.
2. `statusline/statusline.sh` — the regex parse and an `if has xxx; then add_item ...` render. Where the render sits is where it shows: the order is the script's, not the menu's. If Claude Code alone supplies it, consider it for the fallback `display` list used while the monitor is down.
3. Both READMEs — the row in the items table and the key in the `config.json` defaults.
4. `test/smoke.sh` — the 100-column wrapping check may move if the item is on by default.

## Languages

English, German, Spanish, French, Japanese, Korean, and Simplified and Traditional Chinese. `config.json`'s `lang` is `auto` (the system's locale, read by the monitor with `Intl`; Chinese by script, anything without a table English) or a code; the tray's Language menu sets it, and is called Language in every language so that a wrong choice can be undone.

- The monitor's words (the tray) are in `monitor/i18n/<code>.json`, one file per language; the Language menu lists every file under the name it gives itself (`_name`). `i18n.test.js` holds every file to English's keys and placeholders.
- The plugin's words are in `plugin/hooks/strings.ts`: a hooks module cannot read a JSON file, and the two share no phrase. Every language there is typed against English, so a missing phrase does not type-check. The plugin learns the language from `/sessions` (`lang`) and keeps the last one in `$.store`, so the pane stays in it while the monitor is down.
- The statusline says nothing to translate: short labels (`Ctx`, `5h`, `Sys`, `mcp`) and figures only. Keep it that way; new words belong in the pane.
- Column alignment in the pane goes by `width()` / `padTo()` from `strings.ts` (wide characters take two columns), never `.length` / `padEnd`.
- To add a language: a JSON file in `monitor/i18n/`, an entry in `strings.ts`'s table, its locale in `fromLocale()` if it is not matched by its code; run both test suites.

## Global optimization (browser subagent)

`claude/agents/browser.md` and `claude/global-rule.md` are an **optional** global optimization. The installers never apply it — they list it at the end, and when `CLAUDECODE` is set they print instructions for the AI running them (ask the user first, merge rather than overwrite). The manual steps are in the README under "Hand browser work to a subagent". `global-rule.md` carries its own `cc-footprint:browser-agent` start/end markers, which is how the uninstaller removes just that block. Edit the rule or the agent only in the source files under `claude/`.

## Installing without overwriting the user's setup

- `settings.json` is always edited by node (key order and formatting survive), never with `ConvertTo-Json`.
- An existing `statusline.sh` / `statusLine` that is not ours is backed up as `.bak` before writing; a `.bak` already there is kept, since it holds what was there before this tool. The uninstallers say where the backups are and restore nothing. Ours is recognized by `cc-footprint` in the first 5 lines of statusline.sh, and by `statusLine.command` being `bash` followed by that script's absolute path (`scripts/statusline-setting.js` builds the command, quoting a path that has a space in it).
- The uninstaller removes only what belongs to this tool.

## Documentation

- `README.md` and `README.zh-TW.md` mirror each other section by section: change both.
- The installers print the README section name "Hand browser work to a subagent"; keep it in step.
- Images: `screenshots/social-preview.png` is rendered from `social-preview.html` (its header says how) and uploaded by hand under GitHub Settings → Social preview; `banner.png` is its top 1280×380. `cc-footprint.png` and `tray-menu.png` are screenshots of a real session: before publishing one, mask the names of other sessions in it. `monitor/icon.*` come from `scripts/make-icon.py`.

## Key commands

```bash
# Run the monitor (stop the running one first: one instance per port)
cd monitor && node app.js

# Query the API (session ids are hex and dashes; anything else is a 404)
curl http://127.0.0.1:19823/session/<session_id>

# Run the statusline on what Claude Code really sends
bash statusline/statusline.sh < test/fixtures/statusline-input.json

# Under bash 3.2 (from PowerShell on Windows: Git Bash rewrites the -v
# paths); the monitor is out of reach there, so this shows the fallback
docker run --rm -i -v "<repo>:/repo:ro" bash:3.2 bash /repo/statusline/statusline.sh < test/fixtures/statusline-input.json

# Unit tests: every monitor module but app.js and tray.js, the /session keys
# the statusline reads (api.test.js), and the item list kept the same in its
# five places (consistency.test.js)
cd monitor && node --test

# The whole flow (install → measure → statusline → uninstall) on Linux, in
# Docker (from PowerShell on Windows, as above)
docker run --rm -v "<repo>:/repo:ro" node:22-bookworm bash /repo/test/smoke.sh

# The same script runs in CI on all three platforms (SMOKE_SERVICE=1 goes
# through systemd or launchd). On Windows it is CI-only: it stops and
# uninstalls the machine's own monitor.

# The plugin
claude plugin validate plugin --strict && claude plugin test plugin
```

What to run for a change:

| Changed | Run |
|---|---|
| any monitor module, an item, a README config block | `node --test` in `monitor/` |
| `statusline.sh` | the fixture through it, then under `bash:3.2`; the smoke test |
| `app.js`, `api.js`, `tray.js`, the installers, `scripts/` | the smoke test in Docker; CI for Windows and macOS |
| `plugin/` | `claude plugin validate plugin --strict`, `claude plugin test plugin`, type-check (below) |

## Not verified

Kept here so that nobody takes these as tested:

- The macOS menu bar icon: CI runs macOS without a screen. The monitor itself, its launchd agent and the statusline under bash 3.2 are tested there.
- A real Claude Code session on macOS or Linux desktops (CI uses a stand-in session).
- The plugin's toasts in a real session (they are covered by `claude plugin test`).
- Windows fallbacks: running the tray helper under its own name failing over to the shipped name, and an npm-installed Claude Code (running as node.exe, known by its session file).

## Plugin (mod)

`plugin/` is a Claude Code function-hooks plugin: the statusline stays lean, and the details move to toasts (a turn that bloats the context, the approach to auto-compaction, a finished compaction) and the `/footprint` pane.

- Data: the monitor's `/context/:sid` (composition, growth this turn) and `/sessions` (memory per session, MCP servers outside every session), plus the engine's `$.session.usage()` (window, auto-compact threshold, limits). It must degrade when the monitor is down; every hook keeps its own failures (try/catch), as a hook must never fail.
- Pure logic in `hooks/notices.ts`, hooks and the pane in `hooks/register.tsx`, the `$.state` type contract in `types/index.d.ts`.
- `context.js`'s category names are a contract: `notices.ts` groups them into the pane's colours and takes any name it does not know for an MCP server; the README lists them. Change all three together.
- The pane's data is read at the end of every turn, on `/footprint`, and on Refresh; while the pane is open also every 30 s (`$.clock.every`, cancelled on `ui.close`).
- The API is early access and changes between Claude Code versions; the types in the current version's `claude-code.d.ts` are authoritative (loading the plugin-authoring skill writes it out and names its path). Type-check with the tsconfig its header gives, kept outside the repo, its `include` naming that file, `plugin/hooks` and `plugin/types`.
- Develop with hot reload under `~/.claude/dev-mods/<session>/cc-footprint/`, then copy back to `plugin/`.
- Install: `install.ps1` / `install.sh` register this clone as a marketplace and install the plugin from it (`-NoPlugin` / `--no-plugin` skip that); the uninstallers remove the plugin and the marketplace registration. Claude Code installs a **copy**, under `~/.claude/plugins/cache/cc-footprint/cc-footprint/<version>/`: a change to `plugin/` reaches the installed plugin by a version bump and `claude plugin update cc-footprint@cc-footprint`, then `/reload-plugins` or a restart.
- Publishing: `.claude-plugin/marketplace.json` at the repo root makes the repo its own marketplace (`/plugin marketplace add ilwu/cc-footprint`), so a push to `main` is a release. Bump `version` in both `plugin/.claude-plugin/plugin.json` and the marketplace file together whenever `plugin/` changes; `claude plugin validate . --strict` checks the marketplace, `claude plugin validate plugin --strict` the plugin.
