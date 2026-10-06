#Requires -Version 5.1
<#
.SYNOPSIS
    One-click installer for cc-footprint on Windows.
.DESCRIPTION
    - Installs npm dependencies
    - Copies statusline script to ~/.claude/
    - Points statusLine in ~/.claude/settings.json at it
    - Creates startup shortcut for auto-launch
    - Starts the monitor
    - Installs the Claude Code plugin (toasts and the /footprint pane) from
      this folder, unless -NoPlugin
    - Lists optional global optimizations (never applied automatically,
      because they change ~/.claude/ for every project)
    Never silently replaces the user's own statusline: a foreign
    statusline.sh or statusLine setting is backed up to *.bak first.
    Safe to re-run (idempotent): it stops any running monitor on port 19823,
    refreshes installed files, and starts the new build.
.PARAMETER NoPlugin
    Do not install the Claude Code plugin.
.PARAMETER NoBrowserAgent
    Ignored. Kept so older install commands still run; the browser subagent
    is no longer installed automatically.
#>
param(
    [switch]$NoPlugin,
    [switch]$NoBrowserAgent
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$monitorDir = Join-Path $scriptDir "monitor"
$statuslineDir = Join-Path $scriptDir "statusline"
$claudeDir = Join-Path $env:USERPROFILE ".claude"

# Runs a native command and returns all it printed, stderr included, as
# text. Under "Stop", Windows PowerShell 5.1 makes a terminating error of the
# first line a native command writes to a redirected stderr, so the command
# runs under "Continue"; $LASTEXITCODE says how it went.
function Invoke-Native([scriptblock]$Command) {
    $ErrorActionPreference = "Continue"
    & $Command 2>&1 | ForEach-Object { "$_" }
}

Write-Host ""
Write-Host "  cc-footprint - Installer" -ForegroundColor Cyan
Write-Host "  ========================" -ForegroundColor DarkGray
Write-Host ""

# ── Pre-checks ────────────────────────────────────────────────────
Write-Host "[1/6] Checking prerequisites..." -ForegroundColor Yellow

# Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "  ERROR: Node.js not found. Install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
$nodeVer = (node --version) -replace '^v',''
Write-Host "  Node.js $nodeVer" -ForegroundColor Green

# Git Bash
$gitBash = Get-Command bash -ErrorAction SilentlyContinue
if (-not $gitBash) {
    $gitBash = Get-Command "C:\Program Files\Git\bin\bash.exe" -ErrorAction SilentlyContinue
}
if (-not $gitBash) {
    Write-Host "  ERROR: Git Bash not found. Install from https://git-scm.com/" -ForegroundColor Red
    exit 1
}
Write-Host "  Git Bash found" -ForegroundColor Green

# Claude Code
$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
    Write-Host "  WARNING: claude command not found (may still work if installed elsewhere)" -ForegroundColor Yellow
} else {
    Write-Host "  Claude Code found" -ForegroundColor Green
}

# Check if already running
$existing = Get-NetTCPConnection -LocalPort 19823 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 0 }
if ($existing) {
    Write-Host "  WARNING: Port 19823 already in use. Stopping existing monitor..." -ForegroundColor Yellow
    $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
}

# ── npm install ───────────────────────────────────────────────────
Write-Host "[2/6] Installing dependencies..." -ForegroundColor Yellow
Push-Location $monitorDir
Invoke-Native { npm install --silent } | Out-Null
if ($LASTEXITCODE -ne 0) {
    Invoke-Native { npm install } | ForEach-Object { Write-Host "  $_" }
    Write-Host "  ERROR: npm install failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Dependencies installed" -ForegroundColor Green

# ── Copy statusline ──────────────────────────────────────────────
Write-Host "[3/6] Installing statusline..." -ForegroundColor Yellow

if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

$statuslineSrc = Join-Path $statuslineDir "statusline.sh"
$statuslineDst = Join-Path $claudeDir "statusline.sh"

# Our script names itself in its header comment
if (Test-Path $statuslineDst) {
    $head = (Get-Content $statuslineDst -TotalCount 5 -Encoding UTF8) -join "`n"
    if (-not $head.Contains("cc-footprint")) {
        Copy-Item $statuslineDst "$statuslineDst.bak" -Force
        Write-Host "  WARNING: $statuslineDst was not ours - backed up to statusline.sh.bak" -ForegroundColor Yellow
    }
}
Copy-Item $statuslineSrc $statuslineDst -Force
Write-Host "  Copied statusline.sh -> $statuslineDst" -ForegroundColor Green

# Set statusLine in settings.json. A node script edits the JSON so key order
# and formatting survive (ConvertTo-Json reorders keys and re-indents the
# file); a different statusLine is backed up to settings.json.bak first.
$settingsFile = Join-Path $claudeDir "settings.json"
$result = node (Join-Path $scriptDir "scripts\statusline-setting.js") set $settingsFile ($statuslineDst -replace '\\', '/')
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: could not update $settingsFile (invalid JSON?) - left untouched" -ForegroundColor Red
    exit 1
}
if ($result -eq "same") {
    Write-Host "  settings.json already points at statusline.sh" -ForegroundColor Green
} elseif ($result -like "replaced:*") {
    Write-Host "  WARNING: replaced your statusLine '$($result.Substring(9))'" -ForegroundColor Yellow
    Write-Host "           previous settings saved to settings.json.bak" -ForegroundColor Yellow
} else {
    Write-Host "  Added statusLine to settings.json" -ForegroundColor Green
}

# ── Startup shortcut ─────────────────────────────────────────────
Write-Host "[4/6] Creating startup shortcut..." -ForegroundColor Yellow

$ws = New-Object -ComObject WScript.Shell
$startup = $ws.SpecialFolders("Startup")
$shortcutPath = Join-Path $startup "cc-footprint.lnk"
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $monitorDir "start.vbs"
$shortcut.WorkingDirectory = $monitorDir
$shortcut.Description = "cc-footprint - Claude Code session footprint monitor"
$shortcut.Save()
Write-Host "  Shortcut created at: $shortcutPath" -ForegroundColor Green

# ── Start monitor ────────────────────────────────────────────────
Write-Host "[5/6] Starting monitor..." -ForegroundColor Yellow

$vbsPath = Join-Path $monitorDir "start.vbs"
cscript //nologo $vbsPath

# Verify: the API answers within a second or two, the first scan of the
# process table takes a few more
$response = $null
for ($i = 0; $i -lt 10 -and -not $response; $i++) {
    Start-Sleep -Seconds 1
    try { $response = Invoke-RestMethod -Uri "http://127.0.0.1:19823/sessions" -TimeoutSec 2 } catch {}
}
if (-not $response) {
    Write-Host "  WARNING: Monitor started but API not responding yet. It may need a moment." -ForegroundColor Yellow
} elseif ($response.sessions.Count -gt 0) {
    Write-Host "  Monitor running! Tracking $($response.sessions.Count) session(s)" -ForegroundColor Green
} else {
    Write-Host "  Monitor running! (sessions appear once its first scan finishes)" -ForegroundColor Green
}

# ── Claude Code plugin ───────────────────────────────────────────
# This folder is a plugin marketplace, so the plugin loads in place from
# it: a git pull and /reload-plugins is an update. Both commands are
# idempotent; a marketplace of this name added from GitHub is re-pointed
# here.
Write-Host "[6/6] Installing the Claude Code plugin..." -ForegroundColor Yellow
if ($NoPlugin) {
    Write-Host "  Skipped (-NoPlugin)" -ForegroundColor DarkGray
} elseif (-not $claude) {
    Write-Host "  Skipped: claude command not found. Inside Claude Code later:" -ForegroundColor Yellow
    Write-Host "    /plugin marketplace add ilwu/cc-footprint"
    Write-Host "    /plugin install cc-footprint@cc-footprint"
} else {
    $pluginOk = $false
    try {
        $out = Invoke-Native { claude plugin marketplace add $scriptDir }
        if ($LASTEXITCODE -eq 0) {
            $out = Invoke-Native { claude plugin install cc-footprint@cc-footprint }
            $pluginOk = ($LASTEXITCODE -eq 0)
        }
    } catch {}
    if ($pluginOk) {
        Write-Host "  Plugin installed from $scriptDir (restart open sessions to load it)" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: could not install the plugin:" -ForegroundColor Yellow
        Write-Host "    $($out | Select-Object -Last 1)"
        Write-Host "    Inside Claude Code: /plugin marketplace add ilwu/cc-footprint, then /plugin install cc-footprint@cc-footprint"
    }
}

# ── Done ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  What's next:" -ForegroundColor Cyan
Write-Host "    - Look for the orange footprint icon in your system tray (bottom-right)"
Write-Host "    - Right-click it to toggle statusline items or exit"
Write-Host "    - Open a Claude Code session to see the statusline"
Write-Host "    - In a session, /footprint opens the pane; a turn that bloats the context gets a toast"
Write-Host "    - Monitor auto-starts on boot"

# ── Optional global optimizations ────────────────────────────────
# Listed, never applied: they change ~/.claude/ for every project, so the
# user decides. Under Claude Code (CLAUDECODE is set) the AI running this
# script is told to ask first and to merge rather than overwrite.
$agentSrc = Join-Path $scriptDir "claude\agents\browser.md"
$ruleSrc = Join-Path $scriptDir "claude\global-rule.md"
$claudeMd = Join-Path $claudeDir "CLAUDE.md"
$browserApplied = (Test-Path $claudeMd) -and
    ([IO.File]::ReadAllText($claudeMd) -match "<!-- cc-footprint:browser-agent:start -->")

Write-Host ""
Write-Host "  Optional: global optimizations" -ForegroundColor Cyan
Write-Host "    Not applied automatically - they change ~/.claude/ for every project."
if ($browserApplied) {
    Write-Host "    - Browser subagent: already applied" -ForegroundColor DarkGray
} else {
    Write-Host "    - Browser subagent: hand multi-step Chrome work to a subagent with a"
    Write-Host "      short context, so browser-heavy sessions cost much less."
    Write-Host "      How to apply: README.md -> 'Hand browser work to a subagent'"

    if ($env:CLAUDECODE) {
        Write-Host ""
        Write-Host "  [For the AI assistant running this installer]" -ForegroundColor Magenta
        Write-Host "    Ask the user whether to apply the browser subagent optimization."
        Write-Host "    Do not apply it without a yes. To apply:"
        Write-Host "      1. Copy $agentSrc"
        Write-Host "         to ~/.claude/agents/browser.md. If that file already exists,"
        Write-Host "         show the user how it differs and ask before replacing it."
        Write-Host "      2. Append the full contents of $ruleSrc"
        Write-Host "         (start/end markers included) to the end of ~/.claude/CLAUDE.md."
        Write-Host "         Keep everything already in that file."
        Write-Host "      3. Tell the user to restart open Claude Code sessions."
    }
}

Write-Host ""
Write-Host "  To uninstall: .\uninstall.ps1" -ForegroundColor DarkGray
Write-Host ""
# Real failures exit 1 above; a warning from an optional step must not
# leave the exit code of that external command behind
exit 0
