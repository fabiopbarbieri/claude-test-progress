# Shared helpers for the Windows benchmarks (bench-windows.ps1, bench-sessions.ps1,
# bench-heavy.ps1). Dot-source it; it runs on Windows PowerShell 5.1 and PowerShell 7.

if (-not ('TestProgressBench.Cpu' -as [type])) {
    Add-Type -Namespace TestProgressBench -Name Cpu -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
'@
}

# Machine-wide CPU counters; kernel time includes idle time.
function Get-MachineTimes {
    $idle = 0L; $kernel = 0L; $user = 0L
    $null = [TestProgressBench.Cpu]::GetSystemTimes([ref]$idle, [ref]$kernel, [ref]$user)
    [pscustomobject]@{ idle = $idle; kernel = $kernel; user = $user }
}

# Percent of all logical CPUs busy between two Get-MachineTimes readings.
function Get-BusyPercent($Before, $After) {
    $total = ($After.kernel - $Before.kernel) + ($After.user - $Before.user)
    [Math]::Round(100.0 * ($total - ($After.idle - $Before.idle)) / [Math]::Max([long]1, $total), 1)
}

# Percent of all logical CPUs busy while $Body runs.
function Measure-Cpu([scriptblock] $Body) {
    $before = Get-MachineTimes
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $value = & $Body
    $watch.Stop()
    [pscustomobject]@{ cpuPct = (Get-BusyPercent $before (Get-MachineTimes))
        seconds = [Math]::Round($watch.Elapsed.TotalSeconds, 1); value = $value }
}

# Runs a native command that prints one JSON envelope; returns its time, data and outcome.
function Invoke-Timed([string] $Exe, [string[]] $Arguments, [switch] $AllowFailure) {
    # Under Stop, Windows PowerShell 5.1 turns a native stderr line into a terminating error.
    $ErrorActionPreference = 'Continue'
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $out = & $Exe @Arguments 2>&1
    $watch.Stop()
    $text = ($out | Where-Object { $_ -is [string] }) -join "`n"
    $data = $null
    try { $data = $text | ConvertFrom-Json } catch { }
    $ok = $LASTEXITCODE -eq 0 -and $data -and $data.ok
    $errors = ($out | Where-Object { $_ -isnot [string] } | ForEach-Object { $_.ToString() }) -join ' '
    if (-not $ok -and -not $AllowFailure) {
        $detail = (($out | Out-String).Trim() -replace '\s+', ' ')
        throw ('Call failed (exit ' + $LASTEXITCODE + '): ' + $detail.Substring(0, [Math]::Min(400, $detail.Length)))
    }
    [pscustomobject]@{ ms = $watch.Elapsed.TotalMilliseconds; data = $data; ok = [bool]$ok
        error = $(if ($ok) { $null } else { $errors.Substring(0, [Math]::Min(300, $errors.Length)) }) }
}

# Cold sample plus min/p50/p95/max of the warm ones, in ms.
function Get-Stats($Samples) {
    $warm = @($Samples | Select-Object -Skip 1 | Sort-Object)
    if (-not $warm.Count) { $warm = @($Samples | ForEach-Object { $_ }) }
    $pick = { param($q) $warm[[Math]::Min($warm.Count - 1, [Math]::Max(0, [int][Math]::Ceiling($q * $warm.Count) - 1))] }
    [ordered]@{
        coldMs = [Math]::Round($Samples[0]); minMs = [Math]::Round($warm[0]); p50Ms = [Math]::Round((& $pick 0.5))
        p95Ms = [Math]::Round((& $pick 0.95)); maxMs = [Math]::Round($warm[-1])
    }
}

# Machine description recorded with every report.
function Get-MachineInfo([string] $Root, [string] $Node) {
    # Native stderr must not stop the report (Windows PowerShell 5.1 under Stop).
    $ErrorActionPreference = 'Continue'
    $revision = $null
    try { $revision = (& git -C $Root rev-parse --short HEAD 2>$null) } catch { }
    # A copied checkout without .git names its revision in this file.
    $marker = Join-Path $Root '.bench-revision'
    if (-not $revision -and (Test-Path -LiteralPath $marker)) { $revision = (Get-Content -LiteralPath $marker -Raw).Trim() }
    $os = Get-CimInstance Win32_OperatingSystem
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $defender = $null
    try { $status = Get-MpComputerStatus -ErrorAction Stop; $defender = [ordered]@{ realTime = $status.RealTimeProtectionEnabled; mode = [string]$status.AMRunningMode } } catch { }
    $plan = $null
    try { $plan = ((& powercfg.exe /getactivescheme 2>$null) -join ' ').Trim() } catch { }
    [ordered]@{
        date = (Get-Date).ToString('s'); revision = $revision
        os = $os.Caption + ' ' + $os.BuildNumber; cpu = $cpu.Name.Trim(); logicalCpus = [Environment]::ProcessorCount
        ramGb = [Math]::Round($os.TotalVisibleMemorySize / 1MB, 1); freeRamGb = [Math]::Round($os.FreePhysicalMemory / 1MB, 1)
        node = $(if ($Node) { (& $Node --version) } else { $null }); host = $PSVersionTable.PSVersion.ToString()
        executionPolicy = (Get-ExecutionPolicy).ToString(); defender = $defender; powerPlan = $plan
        admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
}

# Writes text as UTF-8 without BOM on both engines.
function Write-Utf8([string] $Path, [string] $Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding -ArgumentList $false))
}
