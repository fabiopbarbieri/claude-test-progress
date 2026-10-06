param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Run', 'Identity', 'IdentityMany', 'State', 'StateMany', 'Group', 'Kill', 'SecureDirectory', 'LaunchCoordinator')]
    [string] $Action,
    [string] $JobFile,
    [int] $ProcessId,
    [string] $StartTime,
    [string] $Owner,
    [string] $JobName,
    [int] $SessionId = -1,
    [string] $Directory,
    [string] $Child,
    [string] $CacheDirectory,
    [string] $Collector,
    [string] $Queries,
    [int] $SelfProcessId
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# Compiling WindowsProcessHost.cs costs most of a short control call. Reuse an assembly
# compiled earlier into the private state root, keyed by source hash and runtime. Only a
# plain file owned by this user, Administrators or SYSTEM (elevated tokens create files
# owned by Administrators) is loaded; any other doubt falls back to compiling in memory.
function Test-TrustedAssembly([string] $Path) {
    try {
        $info = New-Object IO.FileInfo($Path)
        if (-not $info.Exists -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
        $sections = [Security.AccessControl.AccessControlSections]::Owner
        if ($PSVersionTable.PSVersion.Major -ge 6) { $acl = [IO.FileSystemAclExtensions]::GetAccessControl($info, $sections) }
        else { $acl = $info.GetAccessControl($sections) }
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        return $owner -in @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-32-544', 'S-1-5-18')
    } catch { return $false }
}
function Import-ProcessHost {
    $source = Join-Path $PSScriptRoot 'WindowsProcessHost.cs'
    $cached = $null
    try {
        if ($CacheDirectory -and [IO.Path]::IsPathRooted($CacheDirectory) -and [IO.Directory]::Exists($CacheDirectory) -and
            ([IO.File]::GetAttributes($CacheDirectory) -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $digest = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($source))).Replace('-', '').Substring(0, 16) }
            finally { $sha.Dispose() }
            $runtime = [Environment]::Version.ToString() + '-' + $PSVersionTable.PSVersion.Major
            $cached = Join-Path $CacheDirectory ('host-' + $runtime + '-' + $digest.ToLowerInvariant() + '.dll')
        }
    } catch { $cached = $null }
    if ($cached -and -not [IO.File]::Exists($cached)) {
        $temporary = $cached + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
        try {
            Add-Type -Path $source -OutputAssembly $temporary -OutputType Library
            # A concurrent process may publish the same key first; that file is checked below.
            [IO.File]::Move($temporary, $cached)
        } catch {
        } finally {
            try { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } } catch { }
        }
    }
    if ($cached -and (Test-TrustedAssembly $cached)) {
        try { $null = [Reflection.Assembly]::LoadFrom($cached); return } catch { }
    }
    if (-not ('TestProgress.WindowsProcessHost' -as [type])) { Add-Type -Path $source }
}
Import-ProcessHost

function Write-Control($Value) {
    [Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress -Depth 8))
}
function Write-AtomicJson([string] $Path, $Value) {
    Assert-PrivatePath (Split-Path -Parent $Path)
    if ([IO.File]::Exists($Path)) { Assert-PrivatePath $Path }
    $temporary = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        $json = ($Value | ConvertTo-Json -Compress -Depth 8) + "`n"
        [IO.File]::WriteAllText($temporary, $json, (New-Object System.Text.UTF8Encoding($false)))
        # PowerShell coerces $null to an empty string for this .NET parameter.
        # NullString passes an actual null backup filename on both engines.
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $Path) }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}
function Assert-Absolute([string] $Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path)) {
        throw 'An absolute path is required.'
    }
}

if ($Action -eq 'IdentityMany' -or $Action -eq 'StateMany') {
    if ([string]::IsNullOrWhiteSpace($Queries) -or $Queries.Length -gt 65536 -or
        -not $Queries.TrimStart().StartsWith('[') -or -not $Queries.TrimEnd().EndsWith(']')) {
        throw 'Windows queries must be a bounded JSON array.'
    }
    # An object property preserves empty/singleton arrays and null entries on
    # PowerShell 5.1 as well as 7, without pipeline array enumeration.
    $parsed = ('{"items":' + $Queries + '}') | ConvertFrom-Json
    $items = @($parsed.items)
    if ($items.Count -gt 64) { throw 'Windows queries exceed 64 items.' }
    # Validate every entry before invoking any native process query.
    foreach ($entry in $items) {
        $queryPid = $entry
        if ($Action -eq 'StateMany') { $queryPid = $entry.pid }
        if (($queryPid -isnot [int] -and $queryPid -isnot [long]) -or $queryPid -le 0 -or $queryPid -gt [int]::MaxValue) {
            throw 'Windows query PID must be a positive Int32.'
        }
        if ($Action -eq 'StateMany' -and
            ($entry.startTime -isnot [string] -or $entry.startTime -cnotmatch '^[0-9]{1,20}$' -or
             $entry.owner -isnot [string] -or $entry.owner.Length -gt 184 -or $entry.owner -cnotmatch '^S-[0-9]+(?:-[0-9]+)+$')) {
            throw 'Windows state query identity is invalid.'
        }
    }
    if ($SelfProcessId -lt 0 -or ($SelfProcessId -gt 0 -and $Action -ne 'StateMany')) {
        throw 'Invalid self identity query.'
    }
    $results = New-Object 'System.Collections.Generic.List[object]'
    foreach ($entry in $items) {
        if ($Action -eq 'IdentityMany') {
            try { $results.Add([TestProgress.WindowsProcessHost]::Identity([int]$entry)) }
            catch { $results.Add($null) }
        } else {
            try { $results.Add([TestProgress.WindowsProcessHost]::State([int]$entry.pid, $entry.startTime, $entry.owner) -eq 'present') }
            catch { $results.Add($false) }
        }
    }
    if ($Action -eq 'IdentityMany') {
        Write-Control @{ identities = $results.ToArray() }
    } else {
        $originalSelf = $null
        if ($SelfProcessId -gt 0) {
            try { $originalSelf = [TestProgress.WindowsProcessHost]::Identity($SelfProcessId) } catch { }
        }
        Write-Control @{ matches = $results.ToArray(); selfIdentity = $originalSelf }
    }
    exit 0
}
if ($Action -eq 'Identity') {
    Write-Control ([TestProgress.WindowsProcessHost]::Identity($ProcessId))
    exit 0
}
if ($Action -eq 'State') {
    Write-Control @{ state = [TestProgress.WindowsProcessHost]::State($ProcessId, $StartTime, $Owner) }
    exit 0
}
if ($Action -eq 'Group') {
    Write-Control @{ state = [TestProgress.WindowsProcessHost]::Group($JobName, $SessionId) }
    exit 0
}
if ($Action -eq 'Kill') {
    [TestProgress.WindowsProcessHost]::KillOwned($ProcessId, $StartTime, $Owner)
    Write-Control @{ killed = $true }
    exit 0
}
function Protect-PrivateDirectory([string] $Directory) {
    Assert-Absolute $Directory
    # Validate the existing chain before creation or any ACL change.
    $existing = Test-Path -LiteralPath $Directory
    if ($existing) { $item = Get-Item -LiteralPath $Directory -Force }
    else { $item = Get-Item -LiteralPath (Split-Path -Parent $Directory) -Force }
    if (-not $item.PSIsContainer) { throw 'Private state path must be a directory.' }
    $ancestor = $item
    while ($null -ne $ancestor) {
        if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Reparse points are not allowed in a private state path.'
        }
        $ancestor = $ancestor.Parent
    }
    $identity = [TestProgress.WindowsProcessHost]::Identity($PID)
    $user = New-Object Security.Principal.SecurityIdentifier($identity.owner)
    $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
    if (-not $existing) {
        [TestProgress.WindowsProcessHost]::CreatePrivateDirectory($Directory, $user.Value)
    }
    $item = Get-Item -LiteralPath $Directory -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Private state directory was substituted during creation.'
    }
    $ancestor = $item
    while ($null -ne $ancestor) {
        if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Reparse points are not allowed in a private state path.'
        }
        $ancestor = $ancestor.Parent
    }
    # Existing state must already be private; never take ownership or repair a
    # permissive directory that could contain another user's injected files.
    $verified = Get-Acl -LiteralPath $Directory
    if ($verified.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user.Value) {
        throw 'Private state directory has a different owner.'
    }
    $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    if (-not $verified.AreAccessRulesProtected) {
        throw 'Private state ACL could not be verified.'
    }
    $rules = @($verified.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 2 -or @($rules.IdentityReference.Value | Select-Object -Unique).Count -ne 2) {
        throw 'Private state ACL has unexpected entries.'
    }
    foreach ($rule in $rules) {
        if ($rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
            $rule.InheritanceFlags -ne $inheritance -or
            $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or
            $rule.IdentityReference.Value -notin @($user.Value, $system.Value)) {
            throw 'Private state ACL has unexpected permissions.'
        }
    }
    $user.Value
}
if ($Action -eq 'SecureDirectory') {
    $owner = Protect-PrivateDirectory $Directory
    if ($Child) {
        # The namespace root and its workspace directory are secured in one control call.
        if (-not [IO.Path]::GetFullPath((Split-Path -Parent $Child)).Equals([IO.Path]::GetFullPath($Directory), [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Private child directory must be directly under its root.'
        }
        $null = Protect-PrivateDirectory $Child
    }
    Write-Control @{ secured = $true; owner = $owner }
    exit 0
}

Assert-Absolute $JobFile
function Assert-PrivatePath([string] $Path) {
    Assert-Absolute $Path
    $item = Get-Item -LiteralPath $Path -Force
    $ancestor = $item
    while ($null -ne $ancestor) {
        if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Reparse points are not allowed in a private state path.'
        }
        if ($ancestor -is [IO.DirectoryInfo]) { $ancestor = $ancestor.Parent }
        else { $ancestor = $ancestor.Directory }
    }
}
function Read-PrivateText([string] $Path) {
    Assert-PrivatePath $Path
    # Readers must permit atomic replacement of the pathname while retaining
    # their original fd. The default ReadAllText share mode blocks Node rename.
    $share = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, $share)
    try {
        if ($stream.Length -gt 1048576) { throw 'Private state exceeds size limit.' }
        $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
}
Assert-PrivatePath $JobFile
if ($Action -eq 'LaunchCoordinator') {
    Assert-Absolute $Collector
    if (-not [IO.File]::Exists($Collector)) { throw 'Collector executable is unavailable.' }
    $request = (Read-PrivateText $JobFile) | ConvertFrom-Json
    $batchGuid = [Guid]::Empty
    if ($request.schemaVersion -ne 1 -or -not [Guid]::TryParse([string]$request.batchId, [ref]$batchGuid)) {
        throw 'Invalid coordinator request.'
    }
    Assert-PrivatePath $request.directory
    $expectedRequest = Join-Path $request.directory ('batch.' + $batchGuid.ToString('D') + '.request.json')
    if ([IO.Path]::GetFullPath($JobFile) -cne [IO.Path]::GetFullPath($expectedRequest)) {
        throw 'Coordinator request path does not match its identity.'
    }
    $runner = Join-Path (Split-Path -Parent $PSScriptRoot) 'runner'
    $coordinator = Join-Path $runner 'module-batch-worker.mjs'
    Write-Control ([TestProgress.WindowsProcessHost]::StartDetached($Collector, [string[]]@($coordinator, $JobFile), $runner))
    exit 0
}
if ((Get-Item -LiteralPath $JobFile).Length -gt 1048576) { throw 'Private job exceeds size limit.' }
$job = (Read-PrivateText $JobFile) | ConvertFrom-Json
if ($job.schemaVersion -ne 1 -or $job.moduleId -cnotmatch '^[a-z][a-z0-9-]{0,47}$' -or
    $job.moduleId -in @('all', 'constructor', 'prototype', 'con', 'prn', 'aux', 'nul') -or
    $job.moduleId -match '^(?:com|lpt)[1-9]$') {
    throw 'Invalid job or module identity.'
}
$runGuid = [Guid]::Empty
if (-not [Guid]::TryParse([string]$job.runId, [ref]$runGuid)) { throw 'Run identity must be a UUID.' }
$JobName = 'Local\claude-test-progress-' + $runGuid.ToString('D')
Assert-Absolute $job.cwd
Assert-Absolute $job.directory
Assert-PrivatePath $job.directory
$expectedJob = Join-Path $job.directory ($job.moduleId + '.' + $runGuid.ToString('D') + '.job.json')
if ([IO.Path]::GetFullPath($JobFile) -cne [IO.Path]::GetFullPath($expectedJob)) { throw 'Job path does not match its identity.' }
$claimPath = Join-Path $job.directory ($job.moduleId + '.lock/claim.json')
Assert-PrivatePath $claimPath
$claim = (Read-PrivateText $claimPath) | ConvertFrom-Json
if ($claim.schemaVersion -ne 1 -or $claim.moduleId -cne $job.moduleId -or $claim.runId -cne $job.runId) {
    throw 'Run claim does not match job identity.'
}
if ($null -eq $job.windowsCommand -or [string]::IsNullOrEmpty($job.windowsCommand.file)) {
    throw 'The private job is missing its validated windowsCommand.'
}
Assert-Absolute $job.windowsCommand.file
$commandArguments = [string[]] @($job.windowsCommand.args)
$cancelFile = Join-Path $job.directory ($job.moduleId + '.cancel.json')
$sidecar = $JobFile + '.windows.json'
$brokerIdentity = [TestProgress.WindowsProcessHost]::Identity($PID)
$proof = @{ schema = 1; runId = $job.runId; brokerIdentity = $brokerIdentity;
    jobName = $JobName; contained = $false; resumed = $false; treeEmpty = $false; exitCode = $null; cancelled = $false }
$hostProcess = $null
$code = 125
try {
    # The only stdout/stderr writer is the native command; proof stays in the sidecar.
    $hostProcess = New-Object TestProgress.WindowsProcessHost($job.windowsCommand.file, $commandArguments, $job.cwd, $JobName)
    $proof.contained = $true
    $proof.brokerIdentity = @{ platform = 'win32'; pid = $brokerIdentity.pid;
        startTime = $brokerIdentity.startTime; owner = $brokerIdentity.owner;
        sessionId = $brokerIdentity.sessionId; jobName = $JobName; managedBroker = $true; contained = $true }
    Write-AtomicJson $sidecar $proof
    # No user command executes before both containment and its durable proof exist.
    if ([IO.File]::Exists($cancelFile)) {
        Assert-PrivatePath $cancelFile
        $cancel = (Read-PrivateText $cancelFile) | ConvertFrom-Json
        if ($cancel.schemaVersion -eq 1 -and $cancel.moduleId -ceq $job.moduleId -and $cancel.runId -ceq $job.runId) {
            $proof.cancelled = $true
            $hostProcess.Cancel()
        }
    }
    if (-not $proof.cancelled) {
        $hostProcess.Resume()
        $proof.resumed = $true
        Write-AtomicJson $sidecar $proof
    }
    while ($hostProcess.ActiveProcesses() -ne 0) {
        if (-not $proof.cancelled -and [IO.File]::Exists($cancelFile)) {
            Assert-PrivatePath $cancelFile
            $cancel = (Read-PrivateText $cancelFile) | ConvertFrom-Json
            if ($cancel.schemaVersion -eq 1 -and $cancel.moduleId -ceq $job.moduleId -and $cancel.runId -ceq $job.runId) {
                $proof.cancelled = $true
                $hostProcess.Cancel()
            }
        }
        Start-Sleep -Milliseconds 50
    }
    $proof.treeEmpty = $true
    $code = $hostProcess.ExitCode()
    $proof.exitCode = $code
    Write-AtomicJson $sidecar $proof
} catch {
    $proof.error = $_.Exception.Message
    if ($null -ne $hostProcess -and $hostProcess.Contained) {
        try {
            $hostProcess.Cancel()
            $deadline = [DateTime]::UtcNow.AddMilliseconds(1500)
            while ($hostProcess.ActiveProcesses() -ne 0 -and [DateTime]::UtcNow -lt $deadline) {
                Start-Sleep -Milliseconds 25
            }
            $proof.treeEmpty = $hostProcess.ActiveProcesses() -eq 0
        } catch { $proof.treeEmpty = $false }
    }
    try { Write-AtomicJson $sidecar $proof } catch { }
    [Console]::Error.WriteLine('Windows broker: ' + $proof.error)
} finally {
    if ($null -ne $hostProcess) { $hostProcess.Dispose() }
}
exit $code
