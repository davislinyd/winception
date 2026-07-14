[CmdletBinding()]
param(
  [string]$StageRoot = '',
  [ValidateSet('24.15.0')][string]$NodeVersion = '24.15.0',
  [ValidatePattern('^\d+\.\d+\.\d+$')][string]$MsiVersion = '2.0.17',
  [ValidatePattern('^v2\.\d+\.\d+-(alpha|beta|rc)\.\d+$')][string]$ReleaseTag = 'v2.0.0-alpha.5',
  [ValidateSet('internal-prerelease', 'prerelease', 'stable')][string]$Channel = 'internal-prerelease',
  [string]$CodeSigningThumbprint = '',
  [string]$TimestampServer = 'http://timestamp.digicert.com',
  [switch]$BuildMsi
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($StageRoot)) { $StageRoot = Join-Path $repo '.v2-stage' }
$stage = [IO.Path]::GetFullPath($StageRoot)
if (-not $stage.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'StageRoot must remain inside the workspace.' }
$winSwVersion = '2.12.0'
$winSwHash = 'B5066B7BBDFBA1293E5D15CDA3CAAEA88FBEAB35BD5B38C41C913D492AADFC4F'
$winSwCache = Join-Path $repo ".v2-cache\WinSW.NET461-$winSwVersion.exe"
$winSwUrl = "https://github.com/winsw/winsw/releases/download/v$winSwVersion/WinSW.NET461.exe"
$winSwLicenseHash = '1CDF703C10A70E5973BF3ACF2A5EEABE7746237155B92DB2034AEAE26FDF7802'
$winSwLicenseCache = Join-Path $repo ".v2-cache\WinSW-LICENSE-$winSwVersion.txt"
$winSwLicenseUrl = "https://raw.githubusercontent.com/winsw/winsw/v$winSwVersion/LICENSE.txt"
$nodeLicenseHash = '4573185D56580DA2B890BA34A85A409257640F1C5632EADE4300137266194D18'
$nodeLicenseCache = Join-Path $repo ".v2-cache\node-LICENSE-v$NodeVersion.txt"
$nodeLicenseUrl = "https://raw.githubusercontent.com/nodejs/node/v$NodeVersion/LICENSE"
$powerShellModules = @(
  [ordered]@{ Name = 'OSD'; Version = '26.4.23.1'; Sha256 = '4E1A99C503C2F26295D03164D3C68B42D8CB9073933B87101E526A71ED5CAA4C'; License = 'GPL-3.0-only'; ProjectUrl = 'https://github.com/OSDeploy/OSD' },
  [ordered]@{ Name = 'OSDCloud'; Version = '26.4.17.1'; Sha256 = '3172B94A29F9F30C38DCDB1C8ED08A3DB3E134BEE7B0A7A9621FBEBCEAD95693'; License = 'GPL-3.0-only'; ProjectUrl = 'https://github.com/OSDeploy/OSDCloud' }
)
$node = (Get-Command node.exe -ErrorAction Stop).Source
$actualNodeVersion = (& $node --version).Trim().TrimStart('v')
if ($actualNodeVersion -ne $NodeVersion) { throw "Packaging requires Node.js $NodeVersion; found $actualNodeVersion." }
$usingSelfSignedCodeSigning = [string]::IsNullOrWhiteSpace($CodeSigningThumbprint)
if ([string]::IsNullOrWhiteSpace($CodeSigningThumbprint)) {
  $developmentCertificateJson = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'New-WinceptionSelfSignedCertificate.ps1') -Purpose CodeSigning -StoreLocation CurrentUser
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create the local self-signed code-signing certificate.' }
  $developmentCertificate = $developmentCertificateJson | ConvertFrom-Json
  $CodeSigningThumbprint = [string]$developmentCertificate.thumbprint
  $TimestampServer = ''
}

function Get-VerifiedDownload {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Uri, [Parameter(Mandatory)][string]$Sha256)
  if ((Test-Path -LiteralPath $Path -PathType Leaf) -and (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $Sha256) { return }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  $temporary = "$Path.download"
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  Invoke-WebRequest -Uri $Uri -OutFile $temporary
  if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $Sha256) {
    Remove-Item -LiteralPath $temporary -Force
    throw "The downloaded packaging dependency failed SHA-256 verification: $Uri"
  }
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Expand-PowerShellModulePackage {
  param([Parameter(Mandatory)]$Module, [Parameter(Mandatory)][string]$DestinationRoot)

  $packagePath = Join-Path $repo ".v2-cache\$($Module.Name)-$($Module.Version).nupkg"
  $packageUrl = "https://www.powershellgallery.com/api/v2/package/$($Module.Name)/$($Module.Version)"
  Get-VerifiedDownload -Path $packagePath -Uri $packageUrl -Sha256 $Module.Sha256
  $moduleRoot = Join-Path $DestinationRoot "$($Module.Name)\$($Module.Version)"
  if (Test-Path -LiteralPath $moduleRoot) { Remove-Item -LiteralPath $moduleRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $moduleRoot -Force | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($packagePath, $moduleRoot)
  foreach ($metadataPath in @('_rels', 'package', '[Content_Types].xml', "$($Module.Name).nuspec")) {
    Remove-Item -LiteralPath (Join-Path $moduleRoot $metadataPath) -Recurse -Force -ErrorAction SilentlyContinue
  }
  $manifestPath = Join-Path $moduleRoot "$($Module.Name).psd1"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "PowerShell module manifest missing after extraction: $manifestPath" }
  $manifest = Import-PowerShellDataFile -LiteralPath $manifestPath
  if ([version]$manifest.ModuleVersion -ne [version]$Module.Version) { throw "PowerShell module version mismatch: $($Module.Name)" }
}

function Invoke-PackageSigning([string]$PackageRoot) {
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tools/v2/Sign-WinceptionPackage.ps1', '-PackageRoot', $PackageRoot, '-CertificateThumbprint', $CodeSigningThumbprint)
  if (-not [string]::IsNullOrWhiteSpace($TimestampServer)) { $arguments += @('-TimestampServer', $TimestampServer) }
  & powershell.exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "Package signing failed: $PackageRoot" }
}

Push-Location $repo
try {
  & npm.cmd run v2:build
  if ($LASTEXITCODE -ne 0) { throw 'v2 build failed.' }
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  New-Item -ItemType Directory -Path (Join-Path $stage 'node'), (Join-Path $stage 'app') | Out-Null
  Get-VerifiedDownload -Path $winSwCache -Uri $winSwUrl -Sha256 $winSwHash
  Get-VerifiedDownload -Path $winSwLicenseCache -Uri $winSwLicenseUrl -Sha256 $winSwLicenseHash
  Get-VerifiedDownload -Path $nodeLicenseCache -Uri $nodeLicenseUrl -Sha256 $nodeLicenseHash
  Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'node\node.exe')
  Copy-Item -LiteralPath $winSwCache -Destination (Join-Path $stage 'node\Winception.Agent.exe')
  Copy-Item -LiteralPath $winSwCache -Destination (Join-Path $stage 'node\Winception.Web.exe')
  Copy-Item -LiteralPath 'installer\winsw\Winception.Agent.xml', 'installer\winsw\Winception.Web.xml' -Destination (Join-Path $stage 'node')
  Copy-Item -LiteralPath 'package.json', 'package-lock.json' -Destination (Join-Path $stage 'app')
  Copy-Item -LiteralPath 'LICENSE', 'README.md', 'SECURITY.md', 'SUPPORT.md', 'THIRD-PARTY-NOTICES.md' -Destination (Join-Path $stage 'app')
  New-Item -ItemType Directory -Path (Join-Path $stage 'app\licenses') | Out-Null
  Copy-Item -LiteralPath $winSwLicenseCache -Destination (Join-Path $stage 'app\licenses\WinSW-LICENSE.txt')
  Copy-Item -LiteralPath $nodeLicenseCache -Destination (Join-Path $stage 'app\licenses\Node.js-LICENSE.txt')
  Copy-Item -LiteralPath 'dist' -Destination (Join-Path $stage 'app') -Recurse
  Copy-Item -LiteralPath 'tools' -Destination (Join-Path $stage 'app') -Recurse
  Copy-Item -LiteralPath 'config', 'osdcloud-assets', 'Softwares', 'Scripts', 'src' -Destination (Join-Path $stage 'app') -Recurse
  Remove-Item -LiteralPath (Join-Path $stage 'app\tools\osdcloud-console\test'), (Join-Path $stage 'app\Scripts\v2') -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -LiteralPath (Join-Path $stage 'app\dist') -Recurse -File | Where-Object { $_.Name -like '*.map' -or $_.Name -like '*.d.ts' } | Remove-Item -Force
  foreach ($module in $powerShellModules) {
    Expand-PowerShellModulePackage -Module $module -DestinationRoot (Join-Path $stage 'app\powershell-modules')
    Copy-Item -LiteralPath (Join-Path $stage "app\powershell-modules\$($module.Name)\$($module.Version)\LICENSE") -Destination (Join-Path $stage "app\licenses\$($module.Name)-LICENSE.txt") -Force
  }
  & npm.cmd ci --omit=dev --ignore-scripts --prefix (Join-Path $stage 'app')
  if ($LASTEXITCODE -ne 0) { throw 'Production dependency install failed.' }
  $sbomText = (& npm.cmd sbom --omit=dev --sbom-format=cyclonedx) -join "`n"
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sbomText)) { throw 'Production SBOM generation failed.' }
  $packageMetadata = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
  $sbom = $sbomText | ConvertFrom-Json
  $sbom.metadata.component.name = [string]$packageMetadata.name
  $sbom.metadata.component.version = [string]$packageMetadata.version
  $sbomLicenseIds = @($sbom.metadata.component.licenses | ForEach-Object { [string]$_.license.id })
  if ($sbomLicenseIds -notcontains [string]$packageMetadata.license) { throw 'Production SBOM does not contain the declared product license.' }
  $sbom.components = @($sbom.components) + @($powerShellModules | ForEach-Object {
    [ordered]@{
      type = 'library'
      name = $_.Name
      version = $_.Version
      'bom-ref' = "pkg:nuget/$($_.Name)@$($_.Version)"
      purl = "pkg:nuget/$($_.Name)@$($_.Version)"
      hashes = @([ordered]@{ alg = 'SHA-256'; content = $_.Sha256 })
      licenses = @([ordered]@{ license = [ordered]@{ id = $_.License } })
      externalReferences = @([ordered]@{ type = 'website'; url = $_.ProjectUrl })
    }
  })
  $sbomText = $sbom | ConvertTo-Json -Depth 100
  [IO.File]::WriteAllText((Join-Path $stage 'app\winception-v2-sbom.cdx.json'), $sbomText, [Text.UTF8Encoding]::new($false))
  Invoke-PackageSigning $stage
  & node.exe Scripts/v2/create-package-manifest.mjs $stage
  if ($LASTEXITCODE -ne 0) { throw 'Package manifest generation failed.' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer/wix/Generate-WixFiles.ps1 -StageRoot $stage
  if ($LASTEXITCODE -ne 0) { throw 'WiX payload generation failed.' }
  if ($BuildMsi) {
    $dotnetCommand = Get-Command dotnet.exe -ErrorAction SilentlyContinue
    $dotnet = if ($null -ne $dotnetCommand) { $dotnetCommand.Source } else { '' }
    if (-not $dotnet) { $dotnet = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe' }
    if (-not (Test-Path -LiteralPath $dotnet -PathType Leaf)) { throw 'The .NET SDK is required to build the MSI.' }
    & $dotnet build installer/wix/Winception.Installer.wixproj -c Release -p:StageRoot=$stage -p:ProductVersion=$MsiVersion
    if ($LASTEXITCODE -ne 0) { throw 'MSI build failed.' }
    Invoke-PackageSigning 'installer/output'
    if ($usingSelfSignedCodeSigning) {
      $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CodeSigningThumbprint" -ErrorAction Stop
      Export-Certificate -Cert $certificate -FilePath 'installer/output/Winception-Local-CodeSigning.cer' -Force | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $stage 'app\tools\install\Install-Winception.ps1') -Destination 'installer/output/Install-Winception.ps1' -Force
    Copy-Item -LiteralPath (Join-Path $stage 'app\winception-v2-sbom.cdx.json') -Destination 'installer/output/winception-v2-sbom.cdx.json' -Force
    Copy-Item -LiteralPath 'LICENSE' -Destination 'installer/output/LICENSE' -Force
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/v2/New-WinceptionReleaseManifest.ps1 -ReleaseTag $ReleaseTag -Channel $Channel
    if ($LASTEXITCODE -ne 0) { throw 'Release manifest generation failed.' }
  }
}
finally { Pop-Location }
