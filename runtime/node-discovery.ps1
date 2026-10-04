# PowerShell 5.1/7 library. Only selectors return public descriptors.
# No nvm commands, downloads, activation, or PATH changes are performed.

function ConvertTo-TestProgressNativeArgument {
    param([AllowEmptyString()][string] $Value)
    # Windows CommandLineToArgvW quoting; also accepted by ProcessStartInfo on Unix.
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Test-TestProgressAbsolutePath {
    param([string] $Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path)) { return $false }
    # IsPathRooted alone accepts C:relative and \drive-relative on Windows.
    if ([IO.Path]::DirectorySeparatorChar -eq '\') {
        return ($Path -match '^[a-z]:[/\\]' -or $Path -match '^[/\\]{2}[^/\\]+[/\\][^/\\]+([/\\]|$)')
    }
    return $true
}

function Get-TestProgressCwd {
    param([string] $Cwd)
    if (-not (Test-TestProgressAbsolutePath $Cwd) -or
        -not (Test-Path -LiteralPath $Cwd -PathType Container)) {
        throw '--cwd deve indicar um diretório absoluto existente.'
    }
    $resolved = Resolve-Path -LiteralPath $Cwd -ErrorAction Stop
    if ($resolved.Provider.Name -ne 'FileSystem') { throw '--cwd deve usar o sistema de arquivos.' }
    return $resolved.ProviderPath
}

function Test-TestProgressLocalPath {
    param([string] $Path)
    if (-not (Test-TestProgressAbsolutePath $Path) -or
        $Path -match '^[/\\]{2}' -or $Path -match '^[a-z]+://') { return $false }
    try {
        $drive = New-Object IO.DriveInfo -ArgumentList ([IO.Path]::GetPathRoot($Path))
        if ($drive.DriveType -eq [IO.DriveType]::Network) { return $false }
    } catch { return $false }
    return $true
}

function Get-TestProgressNvm2Roots {
    # Read-only discovery; these are installation inventories, not activation.
    # Follow the community CLI's policy/preferences precedence. On Unix there
    # are no Registry drives, so portable parsing/probing needs no Windows API.
    $keys = @(
        'HKLM:\Software\Policies\Author Software\nvm',
        'HKCU:\Software\Policies\Author Software\nvm',
        'HKLM:\Software\Author Software\Preferences\nvm',
        'HKCU:\Software\Author Software\Preferences\nvm'
    )
    foreach ($key in $keys) {
        $drive = $key.Split(':')[0]
        if (-not (Get-PSDrive -Name $drive -ErrorAction SilentlyContinue)) { continue }
        try {
            $setting = Get-ItemProperty -LiteralPath $key -Name InstallRoot -ErrorAction Stop
            if ($setting.InstallRoot -is [string]) {
                $root = [Environment]::ExpandEnvironmentVariables($setting.InstallRoot)
                if (Test-TestProgressLocalPath $root) { return $root }
            }
        } catch { }
    }
    if (Test-TestProgressLocalPath $env:LOCALAPPDATA) {
        $root = Join-Path $env:LOCALAPPDATA 'Author Software/nvm/installs'
        if (Test-TestProgressLocalPath $root) { return $root }
    }
}

function Test-TestProgressNvmShim {
    param([string] $Candidate)
    # File metadata is inspected without executing the nvm 2.x shim. It may
    # auto-install a missing project runtime even for an innocent `node -e`.
    try {
        $metadata = [Diagnostics.FileVersionInfo]::GetVersionInfo($Candidate)
        if ($metadata.ProductName -eq 'NVM for Windows' -or
            $metadata.FileDescription -eq 'Node.js shim' -or
            $metadata.OriginalFilename -eq 'shim.exe') { return $true }
    } catch { }
    foreach ($root in @(Get-TestProgressNvm2Roots)) {
        $parent = Split-Path -Parent $root
        foreach ($directory in @('.shim', '.nodejs')) {
            $shim = Join-Path (Join-Path $parent $directory) 'node.exe'
            if ([IO.Path]::GetFullPath($Candidate) -eq [IO.Path]::GetFullPath($shim)) { return $true }
        }
    }
    return $false
}

function Test-TestProgressLocalItem {
    param([string] $Path)
    if (-not (Test-TestProgressLocalPath $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($null -eq $item) { return $false }
    if ($item.PSObject.Properties['Target'] -and $item.Target) {
        foreach ($target in @($item.Target)) {
            if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path (Split-Path -Parent $item.FullName) $target }
            if (-not (Test-TestProgressLocalPath $target)) { return $false }
        }
    }
    return $true
}

function Get-TestProgressNodeProbe {
    param([string] $Candidate, [string] $Cwd)
    if (-not [IO.Path]::IsPathRooted($Candidate)) {
        if ($Candidate -match '[/\\]') { $Candidate = Join-Path $Cwd $Candidate }
        else {
            if ($Candidate -match '[*?\[\]]') { return $null }
            $command = Get-Command -Name $Candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($null -eq $command) { return $null }
            $Candidate = $command.Source
        }
    }
    if (Test-TestProgressNvmShim $Candidate) { return $null }
    $process = New-Object Diagnostics.Process
    try {
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $Candidate
        $code = 'process.stdout.write(JSON.stringify({path:process.execPath,version:process.version,lts:(process.release && process.release.lts) || null}))'
        $info.Arguments = '-e ' + (ConvertTo-TestProgressNativeArgument $code)
        $info.WorkingDirectory = $Cwd
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.StandardOutputEncoding = New-Object Text.UTF8Encoding -ArgumentList $false
        $info.StandardErrorEncoding = New-Object Text.UTF8Encoding -ArgumentList $false
        $process.StartInfo = $info
        $deadline = [Diagnostics.Stopwatch]::StartNew()
        if (-not $process.Start()) { return $null }
        # Drain both pipes while waiting so a broken executable cannot fill a pipe.
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $remaining = [Math]::Max(0, 2000 - [int]$deadline.ElapsedMilliseconds)
        if (-not $process.WaitForExit($remaining)) {
            try { $process.Kill() } catch { }
            return $null
        }
        if ($process.ExitCode -ne 0) { return $null }
        $remaining = [Math]::Max(0, 2000 - [int]$deadline.ElapsedMilliseconds)
        if (-not $stdout.Wait($remaining)) { return $null }
        $remaining = [Math]::Max(0, 2000 - [int]$deadline.ElapsedMilliseconds)
        if (-not $stderr.Wait($remaining)) { return $null }
        $probe = $stdout.Result | ConvertFrom-Json -ErrorAction Stop
        if ($probe.path -isnot [string] -or -not (Test-TestProgressAbsolutePath $probe.path) -or
            -not (Test-Path -LiteralPath $probe.path -PathType Leaf) -or
            $probe.version -isnot [string] -or $probe.version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$') {
            return $null
        }
        $lts = $null
        if ($probe.lts -is [string] -and -not [string]::IsNullOrWhiteSpace($probe.lts)) { $lts = $probe.lts }
        return [pscustomobject]@{ path = $probe.path; version = $probe.version; lts = $lts }
    } catch { return $null }
    finally { $process.Dispose() }
}

function Get-TestProgressPathCandidates {
    param([string] $Cwd)
    $seen = @{}
    foreach ($entry in ($env:PATH -split [regex]::Escape([string][IO.Path]::PathSeparator))) {
        $directory = $entry.Trim('"')
        if ([string]::IsNullOrWhiteSpace($directory)) { $directory = $Cwd }
        if (-not [IO.Path]::IsPathRooted($directory)) { $directory = Join-Path $Cwd $directory }
        $candidate = Join-Path $directory 'node.exe'
        if (-not $seen.ContainsKey($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $seen[$candidate] = $true
            $candidate
        }
        # Supports portable syntax/behavior checks on Unix with PowerShell 7.
        if ([IO.Path]::DirectorySeparatorChar -eq '/') {
            $candidate = Join-Path $directory 'node'
            if (-not $seen.ContainsKey($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                $seen[$candidate] = $true
                $candidate
            }
        }
    }
}

function Get-TestProgressNvmCurrentCandidate {
    if (-not (Test-TestProgressLocalPath $env:NVM_SYMLINK) -or
        -not (Test-Path -LiteralPath $env:NVM_SYMLINK -PathType Container)) { return }
    $item = Get-Item -LiteralPath $env:NVM_SYMLINK -Force -ErrorAction SilentlyContinue
    if ($null -eq $item) { return }
    # Check a junction/symlink target too; never follow a network target.
    if ($item.PSObject.Properties['Target'] -and $item.Target) {
        foreach ($target in @($item.Target)) {
            if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path $item.Parent.FullName $target }
            if (-not (Test-TestProgressLocalPath $target)) { return }
        }
    }
    $candidate = Join-Path $item.FullName 'node.exe'
    if ((Test-TestProgressLocalItem $candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { $candidate }
}

function Get-TestProgressNvmCandidates {
    $roots = @(Get-TestProgressNvm2Roots)
    if (Test-TestProgressLocalItem $env:NVM_HOME) {
        $roots += $env:NVM_HOME
        $settings = Join-Path $env:NVM_HOME 'settings.txt'
        if ((Test-TestProgressLocalItem $settings) -and (Test-Path -LiteralPath $settings -PathType Leaf)) {
            foreach ($line in (Get-Content -LiteralPath $settings -ErrorAction Stop)) {
                if ($line -match '^\s*root\s*:\s*(.*?)\s*$') {
                    $settingsRoot = [Environment]::ExpandEnvironmentVariables($Matches[1].Trim('"'))
                    if (Test-TestProgressLocalItem $settingsRoot) { $roots += $settingsRoot }
                }
            }
        }
    }
    $seen = @{}
    # Current first for collector/default fallback; the aliases node/stable/LTS
    # subsequently order actual probed versions, not directory names.
    foreach ($candidate in @(Get-TestProgressNvmCurrentCandidate)) {
        $seen[$candidate] = $true
        $candidate
    }
    $installed = @()
    foreach ($root in ($roots | Select-Object -Unique)) {
        if (-not (Test-TestProgressLocalItem $root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($directory in (Get-ChildItem -LiteralPath $root -Directory -ErrorAction Stop)) {
            if ($directory.Name -notmatch '^v?([0-9]+\.[0-9]+\.[0-9]+)$' -or
                -not (Test-TestProgressLocalItem $directory.FullName)) { continue }
            $version = [version]$Matches[1]
            # Inspect target locality with the same rule used for NVM_SYMLINK.
            $local = $true
            if ($directory.PSObject.Properties['Target'] -and $directory.Target) {
                foreach ($target in @($directory.Target)) {
                    if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path $directory.Parent.FullName $target }
                    if (-not (Test-TestProgressLocalPath $target)) { $local = $false }
                }
            }
            $candidate = Join-Path $directory.FullName 'node.exe'
            if ($local -and (Test-TestProgressLocalItem $candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                $installed += [pscustomobject]@{ path = $candidate; version = $version }
            }
        }
    }
    foreach ($entry in ($installed | Sort-Object -Property version -Descending)) {
        if (-not $seen.ContainsKey($entry.path)) { $seen[$entry.path] = $true; $entry.path }
    }
}

function Test-TestProgressNodeVersion {
    param($Probe, [int] $Minimum = 0, [string] $Selector = '')
    if ($null -eq $Probe) { return $false }
    $version = $Probe.version.Substring(1)
    $major = [int]($version.Split('.')[0])
    if ($major -lt $Minimum) { return $false }
    if ($Selector) {
        $numeric = $Selector -replace '^v', ''
        return ($version -eq $numeric -or $version.StartsWith($numeric + '.', [StringComparison]::Ordinal))
    }
    return $true
}

function New-TestProgressNodeDescriptor {
    param($Probe, [string] $Source, [AllowNull()][string] $Nvmrc)
    $file = $null
    if ($Nvmrc) { $file = $Nvmrc }
    return [pscustomobject]@{ path = $Probe.path; version = $Probe.version; source = $Source; nvmrc = $file }
}

function Select-TestProgressCollectorNode {
    param([string] $Cwd)
    $directory = Get-TestProgressCwd $Cwd
    # An explicit but empty/invalid override is an error, never silent fallback.
    if (Test-Path Env:TEST_PROGRESS_NODE) {
        $probe = $null
        if (-not [string]::IsNullOrWhiteSpace($env:TEST_PROGRESS_NODE)) {
            $probe = Get-TestProgressNodeProbe $env:TEST_PROGRESS_NODE $directory
        }
        if (Test-TestProgressNodeVersion $probe 14) { return New-TestProgressNodeDescriptor $probe 'override' $null }
        throw 'TEST_PROGRESS_NODE deve executar um Node >=14; override inválido não permite fallback.'
    }
    foreach ($candidate in @(Get-TestProgressPathCandidates $directory)) {
        $probe = Get-TestProgressNodeProbe $candidate $directory
        if (Test-TestProgressNodeVersion $probe 14) { return New-TestProgressNodeDescriptor $probe 'path' $null }
    }
    foreach ($candidate in @(Get-TestProgressNvmCandidates)) {
        $probe = Get-TestProgressNodeProbe $candidate $directory
        if (Test-TestProgressNodeVersion $probe 14) { return New-TestProgressNodeDescriptor $probe 'nvm' $null }
    }
    throw 'Node >=14 não encontrado no PATH ou nas instalações locais do nvm-windows; shims nvm 2.x não são executados nem baixam versões.'
}

function Get-TestProgressNvmrc {
    param([string] $Cwd)
    $directory = $Cwd
    while ($directory) {
        $file = Join-Path $directory '.nvmrc'
        if (Get-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue) { return $file }
        $parent = [IO.Directory]::GetParent($directory)
        if ($null -eq $parent) { break }
        $directory = $parent.FullName
    }
    return $null
}

function Get-TestProgressNvmrcSelector {
    param([string] $File)
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw '.nvmrc deve ser um arquivo legível.' }
    $selector = $null
    foreach ($line in (Get-Content -LiteralPath $File -ErrorAction Stop)) {
        $value = ($line -split '#', 2)[0].Trim()
        if (-not $value -or $value.Contains('=')) { continue }
        if ($selector -or $value -match '\s' -or $value.StartsWith('-')) {
            throw '.nvmrc deve conter exatamente um seletor de versão, sem opções.'
        }
        $selector = $value
    }
    if (-not $selector) { throw '.nvmrc não contém um seletor de versão.' }
    return $selector
}

function Select-TestProgressProjectNode {
    param([string] $Cwd)
    $directory = Get-TestProgressCwd $Cwd
    $nvmrc = Get-TestProgressNvmrc $directory
    if (-not $nvmrc) {
        foreach ($candidate in @(Get-TestProgressPathCandidates $directory)) {
            $probe = Get-TestProgressNodeProbe $candidate $directory
            if ($probe) { return New-TestProgressNodeDescriptor $probe 'path' $null }
        }
        foreach ($candidate in @(Get-TestProgressNvmCandidates)) {
            $probe = Get-TestProgressNodeProbe $candidate $directory
            if ($probe) { return New-TestProgressNodeDescriptor $probe 'nvm' $null }
        }
        throw 'Node do projeto não encontrado no PATH ou nas instalações locais do nvm-windows; shims nvm 2.x não são executados nem baixam versões.'
    }
    $selector = Get-TestProgressNvmrcSelector $nvmrc
    if ($selector -cmatch '^v?[0-9]+(\.[0-9]+){0,2}$') {
        foreach ($candidate in @(Get-TestProgressPathCandidates $directory)) {
            $probe = Get-TestProgressNodeProbe $candidate $directory
            if (Test-TestProgressNodeVersion $probe 0 $selector) {
                return New-TestProgressNodeDescriptor $probe 'nvmrc-path' $nvmrc
            }
        }
        foreach ($candidate in @(Get-TestProgressNvmCandidates)) {
            $probe = Get-TestProgressNodeProbe $candidate $directory
            if (Test-TestProgressNodeVersion $probe 0 $selector) {
                return New-TestProgressNodeDescriptor $probe 'nvmrc-nvm' $nvmrc
            }
        }
    } elseif ($selector -in @('current', 'default')) {
        # nvm-windows has no separate persistent default alias: both use its
        # existing NVM_SYMLINK, and fail if that current installation is absent.
        foreach ($candidate in @(Get-TestProgressNvmCurrentCandidate)) {
            $probe = Get-TestProgressNodeProbe $candidate $directory
            if ($probe) { return New-TestProgressNodeDescriptor $probe 'nvmrc-nvm' $nvmrc }
        }
    } elseif ($selector -in @('node', 'stable') -or $selector -match '^lts/(\*|[a-z0-9-]+)$') {
        $selected = @()
        foreach ($candidate in @(Get-TestProgressNvmCandidates)) {
            $probe = Get-TestProgressNodeProbe $candidate $directory
            if (-not $probe -or $probe.version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { continue }
            if ($selector.StartsWith('lts/', [StringComparison]::OrdinalIgnoreCase)) {
                $codename = $selector.Substring(4)
                if (-not $probe.lts -or ($codename -ne '*' -and $probe.lts -ine $codename)) { continue }
            }
            $selected += [pscustomobject]@{ probe = $probe; order = [version]$probe.version.Substring(1) }
        }
        $latest = $selected | Sort-Object -Property order -Descending | Select-Object -First 1
        if ($latest) { return New-TestProgressNodeDescriptor $latest.probe 'nvmrc-nvm' $nvmrc }
    } else {
        throw "Alias .nvmrc não suportado no nvm-windows local: $selector. Use versão numérica, current, default, node, stable ou lts/<nome|*>."
    }
    throw "A versão exigida pela .nvmrc ($selector) não está disponível localmente; nenhum fallback foi aplicado."
}
