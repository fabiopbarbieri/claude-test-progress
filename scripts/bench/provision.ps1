[CmdletBinding()]
param(
    [string] $Tools = 'C:\Tools',
    [string] $Fixtures = 'C:\Tools\tp-bench',
    [string] $Plugin = $(if ($PSScriptRoot) { Split-Path -Parent (Split-Path -Parent $PSScriptRoot) } else { '' }),
    [ValidateRange(0.01, 100)][double] $Scale = 1,
    [string[]] $Steps = @('node14', 'jdk', 'maven', 'chrome', 'listener', 'fixtures', 'npm', 'wrapper', 'warmup', 'venv'),
    [string] $NodeVersion = '14.21.3',
    [string] $JdkFeature = '17',
    [string] $MavenVersion = '3.9.11',
    [string] $ChromeVersion = ''
)
# Provisions a native Windows benchmark machine for heavy test suites, without admin rights
# and without installers: everything is a zip extracted under $Tools (Node 14 goes into the
# nvm-windows root instead, so the collector's .nvmrc resolution finds it). No persistent
# environment change: tool paths live in a process-local environment around each native call.
#
# Steps (always run in this order; -Steps picks a subset):
#   node14    Node $NodeVersion (SHA-256 from SHASUMS256.txt) into $env:NVM_HOME\v<version>
#   jdk       Temurin JDK $JdkFeature (SHA-256 from the Adoptium API) into $Tools\jdk-<feature>
#   maven     Apache Maven $MavenVersion (SHA-512 from archive.apache.org) into $Tools
#   chrome    Chrome for Testing, pinned: the first run records version and SHA-256 (no upstream hash)
#   listener  builds adapters\junit with Maven and installs it into the default local repository
#   fixtures  runs scripts\bench\generate.mjs with the collector Node (Node >= 14) into $Fixtures
#   npm       npm ci with Node 14 in each Angular project (marker file holds the lockfile SHA-256)
#   wrapper   creates the only-script Maven wrapper (mvnw.cmd) in mvn-a
#   warmup    one online `test` run per Maven project so surefire providers land in ~/.m2
#   venv      Python venv with a pinned pytest in $Fixtures\.venv
# Records go to $Tools\tp-bench-tools.json, the runner's settings to $Fixtures\env.json.
# Run it with: powershell -NoProfile -ExecutionPolicy Bypass -File provision.ps1 [-Steps ...]
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This provisioning requires native Windows.'
}
$ProgressPreference = 'SilentlyContinue'
$previousProtocol = [Net.ServicePointManager]::SecurityProtocol
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression.FileSystem

$allSteps = @('node14', 'jdk', 'maven', 'chrome', 'listener', 'fixtures', 'npm', 'wrapper', 'warmup', 'venv')
$pytestVersion = '9.1.1'
$angularProjects = @('ng9-a', 'ng9-b')

function Resolve-FullPath([string] $Path) {
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    if ($full.Length -gt 3) { $full = $full.TrimEnd('\') }
    $full
}

# -Steps may arrive as one comma-separated string through -File.
$requested = @($Steps | ForEach-Object { ([string]$_) -split '[,;\s]+' } | Where-Object { $_ } | ForEach-Object { $_.ToLowerInvariant() })
$unknown = @($requested | Where-Object { $allSteps -notcontains $_ })
if ($unknown.Count -gt 0) { throw ('Unknown step: ' + ($unknown -join ', ') + '. Valid steps: ' + ($allSteps -join ', ')) }
if (-not $Plugin -or -not (Test-Path -LiteralPath $Plugin -PathType Container)) { throw 'Plugin root not found; pass -Plugin.' }
$Plugin = (Resolve-Path -LiteralPath $Plugin).ProviderPath.TrimEnd('\')
$Tools = Resolve-FullPath $Tools
$Fixtures = Resolve-FullPath $Fixtures
$cache = Join-Path $Tools 'tp-bench-cache'
$logs = Join-Path $Tools 'tp-bench-logs'
$statePath = Join-Path $Tools 'tp-bench-tools.json'
foreach ($directory in @($Tools, $cache, $logs)) {
    $null = New-Item -ItemType Directory -Force -Path $directory
}
$utf8 = New-Object Text.UTF8Encoding -ArgumentList $false
# One run at a time per Tools folder: the state file and the cache are shared. The lock goes
# away with this process, so a killed run cannot leave it behind.
$runLock = $null
try {
    $runLock = New-Object IO.FileStream -ArgumentList (Join-Path $Tools 'tp-bench-provision.lock'), ([IO.FileMode]::OpenOrCreate),
        ([IO.FileAccess]::ReadWrite), ([IO.FileShare]::None), 4096, ([IO.FileOptions]::DeleteOnClose)
} catch {
    throw ('Another provision.ps1 run is active for ' + $Tools + ' (tp-bench-provision.lock is in use).')
}

# ---- state -------------------------------------------------------------------------------

$state = [ordered]@{}
if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    $loaded = $null
    try { $loaded = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch {
        throw ('Cannot parse ' + $statePath + '; fix or remove it. ' + $_.Exception.Message)
    }
    if ($loaded) { foreach ($property in $loaded.PSObject.Properties) { $state[$property.Name] = $property.Value } }
}
$state['schema'] = 1
$state['updated'] = ''

# Dates stay strings without a 'T': PowerShell 7 would turn ISO strings into DateTime on reload.
function Get-Stamp { [DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss') + 'Z' }

function Save-State {
    $state['updated'] = Get-Stamp
    [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json -Depth 6), $utf8)
}

function Get-Record([string] $Name) {
    if ($state.Contains($Name)) { return $state[$Name] }
    $null
}

function Set-Record([string] $Name, $Record) {
    $state[$Name] = $Record
    Save-State
}

function Get-Field([string] $Name, [string] $Field) {
    $record = Get-Record $Name
    if ($null -ne $record -and $null -ne $record.$Field) { return [string]$record.$Field }
    $null
}

# A recorded tool whose directory exists is usable; the hash of its main file must still match.
function Test-ToolHash($Record) {
    if ($null -eq $Record -or -not $Record.home -or -not $Record.probe) { return $false }
    $file = Join-Path $Record.home $Record.probe
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
    if ((Get-Sha $file) -ne ([string]$Record.probeSha256).ToLowerInvariant()) {
        Write-Warning ($file + ' no longer matches the recorded SHA-256.')
        return $false
    }
    $true
}

$script:stepStatus = 'done'
$script:stepDetail = ''
function Set-StepResult([string] $Status, [string] $Detail) {
    $script:stepStatus = $Status
    $script:stepDetail = $Detail
}

# ---- files, downloads ----------------------------------------------------------------------

function Get-Sha([string] $Path, [string] $Algorithm = 'SHA256') {
    (Get-FileHash -LiteralPath $Path -Algorithm $Algorithm).Hash.ToLowerInvariant()
}

function Get-StringSha([string] $Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) } finally { $sha.Dispose() }
    (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

# One hash for a set of files: names relative to $Root plus content hashes, in a stable order.
function Get-FilesHash([string] $Root, $Files) {
    $lines = foreach ($file in @($Files | Sort-Object FullName)) {
        $file.FullName.Substring($Root.Length).TrimStart('\') + ':' + (Get-Sha $file.FullName)
    }
    Get-StringSha (@($lines) -join "`n")
}

function Remove-Tree([string] $Path) {
    for ($try = 1; $try -le 5; $try++) {
        try {
            if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop }
            return
        } catch {
            # Defender and indexers briefly hold freshly written files.
            if ($try -eq 5) { throw }
            Start-Sleep -Seconds 2
        }
    }
}

function Save-Download([string] $Url, [string] $Path) {
    $part = $Path + '.' + $PID + '.part'
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $part
            Move-Item -LiteralPath $part -Destination $Path -Force
            return
        } catch {
            if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue }
            if ($attempt -eq 3) { throw ('Download failed: ' + $Url + ' (' + $_.Exception.Message + ')') }
            Start-Sleep -Seconds (3 * $attempt)
        }
    }
}

function Get-WebText([string] $Url) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $content = (Invoke-WebRequest -UseBasicParsing -Uri $Url).Content
            if ($content -is [byte[]]) { $content = [Text.Encoding]::UTF8.GetString($content) }
            return [string]$content
        } catch {
            if ($attempt -eq 3) { throw ('Request failed: ' + $Url + ' (' + $_.Exception.Message + ')') }
            Start-Sleep -Seconds (3 * $attempt)
        }
    }
}

# Downloads a zip, verifies it when a hash is known (otherwise trust on first use) and
# extracts it into $Target; a single top-level folder in the archive is flattened.
# Returns the archive hash.
function Install-Archive {
    param(
        [Parameter(Mandatory = $true)][string] $Label,
        [Parameter(Mandatory = $true)][string] $Url,
        [Parameter(Mandatory = $true)][string] $Algorithm,
        [AllowEmptyString()][string] $Expected,
        [Parameter(Mandatory = $true)][string] $Target
    )
    $archive = Join-Path $cache ($Label + '.zip')
    Write-Host ('  downloading ' + $Url)
    Save-Download $Url $archive
    $actual = Get-Sha $archive $Algorithm
    if ($Expected -and $actual -ne $Expected.ToLowerInvariant()) {
        Remove-Item -LiteralPath $archive -Force
        throw ($Label + ' archive failed ' + $Algorithm + ' verification (expected ' + $Expected + ', got ' + $actual + ').')
    }
    $trust = ' (first use, recorded)'
    if ($Expected) { $trust = ' (verified)' }
    Write-Host ('  ' + $Algorithm + ' ' + $actual + $trust)
    $parent = Split-Path -Parent $Target
    $null = New-Item -ItemType Directory -Force -Path $parent
    foreach ($old in @(Get-ChildItem -LiteralPath $parent -Directory -Filter 'tp-stage-*' -ErrorAction SilentlyContinue)) {
        Remove-Tree $old.FullName
    }
    $stage = Join-Path $parent ('tp-stage-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    try {
        Write-Host '  extracting ...'
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $stage)
        $children = @(Get-ChildItem -LiteralPath $stage -Force)
        $source = $stage
        if ($children.Count -eq 1 -and $children[0].PSIsContainer) { $source = $children[0].FullName }
        Remove-Tree $Target
        for ($try = 1; $try -le 5; $try++) {
            try { Move-Item -LiteralPath $source -Destination $Target -ErrorAction Stop; break } catch {
                if ($try -eq 5) { throw }
                Start-Sleep -Seconds 2
            }
        }
    } finally {
        Remove-Tree $stage
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    }
    $actual
}

# ---- native calls --------------------------------------------------------------------------

# Process-local tool environment for one call: JAVA_HOME, CHROME_BIN and PATH with the JDK and
# Maven first (Node 14 first as well for npm). Nothing persists; Invoke-Native restores it.
function Get-ToolEnvironment([bool] $WithNode) {
    $map = @{}
    $dirs = New-Object Collections.Generic.List[string]
    $nodeHome = Get-Field 'node14' 'home'
    $jdkHome = Get-Field 'jdk' 'home'
    $mavenHome = Get-Field 'maven' 'home'
    $chromeExe = Get-Field 'chrome' 'exe'
    if ($WithNode -and $nodeHome) { $dirs.Add($nodeHome) }
    if ($jdkHome) { $map['JAVA_HOME'] = $jdkHome; $dirs.Add((Join-Path $jdkHome 'bin')) }
    if ($mavenHome) { $dirs.Add((Join-Path $mavenHome 'bin')) }
    if ($chromeExe) { $map['CHROME_BIN'] = $chromeExe }
    if ($dirs.Count -gt 0) {
        $map['PATH'] = ($dirs -join ';') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'Process')
    }
    $map
}

# Runs a native command with the tool environment, streams its output to a log file and keeps
# the last lines. Returns Code, Seconds, Tail, Log; the caller decides what a code means.
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string] $Exe,
        [string[]] $Arguments = @(),
        [string] $WorkDir = '',
        [string] $Log = '',
        [switch] $WithNode
    )
    # Under Stop, Windows PowerShell 5.1 turns a native stderr line into a terminating error.
    $ErrorActionPreference = 'Continue'
    $names = @('JAVA_HOME', 'PATH', 'CHROME_BIN')
    $saved = @{}
    foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    $tail = New-Object Collections.Generic.Queue[string]
    $writer = $null
    $code = -1
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        foreach ($item in (Get-ToolEnvironment ([bool]$WithNode)).GetEnumerator()) {
            [Environment]::SetEnvironmentVariable($item.Key, $item.Value, 'Process')
        }
        if ($Log) {
            $writer = New-Object IO.StreamWriter -ArgumentList $Log, $false, $utf8
            $writer.AutoFlush = $true
        }
        if ($WorkDir) { Push-Location -LiteralPath $WorkDir }
        try {
            $global:LASTEXITCODE = $null
            & $Exe @Arguments 2>&1 | ForEach-Object {
                $line = ''
                if ($_ -is [Management.Automation.ErrorRecord]) { $line = $_.Exception.Message } else { $line = [string]$_ }
                if ($writer) { $writer.WriteLine($line) }
                $tail.Enqueue($line)
                if ($tail.Count -gt 40) { $null = $tail.Dequeue() }
            }
            if ($null -ne $LASTEXITCODE) { $code = [int]$LASTEXITCODE }
        } finally {
            if ($WorkDir) { Pop-Location }
        }
    } finally {
        foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
        if ($writer) { $writer.Dispose() }
    }
    $watch.Stop()
    [pscustomobject]@{ Code = $code; Seconds = [Math]::Round($watch.Elapsed.TotalSeconds, 1); Tail = @($tail); Log = $Log }
}

function Assert-NativeOk($Result, [string] $What) {
    if ($Result.Code -eq 0) { return }
    foreach ($line in @($Result.Tail | Select-Object -Last 15)) { Write-Host ('    ' + $line) }
    $where = ''
    if ($Result.Log) { $where = ' Log: ' + $Result.Log }
    throw ($What + ' failed (exit ' + $Result.Code + ').' + $where)
}

function Get-ToolVersionLine([string] $Exe, [string[]] $Arguments) {
    $result = Invoke-Native $Exe $Arguments
    if ($result.Code -ne 0) { return '' }
    ($result.Tail -join ' ').Trim()
}

function Get-ToolHome([string] $Name, [string] $Probe) {
    $record = Get-Record $Name
    if ($null -eq $record -or -not $record.home -or -not (Test-Path -LiteralPath (Join-Path $record.home $Probe))) {
        throw ($Name + ' is not provisioned; run the ' + $Name + ' step first.')
    }
    [string]$record.home
}

function Get-MavenCmd { Join-Path (Get-ToolHome 'maven' 'bin\mvn.cmd') 'bin\mvn.cmd' }

# ---- steps: tools --------------------------------------------------------------------------

function Test-NvmrcResolution([string] $ExpectedExe) {
    # Proves the collector's own discovery finds this Node for `.nvmrc` = major version.
    $discovery = Join-Path $Plugin 'runtime\node-discovery.ps1'
    if (-not (Test-Path -LiteralPath $discovery -PathType Leaf)) { return }
    try {
        $probeDir = Join-Path $cache 'nvmrc-probe'
        $null = New-Item -ItemType Directory -Force -Path $probeDir
        [IO.File]::WriteAllText((Join-Path $probeDir '.nvmrc'), (($NodeVersion.Split('.')[0]) + "`n"), $utf8)
        . $discovery
        $descriptor = Select-TestProgressProjectNode -Cwd $probeDir
        if ($descriptor.path -ieq $ExpectedExe) {
            Write-Host ('  .nvmrc ' + $NodeVersion.Split('.')[0] + ' resolves to ' + $descriptor.path)
        } else {
            Write-Warning ('.nvmrc resolution found ' + $descriptor.path + ' instead of ' + $ExpectedExe)
        }
    } catch {
        Write-Warning ('.nvmrc resolution check failed: ' + $_.Exception.Message)
    }
}

function Invoke-Node14Step {
    $viaNvm = $false
    if ($env:NVM_HOME -and (Test-Path -LiteralPath $env:NVM_HOME -PathType Container)) {
        $viaNvm = $true
        $target = Join-Path $env:NVM_HOME ('v' + $NodeVersion)
    } else {
        Write-Warning ('NVM_HOME is not set: installing Node ' + $NodeVersion + ' under ' + $Tools +
            '. The collector resolves .nvmrc only through nvm-windows, so the Angular projects will not find it.')
        $target = Join-Path $Tools ('node-v' + $NodeVersion)
    }
    $exe = Join-Path $target 'node.exe'
    $record = Get-Record 'node14'
    $healthy = (Test-Path -LiteralPath $exe -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $target 'npm.cmd') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $target 'node_modules\npm\package.json') -PathType Leaf) -and
        ((Get-ToolVersionLine $exe @('--version')) -eq ('v' + $NodeVersion))
    if ($healthy) {
        $known = $null -ne $record -and $record.version -eq $NodeVersion -and $record.home -ieq $target
        if (-not $known) {
            # Already installed (for example by nvm-windows from nodejs.org): adopt it.
            Write-Host ('  adopting existing ' + $target)
            Set-Record 'node14' ([ordered]@{ version = $NodeVersion; home = $target; viaNvm = $viaNvm; probe = 'node.exe'
                probeSha256 = (Get-Sha $exe); source = 'preinstalled'; date = (Get-Stamp) })
        }
        if (-not $known -or (Test-ToolHash $record)) {
            if ($viaNvm) { Test-NvmrcResolution $exe }
            Set-StepResult 'skipped' ('Node ' + $NodeVersion + ' at ' + $target)
            return
        }
    }
    $base = 'https://nodejs.org/dist/v' + $NodeVersion + '/'
    $zipName = 'node-v' + $NodeVersion + '-win-x64.zip'
    $expected = ''
    foreach ($line in ((Get-WebText ($base + 'SHASUMS256.txt')) -split "`n")) {
        if ($line -match '^\s*([0-9a-fA-F]{64})\s+\*?(\S+)\s*$' -and $Matches[2] -eq $zipName) { $expected = $Matches[1] }
    }
    if (-not $expected) { throw ('No SHA-256 for ' + $zipName + ' in SHASUMS256.txt.') }
    $archiveSha = Install-Archive -Label 'node14' -Url ($base + $zipName) -Algorithm 'SHA256' -Expected $expected -Target $target
    if ((Get-ToolVersionLine $exe @('--version')) -ne ('v' + $NodeVersion)) { throw ('Installed node.exe is not v' + $NodeVersion + '.') }
    $npmText = Get-ToolVersionLine (Join-Path $target 'npm.cmd') @('--version')
    Set-Record 'node14' ([ordered]@{ version = $NodeVersion; npm = $npmText; home = $target; viaNvm = $viaNvm; probe = 'node.exe'
        probeSha256 = (Get-Sha $exe); url = ($base + $zipName); archiveSha256 = $archiveSha; source = 'nodejs.org'; date = (Get-Stamp) })
    if ($viaNvm) { Test-NvmrcResolution $exe }
    Set-StepResult 'done' ('Node ' + $NodeVersion + ', npm ' + $npmText + ' at ' + $target)
}

function Invoke-JdkStep {
    $target = Join-Path $Tools ('jdk-' + $JdkFeature)
    $record = Get-Record 'jdk'
    if ($null -ne $record -and $record.feature -eq $JdkFeature -and $record.home -ieq $target -and (Test-ToolHash $record)) {
        Set-StepResult 'skipped' ([string]$record.release)
        return
    }
    if ($null -ne $record -and $record.feature -eq $JdkFeature -and $record.url -and $record.archiveSha256) {
        # Repair the recorded build, not whatever the API lists as latest today.
        $release = [string]$record.release
        $link = [string]$record.url
        $checksum = [string]$record.archiveSha256
    } else {
        $api = 'https://api.adoptium.net/v3/assets/latest/' + $JdkFeature + '/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
        $assets = @(@((Get-WebText $api) | ConvertFrom-Json) | Where-Object {
            $_.binary.os -eq 'windows' -and $_.binary.architecture -eq 'x64' -and $_.binary.image_type -eq 'jdk' -and
            $_.binary.package.name -like '*.zip' })
        if ($assets.Count -eq 0) { throw ('Adoptium lists no Windows x64 JDK zip for feature ' + $JdkFeature + '.') }
        $release = [string]$assets[0].release_name
        $link = [string]$assets[0].binary.package.link
        $checksum = [string]$assets[0].binary.package.checksum
    }
    Write-Host ('  ' + $release)
    $archiveSha = Install-Archive -Label 'jdk' -Url $link -Algorithm 'SHA256' -Expected $checksum -Target $target
    $java = Join-Path $target 'bin\java.exe'
    foreach ($tool in @('java.exe', 'javac.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $target ('bin\' + $tool)) -PathType Leaf)) { throw ('JDK archive has no bin\' + $tool) }
    }
    Set-Record 'jdk' ([ordered]@{ feature = $JdkFeature; release = $release; home = $target; probe = 'bin\java.exe'
        probeSha256 = (Get-Sha $java); url = $link; archiveSha256 = $archiveSha; source = 'adoptium'; date = (Get-Stamp) })
    Set-StepResult 'done' ($release + ' at ' + $target)
}

function Invoke-MavenStep {
    $target = Join-Path $Tools ('apache-maven-' + $MavenVersion)
    $record = Get-Record 'maven'
    if ($null -ne $record -and $record.version -eq $MavenVersion -and $record.home -ieq $target -and (Test-ToolHash $record)) {
        Set-StepResult 'skipped' ('Maven ' + $MavenVersion)
        return
    }
    $url = 'https://archive.apache.org/dist/maven/maven-' + $MavenVersion.Split('.')[0] + '/' + $MavenVersion +
        '/binaries/apache-maven-' + $MavenVersion + '-bin.zip'
    $sumText = Get-WebText ($url + '.sha512')
    if ($sumText -match '(?i)\b([0-9a-f]{128})\b') { $expected = $Matches[1] } else { throw ('No SHA-512 found in ' + $url + '.sha512') }
    $archiveSha = Install-Archive -Label 'maven' -Url $url -Algorithm 'SHA512' -Expected $expected -Target $target
    $mvn = Join-Path $target 'bin\mvn.cmd'
    if (-not (Test-Path -LiteralPath $mvn -PathType Leaf)) { throw 'Maven archive has no bin\mvn.cmd' }
    Set-Record 'maven' ([ordered]@{ version = $MavenVersion; home = $target; probe = 'bin\mvn.cmd'; probeSha256 = (Get-Sha $mvn)
        url = $url; archiveSha512 = $archiveSha; source = 'apache'; date = (Get-Stamp) })
    Set-StepResult 'done' ('Maven ' + $MavenVersion + ' at ' + $target)
}

function Test-ChromeLaunch([string] $Exe) {
    # Headless smoke test with a throwaway profile; failure only warns.
    $profile = Join-Path $cache 'chrome-smoke'
    $process = $null
    try {
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $Exe
        $info.Arguments = '--headless=new --disable-gpu --no-first-run --user-data-dir="' + $profile + '" --dump-dom about:blank'
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $process = [Diagnostics.Process]::Start($info)
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(60000)) {
            try { $process.Kill() } catch { }
            return $false
        }
        return ($process.ExitCode -eq 0 -and $stdout.Result -match '<html')
    } catch {
        return $false
    } finally {
        if ($process) { $process.Dispose() }
        try { Remove-Tree $profile } catch { }
    }
}

function Invoke-ChromeStep {
    $record = Get-Record 'chrome'
    $url = ''
    if ($ChromeVersion) {
        $version = $ChromeVersion
    } elseif ($null -ne $record -and $record.version) {
        $version = [string]$record.version
    } else {
        $listing = (Get-WebText 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json') | ConvertFrom-Json
        $version = [string]$listing.channels.Stable.version
        $download = @($listing.channels.Stable.downloads.chrome | Where-Object { $_.platform -eq 'win64' })
        if (-not $version -or $download.Count -eq 0) { throw 'Chrome for Testing lists no Stable win64 build.' }
        $url = [string]$download[0].url
    }
    if (-not $url) {
        $url = 'https://storage.googleapis.com/chrome-for-testing-public/' + $version + '/win64/chrome-win64.zip'
    }
    $target = Join-Path $Tools ('chrome-' + $version)
    $sameVersion = $null -ne $record -and $record.version -eq $version
    if ($sameVersion -and $record.home -ieq $target -and (Test-ToolHash $record)) {
        Set-StepResult 'skipped' ('Chrome ' + $version + ' (pinned)')
        return
    }
    # Chrome for Testing publishes no hashes: a recorded one (same version) is enforced.
    $expected = ''
    if ($sameVersion -and $record.archiveSha256) { $expected = [string]$record.archiveSha256 }
    $archiveSha = Install-Archive -Label 'chrome' -Url $url -Algorithm 'SHA256' -Expected $expected -Target $target
    $exe = Join-Path $target 'chrome.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Chrome archive has no chrome.exe' }
    # Chrome's sandboxed network service needs read access for ALL APPLICATION PACKAGES, which
    # folders directly under C:\ lack (its installer adds it under Program Files). Without it
    # every launch logs "Sandbox cannot access executable". Scoped to this folder only.
    $acl = Invoke-Native (Join-Path $env:SystemRoot 'System32\icacls.exe') @($target, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '/T', '/C', '/Q')
    if ($acl.Code -ne 0) { Write-Warning ('Could not grant sandbox read access on ' + $target + ' (icacls exit ' + $acl.Code + ').') }
    $fileVersion = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion
    if ($fileVersion -ne $version) { Write-Warning ('chrome.exe reports ' + $fileVersion + ', expected ' + $version) }
    $launch = Test-ChromeLaunch $exe
    if (-not $launch) { Write-Warning 'Headless Chrome did not start (--dump-dom about:blank).' }
    Set-Record 'chrome' ([ordered]@{ version = $version; home = $target; exe = $exe; probe = 'chrome.exe'; probeSha256 = (Get-Sha $exe)
        url = $url; archiveSha256 = $archiveSha; firstUse = $(if ($expected) { $false } else { $true }); headlessLaunch = $launch
        source = 'chrome-for-testing'; date = (Get-Stamp) })
    Set-StepResult 'done' ('Chrome ' + $version + ' at ' + $target)
}

# ---- steps: listener and fixtures ------------------------------------------------------------

function Invoke-ListenerStep {
    $junit = Join-Path $Plugin 'adapters\junit'
    $pom = Join-Path $junit 'pom.xml'
    if (-not (Test-Path -LiteralPath $pom -PathType Leaf)) { throw ('Missing ' + $pom) }
    $mvn = Get-MavenCmd
    $null = Get-ToolHome 'jdk' 'bin\javac.exe'
    $xml = New-Object Xml.XmlDocument
    $xml.Load($pom)
    $groupId = [string]$xml.project.groupId
    $artifactId = [string]$xml.project.artifactId
    $version = [string]$xml.project.version
    if (-not $groupId -or -not $artifactId -or -not $version) { throw 'Cannot read the listener coordinates from pom.xml' }
    $m2 = Join-Path $env:USERPROFILE '.m2\repository'
    $installed = Join-Path $m2 (($groupId -replace '\.', '\') + '\' + $artifactId + '\' + $version + '\' + $artifactId + '-' + $version + '.jar')
    $sources = @(Get-Item -LiteralPath $pom) + @(Get-ChildItem -LiteralPath (Join-Path $junit 'src') -Recurse -File)
    $sourceSha = Get-FilesHash $junit $sources
    $record = Get-Record 'listener'
    if ($null -ne $record -and $record.sourceSha256 -eq $sourceSha -and (Test-Path -LiteralPath $installed -PathType Leaf) -and
        (Get-Sha $installed) -eq ([string]$record.jarSha256)) {
        Set-StepResult 'skipped' ($groupId + ':' + $artifactId + ':' + $version + ' installed')
        return
    }
    # Build in a scratch copy so the plugin checkout stays untouched.
    $work = Join-Path $cache 'listener'
    Remove-Tree $work
    $null = New-Item -ItemType Directory -Force -Path $work
    Copy-Item -LiteralPath $pom -Destination $work
    Copy-Item -LiteralPath (Join-Path $junit 'src') -Destination $work -Recurse
    $build = Invoke-Native $mvn @('-B', '-DskipTests', 'package') -WorkDir $work -Log (Join-Path $logs 'listener-build.log')
    Assert-NativeOk $build 'Listener build'
    $jar = Join-Path $work ('target\' + $artifactId + '-' + $version + '.jar')
    if (-not (Test-Path -LiteralPath $jar -PathType Leaf)) { throw ('Build produced no ' + $jar) }
    $install = Invoke-Native $mvn @('-B', 'install:install-file', ('-Dfile=' + $jar), ('-DpomFile=' + (Join-Path $work 'pom.xml'))) `
        -WorkDir $work -Log (Join-Path $logs 'listener-install.log')
    Assert-NativeOk $install 'Listener install'
    if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { throw ('Install left no ' + $installed) }
    Set-Record 'listener' ([ordered]@{ groupId = $groupId; artifactId = $artifactId; version = $version; jar = $installed
        jarSha256 = (Get-Sha $installed); sourceSha256 = $sourceSha; date = (Get-Stamp) })
    Set-StepResult 'done' ($groupId + ':' + $artifactId + ':' + $version + ' built in ' + $build.Seconds + ' s, installed')
}

# Collector Node: TEST_PROGRESS_NODE, then PATH, then the highest nvm-windows install; must be >= 14.
function Find-CollectorNode {
    $candidates = New-Object Collections.Generic.List[string]
    if ($env:TEST_PROGRESS_NODE) { $candidates.Add($env:TEST_PROGRESS_NODE) }
    foreach ($command in @(Get-Command -Name node.exe -CommandType Application -All -ErrorAction SilentlyContinue)) {
        $candidates.Add($command.Source)
    }
    if ($env:NVM_HOME -and (Test-Path -LiteralPath $env:NVM_HOME -PathType Container)) {
        $installs = @(Get-ChildItem -LiteralPath $env:NVM_HOME -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^v\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name.Substring(1) } -Descending)
        foreach ($install in $installs) { $candidates.Add((Join-Path $install.FullName 'node.exe')) }
    }
    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        # An nvm 2.x shim may download a Node when run; never execute one.
        if ((Get-Item -LiteralPath $candidate).VersionInfo.FileDescription -eq 'Node.js shim') { continue }
        $line = Get-ToolVersionLine $candidate @('--version')
        if ($line -match '^v(\d+)\.' -and [int]$Matches[1] -ge 14) { return $candidate }
    }
    throw 'No Node >= 14 found for the collector (PATH, TEST_PROGRESS_NODE or nvm-windows).'
}

function Invoke-FixturesStep {
    $generator = Join-Path $Plugin 'scripts\bench\generate.mjs'
    if (-not (Test-Path -LiteralPath $generator -PathType Leaf)) { throw ('Missing ' + $generator + '; use a plugin checkout that has scripts\bench.') }
    $node = Find-CollectorNode
    Write-Host ('  generator Node: ' + $node)
    $scaleText = $Scale.ToString([Globalization.CultureInfo]::InvariantCulture)
    $result = Invoke-Native $node @($generator, '--out', $Fixtures, '--scale', $scaleText, '--plugin', $Plugin, '--platform', 'win32') `
        -Log (Join-Path $logs 'fixtures.log')
    Assert-NativeOk $result 'Fixture generation'
    foreach ($item in @('manifest.json', 'ng9-a', 'ng9-b', 'mvn-a', 'mvn-b', 'py-a', 'py-b')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Fixtures $item))) { throw ('Generator left no ' + $item + ' in ' + $Fixtures) }
    }
    Set-StepResult 'done' ('generated in ' + $result.Seconds + ' s at scale ' + $scaleText)
}

# ---- steps: project dependencies -------------------------------------------------------------

function Invoke-NpmStep {
    $nodeHome = Get-ToolHome 'node14' 'node.exe'
    $npm = Join-Path $nodeHome 'npm.cmd'
    $details = @()
    $ran = 0
    foreach ($name in $angularProjects) {
        $dir = Join-Path $Fixtures $name
        $lock = Join-Path $dir 'package-lock.json'
        if (-not (Test-Path -LiteralPath $lock -PathType Leaf)) { throw ('Missing ' + $lock + '; run the fixtures step first.') }
        $marker = Join-Path $dir 'node_modules\.tp-bench-lock'
        $wanted = (Get-Sha $lock) + ' node ' + $NodeVersion
        if ((Test-Path -LiteralPath $marker -PathType Leaf) -and ((Get-Content -LiteralPath $marker -Raw).Trim() -eq $wanted)) {
            $details += ($name + ' up to date')
            continue
        }
        Write-Host ('  npm ci in ' + $name)
        $result = Invoke-Native $npm @('ci', '--no-audit', '--no-fund') -WorkDir $dir -WithNode -Log (Join-Path $logs ('npm-' + $name + '.log'))
        Assert-NativeOk $result ('npm ci in ' + $name)
        if (-not (Test-Path -LiteralPath (Join-Path $dir 'node_modules') -PathType Container)) { throw ('npm ci left no node_modules in ' + $name) }
        [IO.File]::WriteAllText($marker, $wanted + "`n", $utf8)
        $details += ($name + ' installed in ' + $result.Seconds + ' s')
        $ran++
    }
    $status = 'skipped'
    if ($ran -gt 0) { $status = 'done' }
    Set-StepResult $status ($details -join '; ')
}

function Invoke-WrapperStep {
    $dir = Join-Path $Fixtures 'mvn-a'
    if (-not (Test-Path -LiteralPath (Join-Path $dir 'pom.xml') -PathType Leaf)) { throw ('Missing ' + $dir + '\pom.xml; run the fixtures step first.') }
    $wrapper = Join-Path $dir 'mvnw.cmd'
    if ((Test-Path -LiteralPath $wrapper -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $dir '.mvn\wrapper\maven-wrapper.properties') -PathType Leaf)) {
        Set-StepResult 'skipped' 'mvnw.cmd present'
        return
    }
    $null = Get-ToolHome 'jdk' 'bin\java.exe'
    $result = Invoke-Native (Get-MavenCmd) @('-B', '-N', 'org.apache.maven.plugins:maven-wrapper-plugin:3.3.2:wrapper',
        '-Dtype=only-script', ('-Dmaven=' + $MavenVersion)) -WorkDir $dir -Log (Join-Path $logs 'wrapper.log')
    Assert-NativeOk $result 'Maven wrapper generation'
    if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) { throw 'The wrapper plugin left no mvnw.cmd' }
    Set-StepResult 'done' ('mvnw.cmd created in ' + $result.Seconds + ' s')
}

function Invoke-WarmupStep {
    $null = Get-ToolHome 'jdk' 'bin\java.exe'
    $mvn = Get-MavenCmd
    $projects = @(
        [pscustomobject]@{ Name = 'mvn-a'; Exe = (Join-Path (Join-Path $Fixtures 'mvn-a') 'mvnw.cmd') },
        [pscustomobject]@{ Name = 'mvn-b'; Exe = $mvn }
    )
    $poms = @()
    foreach ($project in $projects) {
        $dir = Join-Path $Fixtures $project.Name
        if (-not (Test-Path -LiteralPath (Join-Path $dir 'pom.xml') -PathType Leaf)) { throw ('Missing ' + $dir + '\pom.xml; run the fixtures step first.') }
        if (-not (Test-Path -LiteralPath $project.Exe -PathType Leaf)) { throw ('Missing ' + $project.Exe + '; run the wrapper step first.') }
        $poms += @(Get-ChildItem -LiteralPath $dir -Recurse -Filter 'pom.xml' -File | Where-Object { $_.FullName -notmatch '\\(target|node_modules)\\' })
    }
    $key = Get-StringSha ((Get-FilesHash $Fixtures $poms) + '|' + (Get-Field 'maven' 'version') + '|' + (Get-Field 'jdk' 'release'))
    $record = Get-Record 'warmup'
    if ($null -ne $record -and $record.key -eq $key) {
        Set-StepResult 'skipped' ('already warmed ' + $record.date)
        return
    }
    $details = @()
    $durations = [ordered]@{}
    foreach ($project in $projects) {
        Write-Host ('  ' + $project.Name + ': ' + [IO.Path]::GetFileName($project.Exe) + ' -B test (online)')
        $log = Join-Path $logs ('warmup-' + $project.Name + '.log')
        $result = Invoke-Native $project.Exe @('-B', 'test') -WorkDir (Join-Path $Fixtures $project.Name) -Log $log
        $note = ''
        if ($result.Code -ne 0) {
            # Failing tests are fine (the surefire provider was still resolved); build errors are not.
            $text = Get-Content -LiteralPath $log -Raw
            $testFailure = $text -match 'There are test failures' -or $text -match 'Tests run:.*(Failures|Errors): [1-9]'
            $surefireGoal = $text -match 'Failed to execute goal org\.apache\.maven\.plugins:maven-surefire-plugin:[^\s:]+:test'
            if (-not ($testFailure -and $surefireGoal)) { Assert-NativeOk $result ('Warmup of ' + $project.Name) }
            $note = ', test failures ignored'
        }
        $durations[$project.Name] = $result.Seconds
        $details += ($project.Name + ' ' + $result.Seconds + ' s' + $note)
    }
    Set-Record 'warmup' ([ordered]@{ key = $key; seconds = $durations; date = (Get-Stamp) })
    Set-StepResult 'done' ($details -join '; ')
}

function Find-Python {
    $candidates = New-Object Collections.Generic.List[string]
    # The Microsoft Store alias in WindowsApps is a stub, not an interpreter.
    foreach ($command in @(Get-Command -Name python.exe -CommandType Application -All -ErrorAction SilentlyContinue)) {
        if ($command.Source -notmatch '\\WindowsApps\\') { $candidates.Add($command.Source) }
    }
    foreach ($pattern in @((Join-Path $env:ProgramFiles 'Python3*\python.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python3*\python.exe'))) {
        $found = @(Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Sort-Object { [int]($_.Directory.Name -replace '\D', '') } -Descending)
        foreach ($item in $found) { $candidates.Add($item.FullName) }
    }
    foreach ($candidate in $candidates) {
        $line = Get-ToolVersionLine $candidate @('--version')
        if ($line -match 'Python 3\.(\d+)' -and [int]$Matches[1] -ge 9) { return $candidate }
    }
    throw 'No Python 3.9+ found (python.exe on PATH or C:\Program Files\Python3*).'
}

function Get-PytestVersion([string] $VenvPython) {
    $result = Invoke-Native $VenvPython @('-m', 'pip', '--disable-pip-version-check', 'show', 'pytest')
    foreach ($line in $result.Tail) { if ($line -match '^Version:\s*(\S+)') { return $Matches[1] } }
    ''
}

function Invoke-VenvStep {
    $null = New-Item -ItemType Directory -Force -Path $Fixtures
    $venv = Join-Path $Fixtures '.venv'
    $python = Join-Path $venv 'Scripts\python.exe'
    $created = $false
    $healthy = (Test-Path -LiteralPath $python -PathType Leaf) -and ((Get-ToolVersionLine $python @('--version')) -match '^Python 3\.')
    if (-not $healthy) {
        $base = Find-Python
        Write-Host ('  creating venv with ' + $base)
        $result = Invoke-Native $base @('-m', 'venv', '--clear', $venv) -Log (Join-Path $logs 'venv-create.log')
        Assert-NativeOk $result 'venv creation'
        $created = $true
    }
    $installed = Get-PytestVersion $python
    if ($installed -eq $pytestVersion) {
        $status = 'skipped'
        if ($created) { $status = 'done' }
        Set-StepResult $status ('pytest ' + $installed + ' in ' + $venv)
        return
    }
    $result = Invoke-Native $python @('-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', ('pytest==' + $pytestVersion)) `
        -Log (Join-Path $logs 'venv-pip.log')
    Assert-NativeOk $result 'pip install pytest'
    $installed = Get-PytestVersion $python
    if ($installed -ne $pytestVersion) { throw ('pytest ' + $pytestVersion + ' not installed (found "' + $installed + '").') }
    Set-StepResult 'done' ('pytest ' + $installed + ' in ' + $venv)
}

# ---- runner settings --------------------------------------------------------------------------

function Write-EnvJson {
    $python = Join-Path $Fixtures '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { $python = $null }
    $payload = [ordered]@{
        node14 = (Get-Field 'node14' 'home')
        javaHome = (Get-Field 'jdk' 'home')
        mavenHome = (Get-Field 'maven' 'home')
        chromeBin = (Get-Field 'chrome' 'exe')
        python = $python
        plugin = $Plugin
        nodeVersion = (Get-Field 'node14' 'version')
        jdk = (Get-Field 'jdk' 'release')
        maven = (Get-Field 'maven' 'version')
        chrome = (Get-Field 'chrome' 'version')
    }
    $missing = @($payload.Keys | Where-Object { $null -eq $payload[$_] })
    if ($missing.Count -gt 0) { Write-Warning ('env.json is incomplete, no value for: ' + ($missing -join ', ')) }
    $null = New-Item -ItemType Directory -Force -Path $Fixtures
    $path = Join-Path $Fixtures 'env.json'
    [IO.File]::WriteAllText($path, ($payload | ConvertTo-Json), $utf8)
    Write-Host ('Runner settings: ' + $path)
}

# ---- main -------------------------------------------------------------------------------------

$rows = New-Object Collections.Generic.List[object]
try {
    Write-Host ('Tools ' + $Tools + ' | Fixtures ' + $Fixtures + ' | Plugin ' + $Plugin + ' | PowerShell ' + $PSVersionTable.PSVersion)
    foreach ($step in $allSteps) {
        if ($requested -notcontains $step) { continue }
        Write-Host ('== ' + $step)
        Set-StepResult 'done' ''
        $watch = [Diagnostics.Stopwatch]::StartNew()
        try {
            $null = switch ($step) {
                'node14' { Invoke-Node14Step }
                'jdk' { Invoke-JdkStep }
                'maven' { Invoke-MavenStep }
                'chrome' { Invoke-ChromeStep }
                'listener' { Invoke-ListenerStep }
                'fixtures' { Invoke-FixturesStep }
                'npm' { Invoke-NpmStep }
                'wrapper' { Invoke-WrapperStep }
                'warmup' { Invoke-WarmupStep }
                'venv' { Invoke-VenvStep }
            }
        } catch {
            $message = ($_.Exception.Message -replace '\s+', ' ')
            Set-StepResult 'failed' $message.Substring(0, [Math]::Min(300, $message.Length))
            Write-Host ('  FAILED: ' + $message) -ForegroundColor Red
        }
        $watch.Stop()
        $rows.Add([pscustomobject]@{ Step = $step; Status = $script:stepStatus
            Seconds = [Math]::Round($watch.Elapsed.TotalSeconds, 1); Detail = $script:stepDetail })
    }
    try { Write-EnvJson } catch { Write-Warning ('Could not write env.json: ' + $_.Exception.Message) }
} finally {
    [Net.ServicePointManager]::SecurityProtocol = $previousProtocol
    $runLock.Dispose()
}

$rows | Format-Table Step, Status, Seconds, Detail -AutoSize -Wrap | Out-String -Width 200 | Write-Host
$failed = @($rows | Where-Object { $_.Status -eq 'failed' }).Count
if ($failed -gt 0) {
    Write-Host ($failed.ToString() + ' step(s) failed; logs are in ' + $logs) -ForegroundColor Red
    exit 1
}
exit 0
