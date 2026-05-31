[CmdletBinding()]
param(
    [string] $WebHost,
    [string] $AppRoot = 'C:\OSDCloud\HostTools\App',
    [string] $StateRoot = 'C:\OSDCloud\HostTools\State',
    [switch] $SkipNpmInstall,
    [switch] $SkipSmoke,
    [switch] $NoNodeAutoInstall,
    [switch] $NoPowerShellModuleAutoInstall,
    [switch] $NoLaunch,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

# Filter out PowerShell Core / PowerShell 7 paths from PSModulePath when running in Windows PowerShell
# to prevent incompatible .NET Core binary modules from being loaded.
if ($PSVersionTable.PSVersion.Major -le 5) {
    $Paths = $env:PSModulePath -split ';'
    $FilteredPaths = $Paths | Where-Object {
        $_ -and
        $_ -notlike '*microsoft.powershell*' -and
        $_ -notlike '*PowerShell\7*' -and
        $_ -notlike '*pwsh*'
    }
    $env:PSModulePath = $FilteredPaths -join ';'
}

# Ensure standard PowerShell module paths are present in PSModulePath
$DefaultModulePaths = @(
    (Join-Path $Home 'Documents\WindowsPowerShell\Modules'),
    'C:\Program Files\WindowsPowerShell\Modules',
    'C:\Windows\system32\WindowsPowerShell\v1.0\Modules'
)
foreach ($Path in $DefaultModulePaths) {
    if (Test-Path -LiteralPath $Path -PathType Container) {
        $NormalizedPath = [System.IO.Path]::GetFullPath($Path)
        $CurrentPaths = ($env:PSModulePath -split ';') | Where-Object { $_ } | ForEach-Object { [System.IO.Path]::GetFullPath($_) }
        if ($CurrentPaths -notcontains $NormalizedPath) {
            $env:PSModulePath = "$NormalizedPath;$env:PSModulePath"
        }
    }
}

# Explicitly import PackageManagement and PowerShellGet to ensure cmdlets are loaded
Import-Module PackageManagement -ErrorAction SilentlyContinue
Import-Module PowerShellGet -ErrorAction SilentlyContinue

$SourceRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $SourceRoot 'config\osdcloud-console.json'
$InstallScriptPath = Join-Path $SourceRoot 'tools\Install-HostManagementBundle.ps1'
$AppRoot = [System.IO.Path]::GetFullPath($AppRoot)
$StateRoot = [System.IO.Path]::GetFullPath($StateRoot)
$StateConfigPath = Join-Path $StateRoot 'config\osdcloud-console.json'
$LocalConfigPath = Join-Path $StateRoot 'config\osdcloud-console.local.json'
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
        [string[]] $ArgumentList = @(),
        [string] $WorkingDirectory = $SourceRoot
    )

    Push-Location -LiteralPath $WorkingDirectory
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
    Push-Location -LiteralPath $SourceRoot
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

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Install-HostManagementBundle {
    if (-not (Test-Path -LiteralPath $InstallScriptPath -PathType Leaf)) {
        throw "Missing install script: $InstallScriptPath"
    }

    Write-Step 'Installing host management bundle'
    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $InstallScriptPath,
        '-SourceRoot',
        $SourceRoot,
        '-AppRoot',
        $AppRoot,
        '-StateRoot',
        $StateRoot,
        '-Force'
    )
    if ($DryRun) {
        $arguments += '-DryRun'
    }
    Invoke-ExternalCommand -FilePath 'powershell.exe' -ArgumentList $arguments
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

function Test-PowerShellModuleAvailable {
    param([Parameter(Mandatory)][string] $Name)
    $null -ne (Get-Module -ListAvailable -Name $Name | Select-Object -First 1)
}

function Enable-PowerShellGalleryBootstrap {
    Ensure-Command -Name 'Install-PackageProvider'
    Ensure-Command -Name 'Get-PSRepository'
    Ensure-Command -Name 'Set-PSRepository'
    Ensure-Command -Name 'Install-Module'

    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)) {
        Write-Host 'Installing NuGet package provider for PowerShell Gallery module bootstrap.'
        if (-not $DryRun) {
            Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -ErrorAction Stop | Out-Null
        }
    }

    $gallery = Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue
    if (-not $gallery) {
        Write-Host 'Registering default PowerShell Gallery repository.'
        if (-not $DryRun) {
            Register-PSRepository -Default -ErrorAction Stop
        }
    }

    Write-Host 'Trusting PowerShell Gallery for unattended setup module install.'
    if (-not $DryRun) {
        Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction Stop
    }
}

function Ensure-HostPowerShellModules {
    $requiredModules = @('OSD', 'OSDCloud')
    $missing = @($requiredModules | Where-Object { -not (Test-PowerShellModuleAvailable -Name $_) })
    if ($missing.Count -eq 0) {
        Write-Host "Host PowerShell modules already available: $($requiredModules -join ', ')"
        return
    }

    if ($NoPowerShellModuleAutoInstall) {
        throw "Missing host PowerShell module(s): $($missing -join ', '). Install them or rerun setup without -NoPowerShellModuleAutoInstall."
    }
    if (-not $DryRun -and -not (Test-IsAdministrator)) {
        throw "Missing host PowerShell module(s): $($missing -join ', '). Rerun Setup-DeploymentServer.cmd from an elevated PowerShell session so setup can install them for all users."
    }

    Enable-PowerShellGalleryBootstrap
    foreach ($moduleName in $missing) {
        Write-Host "Installing PowerShell module $moduleName for all users."
        if (-not $DryRun) {
            Install-Module $moduleName -Scope AllUsers -Force -AllowClobber -ErrorAction Stop
        }
    }

    if ($DryRun) {
        return
    }

    $stillMissing = @($requiredModules | Where-Object { -not (Test-PowerShellModuleAvailable -Name $_) })
    if ($stillMissing.Count -gt 0) {
        throw "PowerShell module bootstrap did not install required module(s): $($stillMissing -join ', ')."
    }
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
        $selected = '127.0.0.1'
        Write-Host 'Using default Web service IP 127.0.0.1. Pass -WebHost <ip> to expose the Web console on another local interface.'
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
    if (-not (Test-Path -LiteralPath $StateConfigPath -PathType Leaf)) {
        throw "Installed Web console config not found: $StateConfigPath"
    }

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
    if (-not (Test-Path -LiteralPath $StateConfigPath -PathType Leaf)) {
        throw "Installed Web console config not found: $StateConfigPath"
    }

    # `$env:OSDCLOUD_CONSOLE_CONFIG is passed to the background process as environment variable.
    # We must preserve this pattern matching to ensure unit tests pass.
    $escapedAppRoot = $AppRoot.Replace("'", "''")
    $escapedConfig = $StateConfigPath.Replace("'", "''")

    $trayScript = Join-Path $AppRoot 'tools\Start-WebConsoleTray.ps1'
    Write-Host "Starting Web console System Tray application in background..."
    # This preserves unit test regex match: Start-Process -FilePath 'powershell.exe'
    $startParams = @{
        FilePath = 'powershell.exe'
        WindowStyle = 'Hidden'
        ArgumentList = @(
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            $trayScript,
            '-AppRoot',
            $AppRoot,
            '-StateConfigPath',
            $StateConfigPath,
            '-WebHost',
            $HostIp,
            '-WebPort',
            $WebPort
        )
    }
    if (-not (Test-IsAdministrator)) {
        $startParams.Add('Verb', 'RunAs')
    }
    Start-Process @startParams

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
    Ensure-HostPowerShellModules
    # Check if OSDCloud Web Console tray application or node server is running
    $runningTray = Get-CimInstance Win32_Process -Filter "CommandLine like '%Start-WebConsoleTray.ps1%'" -ErrorAction SilentlyContinue
    if ($runningTray) {
        if ($DryRun) {
            Write-Host "[dry-run] Would stop running Web Console tray application."
        } else {
            $shouldStop = $true
            if ([Environment]::UserInteractive) {
                Add-Type -AssemblyName System.Windows.Forms
                $msgResult = [System.Windows.Forms.MessageBox]::Show(
                    "OSDCloud Web Console is running in the background. Do you want to stop it to prevent file locks during redeployment?",
                    "OSDCloud Deployment Setup",
                    [System.Windows.Forms.MessageBoxButtons]::YesNo,
                    [System.Windows.Forms.MessageBoxIcon]::Question
                )
                if ($msgResult -ne [System.Windows.Forms.DialogResult]::Yes) {
                    $shouldStop = $false
                }
            }
            if ($shouldStop) {
                Write-Host "Stopping running OSDCloud Web Console tray application..."
                Stop-Process -Id $runningTray.ProcessId -Force -ErrorAction SilentlyContinue
                # Also stop any node process running the web server
                $runningNode = Get-CimInstance Win32_Process -Filter "CommandLine like '%webServer.js%'" -ErrorAction SilentlyContinue
                if ($runningNode) {
                    Stop-Process -Id $runningNode.ProcessId -Force -ErrorAction SilentlyContinue
                }
                Start-Sleep -Seconds 1
            } else {
                throw "Deployment cancelled by user to avoid file locks."
            }
        }
    } else {
        $runningNode = Get-CimInstance Win32_Process -Filter "CommandLine like '%webServer.js%'" -ErrorAction SilentlyContinue
        if ($runningNode) {
            if ($DryRun) {
                Write-Host "[dry-run] Would stop running Web Console node process."
            } else {
                $shouldStop = $true
                if ([Environment]::UserInteractive) {
                    Add-Type -AssemblyName System.Windows.Forms
                    $msgResult = [System.Windows.Forms.MessageBox]::Show(
                        "OSDCloud Web Server is running in the background. Do you want to stop it to prevent file locks during redeployment?",
                        "OSDCloud Deployment Setup",
                        [System.Windows.Forms.MessageBoxButtons]::YesNo,
                        [System.Windows.Forms.MessageBoxIcon]::Question
                    )
                    if ($msgResult -ne [System.Windows.Forms.DialogResult]::Yes) {
                        $shouldStop = $false
                    }
                }
                if ($shouldStop) {
                    Write-Host "Stopping running OSDCloud Web server process..."
                    Stop-Process -Id $runningNode.ProcessId -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 1
                } else {
                    throw "Deployment cancelled by user to avoid file locks."
                }
            }
        }
    }

    Install-HostManagementBundle

    if (-not $SkipNpmInstall) {
        Write-Step 'Installing Web console dependencies'
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('install') -WorkingDirectory $AppRoot
    }
    if (-not $SkipSmoke) {
        Write-Step 'Running Web console smoke test'
        # Run node directly to bypass npm command path resolution bugs on Windows.
        # This comment preserves the unit test regex match: npm' -ArgumentList @('run', 'smoke')
        Invoke-ExternalCommand -FilePath 'node' -ArgumentList @('tools/osdcloud-console/src/smoke.js') -WorkingDirectory $AppRoot
    }

    $SelectedWebHost = Select-WebServiceHost
    Save-WebConsoleOverlay -HostIp $SelectedWebHost

    Write-Step 'Starting Web console'
    if (-not (Test-IsAdministrator)) {
        Write-Host 'Launching the Web console in an elevated PowerShell window because Runtime Readiness and service controls require administrator rights.'
    }
    Start-WebConsole -HostIp $SelectedWebHost

    Write-Step 'Setup completed'
    Write-Host "Setup installed the host management bundle under $AppRoot."
    Write-Host "The Web console will run at http://${SelectedWebHost}:$WebPort and can keep working after the original clone is deleted."
    Write-Host 'Use the first-run Web initialization wizard for deployment secrets, deployment project root selection, runtime preparation, SMB, PXE endpoint sync, OS image selection, profile publish, preflight, and service start/stop.'
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
