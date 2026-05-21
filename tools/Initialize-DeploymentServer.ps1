[CmdletBinding()]
param(
    [string] $ArtifactBundle,
    [string] $RuntimeCatalogPath,
    [string] $ManifestPath,
    [string] $LiveRoot = 'C:\OSDCloud',
    [string] $InterfaceAlias = 'LAN',
    [string] $ServerIp = '192.168.88.1',
    [int] $PrefixLength = 24,
    [string] $ClientGateway,
    [switch] $ConfigureNic,
    [string] $NicDefaultGateway = '',
    [switch] $SkipTests,
    [switch] $SkipEndpointSync,
    [switch] $SkipPreflight,
    [switch] $NoLaunch,
    [switch] $SkipAdminCheck,
    [switch] $IncludeOptionalArtifacts,
    [switch] $SkipOsImageDownload,
    [switch] $SkipWinPeBuild
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $RepoRoot 'osdcloud-assets\manifest.json'
}
if ([string]::IsNullOrWhiteSpace($RuntimeCatalogPath)) {
    $RuntimeCatalogPath = Join-Path $RepoRoot 'config\runtime-artifacts.json'
}
if ([string]::IsNullOrWhiteSpace($ClientGateway)) {
    $ClientGateway = $ServerIp
}

function Write-Step {
    param([Parameter(Mandatory)][string] $Message)
    Write-Host ""
    Write-Host "== $Message =="
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Get-FullPath {
    param([Parameter(Mandatory)][string] $Path)
    [System.IO.Path]::GetFullPath($Path)
}

function Assert-ChildPath {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $Path,
        [string] $Label = 'path'
    )

    $rootFull = (Get-FullPath $Root).TrimEnd('\')
    $candidate = Get-FullPath $Path
    $rootWithSlash = "$rootFull\"
    if ($candidate -ne $rootFull -and -not $candidate.StartsWith($rootWithSlash, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label escapes expected root. Root=$rootFull Path=$candidate"
    }
    $candidate
}

function Join-ChildPath {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $RelativePath,
        [string] $Label = 'path'
    )

    if ([System.IO.Path]::IsPathRooted($RelativePath)) {
        throw "$Label must be relative: $RelativePath"
    }
    Assert-ChildPath -Root $Root -Path (Join-Path $Root $RelativePath) -Label $Label
}

function Get-RelativePathUnderRoot {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $Path
    )

    $rootFull = (Get-FullPath $Root).TrimEnd('\')
    $pathFull = Get-FullPath $Path
    $rootWithSlash = "$rootFull\"
    if (-not $pathFull.StartsWith($rootWithSlash, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Artifact source is outside manifest sourceRoot. Root=$rootFull Source=$pathFull"
    }
    $pathFull.Substring($rootWithSlash.Length)
}

function Get-Sha256Hash {
    param([Parameter(Mandatory)][string] $LiteralPath)

    $resolvedPath = (Resolve-Path -LiteralPath $LiteralPath -ErrorAction Stop).ProviderPath
    $hashCommand = Get-Command -Name Get-FileHash -ErrorAction SilentlyContinue
    if ($hashCommand) {
        return (& $hashCommand -LiteralPath $resolvedPath -Algorithm SHA256).Hash.ToUpperInvariant()
    }

    $stream = [System.IO.File]::OpenRead($resolvedPath)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return (-join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })).ToUpperInvariant()
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Assert-ArtifactMatches {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)] $Artifact,
        [Parameter(Mandatory)][string] $Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label missing: $Path"
    }
    if ($null -eq $Artifact.length) {
        throw "$Label has no expected length in manifest: $($Artifact.source)"
    }
    if ([string]::IsNullOrWhiteSpace([string] $Artifact.sha256)) {
        throw "$Label has no SHA-256 in manifest. Refresh osdcloud-assets with -HashLargeArtifacts."
    }

    $item = Get-Item -LiteralPath $Path
    $expectedLength = [int64] $Artifact.length
    if ($item.Length -ne $expectedLength) {
        throw "$Label size mismatch: $Path actual=$($item.Length) expected=$expectedLength"
    }

    $actualHash = Get-Sha256Hash -LiteralPath $Path
    $expectedHash = ([string] $Artifact.sha256).ToUpperInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "$Label SHA-256 mismatch: $Path actual=$actualHash expected=$expectedHash"
    }
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory)][string] $Source,
        [Parameter(Mandatory)][string] $Destination
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        return
    }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        Copy-Item -LiteralPath $item.FullName -Destination $Destination -Recurse -Force
    }
}

function Resolve-ArtifactBundle {
    param([Parameter(Mandatory)][string] $Path)

    $fullPath = Get-FullPath $Path
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        if ([System.IO.Path]::GetExtension($fullPath) -ne '.zip') {
            throw "ArtifactBundle file must be a .zip: $fullPath"
        }
        $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("deployment-server-bundle-" + [System.Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
        Expand-Archive -LiteralPath $fullPath -DestinationPath $tempRoot -Force
        $bundleRoot = $tempRoot
        if (-not (Test-Path -LiteralPath (Join-Path $bundleRoot 'OSDCloud') -PathType Container)) {
            $nested = Get-ChildItem -LiteralPath $tempRoot -Directory | Where-Object {
                Test-Path -LiteralPath (Join-Path $_.FullName 'OSDCloud') -PathType Container
            } | Select-Object -First 1
            if ($nested) {
                $bundleRoot = $nested.FullName
            }
        }
        return [pscustomobject]@{ Root = $bundleRoot; TempRoot = $tempRoot }
    }

    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
        throw "ArtifactBundle not found: $fullPath"
    }
    [pscustomobject]@{ Root = $fullPath; TempRoot = $null }
}

function Read-Manifest {
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Manifest not found: $Path"
    }
    Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
}

function Restore-VersionedAssets {
    param(
        [Parameter(Mandatory)][string] $AssetsRoot,
        [Parameter(Mandatory)][string] $TargetRoot
    )

    foreach ($folder in @('Win11-iPXE-Lab')) {
        $source = Join-Path $AssetsRoot $folder
        $target = Assert-ChildPath -Root $TargetRoot -Path (Join-Path $TargetRoot $folder) -Label 'live asset path'
        Copy-DirectoryContents -Source $source -Destination $target
    }
}

function Restore-ExcludedArtifacts {
    param(
        [Parameter(Mandatory)] $Manifest,
        [Parameter(Mandatory)][string] $BundleRoot,
        [Parameter(Mandatory)][string] $TargetRoot
    )

    $bundleOsdRoot = Join-Path $BundleRoot 'OSDCloud'
    if (-not (Test-Path -LiteralPath $bundleOsdRoot -PathType Container)) {
        throw "Bundle must contain an OSDCloud folder: $bundleOsdRoot"
    }

    $sourceRoot = if ([string]::IsNullOrWhiteSpace([string] $Manifest.sourceRoot)) { 'C:\OSDCloud' } else { [string] $Manifest.sourceRoot }
    $missing = New-Object System.Collections.Generic.List[string]
    $artifacts = @($Manifest.excludedArtifacts)
    foreach ($artifact in $artifacts) {
        if (-not $artifact.exists) {
            $missing.Add([string] $artifact.source)
            continue
        }
        $relative = Get-RelativePathUnderRoot -Root $sourceRoot -Path ([string] $artifact.source)
        $bundleFile = Join-ChildPath -Root $bundleOsdRoot -RelativePath $relative -Label 'bundle artifact path'
        if (-not (Test-Path -LiteralPath $bundleFile -PathType Leaf)) {
            $missing.Add($relative)
        }
    }
    if ($missing.Count -gt 0) {
        throw "Artifact bundle is missing required excluded artifact(s):`n - $($missing -join "`n - ")"
    }

    $restored = 0
    foreach ($artifact in $artifacts) {
        $relative = Get-RelativePathUnderRoot -Root $sourceRoot -Path ([string] $artifact.source)
        $bundleFile = Join-ChildPath -Root $bundleOsdRoot -RelativePath $relative -Label 'bundle artifact path'
        Assert-ArtifactMatches -Path $bundleFile -Artifact $artifact -Label 'Bundle artifact'

        $targetFile = Join-ChildPath -Root $TargetRoot -RelativePath $relative -Label 'target artifact path'
        New-Item -ItemType Directory -Path (Split-Path -Parent $targetFile) -Force | Out-Null
        Copy-Item -LiteralPath $bundleFile -Destination $targetFile -Force
        Assert-ArtifactMatches -Path $targetFile -Artifact $artifact -Label 'Restored artifact'
        $restored += 1
    }
    $restored
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory)][string] $FilePath,
        [string[]] $ArgumentList = @(),
        [string] $WorkingDirectory = $RepoRoot
    )

    Push-Location -LiteralPath $WorkingDirectory
    try {
        Write-Host "+ $FilePath $($ArgumentList -join ' ')"
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-PowerShellScript {
    param(
        [Parameter(Mandatory)][string] $ScriptPath,
        [string[]] $ArgumentList = @()
    )

    Invoke-ExternalCommand -FilePath 'powershell.exe' -ArgumentList (@(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $ScriptPath
    ) + $ArgumentList) -WorkingDirectory $RepoRoot
}

function Start-WebConsole {
    $webUrl = 'http://127.0.0.1:8080'
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
    Start-Process $webUrl
}

try {
    if (-not $SkipAdminCheck -and -not (Test-IsAdministrator)) {
        throw "Run this bootstrap from an elevated PowerShell session or use Deploy-DeploymentServer.cmd."
    }

    $liveRootFull = Get-FullPath $LiveRoot
    if ($liveRootFull -ne 'C:\OSDCloud' -and -not $SkipEndpointSync) {
        throw "-LiveRoot outside C:\OSDCloud is only supported with -SkipEndpointSync."
    }
    if ($liveRootFull -ne 'C:\OSDCloud' -and -not $SkipPreflight) {
        throw "-LiveRoot outside C:\OSDCloud is only supported with -SkipPreflight."
    }
    if ($liveRootFull -ne 'C:\OSDCloud' -and -not $NoLaunch) {
        throw "-LiveRoot outside C:\OSDCloud is only supported with -NoLaunch."
    }

    if ([string]::IsNullOrWhiteSpace($ArtifactBundle)) {
        Write-Step "Rebuilding C:\OSDCloud runtime from repo artifact catalog"
        $restoreArgs = @(
            '-CatalogPath', $RuntimeCatalogPath,
            '-LiveRoot', $liveRootFull
        )
        if ($IncludeOptionalArtifacts) {
            $restoreArgs += '-IncludeOptional'
        }
        if ($SkipOsImageDownload) {
            $restoreArgs += '-SkipOsImageDownload'
        }
        if ($SkipWinPeBuild) {
            $restoreArgs += '-SkipWinPeBuild'
        }
        Invoke-PowerShellScript -ScriptPath (Join-Path $RepoRoot 'tools\Restore-DeploymentArtifacts.ps1') -ArgumentList $restoreArgs
    }
    else {
        Write-Step "Loading manifest and legacy artifact bundle"
        $manifest = Read-Manifest -Path $ManifestPath
        $bundle = Resolve-ArtifactBundle -Path $ArtifactBundle

        try {
            Write-Step "Restoring C:\OSDCloud runtime from legacy bundle"
            New-Item -ItemType Directory -Path $liveRootFull -Force | Out-Null
            Restore-VersionedAssets -AssetsRoot (Join-Path $RepoRoot 'osdcloud-assets') -TargetRoot $liveRootFull
            $restored = Restore-ExcludedArtifacts -Manifest $manifest -BundleRoot $bundle.Root -TargetRoot $liveRootFull
            Write-Host "Restored and verified $restored excluded artifact(s)."
        }
        finally {
            if ($bundle.TempRoot) {
                Remove-Item -LiteralPath $bundle.TempRoot -Recurse -Force
            }
        }
    }

    if (-not $SkipTests) {
        Write-Step "Installing repo dependencies and running validation"
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('install')
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('test')
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('run', 'smoke')
    }

    if ($ConfigureNic) {
        Write-Step "Configuring Windows service NIC"
        $nicArgs = @(
            '-InterfaceAlias', $InterfaceAlias,
            '-ServerIp', $ServerIp,
            '-PrefixLength', [string] $PrefixLength,
            '-InterfaceMetric', '500'
        )
        if (-not [string]::IsNullOrWhiteSpace($NicDefaultGateway)) {
            $nicArgs += @('-DefaultGateway', $NicDefaultGateway)
        }
        Invoke-PowerShellScript -ScriptPath (Join-Path $RepoRoot 'tools\Set-IpxePhysicalNic.ps1') -ArgumentList $nicArgs
    }

    if (-not $SkipEndpointSync) {
        Write-Step "Syncing deployment endpoint"
        Invoke-PowerShellScript -ScriptPath (Join-Path $RepoRoot 'tools\Set-OsdCloudIpxeEndpoint.ps1') -ArgumentList @(
            '-ConfigPath', (Join-Path $RepoRoot 'config\osdcloud-console.json'),
            '-InterfaceAlias', $InterfaceAlias,
            '-ServerIp', $ServerIp,
            '-PrefixLength', [string] $PrefixLength,
            '-DefaultGateway', $ClientGateway,
            '-CommitWinPe',
            '-SyncAssets',
            '-HashLargeArtifacts'
        )
    }

    if (-not $SkipPreflight) {
        Write-Step "Running server preflight"
        Invoke-ExternalCommand -FilePath 'npm' -ArgumentList @('run', 'server:preflight')
    }

    if (-not $NoLaunch) {
        Write-Step "Starting Web console"
        Start-WebConsole
    }

    Write-Step "Deployment server bootstrap completed"
    Write-Host "Web console: http://127.0.0.1:8080"
    Write-Host "Deployment services are not started automatically. Start them from the Web console after confirming the real LAN DHCP server is disabled."
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
