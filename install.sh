#!/usr/bin/env bash
# cc-footprint installer for Linux and macOS.
#
# - Copies the statusline script to ~/.claude/ and points statusLine at it
#   (a statusline of your own is backed up to *.bak first)
# - Starts the monitor now and at login (a systemd user service on Linux,
#   a launchd agent on macOS, where npm also installs what draws its menu
#   bar icon)
# - Installs the Claude Code plugin (toasts and the /footprint pane) from
#   this folder, unless --no-plugin
# - Lists the optional steps; none of them is applied for you
#
# Safe to re-run: it stops the running monitor, refreshes the files and
# starts the new build.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
claude_dir="$HOME/.claude"
no_plugin=""
for arg in "$@"; do
  case "$arg" in
    --no-plugin) no_plugin=1 ;;
    *) printf 'unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done
config_file="$HOME/.cc-footprint/config.json"
unit="cc-footprint.service"
unit_file="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$unit"
agent="com.ilwu.cc-footprint"
agent_file="$HOME/Library/LaunchAgents/$agent.plist"
port=19823

step() { printf '\033[33m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m%s\033[0m\n' "$*"; }
warn() { printf '  \033[33mWARNING: %s\033[0m\n' "$*"; }
die()  { printf '  \033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

is_mac()      { [[ "$(uname -s)" == Darwin ]]; }
# CC_FOOTPRINT_NO_SERVICE=1 starts the monitor directly instead (the tests)
has_systemd() { [[ -z "${CC_FOOTPRINT_NO_SERVICE:-}" ]] && ! is_mac && command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; }
has_launchd() { [[ -z "${CC_FOOTPRINT_NO_SERVICE:-}" ]] && is_mac && command -v launchctl >/dev/null 2>&1; }
api_up()      { (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; }
# Ends a monitor started from this folder. On Linux it reads /proc itself,
# since a minimal system has no pkill; macOS has pkill and no /proc.
kill_monitor() {
  local p
  if [[ ! -d /proc ]]; then
    pkill -f "$dir/monitor/app.js" 2>/dev/null || true
    return
  fi
  for p in /proc/[0-9]*; do
    if [[ -r "$p/cmdline" ]] && tr '\0' ' ' < "$p/cmdline" 2>/dev/null | grep -qF "$dir/monitor/app.js"; then
      kill "${p#/proc/}" 2>/dev/null || true
    fi
  done
}
# Every version of our statusline names itself in its header comment
is_ours()     { head -n 5 "$1" 2>/dev/null | grep -q 'cc-footprint'; }

printf '\n  \033[36mcc-footprint - Installer\033[0m\n  ========================\n\n'

# ── Pre-checks ────────────────────────────────────────────────────
step "[1/5] Checking prerequisites..."
command -v node >/dev/null 2>&1 || die "Node.js not found. Install it from https://nodejs.org/"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' \
  || die "Node.js 18 or newer is needed (found $(node --version))"
ok "Node.js $(node --version)"
if command -v claude >/dev/null 2>&1; then ok "Claude Code found"
else warn "claude command not found (may still work if installed elsewhere)"; fi

if has_systemd && systemctl --user is-active --quiet "$unit"; then
  systemctl --user stop "$unit"
fi
if has_launchd; then
  launchctl bootout "gui/$(id -u)/$agent" >/dev/null 2>&1 || true
fi
kill_monitor

# ── Statusline ────────────────────────────────────────────────────
step "[2/5] Installing statusline..."
mkdir -p "$claude_dir"
statusline="$claude_dir/statusline.sh"
if [[ -f "$statusline" ]] && ! is_ours "$statusline"; then
  cp "$statusline" "$statusline.bak"
  warn "$statusline was not ours - backed up to statusline.sh.bak"
fi
cp "$dir/statusline/statusline.sh" "$statusline"
ok "Copied statusline.sh -> $statusline"

settings="$claude_dir/settings.json"
result="$(node "$dir/scripts/statusline-setting.js" set "$settings" "$statusline")" \
  || die "could not update $settings (invalid JSON?) - left untouched"
case "$result" in
  same)       ok "settings.json already points at statusline.sh" ;;
  replaced:*) warn "replaced your statusLine '${result#replaced:}'"
              printf '           previous settings saved to settings.json.bak\n' ;;
  *)          ok "Added statusLine to settings.json" ;;
esac

# ── Start at login ────────────────────────────────────────────────
step "[3/5] Setting up start at login..."
node_bin="$(command -v node)"
if has_systemd; then
  mkdir -p "$(dirname "$unit_file")"
  cat > "$unit_file" <<EOF
[Unit]
Description=cc-footprint - Claude Code session footprint monitor

[Service]
ExecStart="$node_bin" "$dir/monitor/app.js"
Restart=on-failure

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --quiet "$unit"
  ok "systemd user service: $unit_file"
elif has_launchd; then
  mkdir -p "$(dirname "$agent_file")"
  cat > "$agent_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$dir/monitor/app.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict>
</plist>
EOF
  ok "launchd agent: $agent_file"
else
  warn "no systemd user session here, so the monitor will not start at login."
  printf '           Start it yourself with: nohup "%s" "%s/monitor/app.js" >/dev/null 2>&1 &\n' "$node_bin" "$dir"
fi

# ── Start monitor ─────────────────────────────────────────────────
step "[4/5] Starting monitor..."
# The menu bar icon is drawn by systray2, the monitor's one dependency and
# an optional one. Linux has no tray, so nothing is installed there.
tray=""
if is_mac; then
  if command -v npm >/dev/null 2>&1 && (cd "$dir/monitor" && npm install --silent >/dev/null 2>&1); then
    tray=1
    ok "Dependencies installed"
  else
    warn "npm install failed: the monitor will run without its menu bar icon"
  fi
fi
if has_systemd; then
  systemctl --user start "$unit"
elif has_launchd; then
  # bootstrap loads the agent and, with RunAtLoad, starts it; older
  # macOS releases know only load
  launchctl bootstrap "gui/$(id -u)" "$agent_file" 2>/dev/null || launchctl load "$agent_file"
else
  nohup "$node_bin" "$dir/monitor/app.js" >/dev/null 2>&1 &
fi
for _ in 1 2 3 4 5 6 7 8 9 10; do
  api_up && break
  sleep 0.5
done
if api_up; then ok "Monitor running on 127.0.0.1:$port"
else warn "Monitor started but its API is not answering yet. It may need a moment."; fi

# ── Claude Code plugin ────────────────────────────────────────────
# This folder is a plugin marketplace, so the plugin loads in place from
# it: a git pull and /reload-plugins is an update. Both commands are
# idempotent; a marketplace of this name added from GitHub is re-pointed
# here.
step "[5/5] Installing the Claude Code plugin..."
if [[ -n "$no_plugin" ]]; then
  printf '  \033[90mSkipped (--no-plugin)\033[0m\n'
elif ! command -v claude >/dev/null 2>&1; then
  warn "claude command not found. Inside Claude Code later:"
  printf '    /plugin marketplace add ilwu/cc-footprint\n    /plugin install cc-footprint@cc-footprint\n'
elif out="$(claude plugin marketplace add "$dir" 2>&1 && claude plugin install cc-footprint@cc-footprint 2>&1)"; then
  ok "Plugin installed from $dir (restart open sessions to load it)"
else
  warn "could not install the plugin: $(printf '%s\n' "$out" | tail -n 1)"
  printf '    Inside Claude Code: /plugin marketplace add ilwu/cc-footprint, then /plugin install cc-footprint@cc-footprint\n'
fi

# ── Done ──────────────────────────────────────────────────────────
printf '\n  \033[32mInstallation complete!\033[0m\n\n'
printf '  \033[36mWhat'"'"'s next:\033[0m\n'
printf '    - Open a Claude Code session to see the statusline\n'
printf '    - In a session, /footprint opens the pane; a turn that bloats the context gets a toast\n'
if [[ -n "$tray" ]]; then
  printf '    - Look for the orange footprint in the menu bar; its menu switches items on and off\n'
  printf '      (so does editing %s)\n' "$config_file"
else
  if is_mac; then printf '    - Without the menu bar icon, choose the items shown by editing\n'
  else printf '    - There is no tray icon on Linux: choose the items shown by editing\n'; fi
  printf '      %s (true/false per item, applied at once)\n' "$config_file"
fi

# Listed, never applied: they change ~/.claude/ for every project, so the
# person decides. Under Claude Code (CLAUDECODE is set) the AI running this
# script is told to ask first and to merge rather than overwrite.
printf '\n  \033[36mOptional: global optimizations\033[0m\n'
printf '    Not applied automatically - they change ~/.claude/ for every project.\n'
if grep -q 'cc-footprint:browser-agent:start' "$claude_dir/CLAUDE.md" 2>/dev/null; then
  printf '    - Browser subagent: already applied\n'
else
  printf '    - Browser subagent: hand multi-step Chrome work to a subagent with a\n'
  printf '      short context, so browser-heavy sessions cost much less.\n'
  printf "      How to apply: README.md -> 'Hand browser work to a subagent'\n"
  if [[ -n "${CLAUDECODE:-}" ]]; then
    printf '\n  \033[35m[For the AI assistant running this installer]\033[0m\n'
    printf '    Ask the user whether to apply the browser subagent optimization.\n'
    printf '    Do not apply it without a yes. To apply:\n'
    printf '      1. Copy %s/claude/agents/browser.md\n' "$dir"
    printf '         to ~/.claude/agents/browser.md. If that file already exists,\n'
    printf '         show the user how it differs and ask before replacing it.\n'
    printf '      2. Append the full contents of %s/claude/global-rule.md\n' "$dir"
    printf '         (start/end markers included) to the end of ~/.claude/CLAUDE.md.\n'
    printf '         Keep everything already in that file.\n'
    printf '      3. Tell the user to restart open Claude Code sessions.\n'
  fi
fi

printf '\n  To uninstall: ./uninstall.sh\n\n'
