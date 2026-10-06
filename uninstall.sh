#!/usr/bin/env bash
# cc-footprint uninstaller for Linux and macOS. Removes only what the installer (or a
# hand-applied global optimization) put in place; a statusline or setting
# that is not ours is left alone.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
claude_dir="$HOME/.claude"
config_dir="$HOME/.cc-footprint"
unit="cc-footprint.service"
unit_file="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$unit"
agent="com.ilwu.cc-footprint"
agent_file="$HOME/Library/LaunchAgents/$agent.plist"

step() { printf '\033[33m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m%s\033[0m\n' "$*"; }
note() { printf '  \033[90m%s\033[0m\n' "$*"; }

is_mac()      { [[ "$(uname -s)" == Darwin ]]; }
has_systemd() { [[ -z "${CC_FOOTPRINT_NO_SERVICE:-}" ]] && ! is_mac && command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; }
is_ours()     { head -n 5 "$1" 2>/dev/null | grep -q 'cc-footprint'; }
# Ends a monitor started from this folder; fails when none was running.
# Reads /proc itself, since a minimal system has no pkill.
kill_monitor() {
  local p found=1
  if [[ ! -d /proc ]]; then
    pkill -f "$dir/monitor/app.js" 2>/dev/null
    return
  fi
  for p in /proc/[0-9]*; do
    if [[ -r "$p/cmdline" ]] && tr '\0' ' ' < "$p/cmdline" 2>/dev/null | grep -qF "$dir/monitor/app.js"; then
      kill "${p#/proc/}" 2>/dev/null && found=0
    fi
  done
  return $found
}

printf '\n  \033[36mcc-footprint - Uninstaller\033[0m\n  ==========================\n\n'

# ── Stop monitor, remove start at login ───────────────────────────
step "[1/5] Stopping monitor..."
if has_systemd && [[ -f "$unit_file" ]]; then
  systemctl --user disable --now --quiet "$unit" 2>/dev/null || true
fi
if is_mac && [[ -f "$agent_file" ]]; then
  launchctl bootout "gui/$(id -u)/$agent" >/dev/null 2>&1 || launchctl unload "$agent_file" >/dev/null 2>&1 || true
  rm -f "$agent_file"
  ok "Removed $agent_file"
fi
if kill_monitor; then ok "Monitor stopped"; else note "Monitor not running"; fi
if [[ -f "$unit_file" ]]; then
  rm -f "$unit_file"
  has_systemd && systemctl --user daemon-reload
  ok "Removed $unit_file"
fi

# ── Remove statusline config ──────────────────────────────────────
step "[2/5] Removing statusline config..."
statusline="$claude_dir/statusline.sh"
if [[ -f "$statusline" ]]; then
  if is_ours "$statusline"; then rm -f "$statusline"; ok "Removed statusline.sh"
  else note "statusline.sh is not ours - left untouched"; fi
fi
settings="$claude_dir/settings.json"
if [[ -f "$settings" ]] && command -v node >/dev/null 2>&1; then
  result="$(node "$dir/scripts/statusline-setting.js" unset "$settings" "$statusline" 2>/dev/null || true)"
  [[ "$result" == removed ]] && ok "Removed statusLine from settings.json"
  [[ -f "$settings.bak" ]] && note "Your statusLine from before install is in settings.json.bak"
fi

# ── Remove global optimizations ───────────────────────────────────
# Applied by hand; both pieces carry our markers.
step "[3/5] Removing global optimizations..."
agent="$claude_dir/agents/browser.md"
if grep -q 'installed by cc-footprint' "$agent" 2>/dev/null; then
  rm -f "$agent"
  ok "Removed browser.md"
fi
if command -v node >/dev/null 2>&1; then
  result="$(node "$dir/scripts/remove-global-rule.js" "$claude_dir/CLAUDE.md")"
  [[ "$result" == removed ]] && ok "Removed browser rule from CLAUDE.md"
fi

# ── Remove config dir ─────────────────────────────────────────────
step "[4/5] Removing config..."
if [[ -d "$config_dir" ]]; then rm -rf "$config_dir"; ok "Removed $config_dir"
else note "No config dir found"; fi
# The statusline's note that the monitor was down; earlier versions also
# kept a memory cache per session beside it
rm -f /tmp/claude-sl-* 2>/dev/null || true

# ── Remove the Claude Code plugin ─────────────────────────────────
step "[5/5] Removing the Claude Code plugin..."
if command -v claude >/dev/null 2>&1; then
  if claude plugin uninstall cc-footprint@cc-footprint >/dev/null 2>&1; then ok "Plugin removed"
  else note "Plugin was not installed"; fi
  claude plugin marketplace remove cc-footprint >/dev/null 2>&1 && ok "Marketplace entry removed"
else
  note "claude command not found - if the plugin is installed: claude plugin uninstall cc-footprint@cc-footprint"
fi
# Claude Code keeps a copy of every installed version under its cache, keyed
# by marketplace name; uninstalling does not drop them
if [[ -d "$claude_dir/plugins/cache/cc-footprint" ]]; then
  rm -rf "$claude_dir/plugins/cache/cc-footprint"; ok "Removed the plugin cache"
fi

printf '\n  \033[32mUninstall complete!\033[0m\n'
note "The project files remain in this directory. Delete them yourself if you no longer need them."
printf '\n'
