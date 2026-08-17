[CmdletBinding()]
param(
    [string] $SourceRoot = (Split-Path -Parent $PSScriptRoot),
    [Parameter(Mandatory)][string] $StateRoot,
    [string] $ActiveProfileId = 'IZVZO7PU',
    [switch] $Force
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$ErrorActionPreference = 'Stop'
$sourceRootFull = Get-FullPath $SourceRoot
$stateRootFull = Get-FullPath $StateRoot
$fixtureRoot = Join-Path $sourceRootFull 'fixtures\development'
$markerPath = Join-Path $stateRootFull 'development-fixture.json'

if (-not (Test-Path -LiteralPath $fixtureRoot -PathType Container)) {
    throw "Development fixture directory is missing: $fixtureRoot"
}
if (-not (Test-Path -LiteralPath $stateRootFull -PathType Container)) {
    throw "State root is missing. Install the HostTools bundle first: $stateRootFull"
}
if ((Test-Path -LiteralPath $markerPath -PathType Leaf) -and -not $Force) {
    throw "Development fixture is already seeded. Pass -Force to replace it: $markerPath"
}

if ([string]::IsNullOrWhiteSpace($ActiveProfileId)) {
    throw 'ActiveProfileId must identify a fixture deployment profile.'
}

if ($Force) {
    foreach ($relative in @('config\deployment-profiles', 'Softwares', 'Scripts')) {
        $existing = Join-Path $stateRootFull $relative
        if (Test-Path -LiteralPath $existing) {
            Remove-Item -LiteralPath $existing -Recurse -Force
        }
    }
}

function Copy-FixtureTree {
    param(
        [Parameter(Mandatory)][string] $RelativeSource,
        [Parameter(Mandatory)][string] $RelativeDestination
    )

    $source = Join-Path $fixtureRoot $RelativeSource
    $destination = Join-Path $stateRootFull $RelativeDestination
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        return
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File -Force) {
        $relative = $file.FullName.Substring($source.Length).TrimStart('\')
        $target = Join-Path $destination $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    }
}

Copy-FixtureTree -RelativeSource 'config\deployment-profiles' -RelativeDestination 'config\deployment-profiles'
Copy-FixtureTree -RelativeSource 'Softwares' -RelativeDestination 'Softwares'
Copy-FixtureTree -RelativeSource 'Scripts' -RelativeDestination 'Scripts'

foreach ($catalog in @('software-catalog.json', 'scripts-catalog.json', 'os-image-catalog.json', 'os-download-sources.json')) {
    $source = Join-Path $fixtureRoot "config\$catalog"
    $target = Join-Path $stateRootFull "config\$catalog"
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
}

$stateConfigPath = Join-Path $stateRootFull 'config\osdcloud-console.json'
if (Test-Path -LiteralPath $stateConfigPath -PathType Leaf) {
    $stateConfig = Get-Content -LiteralPath $stateConfigPath -Raw | ConvertFrom-Json
    $profilePath = Join-Path $stateRootFull "config\deployment-profiles\$ActiveProfileId.json"
    if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
        throw "Fixture deployment profile is missing: $ActiveProfileId"
    }
    $activeProfile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
    $fixtureImageId = [string] $activeProfile.osImage
    if ([string]::IsNullOrWhiteSpace($fixtureImageId)) {
        $imageCatalogPath = Join-Path $stateRootFull 'config\os-image-catalog.json'
        $imageCatalog = Get-Content -LiteralPath $imageCatalogPath -Raw | ConvertFrom-Json
        $fixtureImageId = [string] @($imageCatalog.images)[0].id
    }
    if ([string]::IsNullOrWhiteSpace($fixtureImageId)) {
        throw "Fixture profile has no OS image: $ActiveProfileId"
    }
    if (-not $stateConfig.product) {
        $stateConfig | Add-Member -NotePropertyName 'product' -NotePropertyValue ([pscustomobject]@{})
    }
    if ($stateConfig.product.PSObject.Properties.Name -contains 'channel') {
        $stateConfig.product.channel = 'development'
    } else {
        $stateConfig.product | Add-Member -NotePropertyName 'channel' -NotePropertyValue 'development'
    }
    if ($stateConfig.product.PSObject.Properties.Name -contains 'dataPolicy') {
        $stateConfig.product.dataPolicy = 'development-fixture'
    } else {
        $stateConfig.product | Add-Member -NotePropertyName 'dataPolicy' -NotePropertyValue 'development-fixture'
    }
    if (-not $stateConfig.deploymentProfiles) {
        $stateConfig | Add-Member -NotePropertyName 'deploymentProfiles' -NotePropertyValue ([pscustomobject]@{})
    }
    if ($stateConfig.deploymentProfiles.PSObject.Properties.Name -contains 'activeProfile') {
        $stateConfig.deploymentProfiles.activeProfile = $ActiveProfileId
    } else {
        $stateConfig.deploymentProfiles | Add-Member -NotePropertyName 'activeProfile' -NotePropertyValue $ActiveProfileId
    }
    if (-not $stateConfig.osImage) {
        $stateConfig | Add-Member -NotePropertyName 'osImage' -NotePropertyValue ([pscustomobject]@{})
    }
    if ($stateConfig.osImage.PSObject.Properties.Name -contains 'activeImage') {
        $stateConfig.osImage.activeImage = $fixtureImageId
    } else {
        $stateConfig.osImage | Add-Member -NotePropertyName 'activeImage' -NotePropertyValue $fixtureImageId
    }
    [System.IO.File]::WriteAllText($stateConfigPath, (($stateConfig | ConvertTo-Json -Depth 32) + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
}

$marker = [pscustomobject]@{
    schemaVersion = 1
    channel = 'Development'
    seededAt = [DateTimeOffset]::UtcNow.ToString('o')
    source = 'fixtures/development'
    activeProfileId = $ActiveProfileId
    activeImageId = $fixtureImageId
}
[System.IO.File]::WriteAllText($markerPath, (($marker | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
Write-Host "Development fixture seeded into $stateRootFull"
