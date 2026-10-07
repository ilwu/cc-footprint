'use strict';

// ── Windows collector ────────────────────────────────────────────────
// wmic is gone on Windows 11 24H2+, so the process table comes from one
// PowerShell/CIM call per interval. System memory comes from Node's os
// module (no spawn at all).
//
// The script only lists processes; proctree.js adds up each session's tree.
//
// Script output, one record per line:
//   T,<now>                                       the script's clock, ms
//   P,<pid>,<ppid>,<workingSet>,<born>,<name>     every process
//   M,<pid>,<command line>                        the processes whose command
//                                                 line names an MCP server
//   W,<pid>,<cols>                                a claude.exe's terminal width

const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mcp = require('./mcp');

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
}
"@
$procs = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine,CreationDate
$parent = @{}
foreach ($p in $procs) { $parent[[int]$p.ProcessId] = [int]$p.ParentProcessId }

# Walk up the parent chain until a process with a window (the terminal host)
function GW($s) {
  $p = $s
  for ($i = 0; $i -lt 10; $i++) {
    $pr = Get-Process -Id $p
    if ($pr -and $pr.MainWindowHandle -ne [IntPtr]::Zero) {
      $r = New-Object W32+RECT
      [W32]::GetWindowRect($pr.MainWindowHandle, [ref]$r) | Out-Null
      return [math]::Floor(($r.R - $r.L) / 8)
    }
    $p = $parent[[int]$p]
    if (-not $p) { return 0 }
  }
  return 0
}

"T,$([int64]([DateTime]::UtcNow.ToFileTimeUtc() / 10000))"
foreach ($p in $procs) {
  $born = 0
  if ($p.CreationDate) { $born = [int64]($p.CreationDate.ToFileTimeUtc() / 10000) }
  "P,$($p.ProcessId),$($p.ParentProcessId),$($p.WorkingSetSize),$born,$($p.Name)"
  if ($p.CommandLine -match '${mcp.MCP.source}') { "M,$($p.ProcessId),$($p.CommandLine -replace '[\\r\\n]', ' ')" }
  if ($p.Name -eq 'claude.exe') { "W,$($p.ProcessId),$(GW $p.ProcessId)" }
}
`.trim();

let scriptFile = null;

// Writes the script where PowerShell can run it from
function prepare(configDir) {
  scriptFile = path.join(configDir, 'collect.ps1');
  try {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(scriptFile, SCRIPT);
  } catch {}
}

// The script's records -> { table, clock, cols }
function parseOutput(stdout) {
  const table = [];
  const cols = new Map();
  const servers = new Map(); // pid -> the MCP server's short name
  let clock = 0;

  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(',');
    if (parts[0] === 'P' && parts.length >= 6) {
      const pid = parseInt(parts[1]), mem = parseInt(parts[3]);
      if (isNaN(pid) || isNaN(mem)) continue;
      table.push({
        pid, ppid: parseInt(parts[2]) || 0, mem, born: parseInt(parts[4]) || 0,
        name: parts.slice(5).join(','), mcp: null,
      });
    } else if (parts[0] === 'M' && parts.length >= 3) {
      servers.set(parseInt(parts[1]), mcp.label(parts.slice(2).join(',')) || null);
    } else if (parts[0] === 'W' && parts.length >= 3) {
      const pid = parseInt(parts[1]), width = parseInt(parts[2]);
      if (width > 0) cols.set(pid, width);
    } else if (parts[0] === 'T') {
      clock = parseInt(parts[1]) || 0;
    }
  }
  for (const p of table) {
    if (servers.has(p.pid)) p.mcp = servers.get(p.pid);
  }
  return { table, clock, cols };
}

// done(err, { table, clock, cols, systemPct }); see collectors/index.js
function collect(sessionPids, done) {
  const systemPct = Math.round((1 - os.freemem() / os.totalmem()) * 100);
  exec(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptFile}"`,
    { timeout: 15000, windowsHide: true },
    (err, stdout) => {
      if (err) return done(err);
      done(null, { ...parseOutput(stdout), systemPct });
    }
  );
}

module.exports = { prepare, collect, parseOutput };
