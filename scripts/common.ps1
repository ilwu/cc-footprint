# What install.ps1 and uninstall.ps1 share, dot-sourced by both (ASCII only:
# Windows PowerShell 5.1 reads it in the system code page).

# Stops the cc-footprint monitor on port 19823, and nothing else.
#
# Ours is the one that answers on the port as the monitor does (/config with
# its list of items): whatever its command line says (`node app.js` run from
# monitor/, a path that moved) and even when that cannot be read (a process
# run elevated). Returns "none", "stopped", or "other:<name>" for another
# program, which is left alone.

function Stop-Monitor {
    $owners = @(Get-NetTCPConnection -LocalPort 19823 -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -ne 0 } | Select-Object -ExpandProperty OwningProcess -Unique)
    if (-not $owners) { return "none" }
    $ours = $false
    try {
        $answer = Invoke-RestMethod -Uri "http://127.0.0.1:19823/config" -TimeoutSec 3
        $ours = $null -ne $answer.items -and $null -ne $answer.display
    } catch {}
    foreach ($id in $owners) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        # Gone between the two looks: nothing left to stop
        if (-not $p) { continue }
        if (-not $ours) { return "other:$($p.ProcessName)" }
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
    return "stopped"
}

# Runs node and reads what it prints as UTF-8: Windows PowerShell 5.1 would
# read it in the system code page and garble a path that is not ASCII.
# $LASTEXITCODE is node's.
function Invoke-Node {
    $previous = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        & node @args
    } finally {
        [Console]::OutputEncoding = $previous
    }
}
