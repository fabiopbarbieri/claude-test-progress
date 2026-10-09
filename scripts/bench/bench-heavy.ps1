[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Workspace,
    [string] $Checkout,
    [string[]] $Scenario = @('S1', 'S2'),
    [string[]] $Modules,
    [ValidateRange(1, 50)][int] $Repeat = 3,
    [ValidateSet('collector', 'raw', 'both')][string] $Mode = 'both',
    [string[]] $Entry = @('direct', 'ps51', 'pwsh', 'gitbash-ps51', 'gitbash-pwsh', 'gitbash-sh'),
    [ValidateRange(1, 200)][int] $Calls = 20,
    [string[]] $ReplayModules = @('1', '2', '4', '8'),
    [string] $ReplaySpeed = '1',
    [ValidateRange(0, 100000)][int] $EpermEvery = 0,
    [switch] $Diagnose,
    [ValidateRange(0, 3600)][int] $DefenderSeconds = 0,
    [ValidateRange(10, 3600)][int] $IdleSeconds = 60,
    [string] $Label = 'bench',
    [string] $Output,
    [ValidateRange(250, 30000)][int] $SampleMs = 1000,
    [ValidateRange(1, 240)][int] $TimeoutMinutes = 30,
    [string] $NodePath,
    [string[]] $AvNames = @('MsMpEng', 'MpDefenderCoreService', 'NisSrv', 'MsSense', 'SenseIR', 'SenseNdr', 'SenseCncProxy',
        'CSFalconService', 'SentinelAgent', 'SentinelServiceHost', 'cyserver', 'RepMgr', 'elastic-endpoint', 'TaniumClient')
)
# Heavy-suite benchmark of the Test Progress collector on native Windows.
#
# -Workspace is a folder with .claude\test-progress.json: the projects made by generate.mjs and
# provision.ps1 (their .claude\test-progress.template.json, manifest.json and env.json are used
# when present), or a real project. -Checkout is the collector under test (default: this one),
# so two checkouts alternated give an A/B; compare.mjs reads the JSON reports.
#
#   S0  machine idle for -IdleSeconds, the noise floor.
#   S1  each module alone, with the collector and without it (capture.mjs), -Repeat times.
#   S2  every selected module at once, with and without the collector.
#   S4  control calls (list, start, status, logs, cancel) through each -Entry shell path:
#       direct Node as the Mod does, PowerShell 5.1/7 as the run-tests skill does, and both
#       again from Git Bash as Claude Code's Bash tool runs them, plus run-collector.sh.
#   S5  replays of the captures from S1/S2 with 1, 2, 4, 8 modules at -ReplaySpeed (1 keeps the
#       suites' timing with almost no test CPU; max measures throughput).
#       -Diagnose adds fs counters, event loop delay and CPU profiles (replay only, so the
#       suites' own Node processes are never instrumented); -EpermEvery N injects rename EPERM.
#   S6  S2 with the collector -Repeat times in one session, watching growth and leftovers.
#
# CPU per process group comes from process handles held from the first sample to the end, so a
# process that exited still reports its whole CPU; processes living less than -SampleMs are
# missed, but an elevated session counts every process start per group. Defender and other
# EDR processes are measured through CIM. A run that fails a
# gate (counts differ from manifest.json, an unsafe final state, leftover processes, temp files
# or a log over 1 MiB in the state directory) is kept in the report with valid = false.
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This benchmark requires native Windows.' }
. (Join-Path $PSScriptRoot 'common.ps1')

# powershell -File passes `-Scenario S1,S2` as one string; lists accept commas either way.
function Split-List($Values, [string[]] $Allowed, [string] $Name) {
    $items = @($Values | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    foreach ($item in $items) { if ($Allowed -and $Allowed -notcontains $item) { throw ('Invalid ' + $Name + ': ' + $item) } }
    $items
}
$Scenario = Split-List $Scenario @('S0', 'S1', 'S2', 'S4', 'S5', 'S6') 'scenario'
$Entry = Split-List $Entry @('direct', 'ps51', 'pwsh', 'gitbash-ps51', 'gitbash-pwsh', 'gitbash-sh') 'entry'
$ReplayModules = @(Split-List $ReplayModules $null 'replay count' | ForEach-Object { [int]$_ })
if ($Modules) { $Modules = Split-List $Modules $null 'module' }
$AvNames = Split-List $AvNames $null 'AV name'

if (-not $Checkout) { $Checkout = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$Checkout = (Resolve-Path -LiteralPath $Checkout).ProviderPath
$Workspace = (Resolve-Path -LiteralPath $Workspace).ProviderPath
$cli = Join-Path $Checkout 'runner\cli.mjs'
if (-not (Test-Path -LiteralPath $cli)) { throw ('No collector at ' + $Checkout) }
# The tools come from this script's folder, so a checkout without them (main) can be measured.
$benchDir = $PSScriptRoot
$script:runnerKey = (Join-Path $Checkout 'runner\').ToLowerInvariant()
$script:benchKey = ($benchDir + '\').ToLowerInvariant()
$script:avKeys = @($AvNames | ForEach-Object { $_.ToLowerInvariant() })
$resultsDir = Join-Path $Workspace 'results'
$capturesDir = Join-Path $Workspace 'captures'
$null = New-Item -ItemType Directory -Force -Path $resultsDir, $capturesDir
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
if (-not $Output) { $Output = Join-Path $resultsDir ($Label + '-' + $stamp + '.json') }

# Tools from provision.ps1, for this process and every child it starts.
$envFile = Join-Path $Workspace 'env.json'
$tools = $null
if (Test-Path -LiteralPath $envFile) {
    $tools = Get-Content -LiteralPath $envFile -Raw | ConvertFrom-Json
    $prefix = @()
    if ($tools.javaHome) { $env:JAVA_HOME = $tools.javaHome; $prefix += (Join-Path $tools.javaHome 'bin') }
    if ($tools.mavenHome) { $env:MAVEN_HOME = $tools.mavenHome; $prefix += (Join-Path $tools.mavenHome 'bin') }
    if ($tools.chromeBin) { $env:CHROME_BIN = $tools.chromeBin }
    if ($prefix.Count) { $env:PATH = ($prefix -join ';') + ';' + $env:PATH }
}
# Over SSH there is no interactive desktop and Chrome's sandboxed network service crashes, so
# the generated karma.conf adds --no-sandbox; an interactive session keeps the sandbox.
$chromeNoSandbox = [bool]$env:SSH_CONNECTION
if ($chromeNoSandbox) { $env:TP_BENCH_CHROME_NO_SANDBOX = '1' }
if (-not $NodePath) {
    $found = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $found) { throw 'node.exe not found; pass -NodePath.' }
    $NodePath = $found.Source
}
$node = (Resolve-Path -LiteralPath $NodePath).ProviderPath
if ([int]((& $node --version) -replace '^v(\d+).*$', '$1') -lt 14) { throw 'The collector Node must be 14 or newer.' }

# The generated projects reference the adapters of the checkout under test.
$template = Join-Path $Workspace '.claude\test-progress.template.json'
$configPath = Join-Path $Workspace '.claude\test-progress.json'
$jsonText = { param($value) (ConvertTo-Json $value -Compress).Trim('"') }
if (Test-Path -LiteralPath $template) {
    $text = (Get-Content -LiteralPath $template -Raw).Replace('{{PLUGIN}}', (& $jsonText $Checkout)).Replace('{{OUT}}', (& $jsonText $Workspace))
    Write-Utf8 $configPath $text
}
if (-not (Test-Path -LiteralPath $configPath)) { throw ('No .claude\test-progress.json in ' + $Workspace) }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$configured = @($config.modules.PSObject.Properties | Where-Object { $_.Value.enabled -ne $false } | ForEach-Object { $_.Name })
if ($Modules) {
    $missing = @($Modules | Where-Object { $configured -notcontains $_ })
    if ($missing.Count) { throw ('Unknown modules: ' + ($missing -join ', ')) }
} else { $Modules = $configured }
$manifestFile = Join-Path $Workspace 'manifest.json'
$manifest = $null
if (Test-Path -LiteralPath $manifestFile) { $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json }
function Get-Expected([string] $Id) {
    if ($manifest -and $manifest.modules.PSObject.Properties[$Id]) { return $manifest.modules.$Id.expected }
    $null
}

# ---------------------------------------------------------------- processes
function Join-Arguments([string[]] $Values) {
    ($Values | ForEach-Object {
        if ($_ -match '[\s"]' -or $_ -eq '') { '"' + ($_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' } else { $_ }
    }) -join ' '
}

# Starts a process with stdout (and stderr) in files; the returned object keeps its handle.
function Start-Logged([string] $File, [string[]] $Arguments, [string] $Stdout) {
    $process = Start-Process -FilePath $File -ArgumentList (Join-Arguments $Arguments) -RedirectStandardOutput $Stdout `
        -RedirectStandardError ($Stdout + '.err') -WindowStyle Hidden -PassThru
    $null = $process.Handle
    $process
}

# Runs one collector call to completion; returns its time, its own CPU and the envelope.
function Invoke-Collector([string] $Action, [string] $Module, [string] $Cwd, [string] $Owner, [string] $Config) {
    $argv = @($cli, $Action, '--cwd', $Cwd, '--owner', $Owner, '--module', $Module)
    if ($Config) { $argv += @('--config', $Config) }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $node
    $info.Arguments = Join-Arguments $argv
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.CreateNoWindow = $true
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $process = [Diagnostics.Process]::Start($info)
    $errors = $process.StandardError.ReadToEndAsync()
    $text = $process.StandardOutput.ReadToEnd()
    $process.WaitForExit()
    $watch.Stop()
    $data = $null
    try { $data = $text | ConvertFrom-Json } catch { }
    [pscustomobject]@{ ms = [Math]::Round($watch.Elapsed.TotalMilliseconds); cpuMs = [Math]::Round($process.TotalProcessorTime.TotalMilliseconds)
        ok = ($process.ExitCode -eq 0 -and $data -and $data.ok); data = $data; error = $errors.Result.Trim() }
}

function Get-CimProcesses([int[]] $Ids) {
    $map = @{}
    for ($i = 0; $i -lt $Ids.Count; $i += 40) {
        $chunk = $Ids[$i..([Math]::Min($i + 39, $Ids.Count - 1))]
        $filter = ($chunk | ForEach-Object { 'ProcessId=' + $_ }) -join ' OR '
        foreach ($proc in @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction SilentlyContinue)) { $map[[int]$proc.ProcessId] = $proc }
    }
    $map
}

function Get-Group([string] $Name, [string] $CommandLine, [string] $ParentGroup, [int] $Id) {
    $key = $Name.ToLowerInvariant()
    if ($Id -eq $PID) { return 'sampler' }
    if ($script:avKeys -contains $key) { return 'av' }
    if ($key -like 'helper-*') { return 'collector' }
    if ($key -eq 'claude') { return 'mod' }
    if ($key -eq 'wmiprvse') { return 'wmi' }
    if ($CommandLine) {
        $line = $CommandLine.ToLowerInvariant()
        if ($line.Contains($script:benchKey)) {
            if ($line.Contains('replay.mjs')) { return 'tests' }
            return 'harness'
        }
        if ($line.Contains($script:runnerKey) -or $line.Contains('run-collector') -or $line.Contains('node-discovery')) { return 'collector' }
    }
    if ($ParentGroup -eq 'collector' -and $key -eq 'conhost') { return 'collector' }
    if (@('collector', 'harness', 'tests') -contains $ParentGroup) { return 'tests' }
    'other'
}

$script:measured = @('collector', 'tests', 'harness', 'mod', 'wmi', 'sampler')
# Elevated sessions also count every process started during a run, so short calls that the
# samples miss (helper queries, PowerShell bootstraps) still show up per group.
function Start-StartTrace {
    $script:startTrace = $null
    if (-not $machine.admin) { return }
    $script:startTrace = 'tp-bench-start-' + [Guid]::NewGuid().ToString('N')
    Register-CimIndicationEvent -ClassName Win32_ProcessStartTrace -SourceIdentifier $script:startTrace
}

function Stop-StartTrace {
    if (-not $script:startTrace) { return $null }
    $events = @(Get-Event -SourceIdentifier $script:startTrace -ErrorAction SilentlyContinue)
    Unregister-Event -SourceIdentifier $script:startTrace -ErrorAction SilentlyContinue
    $counts = [ordered]@{}
    foreach ($event in $events) {
        $trace = $event.SourceEventArgs.NewEvent
        $name = [IO.Path]::GetFileNameWithoutExtension([string]$trace.ProcessName)
        $own = $script:tracked[[int]$trace.ProcessID]
        $parent = $script:tracked[[int]$trace.ParentProcessID]
        $group = $(if ($own -and $own.name -eq $name) { $own.group } else { Get-Group $name '' $(if ($parent) { $parent.group } else { '' }) 0 })
        $key = $group + ':' + $name
        $counts[$key] = $(if ($counts.Contains($key)) { $counts[$key] } else { 0 }) + 1
        Remove-Event -EventIdentifier $event.EventIdentifier -ErrorAction SilentlyContinue
    }
    $script:startTrace = $null
    $counts
}

function Reset-Sampler {
    $script:tracked = @{}
    $script:retired = New-Object Collections.Generic.List[object]
    $script:memory = @{}
    $script:samples = 0
    $script:baseline = $true
    Invoke-Sample
    $script:baseline = $false
}

function Invoke-Sample {
    $all = [Diagnostics.Process]::GetProcesses()
    $new = @($all | Where-Object { -not $script:tracked.ContainsKey($_.Id) -or $script:tracked[$_.Id].name -ne $_.ProcessName })
    if ($new.Count) {
        $cims = Get-CimProcesses @($new | ForEach-Object { $_.Id })
        # Parents before children, so a child inherits its parent's group.
        foreach ($proc in @($new | Sort-Object { $(if ($cims.ContainsKey($_.Id)) { $cims[$_.Id].CreationDate } else { [datetime]::MaxValue }) })) {
            if ($script:tracked.ContainsKey($proc.Id)) { $script:retired.Add($script:tracked[$proc.Id]) }
            $cim = $cims[$proc.Id]
            $parent = $(if ($cim) { [int]$cim.ParentProcessId } else { 0 })
            $parentGroup = $(if ($script:tracked.ContainsKey($parent)) { $script:tracked[$parent].group } else { '' })
            $group = Get-Group $proc.ProcessName $(if ($cim) { $cim.CommandLine } else { '' }) $parentGroup $proc.Id
            $entry = [pscustomobject]@{ id = $proc.Id; name = $proc.ProcessName; group = $group; parent = $parent; process = $null; cpu0 = 0.0; cpu = 0.0; baseline = $script:baseline }
            if ($script:measured -contains $group) {
                try {
                    $null = $proc.Handle
                    $entry.process = $proc
                    if ($script:baseline) { $entry.cpu0 = $proc.TotalProcessorTime.TotalSeconds }
                } catch { }
            }
            $script:tracked[$proc.Id] = $entry
        }
    }
    $sum = @{}
    foreach ($proc in $all) {
        $entry = $script:tracked[$proc.Id]
        if (-not $entry) { continue }
        if (-not $sum.ContainsKey($entry.group)) { $sum[$entry.group] = @{ ws = 0L; priv = 0L; count = 0 } }
        $sum[$entry.group].ws += $proc.WorkingSet64
        $sum[$entry.group].priv += $proc.PrivateMemorySize64
        $sum[$entry.group].count += 1
    }
    foreach ($group in $sum.Keys) {
        if (-not $script:memory.ContainsKey($group)) { $script:memory[$group] = @{ wsSum = 0.0; wsPeak = 0L; privPeak = 0L; countPeak = 0; n = 0 } }
        $slot = $script:memory[$group]
        $slot.wsSum += $sum[$group].ws; $slot.n += 1
        $slot.wsPeak = [Math]::Max($slot.wsPeak, $sum[$group].ws)
        $slot.privPeak = [Math]::Max($slot.privPeak, $sum[$group].priv)
        $slot.countPeak = [Math]::Max($slot.countPeak, $sum[$group].count)
    }
    $script:samples += 1
}

function Get-AvCpu {
    $filter = ($AvNames | ForEach-Object { "Name='" + $_ + ".exe'" }) -join ' OR '
    $total = 0.0
    foreach ($proc in @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction SilentlyContinue)) {
        $total += ([double]$proc.KernelModeTime + [double]$proc.UserModeTime) / 1e7
    }
    $total
}

# CPU seconds per group since Reset-Sampler, plus the memory seen by the samples.
function Get-Groups([double] $AvSeconds) {
    $cpu = @{}
    # @() over an empty generic List throws in Windows PowerShell 5.1; ToArray does not.
    foreach ($entry in @($script:tracked.Values) + $script:retired.ToArray()) {
        if (-not $entry.process) { continue }
        try { $entry.cpu = $entry.process.TotalProcessorTime.TotalSeconds } catch { }
        $cpu[$entry.group] = $(if ($cpu.ContainsKey($entry.group)) { $cpu[$entry.group] } else { 0.0 }) + [Math]::Max(0.0, $entry.cpu - $entry.cpu0)
    }
    $groups = [ordered]@{}
    foreach ($group in @('collector', 'mod', 'tests', 'harness', 'av', 'wmi', 'sampler', 'other')) {
        $slot = $script:memory[$group]
        $groups[$group] = [ordered]@{
            cpuS = $(if ($group -eq 'av') { [Math]::Round($AvSeconds, 2) } elseif ($cpu.ContainsKey($group)) { [Math]::Round($cpu[$group], 2) } else { $(if ($script:measured -contains $group) { 0 } else { $null }) })
            wsAvgMb = $(if ($slot -and $slot.n) { [Math]::Round($slot.wsSum / $slot.n / 1MB, 1) } else { 0 })
            wsPeakMb = $(if ($slot) { [Math]::Round($slot.wsPeak / 1MB, 1) } else { 0 })
            privPeakMb = $(if ($slot) { [Math]::Round($slot.privPeak / 1MB, 1) } else { 0 })
            processesPeak = $(if ($slot) { $slot.countPeak } else { 0 })
        }
    }
    $groups
}

function Get-Alive([string[]] $Groups) {
    # Processes that were already running when the run began are not its leftovers.
    @($script:tracked.Values | Where-Object { $Groups -contains $_.group -and -not $_.baseline -and $_.process -and -not $_.process.HasExited })
}

# ---------------------------------------------------------------- watcher stream
function Open-Stream([string] $Path) { [pscustomobject]@{ path = $Path; position = 0L; partial = ''; last = $null } }
function Read-Stream($Stream) {
    if (-not (Test-Path -LiteralPath $Stream.path)) { return $Stream.last }
    $file = [IO.File]::Open($Stream.path, 'Open', 'Read', 'ReadWrite')
    try {
        $null = $file.Seek($Stream.position, 'Begin')
        $buffer = New-Object byte[] ([Math]::Max(0, $file.Length - $Stream.position))
        $count = $file.Read($buffer, 0, $buffer.Length)
        $Stream.position += $count
    } finally { $file.Dispose() }
    if ($count -gt 0) {
        $lines = ($Stream.partial + [Text.Encoding]::UTF8.GetString($buffer, 0, $count)) -split "`n"
        $Stream.partial = $lines[-1]
        $complete = @($lines | Select-Object -SkipLast 1 | Where-Object { $_.Trim() })
        if ($complete.Count) { try { $Stream.last = $complete[-1] | ConvertFrom-Json } catch { } }
    }
    $Stream.last
}

$final = @('completed', 'failed', 'cancelled', 'error')
function Test-Settled($Envelope, [string[]] $Ids) {
    if (-not $Envelope -or -not $Envelope.jobs) { return $false }
    foreach ($id in $Ids) {
        $job = $Envelope.jobs.$id
        if (-not $job -or $final -notcontains $job.status) { return $false }
    }
    $true
}

# ---------------------------------------------------------------- runs
$script:runs = New-Object Collections.Generic.List[object]
$script:sequence = 0

function Set-ProcessEnv([hashtable] $Values) {
    $previous = @{}
    foreach ($name in $Values.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $Values[$name], 'Process')
    }
    $previous
}

function Write-Subset([string] $Cwd, [string[]] $Ids, $Source) {
    $selected = [ordered]@{}
    foreach ($id in $Ids) { $selected[$id] = $Source.modules.$id }
    $path = Join-Path $Cwd ('.claude\bench-' + ($Ids -join '-') + '.json')
    if ($path.Length -gt 200) { $path = Join-Path $Cwd ('.claude\bench-' + $Ids.Count + '-modules.json') }
    Write-Utf8 $path ([ordered]@{ schemaVersion = 1; modules = $selected } | ConvertTo-Json -Depth 8)
    $path
}

function Test-Run($Run, $Envelope, [string[]] $Ids, $ExpectedMap, [string] $StateDir) {
    $reasons = New-Object Collections.Generic.List[string]
    $tests = 0
    $modules = [ordered]@{}
    foreach ($id in $Ids) {
        $job = $(if ($Envelope) { $Envelope.jobs.$id } else { $null })
        $expected = $ExpectedMap[$id]
        if (-not $job) { $reasons.Add($id + ': no final state'); continue }
        $wall = $null
        if ($job.startedAt -and $job.endedAt) { $wall = [Math]::Round(([datetime]$job.endedAt - [datetime]$job.startedAt).TotalMilliseconds) }
        $tests += [int]$job.resolved
        $modules[$id] = [ordered]@{ status = $job.status; total = $job.total; passed = $job.passed; failed = $job.failed; skipped = $job.skipped
            wallMs = $wall; exitCode = $job.exitCode; expected = $expected }
        if ($job.recoveryRequired -or $job.infrastructureFailure -or $job.phase -eq 'orphaned-command') { $reasons.Add($id + ': unsafe final state ' + $job.phase) }
        if ($expected) {
            $want = $(if ([int]$expected.failed -gt 0) { 'failed' } else { 'completed' })
            if ($job.status -ne $want) { $reasons.Add($id + ': status ' + $job.status + ', expected ' + $want) }
            foreach ($field in @('total', 'passed', 'failed', 'skipped')) {
                if ([int]$job.$field -ne [int]$expected.$field) { $reasons.Add($id + ': ' + $field + ' ' + $job.$field + ' != ' + $expected.$field) }
            }
        } elseif (@('completed', 'failed') -notcontains $job.status) { $reasons.Add($id + ': status ' + $job.status) }
    }
    if ($StateDir -and (Test-Path -LiteralPath $StateDir)) {
        $temporary = @(Get-ChildItem -LiteralPath $StateDir -Recurse -Force -Filter '*.tmp' -ErrorAction SilentlyContinue)
        if ($temporary.Count) { $reasons.Add($temporary.Count.ToString() + ' temp files left in the state directory') }
        $large = @(Get-ChildItem -LiteralPath $StateDir -Force -Filter '*.log' -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 1MB })
        if ($large.Count) { $reasons.Add($large.Count.ToString() + ' logs over 1 MiB') }
        $Run.stateFiles = @(Get-ChildItem -LiteralPath $StateDir -Recurse -Force -ErrorAction SilentlyContinue).Count
    }
    $Run.modules = $modules
    $Run.tests = $tests
    foreach ($reason in $reasons) { $Run.invalidReasons += $reason }
}

function Wait-Leftovers($Run, [string[]] $Groups, [int] $Seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        Invoke-Sample
        $alive = Get-Alive $Groups
        if (-not $alive.Count) { return }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    $Run.invalidReasons += ('leftover processes: ' + ((@($alive | Group-Object name | ForEach-Object { $_.Name + ' x' + $_.Count })) -join ', '))
}

function Complete-Run($Run, $Before, $AvBefore, [double] $Seconds) {
    $Run.processStarts = Stop-StartTrace
    $avSeconds = [Math]::Max(0.0, (Get-AvCpu) - $AvBefore)
    $Run.machineCpuPct = Get-BusyPercent $Before (Get-MachineTimes)
    $Run.groups = Get-Groups $avSeconds
    # The start call runs while no sample is taken; its CPU is the collector's too.
    if ($Run.startCpuMs) { $Run.groups.collector.cpuS = [Math]::Round($Run.groups.collector.cpuS + $Run.startCpuMs / 1000.0, 2) }
    $Run.samples = $script:samples
    $Run.seconds = [Math]::Round($Seconds, 1)
    if ($Run.tests -gt 0) {
        $Run.kpi = [ordered]@{ collectorCpuMsPer1kTests = [Math]::Round($Run.groups.collector.cpuS * 1e6 / $Run.tests, 1)
            avCpuMsPer1kTests = [Math]::Round($avSeconds * 1e6 / $Run.tests, 1); overheadPct = $null }
    }
    $Run.valid = ($Run.invalidReasons.Count -eq 0)
    $script:runs.Add($Run)
    $flag = $(if ($Run.valid) { 'ok' } else { 'INVALID: ' + ($Run.invalidReasons -join '; ') })
    Write-Host ('  ' + $Run.scenario + ' ' + $Run.variant + ' ' + $Run.module + ' #' + $Run.repeat + ': ' + $Run.wallMs + ' ms, collector ' +
        $Run.groups.collector.cpuS + ' s CPU, tests ' + $Run.tests + ' - ' + $flag)
}

function New-Run([string] $ScenarioId, [string] $Variant, [string] $ModuleLabel, [int] $Index) {
    [pscustomobject][ordered]@{ scenario = $ScenarioId; variant = $Variant; module = $ModuleLabel; entry = $null; action = $null
        repeat = $Index; valid = $true; invalidReasons = @(); wallMs = $null; startMs = $null; startCpuMs = $null; seconds = $null
        tests = 0; machineCpuPct = $null; samples = 0; stateFiles = $null; groups = $null; kpi = $null; modules = $null; diagnose = $null
        processStarts = $null }
}

# One batch through the collector, with a watcher streaming status as the Mod's would.
function Invoke-CollectorRun([string] $ScenarioId, [string] $Variant, [string] $ModuleLabel, [int] $Index, [string] $Cwd,
        [string[]] $Ids, $ExpectedMap, [string] $Config, [string] $Owner, [hashtable] $ExtraEnv, [switch] $KeepState) {
    $script:sequence += 1
    $run = New-Run $ScenarioId $Variant $ModuleLabel $Index
    if (-not $Owner) { $Owner = 'bench-' + $Label + '-' + $stamp + '-' + $script:sequence }
    $stream = Join-Path $resultsDir ('watch-' + $stamp + '-' + $script:sequence + '.jsonl')
    Reset-Sampler
    Start-StartTrace
    $avBefore = Get-AvCpu
    $before = Get-MachineTimes
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $previous = @{}
    if ($ExtraEnv) { $previous = Set-ProcessEnv $ExtraEnv }
    $watcher = $null
    try {
        $module = $(if ($Ids.Count -eq 1 -and -not $Config) { $Ids[0] } else { 'all' })
        $started = Invoke-Collector 'start' $module $Cwd $Owner $Config
        $run.startMs = $started.ms
        $run.startCpuMs = $started.cpuMs
        if (-not $started.ok) { $run.invalidReasons += ('start failed: ' + $started.error) }
        $watchArgs = @('--max-semi-space-size=1', $cli, 'watch', '--cwd', $Cwd, '--owner', $Owner, '--module', 'all')
        if ($Config) { $watchArgs += @('--config', $Config) }
        $watcher = Start-Logged $node $watchArgs $stream
    } finally { if ($ExtraEnv) { $null = Set-ProcessEnv $previous } }
    $source = Open-Stream $stream
    $envelope = $null
    $deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
    $nextSample = [DateTime]::UtcNow.AddMilliseconds($SampleMs)
    while ($run.invalidReasons.Count -eq 0) {
        Start-Sleep -Milliseconds ([Math]::Min(500, $SampleMs))
        $envelope = Read-Stream $source
        if ([DateTime]::UtcNow -ge $nextSample) { Invoke-Sample; $nextSample = [DateTime]::UtcNow.AddMilliseconds($SampleMs) }
        if (Test-Settled $envelope $Ids) { break }
        if ($watcher.HasExited) {
            # A watcher that ended early is replaced by a status call.
            $status = Invoke-Collector 'status' 'all' $Cwd $Owner $Config
            $envelope = $status.data
            if (Test-Settled $envelope $Ids) { break }
            $watcher = Start-Logged $node $watchArgs ($stream + '.' + [DateTime]::UtcNow.Ticks)
        }
        if ([DateTime]::UtcNow -ge $deadline) {
            $run.invalidReasons += ('timeout after ' + $TimeoutMinutes + ' min')
            $null = Invoke-Collector 'cancel' 'all' $Cwd $Owner $Config
            break
        }
    }
    $clock.Stop()
    $run.wallMs = [Math]::Round($clock.Elapsed.TotalMilliseconds)
    $status = Invoke-Collector 'status' 'all' $Cwd $Owner $Config
    if ($status.data) { $envelope = $status.data }
    # Diagnostics need a watcher that ends on its own; otherwise it is stopped as the Mod would.
    if ($Diagnose -and $Variant -eq 'replay') { $null = $watcher.WaitForExit(30000) }
    if (-not $watcher.HasExited) { try { $watcher.Kill() } catch { } }
    Wait-Leftovers $run @('collector', 'tests') 30
    $stateDir = $null
    $first = $(if ($envelope) { @($envelope.jobs.PSObject.Properties | Select-Object -First 1) } else { @() })
    if ($first.Count -and $first[0].Value.logPath) { $stateDir = Split-Path -Parent $first[0].Value.logPath }
    Test-Run $run $envelope $Ids $ExpectedMap $stateDir
    Complete-Run $run $before $avBefore $clock.Elapsed.TotalSeconds
    if ($stateDir -and -not $KeepState) {
        Remove-Item -LiteralPath $stateDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath (Join-Path (Split-Path -Parent $stateDir) ('acl-' + (Split-Path -Leaf $stateDir) + '.json')) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $stream, ($stream + '.err') -Force -ErrorAction SilentlyContinue
    $run
}

# The same modules without the collector; each one's output is kept for S5.
function Invoke-RawRun([string] $ScenarioId, [string] $ModuleLabel, [int] $Index, [string[]] $Ids, $ExpectedMap) {
    $script:sequence += 1
    $run = New-Run $ScenarioId 'raw' $ModuleLabel $Index
    Reset-Sampler
    Start-StartTrace
    $avBefore = Get-AvCpu
    $before = Get-MachineTimes
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $children = @{}
    foreach ($id in $Ids) {
        $summary = Join-Path $resultsDir ('raw-' + $stamp + '-' + $script:sequence + '-' + $id + '.json')
        $children[$id] = [pscustomobject]@{ summary = $summary; process = (Start-Logged $node @((Join-Path $benchDir 'capture.mjs'),
            '--workspace', $Workspace, '--module', $id, '--out', (Join-Path $capturesDir ($id + '.jsonl.gz'))) $summary) }
    }
    $deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
    $nextSample = [DateTime]::UtcNow.AddMilliseconds($SampleMs)
    while (@($children.Values | Where-Object { -not $_.process.HasExited }).Count) {
        Start-Sleep -Milliseconds ([Math]::Min(500, $SampleMs))
        if ([DateTime]::UtcNow -ge $nextSample) { Invoke-Sample; $nextSample = [DateTime]::UtcNow.AddMilliseconds($SampleMs) }
        if ([DateTime]::UtcNow -ge $deadline) {
            $run.invalidReasons += ('timeout after ' + $TimeoutMinutes + ' min')
            foreach ($child in $children.Values) { if (-not $child.process.HasExited) { & taskkill.exe /T /F /PID $child.process.Id 2>&1 | Out-Null } }
            break
        }
    }
    $clock.Stop()
    $run.wallMs = [Math]::Round($clock.Elapsed.TotalMilliseconds)
    Wait-Leftovers $run @('tests') 30
    $modules = [ordered]@{}
    foreach ($id in $Ids) {
        $result = $null
        try { $result = Get-Content -LiteralPath $children[$id].summary -Raw | ConvertFrom-Json } catch { }
        $expected = $ExpectedMap[$id]
        if (-not $result) { $run.invalidReasons += ($id + ': capture failed ' + ((Get-Content -LiteralPath ($children[$id].summary + '.err') -Raw -ErrorAction SilentlyContinue) -replace '\s+', ' ')); continue }
        $modules[$id] = [ordered]@{ exitCode = $result.exitCode; wallMs = [Math]::Round($result.wallMs); stdoutBytes = $result.stdoutBytes; expected = $expected }
        if ($expected) {
            # A clean suite must exit 0; with expected failures some runners still exit 0
            # (Maven with testFailureIgnore), so any code is accepted.
            if ([int]$expected.failed -eq 0 -and $result.exitCode -ne 0) { $run.invalidReasons += ($id + ': exit code ' + $result.exitCode) }
            $run.tests += [int]$expected.total
        }
        Remove-Item -LiteralPath $children[$id].summary, ($children[$id].summary + '.err') -Force -ErrorAction SilentlyContinue
    }
    $run.modules = $modules
    Complete-Run $run $before $avBefore $clock.Elapsed.TotalSeconds
    $run
}

function Get-ExpectedMap([string[]] $Ids) {
    $map = @{}
    foreach ($id in $Ids) { $map[$id] = Get-Expected $id }
    $map
}

# ---------------------------------------------------------------- diagnostics
function Read-Diagnostics([string] $Directory, [double] $Seconds, [string] $ProfileDir, [string] $Name) {
    $reports = @(Get-ChildItem -LiteralPath $Directory -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json })
    if (-not $reports.Count) { return $null }
    $stat = 0.0; $alloc = 0.0; $p99 = 0.0; $max = 0.0; $eperm = 0
    foreach ($report in $reports) {
        foreach ($call in $report.calls.PSObject.Properties) { if ($call.Name -match '^(lstat|stat|fstat):') { $stat += $call.Value } }
        $stat += $report.realpathSegments
        $alloc += $report.allocMb
        $eperm += $report.injectedEperm
        if ($report.script -eq 'module-batch-worker' -or $report.script -eq 'worker') {
            $p99 = [Math]::Max($p99, $report.eventLoopMs.p99); $max = [Math]::Max($max, $report.eventLoopMs.max)
        }
    }
    $markdown = Join-Path $resultsDir ($Name + '.md')
    $ErrorActionPreference = 'Continue'
    $counters = & $node (Join-Path $benchDir 'compare.mjs') --counters $Directory 2>&1
    $profiles = $(if (Test-Path -LiteralPath $ProfileDir) { & $node (Join-Path $benchDir 'cpuprofile-top.mjs') $ProfileDir --top 20 --match runner 2>&1 } else { @() })
    Write-Utf8 $markdown ((@(('# ' + $Name), '', '## fs counters', '') + @($counters) + @('', '## CPU profiles', '') + @($profiles)) -join "`n")
    [ordered]@{ allocMb = [Math]::Round($alloc, 1); statPerS = [Math]::Round($stat / [Math]::Max(0.001, $Seconds)); eventLoopP99Ms = $p99
        eventLoopMaxMs = $max; injectedEperm = $eperm; report = $markdown }
}

# ---------------------------------------------------------------- control calls (S4)
function Get-EntryCommand([string] $Name, [string] $Action, [string] $Cwd, [string] $Owner, [string] $Module) {
    $script = Join-Path $Checkout 'scripts\run-collector.ps1'
    $ps51 = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script, '-Action', $Action, '-Cwd', $Cwd, '-Owner', $Owner, '-Module', $Module)
    $quote = { param($value) "'" + $value.Replace("'", "'\''") + "'" }
    switch ($Name) {
        'direct' { return @($node, @($cli, $Action, '--cwd', $Cwd, '--owner', $Owner, '--module', $Module)) }
        'ps51' { return @($ps51, $psArgs) }
        'pwsh' { return @($script:pwshExe, $psArgs) }
        'gitbash-ps51' { return @($script:bashExe, @('-c', ('powershell ' + (($psArgs | ForEach-Object { & $quote $_ }) -join ' ')))) }
        'gitbash-pwsh' { return @($script:bashExe, @('-c', ('pwsh ' + (($psArgs | ForEach-Object { & $quote $_ }) -join ' ')))) }
        'gitbash-sh' {
            # The session directory as Git Bash spells $PWD (/c/...), like the skill's posix form.
            $shell = (Join-Path $Checkout 'scripts\run-collector.sh').Replace('\', '/')
            $msys = '/' + $Cwd.Substring(0, 1).ToLowerInvariant() + $Cwd.Substring(2).Replace('\', '/')
            return @($script:bashExe, @('-c', ('bash ' + (& $quote $shell) + ' ' + ((@($Action, '--cwd', $msys, '--owner', $Owner, '--module', $Module) | ForEach-Object { & $quote $_ }) -join ' '))))
        }
    }
}

function Invoke-ControlScenario {
    $script:pwshExe = $(if (Get-Command pwsh.exe -ErrorAction SilentlyContinue) { (Get-Command pwsh.exe).Source } else { $null })
    $script:bashExe = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
    $control = Join-Path $Workspace 'control'
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $control '.claude')
    Write-Utf8 (Join-Path $control '.claude\test-progress.json') (([ordered]@{ schemaVersion = 1; modules = [ordered]@{
        ctl = [ordered]@{ label = 'Control'; adapter = 'exit'; command = @($node, '-e', 'setTimeout(function () {}, 4000)') } } }) | ConvertTo-Json -Depth 6)
    foreach ($name in $Entry) {
        if (($name -eq 'pwsh' -or $name -eq 'gitbash-pwsh') -and -not $script:pwshExe) { Write-Warning 'pwsh.exe not found; skipped.'; continue }
        if ($name -like 'gitbash-*' -and -not (Test-Path -LiteralPath $script:bashExe)) { Write-Warning 'Git Bash not found; skipped.'; continue }
        $owner = 'bench-ctl-' + $stamp + '-' + $name
        Write-Host ('S4 control calls through ' + $name + ' ...')
        foreach ($plan in @(@('list', $Calls), @('start', 1), @('status', $Calls), @('logs', 3), @('cancel', 1))) {
            $action = $plan[0]
            $samples = New-Object Collections.Generic.List[double]
            $failures = 0
            $lastError = $null
            for ($i = 0; $i -lt $plan[1]; $i++) {
                $command = Get-EntryCommand $name $action $control $owner 'ctl'
                $call = Invoke-Timed $command[0] $command[1] -AllowFailure
                $samples.Add($call.ms)
                if (-not $call.ok) { $failures += 1; $lastError = $call.error }
            }
            if ($action -eq 'start') {
                # The status calls then see a running job; the job ends by itself after 4 s.
                $null = Invoke-Collector 'status' 'ctl' $control $owner $null
            }
            $run = New-Run 'S4' 'control' 'ctl' 1
            $run.entry = $name; $run.action = $action
            $stats = Get-Stats $samples
            foreach ($key in $stats.Keys) { $run | Add-Member -NotePropertyName $key -NotePropertyValue $stats[$key] }
            $run | Add-Member -NotePropertyName calls -NotePropertyValue $samples.Count
            $run | Add-Member -NotePropertyName failures -NotePropertyValue $failures
            if ($failures) { $run.invalidReasons += ($failures.ToString() + ' of ' + $samples.Count + ' failed: ' + $lastError) }
            $run.valid = ($failures -eq 0)
            $script:runs.Add($run)
            Write-Host ('  ' + $name + ' ' + $action + ': p50 ' + $stats.p50Ms + ' ms, cold ' + $stats.coldMs + ' ms' + $(if ($failures) { ', ' + $failures + ' failed: ' + $lastError } else { '' }))
        }
        $settle = [Diagnostics.Stopwatch]::StartNew()
        while ($settle.Elapsed.TotalSeconds -lt 30) {
            $status = Invoke-Collector 'status' 'ctl' $control $owner $null
            if (-not $status.data -or -not $status.data.jobs.ctl -or $final -contains $status.data.jobs.ctl.status) { break }
            Start-Sleep -Milliseconds 500
        }
    }
}

# ---------------------------------------------------------------- replay workspaces (S5)
function New-ReplayWorkspace([int] $Count) {
    $captures = @($Modules | Where-Object { Test-Path -LiteralPath (Join-Path $capturesDir ($_ + '.jsonl.gz')) })
    if (-not $captures.Count) { return $null }
    $dir = Join-Path $Workspace ('replay-' + $Count)
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $dir '.claude')
    $set = [ordered]@{}
    $expected = @{}
    for ($i = 1; $i -le $Count; $i++) {
        $source = $captures[($i - 1) % $captures.Count]
        $id = 'r' + $i
        $set[$id] = [ordered]@{ label = ('Replay ' + $i + ' ' + $source); adapter = $config.modules.$source.adapter
            command = @($node, (Join-Path $benchDir 'replay.mjs'), (Join-Path $capturesDir ($source + '.jsonl.gz')), '--speed', $ReplaySpeed) }
        $expected[$id] = Get-Expected $source
    }
    Write-Utf8 (Join-Path $dir '.claude\test-progress.json') (([ordered]@{ schemaVersion = 1; modules = $set }) | ConvertTo-Json -Depth 6)
    [pscustomobject]@{ path = $dir; ids = @($set.Keys); expected = $expected }
}

function Set-Overhead {
    foreach ($run in $script:runs) {
        if ($run.variant -ne 'collector' -or -not $run.kpi) { continue }
        $raw = @($script:runs | Where-Object { $_.variant -eq 'raw' -and $_.valid -and $_.scenario -eq $run.scenario -and $_.module -eq $run.module } | ForEach-Object { $_.wallMs } | Sort-Object)
        if ($raw.Count) {
            $median = $raw[[int][Math]::Floor(($raw.Count - 1) / 2)]
            $run.kpi.overheadPct = [Math]::Round(100.0 * ($run.wallMs - $median) / [Math]::Max(1, $median), 1)
        }
    }
}

# ---------------------------------------------------------------- main
$machine = Get-MachineInfo $Checkout $node
Write-Host ('Collector ' + $Checkout + ' (' + $machine.revision + '), workspace ' + $Workspace + ', modules ' + ($Modules -join ', '))
$defender = $null
try {
    if ($DefenderSeconds -gt 0) {
        if (-not $machine.admin) { throw '-DefenderSeconds needs an elevated session.' }
        $etl = Join-Path $resultsDir ($Label + '-' + $stamp + '-defender.etl')
        $defender = Start-Job -ScriptBlock { param($path, $seconds) New-MpPerformanceRecording -RecordTo $path -Seconds $seconds } -ArgumentList $etl, $DefenderSeconds
        Start-Sleep -Seconds 3
    }
    foreach ($id in $Scenario) {
        switch ($id) {
            'S0' {
                Write-Host ('S0 idle for ' + $IdleSeconds + ' s ...')
                $run = New-Run 'S0' 'idle' '' 1
                Reset-Sampler
                Start-StartTrace
                $avBefore = Get-AvCpu
                $before = Get-MachineTimes
                $clock = [Diagnostics.Stopwatch]::StartNew()
                while ($clock.Elapsed.TotalSeconds -lt $IdleSeconds) { Start-Sleep -Milliseconds $SampleMs; Invoke-Sample }
                $run.wallMs = [Math]::Round($clock.Elapsed.TotalMilliseconds)
                Complete-Run $run $before $avBefore $clock.Elapsed.TotalSeconds
            }
            'S1' {
                foreach ($module in $Modules) {
                    for ($i = 1; $i -le $Repeat; $i++) {
                        # Alternate which variant goes first, so drift does not favour one.
                        $order = $(if ($i % 2) { @('raw', 'collector') } else { @('collector', 'raw') })
                        foreach ($variant in $order) {
                            if ($Mode -ne 'both' -and $Mode -ne $variant) { continue }
                            Write-Host ('S1 ' + $module + ' ' + $variant + ' #' + $i + ' ...')
                            if ($variant -eq 'raw') { $null = Invoke-RawRun 'S1' $module $i @($module) (Get-ExpectedMap @($module)) }
                            else { $null = Invoke-CollectorRun 'S1' 'collector' $module $i $Workspace @($module) (Get-ExpectedMap @($module)) $null $null $null }
                        }
                    }
                }
            }
            { $_ -eq 'S2' -or $_ -eq 'S6' } {
                $subset = $(if (@($Modules).Count -ne $configured.Count) { Write-Subset $Workspace $Modules $config } else { $null })
                $owner = $(if ($id -eq 'S6') { 'bench-soak-' + $Label + '-' + $stamp } else { $null })
                for ($i = 1; $i -le $Repeat; $i++) {
                    $order = $(if ($id -eq 'S6') { @('collector') } elseif ($i % 2) { @('raw', 'collector') } else { @('collector', 'raw') })
                    foreach ($variant in $order) {
                        if ($id -eq 'S2' -and $Mode -ne 'both' -and $Mode -ne $variant) { continue }
                        Write-Host ($id + ' all modules ' + $variant + ' #' + $i + ' ...')
                        if ($variant -eq 'raw') { $null = Invoke-RawRun $id 'all' $i $Modules (Get-ExpectedMap $Modules) }
                        else { $null = Invoke-CollectorRun $id $(if ($id -eq 'S6') { 'soak' } else { 'collector' }) 'all' $i $Workspace $Modules (Get-ExpectedMap $Modules) $subset $owner $null -KeepState:($id -eq 'S6' -and $i -lt $Repeat) }
                    }
                }
            }
            'S4' { Invoke-ControlScenario }
            'S5' {
                foreach ($count in $ReplayModules) {
                    $replay = New-ReplayWorkspace $count
                    if (-not $replay) { Write-Warning 'S5 needs captures from an S1 or S2 raw run; skipped.'; break }
                    for ($i = 1; $i -le $Repeat; $i++) {
                        Write-Host ('S5 replay of ' + $count + ' modules at ' + $ReplaySpeed + ' #' + $i + ' ...')
                        $extra = $null
                        $diag = $null
                        if ($Diagnose -or $EpermEvery -gt 0) {
                            $diag = Join-Path $resultsDir ('diag-' + $Label + '-' + $stamp + '-k' + $count + '-' + $i)
                            $null = New-Item -ItemType Directory -Force -Path $diag
                            # NODE_OPTIONS treats a backslash inside quotes as an escape; Windows takes slashes.
                            $options = '--require "' + (Join-Path $benchDir 'fs-counter.cjs').Replace('\', '/') + '"'
                            if ($Diagnose) { $options += ' --cpu-prof --cpu-prof-dir="' + (Join-Path $diag 'profiles').Replace('\', '/') + '"' }
                            $extra = @{ NODE_OPTIONS = $options; TP_BENCH_COUNT_DIR = (Join-Path $diag 'counters'); TP_BENCH_EPERM_EVERY = [string]$EpermEvery
                                TP_BENCH_RUNNER = (Join-Path $Checkout 'runner') }
                        }
                        # Instrumented runs cost CPU, so they never share a group with plain ones.
                        $variant = 'replay' + $(if ($EpermEvery -gt 0) { '-eperm' } else { '' }) + $(if ($Diagnose) { '-diag' } else { '' })
                        $run = Invoke-CollectorRun 'S5' $variant ('k=' + $count) $i $replay.path $replay.ids $replay.expected $null $null $extra
                        if ($diag) { $run.diagnose = Read-Diagnostics (Join-Path $diag 'counters') ($run.wallMs / 1000.0) (Join-Path $diag 'profiles') ('diag-' + $Label + '-' + $stamp + '-k' + $count + '-' + $i) }
                    }
                }
            }
        }
    }
} finally {
    Set-Overhead
    if ($defender) {
        $null = Wait-Job $defender -Timeout ($DefenderSeconds + 120)
        Receive-Job $defender -ErrorAction SilentlyContinue | Out-Null
        if (Test-Path -LiteralPath $etl) {
            try {
                $top = Get-MpPerformanceReport -Path $etl -TopFiles 25 -TopProcesses 10 -TopExtensions 10 -TopPaths 10
                Write-Utf8 ($etl + '.json') ($top | ConvertTo-Json -Depth 6)
            } catch { Write-Warning ('Defender report failed: ' + $_.Exception.Message) }
        }
    }
    $report = [ordered]@{ schemaVersion = 1; tool = 'bench-heavy'; label = $Label; machine = $machine
        checkout = [ordered]@{ path = $Checkout; revision = $machine.revision }; workspace = $Workspace
        tools = $tools; parameters = [ordered]@{ scenario = $Scenario; modules = $Modules; repeat = $Repeat; mode = $Mode
            sampleMs = $SampleMs; replaySpeed = $ReplaySpeed; epermEvery = $EpermEvery; diagnose = [bool]$Diagnose
            chromeNoSandbox = $chromeNoSandbox }
        runs = $script:runs }
    Write-Utf8 $Output ($report | ConvertTo-Json -Depth 10)
    Write-Host ('Report: ' + $Output)
}
