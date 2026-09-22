[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$OutputDirectory,

    [string]$SourceDirectory = (Split-Path -Parent $PSScriptRoot),

    [string]$SourceRef = 'master'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SourceRef) -or $SourceRef -match '[\\/]|^\.') {
    throw "SourceRef must be a Git branch, tag, or commit name, not a path: $SourceRef"
}

$repositoryRoot = [System.IO.Path]::GetFullPath($SourceDirectory)
$packagePath = Join-Path $repositoryRoot 'package.json'
$manualPath = Join-Path $repositoryRoot 'docs\winception-operations-manual.html'
$assetsPath = Join-Path $repositoryRoot 'docs\manual-assets'
$torrentDeckPath = Join-Path $repositoryRoot 'docs\winception_torrent_deck'
$torrentIndexPath = Join-Path $torrentDeckPath 'index.html'
$torrentStylesPath = Join-Path $torrentDeckPath 'assets\styles.css'
$torrentAppPath = Join-Path $torrentDeckPath 'assets\app.js'
$resolvedOutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw "Missing package manifest: $packagePath"
}
if (-not (Test-Path -LiteralPath $manualPath -PathType Leaf)) {
    throw "Missing product manual: $manualPath"
}
if (-not (Test-Path -LiteralPath $assetsPath -PathType Container)) {
    throw "Missing manual assets: $assetsPath"
}
if (-not (Test-Path -LiteralPath $torrentIndexPath -PathType Leaf)) {
    throw "Missing torrent briefing deck: $torrentIndexPath"
}
if (-not (Test-Path -LiteralPath $torrentStylesPath -PathType Leaf)) {
    throw "Missing torrent briefing stylesheet: $torrentStylesPath"
}
if (-not (Test-Path -LiteralPath $torrentAppPath -PathType Leaf)) {
    throw "Missing torrent briefing script: $torrentAppPath"
}

$utf8 = [System.Text.UTF8Encoding]::new($false)
$package = ($utf8.GetString([System.IO.File]::ReadAllBytes($packagePath))) | ConvertFrom-Json
$manualVersion = 'v' + [string]$package.version
$manual = $utf8.GetString([System.IO.File]::ReadAllBytes($manualPath))
$manualTitleMarker = 'Operations Manual ' + [char]0x00B7 + " $manualVersion"
foreach ($versionMarker in @($manualTitleMarker, "Web $manualVersion")) {
    if (-not $manual.Contains($versionMarker)) {
        throw "Product manual is missing version marker '$versionMarker'."
    }
}

if (Test-Path -LiteralPath $resolvedOutputDirectory) {
    $existingOutput = @(Get-ChildItem -LiteralPath $resolvedOutputDirectory -Force)
    if ($existingOutput.Count -gt 0) {
        throw "Output directory must be empty: $resolvedOutputDirectory"
    }
}
else {
    [System.IO.Directory]::CreateDirectory($resolvedOutputDirectory) | Out-Null
}

$repositoryUrl = 'https://github.com/davislinyd/winception'
$referenceLinks = [ordered]@{
    '../README.md' = 'README.md'
    'diagrams/technical-flow.md' = 'docs/diagrams/technical-flow.md'
    'diagrams/user-flow.md' = 'docs/diagrams/user-flow.md'
    '../osdcloud-assets/README.md' = 'osdcloud-assets/README.md'
}

foreach ($relativeLink in $referenceLinks.Keys) {
    $sourceHref = "href=`"$relativeLink`""
    if (-not $manual.Contains($sourceHref)) {
        throw "Product manual is missing expected reference link '$relativeLink'."
    }

    $publishedHref = "href=`"$repositoryUrl/blob/$SourceRef/$($referenceLinks[$relativeLink])`""
    $manual = $manual.Replace($sourceHref, $publishedHref)
}

$indexPath = Join-Path $resolvedOutputDirectory 'index.html'
[System.IO.File]::WriteAllText($indexPath, $manual, $utf8)
Copy-Item -LiteralPath $assetsPath -Destination (Join-Path $resolvedOutputDirectory 'manual-assets') -Recurse
Copy-Item -LiteralPath $torrentDeckPath -Destination (Join-Path $resolvedOutputDirectory 'torrent') -Recurse
New-Item -ItemType File -Path (Join-Path $resolvedOutputDirectory '.nojekyll') -Force | Out-Null

Write-Output "Built Winception $manualVersion GitHub Pages site from $SourceRef at $resolvedOutputDirectory"
