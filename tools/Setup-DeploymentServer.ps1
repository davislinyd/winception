[CmdletBinding()]
param(
    [switch] $SkipNpmInstall,
    [switch] $SkipSmoke,
    [switch] $NoNodeAutoInstall,
    [switch] $NoLaunch,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $RepoRoot 'config\osdcloud-console.json'

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
    $env:Path = @($machinePath, $userPath, $env:Path) -join ';'
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

    Invoke-ExternalCommand -FilePath 'winget' -ArgumentList @(
        'install',
        '--id',
        'OpenJS.NodeJS.LTS',
        '--exact',
        '--accept-package-agreements',
        '--accept-source-agreements'
    )
    Refresh-ProcessPath
}

function Ensure-Command {
    param([Parameter(Mandatory)][string] $Name)
    if (-not (Test-CommandAvailable -Name $Name)) {
        throw "Required command not found: $Name"
    }
}

function Ensure-NodeAndNpm {
    if (-not (Test-CommandAvailable -Name 'node') -or -not (Test-CommandAvailable -Name 'npm')) {
        Install-NodeJsLts
    }
    Ensure-Command -Name 'node'
    Ensure-Command -Name 'npm'
    Invoke-ExternalCommand -FilePath 'node' -ArgumentList @('--version')
    Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('--version')
}

function Start-WebConsole {
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
    Start-Process 'http://127.0.0.1:8080'
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

    Write-Step 'Starting Web console'
    Start-WebConsole

    Write-Step 'Setup completed'
    Write-Host 'Setup only prepares the Web console.'
    Write-Host 'Use Web Runtime Readiness > Prepare runtime for C:\OSDCloud, SMB, iPXE, wimboot, boot.wim, OS image selection, endpoint sync, preflight, and service start/stop.'
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
