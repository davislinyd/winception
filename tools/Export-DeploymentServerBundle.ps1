[CmdletBinding()]
param(
    [string] $ManifestPath,
    [string] $BundleRoot,
    [switch] $Force,
    [switch] $CreateZip
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $RepoRoot 'osdcloud-assets\manifest.json'
}
if ([string]::IsNullOrWhiteSpace($BundleRoot)) {
    $BundleRoot = Join-Path $RepoRoot 'deployment-server-bundle'
}

function Get-FullPath {
    param([Parameter(Mandatory)][string] $Path)
    [System.IO.Path]::GetFullPath($Path)
}

function Assert-SafeDeleteTarget {
    param([Parameter(Mandatory)][string] $Path)

    $full = Get-FullPath $Path
    $root = [System.IO.Path]::GetPathRoot($full)
    if ($full -eq $root -or $full.Length -lt 8) {
        throw "Refusing to delete unsafe bundle path: $full"
    }
    $full
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

function Test-IsRuntimeJunk {
    param([Parameter(Mandatory)][string] $Path)

    $parts = $Path -split '[\\/]'
    if ($parts -contains 'status' -or $parts -contains 'TimingRuns' -or $parts -contains 'screenshots' -or $parts -contains 'transcripts' -or $parts -contains 'logs') {
        return $true
    }
    $extension = [System.IO.Path]::GetExtension($Path)
    $extension -in @('.log', '.etl', '.evtx', '.jsonl')
}

if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Manifest not found: $ManifestPath"
}

$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
$sourceRoot = if ([string]::IsNullOrWhiteSpace([string] $manifest.sourceRoot)) { 'C:\OSDCloud' } else { [string] $manifest.sourceRoot }
$bundleFull = Get-FullPath $BundleRoot

if (Test-Path -LiteralPath $bundleFull) {
    if (-not $Force) {
        throw "Bundle path already exists. Pass -Force to replace it: $bundleFull"
    }
    $safeDelete = Assert-SafeDeleteTarget -Path $bundleFull
    Remove-Item -LiteralPath $safeDelete -Recurse -Force
}

$bundleOsdRoot = Join-Path $bundleFull 'OSDCloud'
New-Item -ItemType Directory -Path $bundleOsdRoot -Force | Out-Null

$records = New-Object System.Collections.Generic.List[object]
foreach ($artifact in @($manifest.excludedArtifacts)) {
    if (-not $artifact.exists) {
        throw "Manifest records an excluded artifact that did not exist on the source host: $($artifact.source)"
    }

    $source = [string] $artifact.source
    if (Test-IsRuntimeJunk -Path $source) {
        continue
    }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Excluded artifact not found on this host: $source"
    }
    if ([string]::IsNullOrWhiteSpace([string] $artifact.sha256)) {
        throw "Excluded artifact has no SHA-256 in manifest. Refresh osdcloud-assets with -HashLargeArtifacts: $source"
    }

    $relative = Get-RelativePathUnderRoot -Root $sourceRoot -Path $source
    $destination = Join-ChildPath -Root $bundleOsdRoot -RelativePath $relative -Label 'bundle artifact path'
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force

    $item = Get-Item -LiteralPath $destination
    $actualHash = Get-Sha256Hash -LiteralPath $destination
    $expectedHash = ([string] $artifact.sha256).ToUpperInvariant()
    if ($item.Length -ne [int64] $artifact.length) {
        throw "Copied artifact size mismatch: $relative actual=$($item.Length) expected=$($artifact.length)"
    }
    if ($actualHash -ne $expectedHash) {
        throw "Copied artifact SHA-256 mismatch: $relative actual=$actualHash expected=$expectedHash"
    }

    $records.Add([ordered]@{
        source = $source
        relativePath = $relative
        bundlePath = "OSDCloud\$relative"
        length = $item.Length
        sha256 = $actualHash
        reason = $artifact.reason
    })
}

$repoCommit = $null
try {
    $repoCommit = (& git -C $RepoRoot rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -ne 0) {
        $repoCommit = $null
    }
}
catch {
    $repoCommit = $null
}

$artifactRecords = @($records.ToArray())
$bundleManifest = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    sourceManifest = (Get-FullPath $ManifestPath)
    sourceRoot = $sourceRoot
    repoCommit = $repoCommit
    artifactCount = $records.Count
    artifacts = $artifactRecords
}

$bundleManifestPath = Join-Path $bundleFull 'bundle-manifest.json'
$bundleManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $bundleManifestPath -Encoding UTF8

if ($CreateZip) {
    $zipPath = "$bundleFull.deployment-server.zip"
    if ((Test-Path -LiteralPath $zipPath) -and -not $Force) {
        throw "Zip path already exists. Pass -Force to replace it: $zipPath"
    }
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    Compress-Archive -Path (Join-Path $bundleFull '*') -DestinationPath $zipPath
    Write-Host "Created $zipPath"
}

Write-Host "Exported $($records.Count) artifact(s) to $bundleFull"
