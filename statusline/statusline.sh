#!/bin/bash
# cc-footprint — dynamic statusline for Claude Code
# Reads display config from monitor API, only renders enabled items.
IFS= read -r -d '' input  # builtin; $(cat) would cost a fork + exec

# ── Parse JSON (pure bash regex, zero process spawning) ──────────
# Written for bash 3.2 as well (macOS ships it): a literal { is [{], not a
# backslash-brace, which its regex library does not take.
# The rate limits carry a used_percentage too, and the context's is null
# until the first response: look only at what follows "context_window" and
# comes before "rate_limits". (The keys are in variables because bash 3.2
# mishandles an escaped quote inside ${var#pattern}.)
cw_key='"context_window":' rl_key='"rate_limits"'
cw="${input#*$cw_key}"
if [[ "$cw" != "$input" ]]; then
  cw="${cw%%$rl_key*}"
  [[ "$cw" =~ \"used_percentage\":([0-9]+) ]]            && ctx="${BASH_REMATCH[1]}"
fi
[[ "$input" =~ \"session_id\":\"([^\"]+)\" ]]             && sid="${BASH_REMATCH[1]}"
[[ "$input" =~ \"project_dir\":\"([^\"]+)\" ]]            && proj="${BASH_REMATCH[1]}"
[[ "$input" =~ \"five_hour\":[{][^}]*\"used_percentage\":([0-9]+) ]] && five="${BASH_REMATCH[1]}"
[[ "$input" =~ \"seven_day\":[{][^}]*\"used_percentage\":([0-9]+) ]] && week="${BASH_REMATCH[1]}"
[[ "$input" =~ \"five_hour\":[{][^}]*\"resets_at\":([0-9]+) ]] && five_reset="${BASH_REMATCH[1]}"
[[ "$input" =~ \"seven_day\":[{][^}]*\"resets_at\":([0-9]+) ]] && week_reset="${BASH_REMATCH[1]}"
[[ "$input" =~ \"context_window_size\":([0-9]+) ]]     && ctx_win="${BASH_REMATCH[1]}"
[[ "$input" =~ \"display_name\":\"([^\"]+)\" ]]           && model="${BASH_REMATCH[1]}"
[[ "$input" =~ \"effort\":[{][^}]*\"level\":\"([^\"]+)\" ]] && effort="${BASH_REMATCH[1]}"
[[ "$input" =~ \"total_cost_usd\":([0-9.eE+-]+) ]]       && cost="${BASH_REMATCH[1]}"
[[ "$input" =~ \"total_lines_added\":([0-9]+) ]]         && lines_add="${BASH_REMATCH[1]}"
[[ "$input" =~ \"total_lines_removed\":([0-9]+) ]]       && lines_del="${BASH_REMATCH[1]}"
[[ "$input" =~ \"total_duration_ms\":([0-9]+) ]]         && duration_ms="${BASH_REMATCH[1]}"

# ── Format project path (keep full path, just fix slashes) ───────
# JSON escapes each backslash, so a pair goes first, then any single one.
# The slash comes from a variable: bash 3.2 would copy an escaped one into
# the result as written.
sl=/
proj="${proj//'\\'/$sl}"
proj="${proj//'\'/$sl}"
proj="${proj%/}"
[[ -z "$proj" ]] && proj="~"

# ── HTTP GET via /dev/tcp (no curl, ~46ms) ───────────────────────
# Response body -> RESP (runs in the main shell, no subshell). Fails when
# nothing answers: no connection, or one that takes the request and says
# nothing (another program on the port, a monitor that is stuck); the
# caller then backs off as it would from a refused connection.
http_get() {
  local line body=""
  RESP=""
  { exec 3<>/dev/tcp/127.0.0.1/19823; } 2>/dev/null || return 1
  printf "GET %s HTTP/1.0\r\nHost: l\r\n\r\n" "$1" >&3
  # Whole seconds: bash 3.2 takes no fraction here
  while read -r -t 1 line; do [[ "${line//$'\r'/}" == "" ]] && break; done <&3
  read -r -t 1 body <&3; exec 3<&-
  RESP="${body//$'\r'/}"
  [[ -n "$RESP" ]]
}

# Now in epoch seconds, without a fork: EPOCHSECONDS on bash 5, printf's
# %(%s)T on 4.2 and later. macOS's bash 3.2 has neither, and there a fork
# is cheap, so date answers; any other old bash shows no countdown.
NOW=${EPOCHSECONDS:-}
[[ -z "$NOW" ]] && printf -v NOW '%(%s)T' -1 2>/dev/null
[[ "$NOW" =~ ^[0-9]+$ ]] || NOW=""
[[ -z "$NOW" && "$OSTYPE" == darwin* ]] && NOW=$(date +%s)

# ── Query monitor API (monitor maps session_id -> claude.exe PID) ──
# A monitor that is down is asked again only every 30 s: under MSYS a
# refused connection takes 2 s to come back, far longer than Claude Code
# waits for this script. $monitor_down holds when the last attempt failed,
# and is rewritten before a retry, so that a run cancelled while it waits
# still leaves the next ones the fast path. Writing a file costs ~5 ms
# there, which is why nothing is written while the monitor answers.
monitor_down="/tmp/claude-sl-monitor.down"
resp="" ask=1 was_down=""
if [[ -n "$NOW" && -s "$monitor_down" ]]; then
  was_down=1
  read -r down_at < "$monitor_down"
  if [[ "$down_at" =~ ^[0-9]+$ ]] && ((NOW >= down_at && NOW - down_at < 30)); then
    ask=""
  else
    echo "$NOW" > "$monitor_down"
  fi
fi
if [[ -n "$sid" && -n "$ask" ]]; then
  if http_get "/session/$sid"; then
    resp=$RESP
    [[ -n "$was_down" ]] && : > "$monitor_down"
  elif [[ -n "$NOW" ]]; then
    echo "$NOW" > "$monitor_down"
  fi
fi

# Parse API response
sys_pct="" cld_total="" sess_mem="" mcp_total="" mcp_count="" display=""
ctx_turn="" ctx_src="" ctx_src_pct="" ctx_mcp_pct="" plugin="" remote=""
if [[ -n "$resp" ]]; then
  [[ "$resp" =~ \"system_pct\":([0-9]+) ]]    && sys_pct="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"claude_total\":([0-9]+) ]]   && cld_total="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"mem\":([0-9]+) ]]            && sess_mem="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"mcp_total\":([0-9]+) ]]      && mcp_total="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"mcp_count\":([0-9]+) ]]      && mcp_count="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"ctx_mcp_pct\":([0-9]+) ]]    && ctx_mcp_pct="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"plugin\":(true|false) ]]     && plugin="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"remote_control\":(true|false) ]] && remote="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"ctx_turn\":(-?[0-9]+) ]]     && ctx_turn="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"ctx_src\":\"([^\"]+)\" ]]    && ctx_src="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"ctx_src_pct\":([0-9]+) ]]    && ctx_src_pct="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"display\":\[([^\]]*)\] ]]    && display="${BASH_REMATCH[1]}"
fi

# Helpers set a global instead of echoing: every $(...) is a fork,
# and a fork costs ~30ms under MSYS — a dozen of them blows the budget.

# Format bytes -> FMT
fmt() {
  local raw=$1
  if [[ -z "$raw" || "$raw" == "0" ]]; then FMT="-"; return; fi
  local mb=$((raw / 1048576))
  if ((mb > 1024)); then
    local gb=$((mb * 10 / 1024))
    FMT="${gb:0:${#gb}-1}.${gb: -1}G"
  else
    FMT="${mb}M"
  fi
}

# Tokens -> short form in TOK (15k)
tok() {
  if (($1 >= 1000)); then TOK="$((($1 + 500) / 1000))k"; else TOK="<1k"; fi
}

# Epoch seconds of a limit reset -> time left in LEFT (4d21h, 2h13m, 45m);
# empty when unknown or already past
left() {
  LEFT=""
  [[ -z "$1" || -z "$NOW" ]] && return
  local s=$(($1 - NOW))
  ((s <= 0)) && return
  if ((s >= 86400)); then LEFT="$((s / 86400))d$((s % 86400 / 3600))h"
  elif ((s >= 3600)); then LEFT="$((s / 3600))h$((s % 3600 / 60))m"
  else LEFT="$((s / 60))m"; fi
}

fmt "$cld_total";  cld_fmt=$FMT
fmt "$sess_mem";   sess_fmt=$FMT

# Without the monitor there is no telling which items are switched on, and
# nothing to show for the ones it measures (an old figure would pass for a
# current one): what is left is the default items Claude Code itself supplies.
# A monitor that answers with no item on ("display":[]) gets an empty line.
if [[ -z "$resp" ]]; then
  display='"ctx","five_hour","week","resets","session_id","path"'
fi

# Check if item is enabled
has() { [[ "$display" == *"\"$1\""* ]]; }

# ── ANSI colors ──────────────────────────────────────────────────
R='\033[0m'
DIM='\033[90m'
GRN='\033[32m'
YLW='\033[33m'
RED='\033[31m'
CYN='\033[36m'
BLU='\033[34m'
MAG='\033[35m'

# Percentage -> color in PC
pct_color() {
  local v=${1:-0}
  if ((v >= 75)); then PC=$RED
  elif ((v >= 50)); then PC=$YLW
  else PC=$GRN; fi
}

# Percentage -> 10-cell progress bar in BAR (also sets PC). The last $2 of
# the filled cells, when given, are in the MCP colour: the context bar draws
# the share MCP tool results take that way.
bar() {
  local pct=${1:-0} mcp=${2:-0} i
  # Ten cells whatever the figure: over 100% (a limit past its end) the bar
  # is full, and the width reckoned for it stays right
  ((pct > 100)) && pct=100
  local filled=$((pct / 10)) empty=$((10 - pct / 10))
  ((mcp > filled)) && mcp=$filled
  pct_color "$pct"
  BAR="$PC"
  for ((i=0; i<filled-mcp; i++)); do BAR+="▊"; done
  if ((mcp > 0)); then
    BAR+="${MAG}"
    for ((i=0; i<mcp; i++)); do BAR+="▊"; done
  fi
  BAR+="${DIM}"
  for ((i=0; i<empty; i++)); do BAR+="░"; done
  BAR+="${R}"
}

sep=" ${DIM}│${R} "
sep_plain=" │ "

# ── Terminal width ───────────────────────────────────────────────
# Claude Code hands the terminal's width to this script as COLUMNS, current
# at every render; the footer indents the line, hence the margin. Where a
# Claude Code does not, the monitor's estimate stands in (the window's
# width on Windows, the terminal's on Linux; up to a minute old), and
# without either nothing is wrapped. tput cols is no use here: in a pipe
# it always says 80.
api_cols=""
if [[ -n "$resp" ]] && [[ "$resp" =~ \"cols\":([0-9]+) ]]; then
  api_cols="${BASH_REMATCH[1]}"
fi
if [[ "${COLUMNS:-}" =~ ^[0-9]+$ ]] && ((COLUMNS > 20)); then
  cols=$((COLUMNS - 4))
else
  cols=${api_cols:-9999}
fi

# ── Build all enabled items (always full content) ────────────────
items=()       # array of ANSI-colored segments
items_len=()   # array of visible widths (no ANSI)

# Columns a string takes on screen -> W. ${#s} counts bytes unless the
# locale is UTF-8, and Claude Code starts this script with none set, so
# both counts are taken: one column per character, plus one for each wide
# (CJK) character, which is three bytes where a narrow one is one or two.
# Where the UTF-8 locale is missing this is the byte count: too wide,
# never too narrow.
width() {
  LC_ALL=C.UTF-8
  local chars=${#1}
  LC_ALL=C
  W=$((chars + (${#1} - chars) / 2))
}

# The second argument stands in for what the first shows, to be measured.
# Bars and arrows are written in ASCII there (##########, ^): they are
# three bytes a glyph and one column wide, which width() would call wide.
add_item() {
  local colored="$1" plain="$2"
  items+=("$colored")
  width "$plain"
  items_len+=("$W")
}

if has sys_mem; then
  bar "${sys_pct:-0}"
  add_item "${PC}Sys${R} ${BAR} ${PC}${sys_pct:-?}%${R}" "Sys ########## ${sys_pct:-?}%"
fi
if has claude_mem; then
  # This session, then all of them together
  add_item "${CYN}Claude${R} ${sess_fmt}/${DIM}${cld_fmt}${R}" "Claude ${sess_fmt}/${cld_fmt}"
fi
# This session's own MCP servers. The ones outside every session are no
# session's business: /footprint lists them.
if has mcp_mem && [[ -n "$mcp_count" && "$mcp_count" != "0" ]]; then
  fmt "$mcp_total"
  add_item "${MAG}MCP${R} ${FMT}${DIM}(${mcp_count})${R}" "MCP ${FMT}(${mcp_count})"
fi
if has ctx; then
  # The share of the window that MCP tool results take, as cells of the bar
  # and as a number: the monitor says their share of what is in use, Claude
  # Code how much of the window that is
  mcp_win="" mcp_cells=0
  if has ctx_mcp && [[ -n "$ctx_mcp_pct" && -n "$ctx" ]] && ((ctx_mcp_pct > 0)); then
    mcp_win=$(( (ctx * ctx_mcp_pct + 50) / 100 ))
    mcp_cells=$(( (mcp_win + 5) / 10 ))
    ((mcp_win > 0)) || mcp_win=""
  fi
  bar "${ctx:-0}" "$mcp_cells"
  ctx_c="Ctx ${BAR} ${ctx:-?}%"; ctx_p="Ctx ########## ${ctx:-?}%"
  # What this turn has added to the context so far (↓ when it has shrunk
  # instead; a compaction starts the count again); yellow once one turn
  # takes 5% of the window
  if has ctx_grow && [[ -n "$ctx_turn" && "$ctx_turn" != "0" ]]; then
    if ((ctx_turn > 0)); then tok "$ctx_turn"; grow="↑$TOK"; else tok "$((-ctx_turn))"; grow="↓$TOK"; fi
    if ((${ctx_win:-0} > 0 && ctx_turn * 20 >= ctx_win)); then gc=$YLW; else gc=$DIM; fi
    ctx_c+=" ${gc}${grow}${R}"; ctx_p+=" ^${TOK}"
  fi
  if [[ -n "$mcp_win" ]]; then
    ctx_c+=" ${MAG}mcp ${mcp_win}%${R}"; ctx_p+=" mcp ${mcp_win}%"
  fi
  # The largest thing in the context and its share of it
  if has ctx_src && [[ -n "$ctx_src" ]]; then
    ctx_c+=" ${DIM}(${ctx_src} ${ctx_src_pct}%)${R}"; ctx_p+=" (${ctx_src} ${ctx_src_pct}%)"
  fi
  add_item "$ctx_c" "$ctx_p"
fi
# With `resets` on, each limit is followed by the time left until it resets
if has five_hour && [[ -n "$five" ]]; then
  bar "$five"
  lim_c="${PC}5h${R} ${BAR} ${PC}${five}%${R}"; lim_p="5h ########## ${five}%"
  if has resets; then left "$five_reset"; [[ -n "$LEFT" ]] && { lim_c+=" ${DIM}${LEFT}${R}"; lim_p+=" ${LEFT}"; }; fi
  add_item "$lim_c" "$lim_p"
fi
if has week && [[ -n "$week" ]]; then
  bar "$week"
  lim_c="${PC}Week${R} ${BAR} ${PC}${week}%${R}"; lim_p="Week ########## ${week}%"
  if has resets; then left "$week_reset"; [[ -n "$LEFT" ]] && { lim_c+=" ${DIM}${LEFT}${R}"; lim_p+=" ${LEFT}"; }; fi
  add_item "$lim_c" "$lim_p"
fi
# The model, and the effort level it runs at when Claude Code reports one
if has model; then
  if [[ -n "$effort" ]]; then
    add_item "${MAG}${model:-?}${R} ${DIM}· ${effort}${R}" "${model:-?} · ${effort}"
  else
    add_item "${MAG}${model:-?}${R}" "${model:-?}"
  fi
fi
if has cost; then
  # Dollars and two digits of cents: 2 is $2.00, 0.5 $0.50. A figure in
  # exponent form (5e-7) is under a cent; the regex took only its digits.
  [[ "$cost" =~ [eE] ]] && cost=0
  if [[ -n "$cost" && "$cost" != "0" ]]; then
    cost_int="${cost%%.*}"; cost_dec=""
    [[ "$cost" == *.* ]] && cost_dec="${cost#*.}"
    cost_dec="${cost_dec}00"; cost_dec="${cost_dec:0:2}"; cost_int="${cost_int:-0}"
    add_item "${YLW}\$$cost_int.$cost_dec${R}" "\$$cost_int.$cost_dec"
  fi
fi
if has lines; then
  la="${lines_add:-0}"; ld="${lines_del:-0}"
  add_item "${GRN}+${la}${R}/${RED}-${ld}${R}" "+${la}/-${ld}"
fi
if has duration; then
  if [[ -n "$duration_ms" && "$duration_ms" != "0" ]]; then
    total_s=$((duration_ms / 1000))
    hrs=$((total_s / 3600)); mins=$(( (total_s % 3600) / 60 ))
    if ((hrs > 0)); then
      dur_fmt="${hrs}h${mins}m"
    else
      dur_fmt="${mins}m"
    fi
    add_item "${DIM}${dur_fmt}${R}" "${dur_fmt}"
  fi
fi
# Reachable by Remote Control right now (the monitor reads it from the
# session file each time); nothing while it is off
if has remote && [[ "$remote" == true ]]; then
  add_item "${GRN}RC${R}" "RC"
fi
if has session_id; then
  add_item "${DIM}${sid:-?}${R}" "${sid:-?}"
fi
if has path; then
  add_item "${BLU}${proj}${R}" "${proj}"
fi
# A reminder that /footprint exists: the command once the plugin is
# installed, how to get it while it is not; nothing when the monitor cannot tell
if has plugin_hint; then
  if [[ "$plugin" == true ]]; then
    add_item "${DIM}/footprint${R}" "/footprint"
  elif [[ "$plugin" == false ]]; then
    add_item "${DIM}/footprint: off${R}" "/footprint: off"
  fi
fi

# ── Auto-wrap: pack items into lines that fit terminal width ─────
sep_len=3  # " │ " is 3 columns
lines=()
cur_line=""
cur_len=0

for i in "${!items[@]}"; do
  item_len=${items_len[$i]}
  # Calculate width if we add this item to current line
  if ((cur_len == 0)); then
    need=$item_len
  else
    need=$((cur_len + sep_len + item_len))
  fi

  if ((need <= cols)) || ((cur_len == 0)); then
    # Fits on current line (or first item on line — always add)
    if ((cur_len > 0)); then
      cur_line+="${sep}"
      cur_len=$((cur_len + sep_len))
    fi
    cur_line+="${items[$i]}"
    cur_len=$((cur_len + item_len))
  else
    # Doesn't fit — start new line
    lines+=("$cur_line")
    cur_line="${items[$i]}"
    cur_len=$item_len
  fi
done
[[ -n "$cur_line" ]] && lines+=("$cur_line")

# ── Output all lines ─────────────────────────────────────────────
for line in "${lines[@]}"; do
  echo -e "$line"
done
