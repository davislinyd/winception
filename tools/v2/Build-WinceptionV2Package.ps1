[CmdletBinding()]
param(
  [string]$StageRoot = '',
  [string]$NodeVersion = '24.15.0',
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
$node = (Get-Command node.exe -ErrorAction Stop).Source
$actualNodeVersion = (& $node --version).Trim().TrimStart('v')
if ($actualNodeVersion -ne $NodeVersion) { throw "Packaging requires Node.js $NodeVersion; found $actualNodeVersion." }

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

Push-Location $repo
try {
  & npm.cmd run v2:build
  if ($LASTEXITCODE -ne 0) { throw 'v2 build failed.' }
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  New-Item -ItemType Directory -Path (Join-Path $stage 'node'), (Join-Path $stage 'app') | Out-Null
  Get-VerifiedDownload -Path $winSwCache -Uri $winSwUrl -Sha256 $winSwHash
  Get-VerifiedDownload -Path $winSwLicenseCache -Uri $winSwLicenseUrl -Sha256 $winSwLicenseHash
  Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'node\node.exe')
  Copy-Item -LiteralPath $winSwCache -Destination (Join-Path $stage 'node\Winception.Agent.exe')
  Copy-Item -LiteralPath $winSwCache -Destination (Join-Path $stage 'node\Winception.Web.exe')
  Copy-Item -LiteralPath 'installer\winsw\Winception.Agent.xml', 'installer\winsw\Winception.Web.xml' -Destination (Join-Path $stage 'node')
  Copy-Item -LiteralPath 'package.json', 'package-lock.json' -Destination (Join-Path $stage 'app')
  Copy-Item -LiteralPath 'README.md', 'SECURITY.md', 'SUPPORT.md', 'THIRD-PARTY-NOTICES.md' -Destination (Join-Path $stage 'app')
  New-Item -ItemType Directory -Path (Join-Path $stage 'app\licenses') | Out-Null
  Copy-Item -LiteralPath $winSwLicenseCache -Destination (Join-Path $stage 'app\licenses\WinSW-LICENSE.txt')
  Copy-Item -LiteralPath 'dist' -Destination (Join-Path $stage 'app') -Recurse
  Copy-Item -LiteralPath 'tools' -Destination (Join-Path $stage 'app') -Recurse
  Copy-Item -LiteralPath 'config', 'osdcloud-assets', 'Softwares', 'Scripts', 'src' -Destination (Join-Path $stage 'app') -Recurse
  Remove-Item -LiteralPath (Join-Path $stage 'app\tools\osdcloud-console\test'), (Join-Path $stage 'app\Scripts\v2') -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -LiteralPath (Join-Path $stage 'app\dist') -Recurse -File | Where-Object { $_.Name -like '*.map' -or $_.Name -like '*.d.ts' } | Remove-Item -Force
  & npm.cmd ci --omit=dev --ignore-scripts --prefix (Join-Path $stage 'app')
  if ($LASTEXITCODE -ne 0) { throw 'Production dependency install failed.' }
  if (-not [string]::IsNullOrWhiteSpace($CodeSigningThumbprint)) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/v2/Sign-WinceptionPackage.ps1 -PackageRoot $stage -CertificateThumbprint $CodeSigningThumbprint -TimestampServer $TimestampServer
    if ($LASTEXITCODE -ne 0) { throw 'Staged payload signing failed.' }
  }
  & node.exe scripts/v2/create-package-manifest.mjs $stage
  if ($LASTEXITCODE -ne 0) { throw 'Package manifest generation failed.' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer/wix/Generate-WixFiles.ps1 -StageRoot $stage
  if ($LASTEXITCODE -ne 0) { throw 'WiX payload generation failed.' }
  if ($BuildMsi) {
    & dotnet.exe build installer/wix/Winception.Installer.wixproj -c Release -p:StageRoot=$stage
    if ($LASTEXITCODE -ne 0) { throw 'MSI build failed.' }
    if (-not [string]::IsNullOrWhiteSpace($CodeSigningThumbprint)) {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/v2/Sign-WinceptionPackage.ps1 -PackageRoot installer/output -CertificateThumbprint $CodeSigningThumbprint -TimestampServer $TimestampServer
      if ($LASTEXITCODE -ne 0) { throw 'MSI signing failed.' }
    }
  }
}
finally { Pop-Location }
