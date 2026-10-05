[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$source = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'runtime/windows-process.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Broker source could not be parsed.' }
# Run the actual broker functions without loading its Win32 entry point.
# This same regression also runs with PowerShell 7 on Linux.
$names = @('Write-AtomicJson', 'Assert-PrivatePath', 'Assert-Absolute')
$definitions = $ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $names
}, $true)
if ($definitions.Count -ne $names.Count) { throw 'Broker atomic writer functions are missing.' }
foreach ($definition in $definitions) {
    . ([ScriptBlock]::Create($definition.Extent.Text))
}
$directory = Join-Path ([IO.Path]::GetTempPath()) ('test-progress-atomic-' + [Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($directory)
$file = Join-Path $directory 'proof.json'
try {
    Write-AtomicJson $file @{ resumed = $false }
    Write-AtomicJson $file @{ resumed = $true }
    Write-AtomicJson $file @{ resumed = $true; treeEmpty = $true; exitCode = 0 }
    $proof = [IO.File]::ReadAllText($file) | ConvertFrom-Json
    if (-not $proof.resumed -or -not $proof.treeEmpty -or $proof.exitCode -ne 0) { throw 'Latest broker proof was lost.' }
    if (@(Get-ChildItem -LiteralPath $directory).Count -ne 1) { throw 'Unexpected proof or temporary files remain.' }
    Write-Output 'Broker atomic proof replacement with no backup: OK'
} finally { [IO.Directory]::Delete($directory, $true) }
