param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Run', 'Identity', 'State', 'Group', 'Kill', 'SecureDirectory')]
    [string] $Action,
    [string] $JobFile,
    [int] $ProcessId,
    [string] $StartTime,
    [string] $Owner,
    [string] $JobName,
    [int] $SessionId = -1,
    [string] $Directory
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -Path (Join-Path $PSScriptRoot 'WindowsProcessHost.cs')

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
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, $null) }
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
if ($Action -eq 'SecureDirectory') {
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
    Write-Control @{ secured = $true; owner = $user.Value }
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
Assert-PrivatePath $JobFile
if ((Get-Item -LiteralPath $JobFile).Length -gt 1048576) { throw 'Private job exceeds size limit.' }
$job = [IO.File]::ReadAllText($JobFile) | ConvertFrom-Json
if ($job.schemaVersion -ne 2 -or $job.moduleId -cnotmatch '^[a-z][a-z0-9-]{0,47}$' -or
    $job.moduleId -in @('all', 'constructor', 'prototype', 'con', 'prn', 'aux', 'nul') -or
    $job.moduleId -match '^(?:com|lpt)[1-9]$') {
    throw 'Invalid v2 job or module identity.'
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
$claim = [IO.File]::ReadAllText($claimPath) | ConvertFrom-Json
if ($claim.schemaVersion -ne 2 -or $claim.moduleId -cne $job.moduleId -or $claim.runId -cne $job.runId) {
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
        $cancel = [IO.File]::ReadAllText($cancelFile) | ConvertFrom-Json
        if ($cancel.schemaVersion -eq 2 -and $cancel.moduleId -ceq $job.moduleId -and $cancel.runId -ceq $job.runId) {
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
        $cancel = [IO.File]::ReadAllText($cancelFile) | ConvertFrom-Json
            if ($cancel.schemaVersion -eq 2 -and $cancel.moduleId -ceq $job.moduleId -and $cancel.runId -ceq $job.runId) {
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
