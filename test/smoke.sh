#!/usr/bin/env bash
# End-to-end check on every platform: install, a stand-in session with a
# child process, the monitor measuring that tree, the statusline printing it
# (under /bin/bash, which is 3.2 on macOS), then uninstall. Run from anywhere:
#
#   bash test/smoke.sh                  in a throwaway HOME, the monitor
#                                       started directly
#   SMOKE_SERVICE=1 bash test/smoke.sh  the monitor as a systemd user service
#                                       or a launchd agent; CI only, see below
#
# On Windows it runs under Git Bash, installs with Windows PowerShell 5.1 (as
# install.ps1 is mostly run) and is for CI only: the installer writes the
# real Startup folder, and the uninstaller ends whatever holds port 19823.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unset CLAUDECODE
tmp_home=""
is_mac() { [[ "$(uname -s)" == Darwin ]]; }
is_win() { [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* ]]; }
if is_win && [[ "${CI:-}" != true ]]; then
  echo "on Windows this test takes the Startup folder and port 19823 of the machine, so it runs under CI only" >&2
  exit 2
fi
if [[ -n "${SMOKE_SERVICE:-}" ]]; then
  # systemd and launchd read their units from the real home, so this mode
  # installs there and rewrites ~/.claude/settings.json: only on a machine
  # made for the run.
  [[ "${CI:-}" == true ]] || { echo "SMOKE_SERVICE=1 writes to the real \$HOME, so it runs under CI only" >&2; exit 2; }
  if ! is_mac; then
    systemctl --user show-environment >/dev/null 2>&1 || { echo "no systemd user session to test against" >&2; exit 2; }
  fi
else
  tmp_home="$(mktemp -d)"
  # With a space in it, as a home may well have
  export HOME="$tmp_home/home dir"
  mkdir "$HOME"
  # The throwaway HOME is not where systemd or launchd look for units
  export CC_FOOTPRINT_NO_SERVICE=1
  # The installer and the monitor read USERPROFILE on Windows
  is_win && export USERPROFILE="$(cygpath -w "$HOME")"
fi
# The home as a command line names it: C:/... on Windows
home_cmd="$HOME"
is_win && home_cmd="$(cygpath -m "$HOME")"
sid="11111111-2222-3333-4444-555555555555"
MB=1048576

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }
# ANSI colours out; BSD sed knows no \x1b, so node does it
strip() { node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>process.stdout.write(b.replace(/\x1b\[[0-9;]*m/g,"")))'; }
# The bash Claude Code runs the statusline with: 3.2 on macOS, Git's on Windows
sl() { /bin/bash "$HOME/.claude/statusline.sh"; }
# The whole URL as one argument: under Git Bash a bare /session/... would
# be taken for a path and rewritten, as would JSON holding one
get()  { node -e 'require("http").get(process.argv[1],r=>{let b="";r.on("data",d=>b+=d);r.on("end",()=>console.log(b))}).on("error",e=>{console.error(e.message);process.exit(1)})' "http://127.0.0.1:19823$1"; }
field() { MSYS_NO_PATHCONV=1 node -e 'const o=JSON.parse(process.argv[1]);console.log(o[process.argv[2]])' "$1" "$2"; }

# The installers, run the way the README says to (so a lost executable bit
# fails here), --no-plugin: the plugin registry is Claude Code's, not under
# test here
install() {
  if is_win; then powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$root/install.ps1")" -NoPlugin
  else "$root/install.sh" --no-plugin; fi
}
uninstall() {
  if is_win; then powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$root/uninstall.ps1")"
  else "$root/uninstall.sh"; fi
}
startup_shortcut() { printf '%s/Microsoft/Windows/Start Menu/Programs/Startup/cc-footprint.lnk' "$(cygpath "$APPDATA")"; }

cleanup() {
  [[ -n "${session_job:-}" ]] && kill "$session_job" 2>/dev/null || true
  uninstall >/dev/null 2>&1 || true
  # Only ever the throwaway home
  [[ -n "$tmp_home" ]] && rm -rf "$tmp_home"
  return 0
}
trap cleanup EXIT

# A stand-in session: a process holding about 80 MB with a child holding 40.
# The child leaves once its parent is gone. The process writes its own pid:
# under Git Bash $! is a pid of bash's own, not the one the machine knows.
node -e '
  require("fs").writeFileSync(process.argv[1], String(process.pid));
  const hold = Buffer.alloc(80 * 1048576, 1);
  require("child_process").spawn(process.execPath,
    ["-e", "const hold = Buffer.alloc(40 * 1048576, 1); const parent = process.ppid;" +
           "setInterval(() => { if (hold.length && process.ppid !== parent) process.exit() }, 500)"],
    { stdio: "ignore" });
  setInterval(() => hold.length, 1000);
' "$HOME/session.pid" &
session_job=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [[ -s "$HOME/session.pid" ]] && break; sleep 0.5; done
session_pid="$(cat "$HOME/session.pid")"
[[ "$session_pid" =~ ^[0-9]+$ ]] || fail "the stand-in session did not start"

mkdir -p "$HOME/.claude/sessions" "$HOME/.claude/projects/-work-api"
# startedAt as Claude Code writes it, a moment after the process began: the
# monitor holds a process younger than its session file to be another one
printf '{"pid":%s,"sessionId":"%s","cwd":"/work/api","name":"smoke","startedAt":%s}\n' "$session_pid" "$sid" "$(( $(date +%s) * 1000 ))" \
  > "$HOME/.claude/sessions/$session_pid.json"
# Two responses: the context grows from 50k to 62k, 2k of it the first answer
cat > "$HOME/.claude/projects/-work-api/$sid.jsonl" <<EOF
{"type":"user","message":{"role":"user","content":"hello"}}
{"type":"assistant","message":{"id":"m1","model":"claude-opus","content":[{"type":"tool_use","id":"t1","name":"Read","input":{}}],"usage":{"input_tokens":50000,"output_tokens":2000}}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"file text"}]}}
{"type":"assistant","message":{"id":"m2","model":"claude-opus","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":62000,"output_tokens":100}}}
EOF

# A setting of the person's own, to see that the installer keeps the rest
printf '{\n  "theme": "dark",\n  "statusLine": { "type": "command", "command": "my-own.sh" }\n}\n' > "$HOME/.claude/settings.json"

install > "$HOME/install.log" 2>&1 || { rc=$?; cat "$HOME/install.log"; fail "the installer exited $rc"; }
grep -q "Monitor running" "$HOME/install.log" || { cat "$HOME/install.log"; fail "the monitor did not come up"; }
pass "the installer ran and the monitor answers"

if [[ -n "${SMOKE_SERVICE:-}" ]]; then
  if is_mac; then
    launchctl print "gui/$(id -u)/com.ilwu.cc-footprint" >/dev/null 2>&1 || fail "the launchd agent is not loaded"
    [[ -f "$HOME/Library/LaunchAgents/com.ilwu.cc-footprint.plist" ]] || fail "the agent's plist is missing"
    pass "the monitor runs as a launchd agent, loaded at login"
  else
    systemctl --user is-enabled --quiet cc-footprint.service || fail "the service is not enabled for login"
    systemctl --user is-active --quiet cc-footprint.service || fail "the service is not running"
    pass "the monitor runs as a systemd user service, enabled for login"
  fi
elif is_win; then
  [[ -f "$(startup_shortcut)" ]] || fail "no shortcut in the Startup folder: $(startup_shortcut)"
  pass "the monitor starts at login through the Startup folder"
fi

settings="$(cat "$HOME/.claude/settings.json")"
[[ "$settings" == *'"theme": "dark"'* ]] || fail "settings.json lost the person's other settings"
sl_command="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).statusLine.command' "$HOME/.claude/settings.json")"
[[ "$sl_command" == bash*"$home_cmd/.claude/statusline.sh"* ]] || fail "statusLine does not point at our script: $sl_command"
grep -q 'my-own.sh' "$HOME/.claude/settings.json.bak" || fail "the previous statusLine was not backed up"
pass "statusLine set, the rest of settings.json kept, the old one backed up"

status="$(get "/session/$sid")"
mem="$(field "$status" mem)"; self="$(field "$status" self)"; procs="$(field "$status" procs)"
(( mem >= 110 * MB )) || fail "tree memory $mem is less than the 120 MB the stand-ins hold: $status"
(( self >= 70 * MB && self < mem )) || fail "self $self should be the parent alone: $status"
(( procs >= 2 )) || fail "expected the child in the tree, procs=$procs"
[[ "$(field "$status" ctx_turn)" == 12100 ]] || fail "ctx_turn should be 12100: $status"
[[ "$(field "$status" ctx_src)" == files ]] || fail "ctx_src should be files: $status"
[[ "$(field "$status" system_pct)" =~ ^[0-9]+$ ]] || fail "no system memory figure: $status"
pass "the session's tree is measured: $((mem / MB))M in $procs processes, $((self / MB))M of it the session itself"

sessions="$(get /sessions)"
[[ "$sessions" == *'"name":"smoke"'* ]] || fail "/sessions does not list the session: $sessions"
pass "/sessions lists it"

reset=$(( $(date +%s) + 8000 ))
line="$(printf '{"session_id":"%s","workspace":{"project_dir":"/work/api"},"context_window":{"context_window_size":200000,"used_percentage":31},"rate_limits":{"five_hour":{"used_percentage":34,"resets_at":%s},"seven_day":{"used_percentage":52,"resets_at":%s}}}' "$sid" "$reset" "$reset" \
  | sl | strip)"
printf '%s\n' "$line" | sed 's/^/     /'
[[ "$line" == *"Claude $((mem / MB))M/"* ]] || fail "the statusline does not show the session's memory"
[[ "$line" == *"31% ↑12k"* ]] || fail "the statusline does not show this turn's growth"
[[ "$line" == *"34% 2h13m"* ]] || fail "the statusline does not show the reset countdown"
[[ "$line" == *"/work/api"* ]] || fail "the statusline does not show the project path"
pass "the statusline prints memory, growth and the reset countdown"

# The command as settings.json has it, run through a shell as Claude Code
# runs it: whatever the path to the script holds, it has to get there whole
line="$(printf '{"session_id":"%s","workspace":{"project_dir":"/work/api"}}' "$sid" | sh -c "$sl_command" 2>&1 | strip)" || true
[[ "$line" == *"/work/api"* ]] || fail "the statusLine command does not run: $sl_command ($line)"
# The context's share is null until the first response, and must not be
# taken from the limits, which carry the same key
line="$(printf '{"session_id":"%s","context_window":{"used_percentage":null},"rate_limits":{"five_hour":{"used_percentage":34}}}' "$sid" | sl | strip)"
[[ "$line" == *"?% "*"5h "*"34%"* ]] || fail "a context share of null was read from the limits: $line"
pass "the statusLine command runs as written, and a null context share stays unknown"

# The /footprint hint follows the plugin's state in settings.json: how to get
# it while it is missing, the command itself once it is enabled
[[ "$line" == *"plugin off: rerun the installer for /footprint"* ]] || fail "no plugin nudge while it is not installed"
node -e '
  const fs = require("fs"), f = process.argv[1], s = JSON.parse(fs.readFileSync(f, "utf8"));
  s.enabledPlugins = { "cc-footprint@cc-footprint": true };
  fs.writeFileSync(f, JSON.stringify(s, null, 2));
' "$HOME/.claude/settings.json"
line="$(printf '{"session_id":"%s"}' "$sid" | sl | strip)"
[[ "$line" == *"/footprint"* && "$line" != *"plugin off"* ]] || fail "the hint did not switch to /footprint once the plugin was enabled: $line"
pass "the /footprint hint follows whether the plugin is installed"

# Lines are filled to the terminal's width by what they take on screen. A
# bar is 30 bytes and 10 columns: counted in bytes, a 100-column terminal
# gets two items on the first line (53 columns) instead of three (79).
first="$(printf '{"session_id":"%s","context_window":{"used_percentage":31}}' "$sid" \
  | COLUMNS=100 sl | strip | head -n 1)"
columns="$(MSYS_NO_PATHCONV=1 node -e 'console.log([...process.argv[1]].length)' "$first")"
(( columns >= 70 && columns <= 96 )) || fail "at 100 columns the first line is $columns wide: $first"
pass "lines are filled to the terminal's width ($columns of 96 columns used)"

# Item choices are a file (the tray writes it too): a change shows on the
# next render
node -e 'const fs=require("fs"),f=process.argv[1],c=JSON.parse(fs.readFileSync(f));c.claude_mem=false;fs.writeFileSync(f,JSON.stringify(c,null,2))' "$HOME/.cc-footprint/config.json"
line="$(printf '{"session_id":"%s"}' "$sid" | sl | strip)"
[[ "$line" != *"Claude "* ]] || fail "an item turned off in config.json is still shown"
pass "editing config.json turns an item off"

uninstall > "$HOME/uninstall.log" 2>&1 || { rc=$?; cat "$HOME/uninstall.log"; fail "the uninstaller exited $rc"; }
[[ ! -e "$HOME/.claude/statusline.sh" ]] || fail "statusline.sh is still there"
[[ ! -d "$HOME/.cc-footprint" ]] || fail "the config dir is still there"
grep -q statusLine "$HOME/.claude/settings.json" && fail "statusLine is still in settings.json"
grep -q '"theme": "dark"' "$HOME/.claude/settings.json" || fail "uninstall lost the person's other settings"
sleep 1
(exec 3<>/dev/tcp/127.0.0.1/19823) 2>/dev/null && fail "the monitor is still running"
if [[ -n "${SMOKE_SERVICE:-}" ]]; then
  if is_mac; then
    launchctl print "gui/$(id -u)/com.ilwu.cc-footprint" >/dev/null 2>&1 && fail "the launchd agent is still loaded"
    [[ ! -e "$HOME/Library/LaunchAgents/com.ilwu.cc-footprint.plist" ]] || fail "the agent's plist is still there"
  else
    systemctl --user is-enabled --quiet cc-footprint.service 2>/dev/null && fail "the service is still enabled"
    [[ ! -e "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/cc-footprint.service" ]] || fail "the unit file is still there"
  fi
elif is_win; then
  [[ ! -e "$(startup_shortcut)" ]] || fail "the Startup shortcut is still there"
fi
pass "the uninstaller removed what was installed and nothing else"

# With the monitor gone the statusline still prints what Claude Code gave
# it and leaves out what the monitor measures, and it notes the failure so
# that the next renders do not wait on the port (a refused connection takes
# 2 s under Git Bash)
line="$(printf '{"session_id":"%s","context_window":{"used_percentage":31}}' "$sid" | /bin/bash "$root/statusline/statusline.sh" | strip)"
[[ "$line" == *"Ctx "*"31%"*"$sid"* ]] || fail "without the monitor the statusline lost Claude Code's own items: $line"
[[ "$line" != *"Sys "* && "$line" != *"Claude "* ]] || fail "memory items are shown while the monitor is down: $line"
[[ -s /tmp/claude-sl-monitor.down ]] || fail "the failed connection was not noted"
rm -f /tmp/claude-sl-monitor.down
pass "without the monitor the statusline shows Claude Code's own items only, and backs off"

printf '\nAll checks passed.\n'
