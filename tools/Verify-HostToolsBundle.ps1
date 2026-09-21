[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $BundleRoot,
    [ValidateSet('Release', 'Development')][string] $Channel = 'Release',
    [string] $ZipPath,
    [string] $ExpectedCommit,
    [string] $ExpectedVersion
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$bundleRootFull = Get-FullPath $BundleRoot
$stageRoot = if (Test-Path -LiteralPath (Join-Path $bundleRootFull 'bundle-manifest.json') -PathType Leaf) {
    $bundleRootFull
} else {
    Join-ChildPath -Root $bundleRootFull -RelativePath 'HostTools' -Label 'HostTools stage root'
}
$manifestPath = Join-ChildPath -Root $stageRoot -RelativePath 'bundle-manifest.json' -Label 'bundle manifest'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$failures = New-Object System.Collections.Generic.List[string]

function Add-Failure {
    param([Parameter(Mandatory)][string] $Message)
    $failures.Add($Message)
}

function Assert-Value {
    param(
        [Parameter(Mandatory)] $Actual,
        [Parameter(Mandatory)] $Expected,
        [Parameter(Mandatory)][string] $Label
    )
    if ([string] $Actual -ne [string] $Expected) {
        Add-Failure "$Label expected '$Expected' but found '$Actual'."
    }
}

Assert-Value -Actual $manifest.channel -Expected $Channel -Label 'manifest channel'
$expectedPolicy = if ($Channel -eq 'Release') { 'zero-preload' } else { 'development-fixture' }
Assert-Value -Actual $manifest.dataPolicy -Expected $expectedPolicy -Label 'manifest data policy'
Assert-Value -Actual $manifest.allowlist -Expected 'hosttools-production-v1' -Label 'manifest allowlist'
Assert-Value -Actual $manifest.secretPolicy -Expected 'no-plaintext-secrets' -Label 'manifest secret policy'
Assert-Value -Actual $manifest.statePolicy -Expected 'fresh-empty-preserve-on-upgrade' -Label 'manifest State policy'
if ($null -eq $manifest.files) {
    Add-Failure 'bundle manifest has no files inventory.'
}

$records = @($manifest.files)
if ([int] $manifest.artifactCount -ne $records.Count) {
    Add-Failure "manifest artifactCount does not match files inventory ($($manifest.artifactCount) vs $($records.Count))."
}
if (-not [string]::IsNullOrWhiteSpace($ExpectedCommit)) {
    Assert-Value -Actual $manifest.repoCommit -Expected $ExpectedCommit -Label 'manifest commit'
}
if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion)) {
    Assert-Value -Actual $manifest.version -Expected $ExpectedVersion -Label 'manifest version'
}

$inventory = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
foreach ($record in $records) {
    $relative = ([string] $record.path).Replace('/', '\').TrimStart('\')
    if ([string]::IsNullOrWhiteSpace($relative) -or [System.IO.Path]::IsPathRooted($relative) -or $relative -match '(^|\\)\.\.(\\|$)') {
        Add-Failure "manifest contains an unsafe path: $($record.path)"
        continue
    }
    if (-not $inventory.Add($relative)) {
        Add-Failure "manifest contains a duplicate path: $relative"
        continue
    }
    try {
        $path = Join-ChildPath -Root $stageRoot -RelativePath $relative -Label 'bundle file'
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            Add-Failure "manifest file is missing: $relative"
            continue
        }
        $item = Get-Item -LiteralPath $path
        if ([int64] $record.length -ne [int64] $item.Length) {
            Add-Failure "length mismatch: $relative"
        }
        $actualHash = Get-Sha256Hash -LiteralPath $path
        if ($actualHash -ne ([string] $record.sha256).ToUpperInvariant()) {
            Add-Failure "SHA-256 mismatch: $relative"
        }
    } catch {
        Add-Failure "unable to verify $($relative): $($_.Exception.Message)"
    }
}

foreach ($item in Get-ChildItem -LiteralPath $stageRoot -Recurse -File -Force) {
    $relative = $item.FullName.Substring($stageRoot.Length).TrimStart('\')
    if ($relative -eq 'bundle-manifest.json') {
        continue
    }
    if (-not $inventory.Contains($relative)) {
        Add-Failure "file is not listed in manifest: $relative"
    }
}

$forbiddenDataPathPattern = if ($Channel -eq 'Release') {
    '(^|\\)(\.git|\.ai|fixtures|logs|screenshots|transcripts|runtime|downloads|tests?)(\\|$)'
} else {
    '(^|\\)(\.git|\.ai|logs|screenshots|transcripts|runtime|downloads|tests?)(\\|$)'
}

foreach ($record in $records) {
    $relative = ([string] $record.path).Replace('/', '\')
    if ($relative -match $forbiddenDataPathPattern -or
        $relative -match '(^|\\)([^\\]*secret[^\\]*|[^\\]*\.local\.json)$' -and $relative -notmatch 'osdcloud-secrets\.example\.json$' -or
        $relative -match '\.(iso|wim|esd|vhd|vhdx|avhdx|log|etl|evtx|png|jpg|jpeg|msi|exe|pcapng)$' -and
        $relative -notmatch '^docs\\manual-assets\\' -and
        $relative -notmatch '^tools\\osdcloud-console\\web\\') {
        Add-Failure "forbidden release path is present: $relative"
    }
}

if ($Channel -eq 'Release') {
    if ([bool] $manifest.fixturePresence.included -or @($manifest.fixturePresence.paths).Count -gt 0) {
        Add-Failure 'Release manifest declares development fixtures.'
    }
    if (Test-Path -LiteralPath (Join-Path $stageRoot 'tools\Seed-DevelopmentFixture.ps1') -PathType Leaf) {
        Add-Failure 'Release bundle contains the Development seed command.'
    }
    $profileFiles = @(Get-ChildItem -LiteralPath (Join-ChildPath -Root $stageRoot -RelativePath 'config\deployment-profiles' -Label 'profile directory') -File -Force -ErrorAction SilentlyContinue)
    if (@($profileFiles | Where-Object { $_.Name -ne '.gitkeep' }).Count -gt 0) {
        Add-Failure 'Release bundle contains deployment profile data.'
    }

    foreach ($catalog in @(
        @{ path = 'config\software-catalog.json'; collection = 'software' },
        @{ path = 'config\scripts-catalog.json'; collection = 'scripts' },
        @{ path = 'config\os-image-catalog.json'; collection = 'images' },
        @{ path = 'config\os-download-sources.json'; collection = 'images' }
    )) {
        $catalogPath = Join-ChildPath -Root $stageRoot -RelativePath $catalog.path -Label 'release catalog'
        try {
            $catalogObject = Get-Content -LiteralPath $catalogPath -Raw | ConvertFrom-Json
            if (@($catalogObject.($catalog.collection)).Count -ne 0) {
                Add-Failure "Release catalog is not empty: $($catalog.path)"
            }
        } catch {
            Add-Failure "Release catalog cannot be read: $($catalog.path)"
        }
    }

    foreach ($record in $records | Where-Object { $_.path -match '^config/.*\.json$' -and $_.path -notmatch 'osdcloud-secrets\.example\.json$' }) {
        $configPath = Join-ChildPath -Root $stageRoot -RelativePath ([string] $record.path) -Label 'release config scan'
        $configText = Get-Content -LiteralPath $configPath -Raw
        if ($configText -match 'LabAdmin|SC-J5GF07Y2|074RMJU3|I20HRVF5|IZVZO7PU|192\.168\.177\.1|192\.168\.88\.1|7-Zip|Notepad\+\+|Chrome') {
            Add-Failure "Release config contains development or fixed Lab data: $($record.path)"
        }
        if ($configText -match '(?i)"(?:windowsPassword|pxeinstallPassword)"\s*:\s*"(?<secret>[^"]+)"') {
            $value = [string] $Matches.secret
            if (-not [string]::IsNullOrWhiteSpace($value) -and $value -notmatch '^<[^>]+>$') {
                Add-Failure "Release config contains a plaintext deployment secret: $($record.path)"
            }
        }
    }

    try {
        $config = Get-Content -LiteralPath (Join-ChildPath -Root $stageRoot -RelativePath 'config\osdcloud-console.json' -Label 'release config') -Raw | ConvertFrom-Json
        if ($config.product.channel -ne 'release' -or $config.product.dataPolicy -ne 'zero-preload' -or $config.initialization.status -ne 'unconfigured') {
            Add-Failure 'Release config is not an unconfigured zero-preload product.'
        }
        foreach ($property in @(
            'adapter.serverIp', 'dhcp.listenIp', 'dhcp.leaseStartIp', 'dhcp.leaseEndIp',
            'dhcp.router', 'dhcp.ipxeBootUrl', 'tftp.listenIp', 'http.host', 'smb.share',
            'smb.imagePath', 'osImage.activeImage', 'deploymentProfiles.activeProfile'
        )) {
            $segments = $property.Split('.')
            $value = $config
            foreach ($segment in $segments) { $value = $value.($segment) }
            if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string] $value)) {
                Add-Failure "Release config contains active deployment state: $property"
            }
        }
    } catch {
        Add-Failure "Release config cannot be read: $($_.Exception.Message)"
    }
}

if (-not [string]::IsNullOrWhiteSpace($ZipPath)) {
    $zipFull = Get-FullPath $ZipPath
    if (-not (Test-Path -LiteralPath $zipFull -PathType Leaf)) {
        Add-Failure "ZIP is missing: $zipFull"
    }
}

if ($failures.Count -gt 0) {
    throw ("HostTools bundle verification failed:`n - " + ($failures -join "`n - "))
}

[pscustomobject]@{
    stageRoot = $stageRoot
    channel = $manifest.channel
    dataPolicy = $manifest.dataPolicy
    fixturePresence = [bool] $manifest.fixturePresence.included
    repoCommit = $manifest.repoCommit
    version = $manifest.version
    artifactCount = $records.Count
    verified = $true
} | ConvertTo-Json -Depth 6
