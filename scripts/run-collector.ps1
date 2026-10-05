[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('start', 'list', 'status', 'cancel', 'logs')][string] $Action,
    [Parameter(Mandatory = $true)][string] $Cwd,
    [Parameter(Mandatory = $true)][string] $Owner,
    [ValidatePattern('^(?:all|[a-z][a-z0-9-]{0,47})$')][string] $Module = 'all',
    [string] $Config
)
$ErrorActionPreference = 'Stop'
try {
    $prototypeRoot = Split-Path -Parent $PSScriptRoot
    . (Join-Path $prototypeRoot 'runtime/node-discovery.ps1')
    $descriptor = Select-TestProgressCollectorNode $Cwd
    # Scalar parameters work with powershell.exe -File in Windows PowerShell 5.1.
    $cliArgs = @($Action, '--cwd', $Cwd, '--owner', $Owner, '--module', $Module)
    if ($Config) { $cliArgs += @('--config', $Config) }
    $previousSource = [Environment]::GetEnvironmentVariable('TEST_PROGRESS_NODE_SOURCE', 'Process')
    $previousOutputEncoding = [Console]::OutputEncoding
    try {
        [Environment]::SetEnvironmentVariable('TEST_PROGRESS_NODE_SOURCE', $descriptor.source, 'Process')
        [Console]::OutputEncoding = New-Object Text.UTF8Encoding -ArgumentList $false
        & $descriptor.path (Join-Path $prototypeRoot 'runner/cli.mjs') @cliArgs
        $result = $LASTEXITCODE
    } finally {
        [Environment]::SetEnvironmentVariable('TEST_PROGRESS_NODE_SOURCE', $previousSource, 'Process')
        [Console]::OutputEncoding = $previousOutputEncoding
    }
    exit $result
} catch {
    [Console]::Error.WriteLine('test-progress: ' + $_.Exception.Message)
    exit 1
}
