[CmdletBinding()]
param(
    [string] $SourceRoot,
    [string] $AppRoot = 'C:\OSDCloud\HostTools\App',
    [string] $StateRoot = 'C:\OSDCloud\HostTools\State',
    [ValidateSet('Release', 'Development')][string] $Channel = 'Release',
    [switch] $Force,
    [switch] $DryRun,
    [switch] $PrepareDependencies,
    [switch] $RunSmoke,
    [switch] $StageOnly,
    [string] $StagePath,
    [string] $StagedAppPath,
    [switch] $AllowUnvalidatedStage
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')
. (Join-Path $PSScriptRoot 'lib\HostManagementUpgrade.ps1')

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
    if ($script:HostToolsStateRoot) {
        $full = [System.IO.Path]::GetFullPath($Path)
        $stateRoot = [System.IO.Path]::GetFullPath($script:HostToolsStateRoot).TrimEnd('\')
        if ($full.StartsWith("$stateRoot\", [System.StringComparison]::OrdinalIgnoreCase) -and $full -ne $stateRoot) {
            Assert-HostToolsUpgradeStateMutationAllowed -StateRoot $stateRoot -Path $full -Directory
        }
    }
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
    if ($script:HostToolsStateRoot) {
        $destinationFull = [System.IO.Path]::GetFullPath($Destination)
        $stateRoot = [System.IO.Path]::GetFullPath($script:HostToolsStateRoot).TrimEnd('\')
        if ($destinationFull.StartsWith("$stateRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
            Assert-HostToolsUpgradeStateMutationAllowed -StateRoot $stateRoot -Path $destinationFull
        }
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

    if ($script:HostToolsStateRoot) {
        $pathFull = [System.IO.Path]::GetFullPath($Path)
        $stateRoot = [System.IO.Path]::GetFullPath($script:HostToolsStateRoot).TrimEnd('\')
        if ($pathFull.StartsWith("$stateRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
            Assert-HostToolsUpgradeStateMutationAllowed -StateRoot $stateRoot -Path $pathFull
        }
    }
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
        $normalized -notmatch '^docs\\manual-assets\\' -and
        $normalized -notmatch '^tools\\osdcloud-console\\web\\') {
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
        $relative = $file.FullName.Substring($Source.Length).TrimStart('\')
        $filterRelative = $file.FullName.Substring($sourceRootFull.Length).TrimStart('\')
        if (Test-ExcludedProductPath -RelativePath $filterRelative) {
            continue
        }
        $destinationPath = Join-Path $Destination $relative
        Copy-File -Source $file.FullName -Destination $destinationPath
    }
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

$sourceRootFull = Get-FullPath $SourceRoot
$appRootFull = Get-FullPath $AppRoot
$stateRootFull = Get-FullPath $StateRoot
$hostToolsRoot = Split-Path -Parent $appRootFull
$script:HostToolsStateRoot = $stateRootFull
$stateWasPresent = Test-Path -LiteralPath $stateRootFull -PathType Container

if (-not (Test-Path -LiteralPath (Join-Path $sourceRootFull 'package.json') -PathType Leaf)) {
    throw "Source root is missing package.json: $sourceRootFull"
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceRootFull 'tools\osdcloud-console\src\webServer.js') -PathType Leaf)) {
    throw "Source root is missing Web console sources: $sourceRootFull"
}

$sourcePackage = Get-Content -LiteralPath (Join-Path $sourceRootFull 'package.json') -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath (Join-Path $sourceRootFull 'package-lock.json') -PathType Leaf)) {
    throw "Source root is missing package-lock.json: $sourceRootFull"
}
$activeTransaction = Get-ActiveHostToolsUpgradeTransaction -HostToolsRoot $hostToolsRoot
if ($activeTransaction) {
    throw "A HostTools upgrade is already pending. Run $hostToolsRoot\Restore-HostManagementUpgrade.ps1 before installing another App."
}
if ($StageOnly -and -not [string]::IsNullOrWhiteSpace($StagedAppPath)) {
    throw 'Use either -StageOnly or -StagedAppPath, not both.'
}
if ($StageOnly -and $DryRun) { throw '-StageOnly cannot be combined with -DryRun.' }
if ($StageOnly -and -not $AllowUnvalidatedStage -and (-not $PrepareDependencies -or -not $RunSmoke)) {
    throw 'A staged App requires both -PrepareDependencies and -RunSmoke before it can be handed to the cutover step.'
}

$schemaPath = Join-Path $stateRootFull 'state-schema.json'
if (Test-Path -LiteralPath $schemaPath -PathType Leaf) {
    try {
        $currentSchema = Get-Content -LiteralPath $schemaPath -Raw | ConvertFrom-Json
        if ($null -ne $currentSchema.schemaVersion -and [int]$currentSchema.schemaVersion -gt 1) {
            throw "Unsupported HostTools State schema version $($currentSchema.schemaVersion); current version is 1."
        }
    } catch {
        if ($_.Exception.Message -like 'Unsupported HostTools State schema version*') { throw }
        throw "Unable to read State schema metadata: $schemaPath - $($_.Exception.Message)"
    }
}

$hostToolsRoot = [System.IO.Path]::GetFullPath($hostToolsRoot)
$sourceMetadata = Get-HostToolsSourceMetadata -SourceRoot $sourceRootFull -Channel $Channel -Version ([string]$sourcePackage.version)

$stageBase = [System.IO.Path]::GetFullPath((Join-Path $hostToolsRoot 'Staging')).TrimEnd('\') + '\'
$stageOnlyBuild = [string]::IsNullOrWhiteSpace($StagedAppPath)
if ($stageOnlyBuild) {
    $transactionId = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
    $stageRoot = if ([string]::IsNullOrWhiteSpace($StagePath)) {
        Join-Path $stageBase "HostTools-App-$transactionId"
    } else {
        [System.IO.Path]::GetFullPath($StagePath)
    }
} else {
    $stageRoot = [System.IO.Path]::GetFullPath($StagedAppPath)
    if (-not $stageRoot.StartsWith($stageBase, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Staged App must remain under HostTools Staging: $stageRoot"
    }
    $stageName = Split-Path -Leaf $stageRoot
    if ($stageName -notmatch '^HostTools-App-(\d{8}-\d{6}-\d{3})$') {
        throw "Invalid staged App directory name: $stageName"
    }
    $transactionId = $Matches[1]
    $manifestPath = Join-Path $stageRoot 'installation-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Staged App manifest is missing: $manifestPath" }
    $installMetadata = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([System.IO.Path]::GetFullPath([string]$installMetadata.appRoot) -ine $appRootFull -or
        [string]$installMetadata.packageLockSha256 -ne (Get-HostToolsUpgradeHash -LiteralPath (Join-Path $sourceRootFull 'package-lock.json')) -or
        [string]$installMetadata.source.sourceCommit -ine [string]$sourceMetadata.sourceCommit -or
        [string]$installMetadata.source.sourceBranch -ine [string]$sourceMetadata.sourceBranch -or
        [string]$installMetadata.source.sourceTreeClean -ine [string]$sourceMetadata.sourceTreeClean -or
        [string]$installMetadata.source.version -ine [string]$sourceMetadata.version -or
        [string]$installMetadata.source.channel -ine [string]$sourceMetadata.channel -or
        [string]$installMetadata.source.bundleCommit -ine [string]$sourceMetadata.bundleCommit -or
        [string]$installMetadata.source.bundleVersion -ine [string]$sourceMetadata.bundleVersion -or
        [string]$installMetadata.source.bundleChannel -ine [string]$sourceMetadata.bundleChannel -or
        [string]$installMetadata.source.bundleManifestSha256 -ine [string]$sourceMetadata.bundleManifestSha256) {
        throw 'Staged App source metadata does not match the requested source, channel, version, or lockfile.'
    }
    Assert-HostToolsUpgradePathHasNoReparsePoints -Path $stageRoot
    if (-not $AllowUnvalidatedStage -and
        ($installMetadata.validation.dependenciesPrepared -ne $true -or $installMetadata.validation.smokePassed -ne $true)) {
        throw 'Staged App has not passed locked dependency preparation and the Web Console smoke test.'
    }
}
if (-not $stageRoot.StartsWith($stageBase, [System.StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Parent $stageRoot).TrimEnd('\') -ine (Join-Path $hostToolsRoot 'Staging').TrimEnd('\')) {
    throw "Staged App must be a direct child of HostTools Staging: $stageRoot"
}

if ($stageOnlyBuild) {
    Ensure-Directory -Path (Split-Path -Parent $stageRoot)
    Ensure-Directory -Path $stageRoot
    try {
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
        Copy-File -Source (Join-Path $sourceRootFull $relativeFile) -Destination (Join-Path $stageRoot $relativeFile)
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
        Copy-FilteredDirectoryTree -Source (Join-Path $sourceRootFull $relativeDirectory) -Destination (Join-Path $stageRoot $relativeDirectory)
    }

    foreach ($relativeDirectory in @(
        'osdcloud-assets\OSDCloud\PXE-HttpRoot',
        'osdcloud-assets\OSDCloud\PXE-TFTP'
    )) {
        Copy-FilteredDirectoryTree -Source (Join-Path $sourceRootFull $relativeDirectory) -Destination (Join-Path $stageRoot $relativeDirectory) -Optional
    }

    foreach ($relativeFile in @(
        'tools\Install-HostManagementBundle.ps1',
        'tools\Setup-DeploymentServer.ps1',
        'tools\Reload-Console.ps1',
        'tools\Start-InstalledWebConsole.ps1',
        'tools\Start-WebConsoleTray.ps1',
        'tools\Restore-HostManagementUpgrade.ps1',
        'tools\Complete-HostManagementUpgrade.ps1',
        'tools\Backup-HostManagementState.ps1',
        'tools\Get-HostManagementStateBackupInventory.ps1',
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
            Copy-File -Source $sourcePath -Destination (Join-Path $stageRoot $relativeFile)
        }
    }

    if (Test-Path -LiteralPath (Join-Path $sourceRootFull 'bundle-manifest.json') -PathType Leaf) {
        Copy-File -Source (Join-Path $sourceRootFull 'bundle-manifest.json') -Destination (Join-Path $stageRoot 'bundle-manifest.json')
    }

    if ($Channel -eq 'Development') {
        Copy-File -Source (Join-Path $sourceRootFull 'tools\Seed-DevelopmentFixture.ps1') -Destination (Join-Path $stageRoot 'tools\Seed-DevelopmentFixture.ps1')
        Copy-FilteredDirectoryTree -Source (Join-Path $sourceRootFull 'fixtures\development') -Destination (Join-Path $stageRoot 'fixtures\development')
    }

    $lockHash = Get-HostToolsUpgradeHash -LiteralPath (Join-Path $sourceRootFull 'package-lock.json')
    $installMetadata = [pscustomobject][ordered]@{
        schemaVersion = 1
        installedAt = [DateTimeOffset]::UtcNow.ToString('o')
        appRoot = $appRootFull
        packageLockSha256 = $lockHash
        source = $sourceMetadata
        validation = [pscustomobject][ordered]@{
            dependenciesPrepared = $false
            smokePassed = $false
        }
    }
    if (-not $DryRun) {
        Write-Host "write $(Join-Path $stageRoot 'installation-manifest.json')"
        [System.IO.File]::WriteAllText(
            (Join-Path $stageRoot 'installation-manifest.json'),
            (($installMetadata | ConvertTo-Json -Depth 16) + [Environment]::NewLine),
            $Utf8NoBom
        )
    }

    if (-not $DryRun) {
        foreach ($requiredPath in @(
            'package.json',
            'package-lock.json',
            'tools\osdcloud-console\src\webServer.js',
            'tools\lib\HostManagementUpgrade.ps1',
            'tools\Restore-HostManagementUpgrade.ps1'
        )) {
            if (-not (Test-Path -LiteralPath (Join-Path $stageRoot $requiredPath) -PathType Leaf)) {
                throw "Staged App is missing a required file: $requiredPath"
            }
        }
    }

    if ($PrepareDependencies -and -not $DryRun) {
        $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
        if (-not $npm) { throw 'npm is not available; install Node.js LTS before preparing the staged HostTools App.' }
        Push-Location -LiteralPath $stageRoot
        try {
            Write-Host 'Preparing locked production dependencies in the staged App.'
            & $npm.Source ci --omit=dev --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE in staged App." }
            $installMetadata.validation.dependenciesPrepared = $true
        } finally {
            Pop-Location
        }
    }
    if ($RunSmoke -and -not $DryRun) {
        $node = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
        if (-not $node) { throw 'node is not available; cannot smoke test the staged HostTools App.' }
        Push-Location -LiteralPath $stageRoot
        try {
            Write-Host 'Running the staged Web Console smoke test.'
            & $node.Source 'tools/osdcloud-console/src/smoke.js'
            if ($LASTEXITCODE -ne 0) { throw "Staged Web Console smoke test failed with exit code $LASTEXITCODE." }
            $installMetadata.validation.smokePassed = $true
        } finally {
            Pop-Location
        }
    }
    if (-not $DryRun) {
        [System.IO.File]::WriteAllText(
            (Join-Path $stageRoot 'installation-manifest.json'),
            (($installMetadata | ConvertTo-Json -Depth 16) + [Environment]::NewLine),
            $Utf8NoBom
        )
    }
} catch {
    if (-not $DryRun -and (Test-Path -LiteralPath $stageRoot -PathType Container)) {
        $safeStage = Assert-SafeRemoveRoot -Path $stageRoot
        Remove-Item -LiteralPath $safeStage -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
}
}

if ($StageOnly) {
    Write-Host "Staged App ready for cutover: $stageRoot"
    return
}

$rootRecoveryModule = Join-Path $hostToolsRoot 'HostManagementUpgrade.ps1'
$rootRecoveryScript = Join-Path $hostToolsRoot 'Restore-HostManagementUpgrade.ps1'
$launcherPath = Join-Path $hostToolsRoot 'Open-WebConsole.cmd'
if ($DryRun) {
    Write-Host "[dry-run] stage App at $stageRoot and begin a scoped upgrade transaction."
} else {
    Ensure-Directory -Path $hostToolsRoot
    Copy-Item -LiteralPath (Join-Path $stageRoot 'tools\lib\HostManagementUpgrade.ps1') -Destination $rootRecoveryModule -Force
    Copy-Item -LiteralPath (Join-Path $stageRoot 'tools\Restore-HostManagementUpgrade.ps1') -Destination $rootRecoveryScript -Force
    $launcherContent = @"
@echo off
setlocal
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Restore-HostManagementUpgrade.ps1"
if errorlevel 1 exit /b %errorlevel%
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0App\tools\Start-InstalledWebConsole.ps1"
"@
    [System.IO.File]::WriteAllText($launcherPath, $launcherContent + [Environment]::NewLine, $Utf8NoBom)

    $transactionParameters = @{
        HostToolsRoot = $hostToolsRoot
        AppRoot = $appRootFull
        StateRoot = $stateRootFull
        StageRoot = $stageRoot
        SourceMetadata = $sourceMetadata
        TransactionId = $transactionId
    }
    $transactionPath = New-HostToolsUpgradeTransaction @transactionParameters
    try {
        Start-HostToolsUpgradeCutover -TransactionPath $transactionPath -StageRoot $stageRoot -AppRoot $appRootFull -StateRoot $stateRootFull
        Ensure-Directory -Path $stateRootFull
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
            Copy-SeedFileIfMissing -Source (Join-Path $sourceRootFull $seedFile) -Destination (Join-Path $stateRootFull $seedFile)
        }
        Invoke-StateMigration -Path $stateRootFull -AppVersion ([string]$sourcePackage.version)
        Complete-HostToolsUpgradeStateMutation -TransactionPath $transactionPath -StateRoot $stateRootFull
    } catch {
        $failure = $_.Exception.Message
        try {
            Restore-HostToolsUpgradeTransaction -TransactionPath $transactionPath -HostToolsRoot $hostToolsRoot -AppRoot $appRootFull -StateRoot $stateRootFull
        } catch {
            Write-Error "Automatic upgrade rollback did not finish. Run $rootRecoveryScript. $($_.Exception.Message)"
        }
        throw "HostTools upgrade transaction failed: $failure"
    }
}

Write-Host 'Installed host management bundle:'
Write-Host "  AppRoot   = $appRootFull"
Write-Host "  StateRoot = $stateRootFull"
Write-Host "  Channel   = $Channel"
Write-Host "  Install   = $(if ($stateWasPresent) { 'upgrade' } else { 'fresh' })"
if (-not $DryRun) {
    Write-Host "  Transaction = HostTools-Upgrade-$transactionId (pending Web readiness validation)"
    Write-Host "  Recovery    = $rootRecoveryScript"
}
