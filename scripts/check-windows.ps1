[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $NodePath,
    [Parameter(Mandatory = $true)][string] $ProjectNode
)
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This gate requires native Windows; parsing on another OS is not acceptance.'
}
if ($PSVersionTable.PSVersion.Major -ne 5 -and $PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Run this gate separately on Windows PowerShell 5.1 and PowerShell 7.'
}
$root = Split-Path -Parent $PSScriptRoot
foreach ($script in @(Get-ChildItem -LiteralPath $root -Recurse -Filter '*.ps1' -File)) {
    $tokens = $null
    $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw ('PowerShell parse failed: ' + $script.Name) }
}
$engine = (Get-Process -Id $PID).Path
$names = @('TEST_PROGRESS_NODE', 'TEST_PROGRESS_POWERSHELL', 'TEST_PROGRESS_PROJECT_NODE')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:TEST_PROGRESS_NODE = (Resolve-Path -LiteralPath $NodePath).ProviderPath
    $env:TEST_PROGRESS_POWERSHELL = $engine
    $env:TEST_PROGRESS_PROJECT_NODE = (Resolve-Path -LiteralPath $ProjectNode).ProviderPath
    Write-Output ('Native Windows gate; PowerShell ' + $PSVersionTable.PSVersion.ToString())
    # Measure the same fresh-process Add-Type/PInvoke path used by the collector.
    $probe = [Diagnostics.Stopwatch]::StartNew()
    $identity = & $engine -NoLogo -NoProfile -NonInteractive -File (Join-Path $root 'runtime/windows-process.ps1') -Action Identity -ProcessId $PID
    if ($LASTEXITCODE -ne 0 -or -not (($identity | ConvertFrom-Json).owner)) { throw 'Native process identity probe failed.' }
    Write-Output ('Fresh PowerShell control startup: ' + $probe.ElapsedMilliseconds + ' ms')
    & $env:TEST_PROGRESS_NODE (Join-Path $root 'tests/windows/native.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Native Windows modules gate failed.' }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
