param([Parameter(ValueFromRemainingArguments = $true)][string[]] $CliArgs = @())
$ErrorActionPreference = 'Stop'
try {
    $claudeExecutable = 'claude'
    if (-not [string]::IsNullOrWhiteSpace($env:CLAUDE_BIN)) { $claudeExecutable = $env:CLAUDE_BIN }
    $command = Get-Command -Name $claudeExecutable -CommandType Application, ExternalScript -ErrorAction Stop | Select-Object -First 1
    . (Join-Path $PSScriptRoot 'runtime/node-discovery.ps1')
    # Check availability only. Every collector resolves its own cwd later.
    $availableNode = Select-TestProgressCollectorNode (Get-Location).ProviderPath
    $LASTEXITCODE = 0
    $versionOutput = & $command.Source '--version'
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível consultar a versão do Claude.' }
    $versionText = $versionOutput -join "`n"
    if ($versionText -notmatch '([0-9]+)\.([0-9]+)\.([0-9]+)') {
        throw "Não foi possível identificar a versão do Claude: $versionText"
    }
    $version = [version]($Matches[1] + '.' + $Matches[2] + '.' + $Matches[3])
    if ($version -lt [version]'2.1.289') { throw "Mods requer Claude 2.1.289+. Encontrado: $versionText" }
    # PowerShell's call operator invokes .cmd/.bat wrappers through their host.
    & $command.Source '--plugin-dir' $PSScriptRoot @CliArgs
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('test-progress: ' + $_.Exception.Message)
    exit 1
}
