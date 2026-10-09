[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $NodePath,
    [ValidateRange(3, 500)][int] $Iterations = 20,
    [ValidateRange(0, 99)][int] $Modules = 0,
    [switch] $Start,
    [ValidateRange(5, 600)][int] $WindowSeconds = 30,
    [string] $Output
)
# Times the Mod's polling query (status) on native Windows: PowerShell bootstrap
# versus direct Node, for each control engine, with $Modules configured modules.
# -Start also times start all, status with every job active and cancel all (direct
# path, as the Mod uses after its first bootstrap) plus machine CPU over four windows:
# nothing running, jobs active without polling, jobs active polled every second as the
# Mod did before its watcher, and the same jobs streamed by one `watch` collector.
# CPU comes from GetSystemTimes, so short PowerShell control calls are counted too. The first status call of each variant is reported apart as cold. Results are relative to this machine; they are not acceptance.
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This benchmark requires native Windows.'
}
if ($Start -and $Modules -lt 1) { throw '-Start requires -Modules 1 or more.' }
$root = Split-Path -Parent $PSScriptRoot
$node = (Resolve-Path -LiteralPath $NodePath).ProviderPath
$ps51 = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$pwsh = Get-Command pwsh.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$engines = [ordered]@{ '5.1' = $ps51 }
if ($pwsh) { $engines['7'] = $pwsh.Source } else { Write-Warning 'pwsh.exe not found; PowerShell 7 skipped.' }
$cli = Join-Path $root 'runner\cli.mjs'
$workspaces = New-Object Collections.Generic.List[string]

. (Join-Path $PSScriptRoot 'bench\common.ps1')

# Live processes split into collector (runner, native helper brokers, control scripts and
# the consoles they own) and the test commands; private memory is what each one adds.
function Get-ProcessInventory {
    $all = @(Get-CimInstance Win32_Process)
    $byId = @{}
    foreach ($proc in $all) { $byId[[int]$proc.ProcessId] = $proc }
    $groups = [ordered]@{ collector = @(); test = @() }
    $collector = @{}
    foreach ($proc in $all) {
        if ($proc.ProcessId -eq $PID -or -not $proc.CommandLine) { continue }
        if ($proc.CommandLine -like '*900000*') { $groups.test += $proc }
        elseif ($proc.CommandLine -like ('*' + $root + '*') -or $proc.Name -like 'helper-*.exe') {
            $groups.collector += $proc; $collector[[int]$proc.ProcessId] = $true
        }
    }
    foreach ($proc in $all) {
        if ($proc.Name -eq 'conhost.exe' -and $collector.ContainsKey([int]$proc.ParentProcessId)) { $groups.collector += $proc }
    }
    $summary = [ordered]@{}
    foreach ($group in $groups.GetEnumerator()) {
        $summary[$group.Key] = [ordered]@{ count = $group.Value.Count
            workingSetMb = [Math]::Round((($group.Value | Measure-Object WorkingSetSize -Sum).Sum) / 1MB, 1)
            privateMb = [Math]::Round((($group.Value | Measure-Object PrivatePageCount -Sum).Sum) / 1MB, 1)
            processes = @($group.Value | Group-Object Name | ForEach-Object { $_.Name + ' x' + $_.Count }) }
    }
    $summary
}

function New-Workspace {
    $dir = Join-Path ([IO.Path]::GetTempPath()) ('tp-bench-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $null = New-Item -ItemType Directory -Path (Join-Path $dir '.claude')
    $workspaces.Add($dir)
    if ($Modules -gt 0) {
        # Exit-adapter jobs that only wait; cancel all ends them.
        $set = [ordered]@{}
        for ($m = 1; $m -le $Modules; $m++) {
            $set[('m{0:D2}' -f $m)] = [ordered]@{
                label = ('Bench {0:D2}' -f $m); adapter = 'exit'
                command = @($node, '-e', 'setTimeout(function () {}, 900000)')
            }
        }
        $json = [ordered]@{ schemaVersion = 1; modules = $set } | ConvertTo-Json -Depth 5
        [IO.File]::WriteAllText((Join-Path $dir '.claude\test-progress.json'), $json, (New-Object Text.UTF8Encoding -ArgumentList $false))
    }
    $dir
}

function Measure-Status([string] $Exe, [string[]] $Arguments) {
    $samples = New-Object Collections.Generic.List[double]
    for ($i = 0; $i -le $Iterations; $i++) { $samples.Add((Invoke-Timed $Exe $Arguments).ms) }
    Get-Stats $samples
}

function Get-ActiveCount($Data) {
    @($Data.jobs.PSObject.Properties | Where-Object { $_.Value.status -in @('preparing', 'running', 'cancelling') }).Count
}

$previous = [Environment]::GetEnvironmentVariable('TEST_PROGRESS_POWERSHELL', 'Process')
$results = New-Object Collections.Generic.List[object]
$owner = 'bench-' + $PID
try {
    foreach ($engine in $engines.GetEnumerator()) {
        # The collector's own control calls use this engine in both paths.
        $env:TEST_PROGRESS_POWERSHELL = $engine.Value
        $idle = New-Workspace
        $bootstrap = @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $root 'scripts\run-collector.ps1'),
            '-Action', 'status', '-Cwd', $idle, '-Owner', $owner, '-Module', 'all')
        $direct = @($cli, 'status', '--cwd', $idle, '--owner', $owner, '--module', 'all')
        foreach ($variant in @(@('bootstrap', $engine.Value, $bootstrap), @('direct', $node, $direct))) {
            Write-Host ('Measuring idle status ' + $variant[0] + ' / PowerShell ' + $engine.Key + ' ...')
            $stats = Measure-Status $variant[1] $variant[2]
            $results.Add([pscustomobject](@{ scenario = 'idle-status'; path = $variant[0]; engine = $engine.Key } + $stats))
        }
        if (-not $Start) { continue }

        $busy = New-Workspace
        $argv = { param($action, $id = 'all') @($cli, $action, '--cwd', $busy, '--owner', $owner, '--module', $id) }
        Write-Host ('Measuring baseline CPU (' + $WindowSeconds + ' s) ...')
        $base = Measure-Cpu { Start-Sleep -Seconds $WindowSeconds }
        $results.Add([pscustomobject]@{ scenario = 'cpu-baseline'; engine = $engine.Key; cpuPct = $base.cpuPct; seconds = $base.seconds })
        Write-Host ('Measuring start all / PowerShell ' + $engine.Key + ' ...')
        $started = Invoke-Timed $node (& $argv 'start') -AllowFailure
        $results.Add([pscustomobject]@{ scenario = 'start-all'; path = 'direct'; engine = $engine.Key; ok = $started.ok
            ms = [Math]::Round($started.ms); active = $(if ($started.data) { Get-ActiveCount $started.data } else { 0 }); error = $started.error })
        try {
            # A refused batch starts nothing; start each module alone, as from the panel, to get every job active.
            $single = New-Object Collections.Generic.List[double]
            for ($m = 1; $m -le $Modules -and -not $started.ok; $m++) {
                $one = Invoke-Timed $node (& $argv 'start' ('m{0:D2}' -f $m)) -AllowFailure
                $single.Add($one.ms)
                if (-not $one.ok) { Write-Warning ('start m{0:D2} failed: {1}' -f $m, $one.error) }
            }
            if ($single.Count) {
                $active = Get-ActiveCount (Invoke-Timed $node (& $argv 'status')).data
                $results.Add([pscustomobject]@{ scenario = 'start-each'; path = 'direct'; engine = $engine.Key; active = $active
                    p50Ms = [Math]::Round(($single | Sort-Object)[[int][Math]::Floor(($single.Count - 1) / 2)]); maxMs = [Math]::Round(($single | Measure-Object -Maximum).Maximum)
                    ms = [Math]::Round(($single | Measure-Object -Sum).Sum) })
            }
            Write-Host ('Measuring CPU with jobs active, no polling (' + $WindowSeconds + ' s) ...')
            $quiet = Measure-Cpu { Start-Sleep -Seconds $WindowSeconds; Get-ProcessInventory }
            $results.Add([pscustomobject]@{ scenario = 'cpu-active-quiet'; engine = $engine.Key; cpuPct = $quiet.cpuPct
                seconds = $quiet.seconds; processes = $quiet.value })
            Write-Host ('Measuring active status polled every second / PowerShell ' + $engine.Key + ' ...')
            $samples = New-Object Collections.Generic.List[double]
            $script:activeMin = $Modules
            $polled = Measure-Cpu {
                for ($i = 0; $i -le $Iterations; $i++) {
                    $call = Invoke-Timed $node (& $argv 'status')
                    $samples.Add($call.ms)
                    $script:activeMin = [Math]::Min($script:activeMin, (Get-ActiveCount $call.data))
                    # The Mod's 1 s timer skips ticks while a query is pending.
                    if ($call.ms -lt 1000) { Start-Sleep -Milliseconds (1000 - [int]$call.ms) }
                }
            }
            $results.Add([pscustomobject](@{ scenario = 'active-status'; path = 'direct'; engine = $engine.Key
                activeMin = $script:activeMin; cpuPct = $polled.cpuPct; seconds = $polled.seconds } + (Get-Stats $samples)))
            # The Mod's watcher instead: one collector streaming status for the same window.
            Write-Host ('Measuring active status streamed by one watcher (' + $WindowSeconds + ' s) ...')
            $stream = Join-Path ([IO.Path]::GetTempPath()) ('tp-bench-watch-' + [Guid]::NewGuid().ToString('N') + '.jsonl')
            # Same flag as the Mod's watcher (LONG_LIVED_NODE_FLAGS).
            $watcher = Start-Process -FilePath $node -ArgumentList @('--max-semi-space-size=1', ('"' + $cli + '"'), 'watch', '--cwd', ('"' + $busy + '"'), '--owner', $owner, '--module', 'all') `
                -RedirectStandardOutput $stream -WindowStyle Hidden -PassThru
            try {
                Start-Sleep -Seconds 2
                $streamed = Measure-Cpu { Start-Sleep -Seconds $WindowSeconds; Get-ProcessInventory }
            } finally {
                if (-not $watcher.HasExited) { $watcher.Kill() }
                $watcher.WaitForExit()
            }
            $lines = @(Get-Content -LiteralPath $stream | Where-Object { $_ }).Count
            Remove-Item -LiteralPath $stream -Force -ErrorAction SilentlyContinue
            $results.Add([pscustomobject]@{ scenario = 'active-watch'; path = 'watch'; engine = $engine.Key
                cpuPct = $streamed.cpuPct; seconds = $streamed.seconds; lines = $lines; processes = $streamed.value })
        } finally {
            Write-Host ('Measuring cancel all / PowerShell ' + $engine.Key + ' ...')
            $cancelled = Invoke-Timed $node (& $argv 'cancel')
            $settle = [Diagnostics.Stopwatch]::StartNew()
            $left = Get-ActiveCount $cancelled.data
            while ($left -gt 0 -and $settle.Elapsed.TotalSeconds -lt 120) {
                Start-Sleep -Milliseconds 500
                $left = Get-ActiveCount (Invoke-Timed $node (& $argv 'status')).data
            }
            $results.Add([pscustomobject]@{ scenario = 'cancel-all'; path = 'direct'; engine = $engine.Key
                ms = [Math]::Round($cancelled.ms); settleMs = [Math]::Round($settle.Elapsed.TotalMilliseconds); activeLeft = $left })
        }
    }
} finally {
    [Environment]::SetEnvironmentVariable('TEST_PROGRESS_POWERSHELL', $previous, 'Process')
    foreach ($dir in $workspaces) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
}

$results | Format-Table scenario, path, engine, ok, coldMs, p50Ms, p95Ms, maxMs, ms, active, activeMin, cpuPct, seconds, lines, settleMs, activeLeft -AutoSize | Out-String -Width 200 | Write-Host
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$sha = (& git -C $root rev-parse --short HEAD 2>$null)
$report = [ordered]@{
    date = (Get-Date).ToString('s'); revision = $sha; iterations = $Iterations; modules = $Modules
    os = $os.Caption + ' ' + $os.BuildNumber; cpu = $cpu.Name.Trim(); logicalCpus = [Environment]::ProcessorCount
    ramGb = [Math]::Round($os.TotalVisibleMemorySize / 1MB, 1); node = (& $node --version)
    host = $PSVersionTable.PSVersion.ToString(); executionPolicy = (Get-ExecutionPolicy).ToString()
    limits = [ordered]@{ modStatusMs = 15000; modStartMs = 60000; batchPreparationMs = 30000 }; results = $results
}
$json = $report | ConvertTo-Json -Depth 6
if ($Output) { [IO.File]::WriteAllText($Output, $json, (New-Object Text.UTF8Encoding -ArgumentList $false)) }
$json
