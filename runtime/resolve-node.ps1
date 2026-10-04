[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('collector', 'project')][string] $Mode,
    [Parameter(Mandatory = $true)][string] $Cwd
)
$ErrorActionPreference = 'Stop'
# The JavaScript driver consumes UTF-8 JSON, including non-ASCII Windows paths.
[Console]::OutputEncoding = New-Object Text.UTF8Encoding -ArgumentList $false
try {
    . (Join-Path $PSScriptRoot 'node-discovery.ps1')
    if ($Mode -eq 'collector') { $descriptor = Select-TestProgressCollectorNode $Cwd }
    else { $descriptor = Select-TestProgressProjectNode $Cwd }
    $descriptor | ConvertTo-Json -Compress
    exit 0
} catch {
    [Console]::Error.WriteLine('test-progress: ' + $_.Exception.Message)
    exit 1
}
