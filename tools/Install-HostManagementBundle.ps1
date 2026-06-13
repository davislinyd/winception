[CmdletBinding()]
param(
    [string] $SourceRoot,
    [string] $AppRoot = 'C:\OSDCloud\HostTools\App',
    [string] $StateRoot = 'C:\OSDCloud\HostTools\State',
    [switch] $Force,
    [switch] $DryRun
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = Split-Path -Parent $PSScriptRoot
}

function Assert-SafeRemoveRoot {
    param([Parameter(Mandatory)][string] $Path)

    $full = Get-FullPath $Path
    $root = [System.IO.Path]::GetPathRoot($full)
    if ($full -eq $root -or $full.Length -lt 8) {
        throw "Refusing to remove unsafe path: $full"
    }
    $full
}

function Ensure-Directory {
    param([Parameter(Mandatory)][string] $Path)
    if ($DryRun) {
        Write-Host "[dry-run] mkdir $Path"
        return
    }
    [System.IO.Directory]::CreateDirectory($Path) | Out-Null
}

function Copy-File {
    param(
        [Parameter(Mandatory)][string] $Source,
        [Parameter(Mandatory)][string] $Destination
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Missing source file: $Source"
    }
    Ensure-Directory -Path (Split-Path -Parent $Destination)
    Write-Host "copy $Source -> $Destination"
    if (-not $DryRun) {
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
    }
}

function Copy-DirectoryTree {
    param(
        [Parameter(Mandatory)][string] $Source,
        [Parameter(Mandatory)][string] $Destination
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        throw "Missing source directory: $Source"
    }
    Ensure-Directory -Path (Split-Path -Parent $Destination)
    Write-Host "mirror $Source -> $Destination"
    if (-not $DryRun) {
        Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
    }
}

function Copy-SeedFileIfMissing {
    param(
        [Parameter(Mandatory)][string] $Source,
        [Parameter(Mandatory)][string] $Destination
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Missing seed file: $Source"
    }
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        return
    }
    Copy-File -Source $Source -Destination $Destination
}

function Copy-SeedFilesByPattern {
    param(
        [Parameter(Mandatory)][string] $SourceRootPath,
        [Parameter(Mandatory)][string] $DestinationRootPath,
        [Parameter(Mandatory)][string[]] $Patterns
    )

    if (-not (Test-Path -LiteralPath $SourceRootPath -PathType Container)) {
        return
    }

    foreach ($pattern in $Patterns) {
        $files = Get-ChildItem -LiteralPath $SourceRootPath -Recurse -File -Filter $pattern
        foreach ($file in $files) {
            $relativePath = $file.FullName.Substring($SourceRootPath.Length).TrimStart('\')
            $destination = Join-Path $DestinationRootPath $relativePath
            Copy-SeedFileIfMissing -Source $file.FullName -Destination $destination
        }
    }
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)] $Value
    )

    Ensure-Directory -Path (Split-Path -Parent $Path)
    $json = ($Value | ConvertTo-Json -Depth 32) + [Environment]::NewLine
    Write-Host "write $Path"
    if (-not $DryRun) {
        [System.IO.File]::WriteAllText($Path, $json, $Utf8NoBom)
    }
}

function Set-ObjectProperty {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)] $Value
    )

    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    } else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

$sourceRootFull = Get-FullPath $SourceRoot
$appRootFull = Get-FullPath $AppRoot
$stateRootFull = Get-FullPath $StateRoot
$hostToolsRoot = Split-Path -Parent $appRootFull

if (-not (Test-Path -LiteralPath (Join-Path $sourceRootFull 'package.json') -PathType Leaf)) {
    throw "Source root is missing package.json: $sourceRootFull"
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceRootFull 'tools\osdcloud-console\src\webServer.js') -PathType Leaf)) {
    throw "Source root is missing Web console sources: $sourceRootFull"
}

if ($Force -and (Test-Path -LiteralPath $appRootFull)) {
    $safeAppRoot = Assert-SafeRemoveRoot -Path $appRootFull
    Write-Host "remove $safeAppRoot"
    if (-not $DryRun) {
        Remove-Item -LiteralPath $safeAppRoot -Recurse -Force
    }
}

Ensure-Directory -Path $appRootFull
Ensure-Directory -Path $stateRootFull

foreach ($relativeFile in @(
    'package.json',
    'package-lock.json',
    'Setup-DeploymentServer.cmd',
    'Deploy-DeploymentServer.cmd',
    'Softwares\Install-Apps.ps1'
)) {
    Copy-File `
        -Source (Join-Path $sourceRootFull $relativeFile) `
        -Destination (Join-Path $appRootFull $relativeFile)
}

foreach ($relativeDirectory in @(
    'tools',
    'config',
    'osdcloud-assets'
)) {
    Copy-DirectoryTree `
        -Source (Join-Path $sourceRootFull $relativeDirectory) `
        -Destination (Join-Path $appRootFull $relativeDirectory)
}

$stateConfigRoot = Join-Path $stateRootFull 'config'
Ensure-Directory -Path (Join-Path $stateConfigRoot 'deployment-profiles')
Ensure-Directory -Path (Join-Path $stateRootFull 'Softwares')
Ensure-Directory -Path (Join-Path $stateRootFull 'Scripts')

$sourceConfigPath = Join-Path $sourceRootFull 'config\osdcloud-console.json'
$stateConfigPath = Join-Path $stateConfigRoot 'osdcloud-console.json'
$stateConfig = if (Test-Path -LiteralPath $stateConfigPath -PathType Leaf) {
    Get-Content -LiteralPath $stateConfigPath -Raw | ConvertFrom-Json
} else {
    Get-Content -LiteralPath $sourceConfigPath -Raw | ConvertFrom-Json
}

if (-not $stateConfig.paths) {
    $stateConfig | Add-Member -NotePropertyName 'paths' -NotePropertyValue ([pscustomobject]@{})
}
Set-ObjectProperty -Object $stateConfig.paths -Name 'appRoot' -Value $appRootFull
Set-ObjectProperty -Object $stateConfig.paths -Name 'repoRoot' -Value $appRootFull
Set-ObjectProperty -Object $stateConfig.paths -Name 'stateRoot' -Value $stateRootFull

Write-JsonFile -Path $stateConfigPath -Value $stateConfig

foreach ($seedFile in @(
    'config\os-download-sources.json',
    'config\os-image-catalog.json',
    'config\software-catalog.json',
    'config\scripts-catalog.json'
)) {
    Copy-SeedFileIfMissing `
        -Source (Join-Path $sourceRootFull $seedFile) `
        -Destination (Join-Path $stateRootFull $seedFile)
}

Copy-SeedFilesByPattern `
    -SourceRootPath (Join-Path $sourceRootFull 'config\deployment-profiles') `
    -DestinationRootPath (Join-Path $stateRootFull 'config\deployment-profiles') `
    -Patterns @('*.json')

Copy-SeedFilesByPattern `
    -SourceRootPath (Join-Path $sourceRootFull 'Softwares') `
    -DestinationRootPath (Join-Path $stateRootFull 'Softwares') `
    -Patterns @('*.ps1')

Copy-SeedFilesByPattern `
    -SourceRootPath (Join-Path $sourceRootFull 'Scripts') `
    -DestinationRootPath (Join-Path $stateRootFull 'Scripts') `
    -Patterns @('*.ps1')

$launcherPath = Join-Path $hostToolsRoot 'Open-WebConsole.cmd'
$launcherContent = @"
@echo off
setlocal
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$appRootFull\tools\Start-InstalledWebConsole.ps1"
"@
Ensure-Directory -Path (Split-Path -Parent $launcherPath)
Write-Host "write $launcherPath"
if (-not $DryRun) {
    [System.IO.File]::WriteAllText($launcherPath, $launcherContent + [Environment]::NewLine, $Utf8NoBom)
}

Write-Host "Installed host management bundle:"
Write-Host "  AppRoot  = $appRootFull"
Write-Host "  StateRoot = $stateRootFull"
