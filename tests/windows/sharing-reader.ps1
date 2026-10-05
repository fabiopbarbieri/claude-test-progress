[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $Directory)
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$source = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'runtime/windows-process.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
$names = @('Read-PrivateText', 'Assert-PrivatePath', 'Assert-Absolute')
$definitions = $ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $names
}, $true)
if ($errors.Count -or $definitions.Count -ne $names.Count) { throw 'Private reader functions are unavailable.' }
foreach ($definition in $definitions) { . ([ScriptBlock]::Create($definition.Extent.Text)) }
$file = Join-Path $Directory 'sharing.json'
$ready = Join-Path $Directory 'reader.ready'
$stop = Join-Path $Directory 'reader.stop'
$count = 0
[IO.File]::WriteAllText($ready, 'ready')
while (-not [IO.File]::Exists($stop)) {
    $value = (Read-PrivateText $file) | ConvertFrom-Json
    if ($value.moduleId -ne 'sharing' -or $value.payload.Length -ne 65536 -or $value.sequence -lt 0) {
        throw 'Private reader observed incomplete replacement bytes.'
    }
    $count++
}
if ($count -lt 1) { throw 'Private reader did not overlap writes.' }
Write-Output ('Shared private reader observed ' + $count + ' complete versions')
