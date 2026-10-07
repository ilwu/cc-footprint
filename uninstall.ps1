#Requires -Version 5.1
<#
.SYNOPSIS
    Uninstaller for cc-footprint.
#>

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# Stop-Monitor and Invoke-Node, shared with the other installer
. (Join-Path $scriptDir "scripts\common.ps1")
$claudeDir = Join-Path $env:USERPROFILE ".claude"
$configDir = Join-Path $env:USERPROFILE ".cc-footprint"

# Runs a native command and returns all it printed, stderr included, as
# text. Under "Stop", Windows PowerShell 5.1 makes a terminating error of the
# first line a native command writes to a redirected stderr, so the command
# runs under "Continue"; $LASTEXITCODE says how it went.
function Invoke-Native([scriptblock]$Command) {
    $ErrorActionPreference = "Continue"
    & $Command 2>&1 | ForEach-Object { "$_" }
}


Write-Host ""
Write-Host "  cc-footprint - Uninstaller" -ForegroundColor Cyan
Write-Host "  ==========================" -ForegroundColor DarkGray
Write-Host ""

# ── Stop monitor ─────────────────────────────────────────────────
Write-Host "[1/6] Stopping monitor..." -ForegroundColor Yellow
$stopped = Stop-Monitor
if ($stopped -eq "stopped") {
    Write-Host "  Monitor stopped" -ForegroundColor Green
    # The tray helper leaves with it; give it a moment before its folder goes
    Start-Sleep -Seconds 1
} elseif ($stopped -like "stuck:*") {
    Write-Host "  WARNING: the monitor could not be stopped (started as administrator?) - end $($stopped.Substring(6)) on port 19823 yourself" -ForegroundColor Yellow
} elseif ($stopped -like "other:*") {
    Write-Host "  Port 19823 is held by $($stopped.Substring(6)), which is not cc-footprint - left alone" -ForegroundColor DarkGray
} else {
    Write-Host "  Monitor not running" -ForegroundColor DarkGray
}

# ── Remove startup shortcut ──────────────────────────────────────
Write-Host "[2/6] Removing startup shortcut..." -ForegroundColor Yellow
# Resolved as the installer resolves it (see install.ps1)
$ws = New-Object -ComObject WScript.Shell
$startup = $ws.SpecialFolders("Startup")
if (-not $startup) { $startup = [Environment]::GetFolderPath("Startup") }
if (-not $startup) { $startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup" }
$shortcutPath = Join-Path $startup "cc-footprint.lnk"
if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "  Removed cc-footprint.lnk" -ForegroundColor Green
} else {
    Write-Host "  No shortcut found" -ForegroundColor DarkGray
}

# ── Remove statusline config ────────────────────────────────────
Write-Host "[3/6] Removing statusline config..." -ForegroundColor Yellow

# Only what is ours; a statusline the person set up is left alone. Node
# decides, as it did on install (scripts/statusline-file.js); without node
# the file is left, as the setting that runs it is (below).
$statuslineFile = Join-Path $claudeDir "statusline.sh"
$hasNode = [bool](Get-Command node -ErrorAction SilentlyContinue)
if ($hasNode) {
    $removed = Invoke-Node (Join-Path $scriptDir "scripts\statusline-file.js") remove $statuslineFile
    if ($removed -eq "removed") { Write-Host "  Removed statusline.sh" -ForegroundColor Green }
    elseif ($removed -eq "not-ours") { Write-Host "  statusline.sh is not ours - left untouched" -ForegroundColor DarkGray }
} else {
    Write-Host "  node not found - statusline.sh and the statusLine setting are left as they are" -ForegroundColor Yellow
}

# Node edits the JSON so key order and formatting survive
$settingsFile = Join-Path $claudeDir "settings.json"
if ($hasNode -and (Test-Path $settingsFile)) {
    $result = Invoke-Node (Join-Path $scriptDir "scripts\statusline-setting.js") unset $settingsFile ($statuslineFile -replace '\\', '/')
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  WARNING: could not read $settingsFile - left untouched" -ForegroundColor Yellow
    } elseif ($result -eq "removed") {
        Write-Host "  Removed statusLine from settings.json" -ForegroundColor Green
    }
    if (Test-Path "$settingsFile.bak") {
        Write-Host "  Your statusLine from before install is in settings.json.bak" -ForegroundColor DarkGray
    }
}
if (Test-Path "$statuslineFile.bak") {
    Write-Host "  Your statusline.sh from before install is in statusline.sh.bak" -ForegroundColor DarkGray
}

# ── Remove global optimizations ─────────────────────────────────
# Applied by hand, following the README; the files carry our markers.
Write-Host "[4/6] Removing global optimizations..." -ForegroundColor Yellow

$agentFile = Join-Path $claudeDir "agents\browser.md"
if ((Test-Path $agentFile) -and
    [IO.File]::ReadAllText($agentFile) -match "<!-- installed by cc-footprint -->") {
    Remove-Item $agentFile -Force
    Write-Host "  Removed browser.md" -ForegroundColor Green
}

$claudeMd = Join-Path $claudeDir "CLAUDE.md"
if ($hasNode -and (Test-Path $claudeMd)) {
    $result = Invoke-Node (Join-Path $scriptDir "scripts\remove-global-rule.js") $claudeMd
    if ($result -eq "removed") {
        Write-Host "  Removed browser rule from CLAUDE.md" -ForegroundColor Green
    }
}

# ── Remove config dir ────────────────────────────────────────────
Write-Host "[5/6] Removing config..." -ForegroundColor Yellow
if (Test-Path $configDir) {
    # A file still in use (the tray helper not yet gone) leaves the folder;
    # the steps after this one still run
    try {
        Remove-Item $configDir -Recurse -Force -ErrorAction Stop
        Write-Host "  Removed $configDir" -ForegroundColor Green
    } catch {
        Write-Host "  WARNING: could not remove all of $configDir ($($_.Exception.Message)) - delete it by hand" -ForegroundColor Yellow
    }
} else {
    Write-Host "  No config dir found" -ForegroundColor DarkGray
}

# The statusline's note that the monitor was down; earlier versions also
# kept a memory cache per session beside it. It writes to /tmp, which under
# Git Bash is %TEMP%
$caches = @(Get-ChildItem (Join-Path $env:TEMP "claude-sl-*") -ErrorAction SilentlyContinue)
if ($caches) {
    $caches | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Host "  Removed $($caches.Count) statusline temporary file(s)" -ForegroundColor Green
}

# ── Remove the Claude Code plugin ────────────────────────────────
Write-Host "[6/6] Removing the Claude Code plugin..." -ForegroundColor Yellow
if (Get-Command claude -ErrorAction SilentlyContinue) {
    $out = Invoke-Native { claude plugin uninstall cc-footprint@cc-footprint }
    if ($LASTEXITCODE -eq 0) { Write-Host "  Plugin removed" -ForegroundColor Green }
    else { Write-Host "  Plugin was not installed" -ForegroundColor DarkGray }
    $out = Invoke-Native { claude plugin marketplace remove cc-footprint }
    if ($LASTEXITCODE -eq 0) { Write-Host "  Marketplace entry removed" -ForegroundColor Green }
} else {
    Write-Host "  claude command not found - if the plugin is installed, remove it with:" -ForegroundColor DarkGray
    Write-Host "    claude plugin uninstall cc-footprint@cc-footprint" -ForegroundColor DarkGray
}
# Claude Code keeps a copy of every installed version under its cache, keyed
# by marketplace name; uninstalling does not drop them
$pluginCache = Join-Path $claudeDir "plugins\cache\cc-footprint"
if (Test-Path $pluginCache) {
    Remove-Item $pluginCache -Recurse -Force
    Write-Host "  Removed the plugin cache" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Uninstall complete!" -ForegroundColor Green
Write-Host "  Note: The project files remain in this directory. Delete manually if no longer needed." -ForegroundColor DarkGray
Write-Host ""
# Without this the script's exit code is that of the last external command,
# e.g. a "marketplace remove" of an entry that was not there
exit 0
