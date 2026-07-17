[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^v1\.\d+\.\d+$')]
    [string]$ReleaseTag,

    [Parameter(Mandatory)]
    [string]$OutputDirectory,

    [string]$SourceDirectory = (Split-Path -Parent $PSScriptRoot)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath($SourceDirectory)
$packagePath = Join-Path $repositoryRoot 'package.json'
$manualPath = Join-Path $repositoryRoot 'docs\winception-operations-manual.html'
$assetsPath = Join-Path $repositoryRoot 'docs\manual-assets'
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

$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$expectedVersion = $ReleaseTag.Substring(1)
if ($package.version -ne $expectedVersion) {
    throw "package.json version '$($package.version)' does not match release tag '$ReleaseTag'."
}

$manual = Get-Content -LiteralPath $manualPath -Raw
foreach ($versionMarker in @("Operations Manual · $ReleaseTag", "Web $ReleaseTag")) {
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

    $publishedHref = "href=`"$repositoryUrl/blob/$ReleaseTag/$($referenceLinks[$relativeLink])`""
    $manual = $manual.Replace($sourceHref, $publishedHref)
}

$indexPath = Join-Path $resolvedOutputDirectory 'index.html'
[System.IO.File]::WriteAllText($indexPath, $manual, [System.Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath $assetsPath -Destination (Join-Path $resolvedOutputDirectory 'manual-assets') -Recurse
New-Item -ItemType File -Path (Join-Path $resolvedOutputDirectory '.nojekyll') -Force | Out-Null

Write-Output "Built Winception $ReleaseTag GitHub Pages site at $resolvedOutputDirectory"
