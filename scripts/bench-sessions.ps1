[CmdletBinding()]
param(
    [ValidateRange(10, 3600)][int] $WindowSeconds = 60,
    [string] $Label = 'window',
    [string] $Output
)
# Measures what the Claude Code sessions open on this machine spend on Test Progress
# monitoring during one window, for comparing two plugin versions or one session against
# two. Open the sessions first (for example two `claude --plugin-dir <checkout>` in the
# same project, one running tests and one only watching), then run this as Administrator:
# process start events need it.
#
# Reported per claude.exe: processes it started (Node, PowerShell, bash) counted from
# kernel start events, so short status queries are not missed; its own CPU; and the CPU
# and memory of the long-lived collector processes (watcher, coordinator, native helper
# brokers). A short process that starts and ends inside the window is counted, but its
# CPU is only in the machine total, which is noisy in a VM.
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This benchmark requires native Windows.' }
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator: process start events need it.' }

. (Join-Path $PSScriptRoot 'bench\common.ps1')

function Get-Snapshot {
    $all = @(Get-CimInstance Win32_Process)
    $sessions = @($all | Where-Object { $_.Name -eq 'claude.exe' })
    $collector = @($all | Where-Object { $_.Name -like 'helper-*.exe' -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'cli\.mjs|module-batch-worker\.mjs|worker\.mjs') })
    $byId = @{}
    foreach ($proc in $all) { $byId[[int]$proc.ProcessId] = $proc }
    $cpu = @{}
    foreach ($proc in $sessions + $collector) { $cpu[[int]$proc.ProcessId] = ([double]$proc.KernelModeTime + [double]$proc.UserModeTime) / 1e7 }
    [pscustomobject]@{ sessions = $sessions; collector = $collector; cpu = $cpu; byId = $byId }
}

$names = @('node.exe', 'powershell.exe', 'pwsh.exe', 'bash.exe', 'conhost.exe')
$starts = New-Object Collections.Generic.List[object]
$source = 'tp-bench-' + [Guid]::NewGuid().ToString('N')
Register-CimIndicationEvent -ClassName Win32_ProcessStartTrace -SourceIdentifier $source
$before = Get-Snapshot
$machineBefore = Get-MachineTimes
Write-Host ("Measuring '" + $Label + "' for " + $WindowSeconds + ' s with ' + $before.sessions.Count + ' claude.exe ...')
$deadline = [DateTime]::UtcNow.AddSeconds($WindowSeconds)
try {
    while ([DateTime]::UtcNow -lt $deadline) {
        $event = Wait-Event -SourceIdentifier $source -Timeout 1
        while ($event) {
            $trace = $event.SourceEventArgs.NewEvent
            if ($names -contains $trace.ProcessName) { $starts.Add([pscustomobject]@{ name = $trace.ProcessName; parent = [int]$trace.ParentProcessID }) }
            Remove-Event -EventIdentifier $event.EventIdentifier
            $event = Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue | Select-Object -First 1
        }
    }
} finally {
    Unregister-Event -SourceIdentifier $source -ErrorAction SilentlyContinue
    Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue | Remove-Event
}
$machineAfter = Get-MachineTimes
$after = Get-Snapshot
$delta = { param($id) $after.cpu[$id] - $(if ($before.cpu.ContainsKey($id)) { $before.cpu[$id] } else { 0 }) }

$sessionIds = @($before.sessions + $after.sessions | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
$sessions = foreach ($proc in $after.sessions) {
    $id = [int]$proc.ProcessId
    $mine = @($starts | Where-Object { $_.parent -eq $id -and $_.name -ne 'conhost.exe' })
    [ordered]@{ pid = $id; cpuSeconds = [Math]::Round((& $delta $id), 2)
        workingSetMb = [Math]::Round($proc.WorkingSetSize / 1MB, 1); privateMb = [Math]::Round($proc.PrivatePageCount / 1MB, 1)
        started = [ordered]@{ total = $mine.Count; byName = @($mine | Group-Object name | ForEach-Object { $_.Name + ' x' + $_.Count }) } }
}
$collectorCpu = 0.0
foreach ($proc in $after.collector) { $collectorCpu += & $delta ([int]$proc.ProcessId) }
$result = [ordered]@{
    label = $Label; seconds = $WindowSeconds; machineCpuPct = (Get-BusyPercent $machineBefore $machineAfter)
    sessions = @($sessions)
    collector = [ordered]@{ alive = $after.collector.Count; cpuSeconds = [Math]::Round($collectorCpu, 2)
        workingSetMb = [Math]::Round((($after.collector | Measure-Object WorkingSetSize -Sum).Sum) / 1MB, 1)
        privateMb = [Math]::Round((($after.collector | Measure-Object PrivatePageCount -Sum).Sum) / 1MB, 1)
        processes = @($after.collector | Group-Object Name | ForEach-Object { $_.Name + ' x' + $_.Count }) }
    startedElsewhere = @($starts | Where-Object { $_.name -ne 'conhost.exe' -and $sessionIds -notcontains $_.parent } |
        Group-Object name | ForEach-Object { $_.Name + ' x' + $_.Count })
}
$json = $result | ConvertTo-Json -Depth 6
if ($Output) { [IO.File]::WriteAllText($Output, $json, (New-Object Text.UTF8Encoding -ArgumentList $false)) }
$json
