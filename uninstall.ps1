#Requires -Version 5.1
<#
.SYNOPSIS
    Uninstaller for cc-footprint.
#>

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$claudeDir = Join-Path $env:USERPROFILE ".claude"
$configDir = Join-Path $env:USERPROFILE ".cc-footprint"

Write-Host ""
Write-Host "  cc-footprint - Uninstaller" -ForegroundColor Cyan
Write-Host "  ==========================" -ForegroundColor DarkGray
Write-Host ""

# ── Stop monitor ─────────────────────────────────────────────────
Write-Host "[1/6] Stopping monitor..." -ForegroundColor Yellow
$port = Get-NetTCPConnection -LocalPort 19823 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 0 }
if ($port) {
    $port | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Write-Host "  Monitor stopped" -ForegroundColor Green
} else {
    Write-Host "  Monitor not running" -ForegroundColor DarkGray
}

# ── Remove startup shortcut ──────────────────────────────────────
Write-Host "[2/6] Removing startup shortcut..." -ForegroundColor Yellow
$ws = New-Object -ComObject WScript.Shell
$startup = $ws.SpecialFolders("Startup")
$shortcutPath = Join-Path $startup "cc-footprint.lnk"
if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "  Removed cc-footprint.lnk" -ForegroundColor Green
} else {
    Write-Host "  No shortcut found" -ForegroundColor DarkGray
}

# ── Remove statusline config ────────────────────────────────────
Write-Host "[3/6] Removing statusline config..." -ForegroundColor Yellow

# Only remove what is ours; a statusline the user set up is left alone
$statuslineFile = Join-Path $claudeDir "statusline.sh"
if (Test-Path $statuslineFile) {
    $head = (Get-Content $statuslineFile -TotalCount 5 -Encoding UTF8) -join "`n"
    if ($head.Contains("cc-footprint")) {
        Remove-Item $statuslineFile -Force
        Write-Host "  Removed statusline.sh" -ForegroundColor Green
    } else {
        Write-Host "  statusline.sh is not ours - left untouched" -ForegroundColor DarkGray
    }
}

# Node edits the JSON so key order and formatting survive
$settingsFile = Join-Path $claudeDir "settings.json"
if (Test-Path $settingsFile) {
    $statuslineCmd = "bash " + ($statuslineFile -replace '\\', '/')
    $result = node (Join-Path $scriptDir "scripts\statusline-setting.js") unset $settingsFile $statuslineCmd
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  WARNING: could not read $settingsFile - left untouched" -ForegroundColor Yellow
    } elseif ($result -eq "removed") {
        Write-Host "  Removed statusLine from settings.json" -ForegroundColor Green
    }
    if (Test-Path "$settingsFile.bak") {
        Write-Host "  Your statusLine from before install is in settings.json.bak" -ForegroundColor DarkGray
    }
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
if (Test-Path $claudeMd) {
    $md = [IO.File]::ReadAllText($claudeMd)
    $ruleStart = "<!-- cc-footprint:browser-agent:start -->"
    $ruleEnd = "<!-- cc-footprint:browser-agent:end -->"
    $s = $md.IndexOf($ruleStart)
    $e = $md.IndexOf($ruleEnd)
    if ($s -ge 0 -and $e -gt $s) {
        $md = ($md.Substring(0, $s).TrimEnd() + "`n`n" + $md.Substring($e + $ruleEnd.Length).TrimStart()).Trim()
        if ($md) {
            [IO.File]::WriteAllText($claudeMd, $md + "`n", (New-Object System.Text.UTF8Encoding($false)))
        } else {
            # The file held nothing but our rule
            Remove-Item $claudeMd -Force
        }
        Write-Host "  Removed browser rule from CLAUDE.md" -ForegroundColor Green
    }
}

# ── Remove config dir ────────────────────────────────────────────
Write-Host "[5/6] Removing config..." -ForegroundColor Yellow
if (Test-Path $configDir) {
    Remove-Item $configDir -Recurse -Force
    Write-Host "  Removed $configDir" -ForegroundColor Green
} else {
    Write-Host "  No config dir found" -ForegroundColor DarkGray
}

# Clean up temp caches
Remove-Item "/tmp/claude-sl-*" -Force -ErrorAction SilentlyContinue 2>$null

# ── Remove the Claude Code plugin ────────────────────────────────
Write-Host "[6/6] Removing the Claude Code plugin..." -ForegroundColor Yellow
if (Get-Command claude -ErrorAction SilentlyContinue) {
    $out = claude plugin uninstall cc-footprint@cc-footprint 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Host "  Plugin removed" -ForegroundColor Green }
    else { Write-Host "  Plugin was not installed" -ForegroundColor DarkGray }
    $out = claude plugin marketplace remove cc-footprint 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Host "  Marketplace entry removed" -ForegroundColor Green }
} else {
    Write-Host "  claude command not found - if the plugin is installed, remove it with:" -ForegroundColor DarkGray
    Write-Host "    claude plugin uninstall cc-footprint@cc-footprint" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Uninstall complete!" -ForegroundColor Green
Write-Host "  Note: The project files remain in this directory. Delete manually if no longer needed." -ForegroundColor DarkGray
Write-Host ""
