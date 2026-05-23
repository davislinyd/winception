[CmdletBinding()]
param(
    [string] $WebHost,
    [switch] $SkipNpmInstall,
    [switch] $SkipSmoke,
    [switch] $NoNodeAutoInstall,
    [switch] $NoLaunch,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $RepoRoot 'config\osdcloud-console.json'
$LocalConfigPath = Join-Path $RepoRoot 'config\osdcloud-console.local.json'
$WebPort = 8080

function Write-Step {
    param([Parameter(Mandatory)][string] $Message)
    Write-Host ''
    Write-Host "== $Message =="
}

function Test-CommandAvailable {
    param([Parameter(Mandatory)][string] $Name)
    $null -ne (Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory)][string] $FilePath,
        [string[]] $ArgumentList = @()
    )

    Push-Location -LiteralPath $RepoRoot
    try {
        Write-Host "+ $FilePath $($ArgumentList -join ' ')"
        if (-not $DryRun) {
            & $FilePath @ArgumentList
            if ($LASTEXITCODE -ne 0) {
                throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
            }
        }
    }
    finally {
        Pop-Location
    }
}

function Test-IPv4Address {
    param([Parameter(Mandatory)][string] $Address)
    $parsed = $null
    if (-not [System.Net.IPAddress]::TryParse($Address, [ref] $parsed)) {
        return $false
    }
    $parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork
}

function Read-YesNo {
    param(
        [Parameter(Mandatory)][string] $Prompt,
        [bool] $DefaultYes = $true
    )

    if ($DryRun) {
        Write-Host "[dry-run] prompt: $Prompt"
        return $DefaultYes
    }

    $suffix = if ($DefaultYes) { '[Y/n]' } else { '[y/N]' }
    $answer = Read-Host -Prompt "$Prompt $suffix"
    if ([string]::IsNullOrWhiteSpace($answer)) {
        return $DefaultYes
    }
    $answer.Trim().ToLowerInvariant().StartsWith('y')
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $paths = @($machinePath, $userPath, $env:Path) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $env:Path = $paths -join ';'
    Add-NodeInstallPaths
}

function Add-PathEntry {
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return
    }

    $entries = @($env:Path -split ';') |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    if ($entries -notcontains $Path) {
        $env:Path = (@($Path) + $entries) -join ';'
    }
}

function Add-NodeInstallPaths {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates += (Join-Path $env:ProgramFiles 'nodejs')
    }

    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
        $candidates += (Join-Path $programFilesX86 'nodejs')
    }

    foreach ($candidate in $candidates) {
        Add-PathEntry -Path $candidate
    }
}

function Test-NodeAndNpmAvailable {
    (Test-CommandAvailable -Name 'node') -and (Test-CommandAvailable -Name 'npm')
}

function Install-NodeJsLts {
    if ($NoNodeAutoInstall) {
        throw 'Node.js LTS/npm are missing. Install Node.js LTS, then rerun Setup-DeploymentServer.cmd.'
    }
    if (-not (Read-YesNo -Prompt 'Node.js LTS/npm are missing. Install Node.js LTS with winget now?' -DefaultYes $true)) {
        throw 'Node.js LTS/npm are required before the Web console can run.'
    }
    if (-not (Test-CommandAvailable -Name 'winget')) {
        throw 'winget is not available. Install Node.js LTS manually from https://nodejs.org/, then rerun setup.'
    }

    $wingetArgs = @(
        'install',
        '--id',
        'OpenJS.NodeJS.LTS',
        '--exact',
        '--accept-package-agreements',
        '--accept-source-agreements'
    )
    Push-Location -LiteralPath $RepoRoot
    try {
        Write-Host "+ winget $($wingetArgs -join ' ')"
        if (-not $DryRun) {
            & winget @wingetArgs
            $wingetExitCode = $LASTEXITCODE
            Refresh-ProcessPath
            if ($wingetExitCode -ne 0 -and -not (Test-NodeAndNpmAvailable)) {
                throw "Command failed with exit code ${wingetExitCode}: winget $($wingetArgs -join ' ')"
            }
            if ($wingetExitCode -ne 0) {
                Write-Warning 'winget did not install or upgrade Node.js, but node/npm are available now. Continuing setup.'
            }
        }
    }
    finally {
        Pop-Location
    }
    Refresh-ProcessPath
}

function Ensure-Command {
    param([Parameter(Mandatory)][string] $Name)
    if (-not (Test-CommandAvailable -Name $Name)) {
        throw "Required command not found: $Name"
    }
}

function Ensure-NodeAndNpm {
    Refresh-ProcessPath
    if (-not (Test-NodeAndNpmAvailable)) {
        Install-NodeJsLts
    }
    Refresh-ProcessPath
    Ensure-Command -Name 'node'
    Ensure-Command -Name 'npm'
    Invoke-ExternalCommand -FilePath 'node' -ArgumentList @('--version')
    Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('--version')
}

function Get-AvailableWebHosts {
    $hosts = New-Object System.Collections.Generic.List[object]
    $hosts.Add([pscustomobject]@{
        InterfaceAlias = 'Loopback'
        Status = 'Up'
        IPv4 = '127.0.0.1'
        PrefixLength = 8
    })

    try {
        $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -and
                $_.IPAddress -ne '0.0.0.0' -and
                $_.IPAddress -notlike '169.254.*' -and
                $_.IPAddress -ne '127.0.0.1'
            }
        foreach ($address in $addresses) {
            $adapter = Get-NetAdapter -InterfaceIndex $address.InterfaceIndex -ErrorAction SilentlyContinue
            if (-not $adapter -or $adapter.Status -ne 'Up') {
                continue
            }
            $hosts.Add([pscustomobject]@{
                InterfaceAlias = $adapter.Name
                Status = $adapter.Status
                IPv4 = $address.IPAddress
                PrefixLength = $address.PrefixLength
            })
        }
    }
    catch {
        Write-Warning "Unable to enumerate adapter IPv4 addresses: $($_.Exception.Message)"
    }

    $hosts |
        Sort-Object -Property @{ Expression = { if ($_.IPv4 -eq '127.0.0.1') { 0 } else { 1 } } }, InterfaceAlias, IPv4 -Unique
}

function Select-WebServiceHost {
    $available = @(Get-AvailableWebHosts)
    $allowed = @($available | ForEach-Object { $_.IPv4 })

    Write-Step 'Selecting Web service IP'
    Write-Host 'Available local IPv4 addresses for the Web management console:'
    for ($index = 0; $index -lt $available.Count; $index += 1) {
        $item = $available[$index]
        Write-Host ("[{0}] {1,-15} {2}/{3} {4}" -f ($index + 1), $item.InterfaceAlias, $item.IPv4, $item.PrefixLength, $item.Status)
    }

    $selected = $WebHost
    if ([string]::IsNullOrWhiteSpace($selected)) {
        if ($DryRun) {
            Write-Host '[dry-run] prompt: Web service IP [127.0.0.1]'
            $selected = '127.0.0.1'
        } else {
            $selected = Read-Host -Prompt 'Web service IP [127.0.0.1]'
            if ([string]::IsNullOrWhiteSpace($selected)) {
                $selected = '127.0.0.1'
            }
        }
    }
    $selected = $selected.Trim()

    $selectedIndex = 0
    if ([int]::TryParse($selected, [ref] $selectedIndex) -and $selectedIndex -ge 1 -and $selectedIndex -le $available.Count) {
        $selected = $available[$selectedIndex - 1].IPv4
    }

    if (-not (Test-IPv4Address -Address $selected)) {
        throw "Invalid Web service IP: $selected"
    }
    if ($allowed -notcontains $selected) {
        throw "Web service IP $selected is not assigned to an enabled local IPv4 adapter. Choose one of: $($allowed -join ', ')"
    }
    $selected
}

function Save-WebConsoleOverlay {
    param([Parameter(Mandatory)][string] $HostIp)

    $webConfig = [pscustomobject]@{
        host = $HostIp
        port = $WebPort
    }

    if ($DryRun) {
        Write-Host '[dry-run] writing only the Web console local overlay; deployment changes remain skipped.'
    }

    $overlay = [pscustomobject]@{}
    if (Test-Path -LiteralPath $LocalConfigPath -PathType Leaf) {
        $raw = Get-Content -LiteralPath $LocalConfigPath -Raw
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
            $overlay = $raw | ConvertFrom-Json
        }
    }

    if ($overlay.PSObject.Properties.Name -contains 'web') {
        $overlay.web = $webConfig
    } else {
        $overlay | Add-Member -NotePropertyName 'web' -NotePropertyValue $webConfig
    }

    $json = ($overlay | ConvertTo-Json -Depth 20) + [Environment]::NewLine
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $LocalConfigPath)) | Out-Null
    [System.IO.File]::WriteAllText($LocalConfigPath, $json, $encoding)
    Write-Host "Saved Web console settings: $LocalConfigPath"
}

function Start-WebConsole {
    param([Parameter(Mandatory)][string] $HostIp)

    if ($NoLaunch -or $DryRun) {
        Write-Host 'Web console launch skipped.'
        return
    }
    $escapedRepo = $RepoRoot.Replace("'", "''")
    $command = "Set-Location -LiteralPath '$escapedRepo'; npm run web"
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-NoExit',
        '-Command',
        $command
    )
    Start-Sleep -Seconds 2
    Start-Process "http://${HostIp}:$WebPort"
}

try {
    Write-Step 'Checking setup prerequisites'
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        throw "Missing repo config: $ConfigPath"
    }
    Ensure-Command -Name 'git'
    Ensure-NodeAndNpm
    Invoke-ExternalCommand -FilePath 'git' -ArgumentList @('status', '--short', '--branch')

    if (-not $SkipNpmInstall) {
        Write-Step 'Installing Web console dependencies'
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('install')
    }
    if (-not $SkipSmoke) {
        Write-Step 'Running Web console smoke test'
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('run', 'smoke')
    }

    $SelectedWebHost = Select-WebServiceHost
    Save-WebConsoleOverlay -HostIp $SelectedWebHost

    Write-Step 'Starting Web console'
    Start-WebConsole -HostIp $SelectedWebHost

    Write-Step 'Setup completed'
    Write-Host "Setup only prepares the Web console at http://${SelectedWebHost}:$WebPort."
    Write-Host 'Use the first-run Web initialization wizard for deployment secrets, C:\OSDCloud runtime preparation, SMB, PXE endpoint sync, OS image selection, profile publish, preflight, and service start/stop.'
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
