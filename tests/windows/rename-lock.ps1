[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $TargetPath,
    [Parameter(Mandatory = $true)][string] $ReadyPath,
    [Parameter(Mandatory = $true)][string] $BeginPath,
    [Parameter(Mandatory = $true)][ValidateRange(1, 10000)][int] $HoldMilliseconds
)
$ErrorActionPreference = 'Stop'
foreach ($path in @($TargetPath, $ReadyPath, $BeginPath)) {
    if (-not [IO.Path]::IsPathRooted($path)) { throw 'Fixture paths must be absolute.' }
}
# Deliberately omit Delete to reproduce a real rename sharing conflict.
$stream = [IO.File]::Open($TargetPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
try {
    [IO.File]::WriteAllText($ReadyPath, 'ready')
    # Start the hold interval only after the writer is ready, excluding engine
    # startup and scheduling before it observes our open-handle marker.
    $waiting = [Diagnostics.Stopwatch]::StartNew()
    while (-not [IO.File]::Exists($BeginPath)) {
        if ($waiting.ElapsedMilliseconds -ge 10000) { throw 'Rename writer did not acknowledge readiness.' }
        Start-Sleep -Milliseconds 5
    }
    Start-Sleep -Milliseconds $HoldMilliseconds
} finally { $stream.Dispose() }
Write-Output 'Rename lock released'
