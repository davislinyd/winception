[CmdletBinding()]
param(
    [string] $SourceRoot,
    [string] $AppRoot = 'C:\OSDCloud\HostTools\App',
    [string] $StateRoot = 'C:\OSDCloud\HostTools\State',
    [ValidateSet('Release', 'Development')][string] $Channel = 'Release',
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

function Test-ExcludedProductPath {
    param([Parameter(Mandatory)][string] $RelativePath)

    $normalized = $RelativePath.Replace('/', '\').TrimStart('\')
    if ($normalized -match '(^|\\)(\.git|\.ai|node_modules|downloads|\.downloads|status|logs|screenshots|transcripts|runtime|test|tests)(\\|$)') {
        return $true
    }
    if ($normalized -match '(^|\\)([^\\]*secret[^\\]*|[^\\]*\.local\.json)$') {
        return -not ($normalized -match 'osdcloud-secrets\.example\.json$')
    }
    if ($normalized -match '\.(iso|wim|esd|vhd|vhdx|avhdx|log|etl|evtx|png|jpg|jpeg|msi|exe|pcapng)$' -and
        $normalized -notmatch '^docs\\manual-assets\\') {
        return $true
    }
    if ($normalized -match '(^|\\)(config\\lab-regression\.example\.json|osdcloud-assets\\manifest\.json)$') {
        return $true
    }
    if ($normalized -match '(^|\\)(Initialize-WinceptionLab\.ps1|Invoke-WinceptionLabRegression\.ps1|Export-HostToolsBundle\.ps1|lab-deploy\.yml|pr\.yml)(\\|$)') {
        return $true
    }
    if ($Channel -eq 'Release' -and $normalized -match '(^|\\)Seed-DevelopmentFixture\.ps1(\\|$)') {
        return $true
    }
    if ($normalized -match '(^|\\)(Softwares\\(?:7zip|chrome|SW-4UT7PDID)|Scripts\\SC-J5GF07Y2|osdcloud-assets\\OSDCloud\\Media\\OSDCloud\\(?:Apps\\(?:7zip|chrome|SW-4UT7PDID)|Scripts\\SC-J5GF07Y2))(\\|$)') {
        return $true
    }
    $false
}

function Copy-FilteredDirectoryTree {
    param(
        [Parameter(Mandatory)][string] $Source,
        [Parameter(Mandatory)][string] $Destination,
        [switch] $Optional
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        if ($Optional) { return }
        throw "Missing source directory: $Source"
    }

    foreach ($file in Get-ChildItem -LiteralPath $Source -Recurse -File -Force) {
        $relative = $file.FullName.Substring($sourceRootFull.Length).TrimStart('\')
        if (Test-ExcludedProductPath -RelativePath $relative) {
            continue
        }
        $destinationPath = Join-Path $appRootFull $relative
        Copy-File -Source $file.FullName -Destination $destinationPath
    }
}

function Backup-StateRoot {
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return $null
    }
    $entries = @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue)
    if ($entries.Count -eq 0) {
        return $null
    }

    $backupRoot = Join-Path $hostToolsRoot 'Backups'
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
    $backupPath = Join-Path $backupRoot "HostTools-State-$stamp"
    Write-Host "backup $Path -> $backupPath"
    if (-not $DryRun) {
        Ensure-Directory -Path $backupRoot
        Copy-Item -LiteralPath $Path -Destination $backupPath -Recurse -Force
    }
    $backupPath
}

function Invoke-StateMigration {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $AppVersion
    )

    $schemaPath = Join-Path $Path 'state-schema.json'
    $currentVersion = 0
    if (Test-Path -LiteralPath $schemaPath -PathType Leaf) {
        try {
            $metadata = Get-Content -LiteralPath $schemaPath -Raw | ConvertFrom-Json
            $currentVersion = if ($null -eq $metadata.schemaVersion) { 0 } else { [int] $metadata.schemaVersion }
        } catch {
            throw "Unable to read State schema metadata: $schemaPath - $($_.Exception.Message)"
        }
    }
    if ($currentVersion -gt 1) {
        throw "Unsupported HostTools State schema version $currentVersion; current version is 1."
    }

    Write-JsonFile -Path $schemaPath -Value ([pscustomobject]@{
        schemaVersion = 1
        appVersion = $AppVersion
        migratedAt = [DateTimeOffset]::UtcNow.ToString('o')
    })
}

function Clear-DiagnosticsState {
    param([Parameter(Mandatory)][string] $StateRootPath)

    $diagnosticsRoot = Join-Path $StateRootPath 'diagnostics'
    if (-not (Test-Path -LiteralPath $diagnosticsRoot)) {
        return
    }

    $safeDiagnosticsRoot = Assert-SafeRemoveRoot -Path $diagnosticsRoot
    Write-Host "remove $safeDiagnosticsRoot"
    if (-not $DryRun) {
        Remove-Item -LiteralPath $safeDiagnosticsRoot -Recurse -Force
    }
}

$sourceRootFull = Get-FullPath $SourceRoot
$appRootFull = Get-FullPath $AppRoot
$stateRootFull = Get-FullPath $StateRoot
$hostToolsRoot = Split-Path -Parent $appRootFull
$stateWasPresent = Test-Path -LiteralPath $stateRootFull -PathType Container

if (-not (Test-Path -LiteralPath (Join-Path $sourceRootFull 'package.json') -PathType Leaf)) {
    throw "Source root is missing package.json: $sourceRootFull"
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceRootFull 'tools\osdcloud-console\src\webServer.js') -PathType Leaf)) {
    throw "Source root is missing Web console sources: $sourceRootFull"
}

$sourcePackage = Get-Content -LiteralPath (Join-Path $sourceRootFull 'package.json') -Raw | ConvertFrom-Json
$stateBackupPath = Backup-StateRoot -Path $stateRootFull

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
    'New-WinceptionUsbInstaller.cmd',
    'docs\winception-operations-manual.html',
    'Softwares\Install-Apps.ps1',
    'Softwares\Show-DeploymentProgress.ps1'
)) {
    Copy-File `
        -Source (Join-Path $sourceRootFull $relativeFile) `
        -Destination (Join-Path $appRootFull $relativeFile)
}

foreach ($relativeDirectory in @(
    'tools\osdcloud-console\src',
    'tools\osdcloud-console\web',
    'tools\lib',
    'config',
    'docs\manual-assets',
    'osdcloud-assets\OSDCloud\Config',
    'osdcloud-assets\OSDCloud\WinPE',
    'osdcloud-assets\OSDCloud\Tools',
    'osdcloud-assets\OSDCloud\Media\OSDCloud\Apps'
)) {
    Copy-FilteredDirectoryTree `
        -Source (Join-Path $sourceRootFull $relativeDirectory) `
        -Destination (Join-Path $appRootFull $relativeDirectory)
}

foreach ($relativeDirectory in @(
    'osdcloud-assets\OSDCloud\PXE-HttpRoot',
    'osdcloud-assets\OSDCloud\PXE-TFTP'
)) {
    Copy-FilteredDirectoryTree `
        -Source (Join-Path $sourceRootFull $relativeDirectory) `
        -Destination (Join-Path $appRootFull $relativeDirectory) `
        -Optional
}

foreach ($relativeFile in @(
    'tools\Install-HostManagementBundle.ps1',
    'tools\Setup-DeploymentServer.ps1',
    'tools\Reload-Console.ps1',
    'tools\Start-InstalledWebConsole.ps1',
    'tools\Start-WebConsoleTray.ps1',
    'tools\Configure-WinceptionGateway.ps1',
    'tools\Initialize-DeploymentServer.ps1',
    'tools\Invoke-SoftwareTestVm.ps1',
    'tools\New-WinceptionUsbInstaller.ps1',
    'tools\Publish-SecureBootTftp.ps1',
    'tools\Repair-WinPeBootWim.ps1',
    'tools\Restore-DeploymentArtifacts.ps1',
    'tools\Restore-HostManagementState.ps1',
    'tools\Set-IpxePhysicalNic.ps1',
    'tools\Set-OsdCloudIpxeEndpoint.ps1',
    'tools\Sync-OsdCloudAssets.ps1'
)) {
    $sourcePath = Join-Path $sourceRootFull $relativeFile
    if ((Test-Path -LiteralPath $sourcePath -PathType Leaf) -and -not (Test-ExcludedProductPath -RelativePath $relativeFile)) {
        Copy-File -Source $sourcePath -Destination (Join-Path $appRootFull $relativeFile)
    }
}

if ($Channel -eq 'Development') {
    Copy-File `
        -Source (Join-Path $sourceRootFull 'tools\Seed-DevelopmentFixture.ps1') `
        -Destination (Join-Path $appRootFull 'tools\Seed-DevelopmentFixture.ps1')
    Copy-FilteredDirectoryTree `
        -Source (Join-Path $sourceRootFull 'fixtures\development') `
        -Destination (Join-Path $appRootFull 'fixtures\development')
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

Invoke-StateMigration -Path $stateRootFull -AppVersion ([string] $sourcePackage.version)

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

Clear-DiagnosticsState -StateRootPath $stateRootFull

Write-Host "Installed host management bundle:"
Write-Host "  AppRoot  = $appRootFull"
Write-Host "  StateRoot = $stateRootFull"
Write-Host "  Channel  = $Channel"
Write-Host "  Install  = $(if ($stateWasPresent) { 'upgrade' } else { 'fresh' })"
if ($stateBackupPath) {
    Write-Host "  StateBackup = $stateBackupPath"
}
