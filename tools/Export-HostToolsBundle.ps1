[CmdletBinding()]
param(
    [string] $SourceRoot,
    [Parameter(Mandatory)][string] $OutputRoot,
    [ValidateSet('Release', 'Development')][string] $Channel = 'Release',
    [string] $Commit,
    [string] $Version,
    [switch] $CreateZip,
    [switch] $Force
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = Split-Path -Parent $PSScriptRoot
}

$SourceRoot = Get-FullPath $SourceRoot
$OutputRoot = Get-FullPath $OutputRoot

function Assert-SafeOutputRoot {
    param([Parameter(Mandatory)][string] $Path)

    $full = Get-FullPath $Path
    $root = [System.IO.Path]::GetPathRoot($full)
    if ($full -eq $root -or $full.Length -lt 8) {
        throw "Refusing unsafe HostTools bundle output path: $full"
    }
    if ($full -eq $SourceRoot -or $full.StartsWith("$SourceRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "HostTools bundle output must not be inside the source root: $full"
    }
    $full
}

function Normalize-RelativePath {
    param([Parameter(Mandatory)][string] $Path)
    $Path.Replace('/', '\').TrimStart('\')
}

function Get-TrackedRelativePaths {
    Push-Location -LiteralPath $SourceRoot
    try {
        $tracked = @(& git ls-files --cached 2>$null)
        if ($LASTEXITCODE -ne 0) {
            throw 'Unable to enumerate tracked files for the HostTools bundle.'
        }
        $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($item in $tracked) {
            if (-not [string]::IsNullOrWhiteSpace([string] $item)) {
                $set.Add((Normalize-RelativePath -Path ([string] $item))) | Out-Null
            }
        }
        return ,$set
    }
    finally {
        Pop-Location
    }
}

function Test-ExcludedBundlePath {
    param([Parameter(Mandatory)][string] $RelativePath)

    $normalized = Normalize-RelativePath $RelativePath
    if ($normalized -match '^tools\\acceptance\\|^tools\\lib\\(?:Acceptance|LabRouter|LabNetworkAcceptance)\.ps1$|^tools\\(?:Invoke-WinceptionAcceptance|Initialize-WinceptionLabRouter)\.ps1$|^config\\acceptance\.example\.json$') { return $true }
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
    if ($normalized -match '(^|\\)(Initialize-WinceptionLab\.ps1|Invoke-WinceptionLabRegression\.ps1|Export-HostToolsBundle\.ps1|lab-deploy\.yml|pr\.yml)$') {
        return $true
    }
    if ($normalized -match '(^|\\)(Softwares\\(?:7zip|chrome|SW-4UT7PDID)|Scripts\\SC-J5GF07Y2|osdcloud-assets\\OSDCloud\\Media\\OSDCloud\\(?:Apps\\(?:7zip|chrome|SW-4UT7PDID)|Scripts\\SC-J5GF07Y2))(\\|$)') {
        return $true
    }
    $false
}

function Add-TrackedTree {
    param(
        [System.Collections.Generic.List[string]] $Files,
        [Parameter(Mandatory)][System.Collections.Generic.HashSet[string]] $Tracked,
        [Parameter(Mandatory)][string] $RelativeRoot,
        [switch] $Optional
    )

    $root = Join-Path $SourceRoot $RelativeRoot
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        if ($Optional) { return }
        throw "Required HostTools bundle directory is missing: $root"
    }

    foreach ($item in Get-ChildItem -LiteralPath $root -Recurse -File -Force) {
        $relative = Normalize-RelativePath $item.FullName.Substring($SourceRoot.Length)
        if ($Tracked.Contains($relative) -and -not (Test-ExcludedBundlePath -RelativePath $relative)) {
            $Files.Add($relative)
        }
    }
}

function Add-TrackedFile {
    param(
        [System.Collections.Generic.List[string]] $Files,
        [Parameter(Mandatory)][System.Collections.Generic.HashSet[string]] $Tracked,
        [Parameter(Mandatory)][string] $RelativePath,
        [switch] $Optional
    )

    $normalized = Normalize-RelativePath $RelativePath
    $path = Join-Path $SourceRoot $normalized
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        if ($Optional) { return }
        throw "Required HostTools bundle file is missing: $path"
    }
    if (-not $Tracked.Contains($normalized)) {
        if ($Optional) { return }
        throw "Required HostTools bundle file is not tracked: $normalized"
    }
    if (-not (Test-ExcludedBundlePath -RelativePath $normalized)) {
        $Files.Add($normalized)
    }
}

function Get-BundleFiles {
    param([Parameter(Mandatory)][ValidateSet('Release', 'Development')][string] $BundleChannel)

    $tracked = Get-TrackedRelativePaths
    $files = New-Object System.Collections.Generic.List[string]

    foreach ($relative in @(
        'package.json',
        'package-lock.json',
        'Setup-DeploymentServer.cmd',
        'Deploy-DeploymentServer.cmd',
        'New-WinceptionUsbInstaller.cmd',
        'docs\winception-operations-manual.html',
        'tools\Install-HostManagementBundle.ps1',
        'tools\Setup-DeploymentServer.ps1',
        'tools\Reload-Console.ps1',
        'tools\Start-InstalledWebConsole.ps1',
        'tools\Start-WebConsoleTray.ps1',
        'tools\lib\Common.ps1',
        'tools\Restore-HostManagementState.ps1',
        'Softwares\Install-Apps.ps1',
        'Softwares\Show-DeploymentProgress.ps1',
        'osdcloud-assets\README.md'
    )) {
        Add-TrackedFile -Files $files -Tracked $tracked -RelativePath $relative
    }

    foreach ($relative in @(
        'config\osdcloud-console.json',
        'config\osdcloud-secrets.example.json',
        'config\os-download-sources.json',
        'config\os-image-catalog.json',
        'config\runtime-artifacts.json',
        'config\software-catalog.json',
        'config\scripts-catalog.json',
        'config\deployment-profiles\.gitkeep'
    )) {
        Add-TrackedFile -Files $files -Tracked $tracked -RelativePath $relative
    }

    Add-TrackedTree -Files $files -Tracked $tracked -RelativeRoot 'tools\osdcloud-console\src'
    Add-TrackedTree -Files $files -Tracked $tracked -RelativeRoot 'tools\osdcloud-console\web'
    Add-TrackedTree -Files $files -Tracked $tracked -RelativeRoot 'docs\manual-assets' -Optional
    Add-TrackedTree -Files $files -Tracked $tracked -RelativeRoot 'osdcloud-assets\OSDCloud\Config'
    Add-TrackedTree -Files $files -Tracked $tracked -RelativeRoot 'osdcloud-assets\OSDCloud\WinPE'
    Add-TrackedTree -Files $files -Tracked $tracked -RelativeRoot 'osdcloud-assets\OSDCloud\PXE-HttpRoot' -Optional
    Add-TrackedTree -Files $files -Tracked $tracked -RelativeRoot 'osdcloud-assets\OSDCloud\PXE-TFTP' -Optional
    Add-TrackedTree -Files $files -Tracked $tracked -RelativeRoot 'osdcloud-assets\OSDCloud\Tools' -Optional
    Add-TrackedTree -Files $files -Tracked $tracked -RelativeRoot 'osdcloud-assets\OSDCloud\Media\OSDCloud\Apps' -Optional

    foreach ($relative in @(
        'tools\Configure-WinceptionGateway.ps1',
        'tools\Initialize-DeploymentServer.ps1',
        'tools\Invoke-SoftwareTestVm.ps1',
        'tools\New-WinceptionUsbInstaller.ps1',
        'tools\Publish-SecureBootTftp.ps1',
        'tools\Repair-WinPeBootWim.ps1',
        'tools\Restore-DeploymentArtifacts.ps1',
        'tools\Set-IpxePhysicalNic.ps1',
        'tools\Set-OsdCloudIpxeEndpoint.ps1',
        'tools\Sync-OsdCloudAssets.ps1'
    )) {
        Add-TrackedFile -Files $files -Tracked $tracked -RelativePath $relative -Optional
    }

    if ($BundleChannel -eq 'Development') {
        Add-TrackedTree -Files $files -Tracked $tracked -RelativeRoot 'fixtures\development'
        Add-TrackedFile -Files $files -Tracked $tracked -RelativePath 'tools\Seed-DevelopmentFixture.ps1'
    }

    @($files | Sort-Object -Unique)
}

function Get-GitCommit {
    if (-not [string]::IsNullOrWhiteSpace($Commit)) {
        return $Commit.Trim()
    }
    Push-Location -LiteralPath $SourceRoot
    try {
        $value = (& git rev-parse HEAD 2>$null).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
            throw 'Unable to resolve the source commit. Pass -Commit when exporting outside a Git checkout.'
        }
        $value
    }
    finally {
        Pop-Location
    }
}

function Get-Version {
    if (-not [string]::IsNullOrWhiteSpace($Version)) {
        return $Version.Trim()
    }
    $package = Get-Content -LiteralPath (Join-Path $SourceRoot 'package.json') -Raw | ConvertFrom-Json
    [string] $package.version
}

$OutputRoot = Assert-SafeOutputRoot $OutputRoot
$commitValue = Get-GitCommit
$versionValue = Get-Version
$stageRoot = Join-Path $OutputRoot 'HostTools'
$manifestPath = Join-Path $stageRoot 'bundle-manifest.json'
$zipPath = Join-Path $OutputRoot ("winception-hosttools-{0}-{1}.zip" -f $Channel.ToLowerInvariant(), $commitValue.Substring(0, [Math]::Min(12, $commitValue.Length)))

if (Test-Path -LiteralPath $OutputRoot) {
    if (-not $Force) {
        throw "HostTools bundle output already exists. Pass -Force to replace it: $OutputRoot"
    }
    Remove-Item -LiteralPath $OutputRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

$records = New-Object System.Collections.Generic.List[object]
$bundleFiles = @(Get-BundleFiles -BundleChannel $Channel)
foreach ($relative in $bundleFiles) {
    $source = Join-ChildPath -Root $SourceRoot -RelativePath $relative -Label 'bundle source path'
    $destination = Join-ChildPath -Root $stageRoot -RelativePath $relative -Label 'bundle destination path'
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $item = Get-Item -LiteralPath $destination
    $records.Add([ordered]@{
        path = $relative.Replace('\', '/')
        length = [int64] $item.Length
        sha256 = Get-Sha256Hash -LiteralPath $destination
    })
}

$fixtureRecords = @($records | Where-Object { $_.path -like 'fixtures/development/*' })
$manifest = [ordered]@{
    schemaVersion = 2
    generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    channel = $Channel
    dataPolicy = if ($Channel -eq 'Release') { 'zero-preload' } else { 'development-fixture' }
    allowlist = 'hosttools-production-v1'
    secretPolicy = 'no-plaintext-secrets'
    statePolicy = 'fresh-empty-preserve-on-upgrade'
    fixturePresence = [ordered]@{
        included = $fixtureRecords.Count -gt 0
        paths = @($fixtureRecords | ForEach-Object { $_.path })
    }
    repoCommit = $commitValue
    version = $versionValue
    artifactCount = $records.Count
    files = @($records.ToArray())
}
$manifestJson = $manifest | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($manifestPath, ($manifestJson + [Environment]::NewLine), $Utf8NoBom)

if ($CreateZip) {
    if (Test-Path -LiteralPath $zipPath) {
        if (-not $Force) {
            throw "HostTools zip already exists. Pass -Force to replace it: $zipPath"
        }
        Remove-Item -LiteralPath $zipPath -Force
    }
    Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
}

[pscustomobject]@{
    outputRoot = $OutputRoot
    stageRoot = $stageRoot
    zipPath = if ($CreateZip) { $zipPath } else { $null }
    channel = $Channel
    dataPolicy = $manifest.dataPolicy
    fixturePresence = $manifest.fixturePresence.included
    repoCommit = $commitValue
    version = $versionValue
    artifactCount = $records.Count
} | ConvertTo-Json -Depth 6
