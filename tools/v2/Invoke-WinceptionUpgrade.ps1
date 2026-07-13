[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$PackageRoot,
  [string]$InstallRoot = "$env:ProgramFiles\Winception",
  [string]$StateRoot = "$env:ProgramData\Winception\State",
  [string]$HealthUrl = 'http://127.0.0.1:8080/api/v2/health',
  [switch]$AllowUnsigned
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$package = (Resolve-Path -LiteralPath $PackageRoot).Path
$install = [IO.Path]::GetFullPath($InstallRoot)
$parent = Split-Path -Parent $install
$stage = Join-Path $parent ('.winception-stage-' + [Guid]::NewGuid().ToString('N'))
$rollback = Join-Path $parent ('.winception-rollback-' + [Guid]::NewGuid().ToString('N'))
$database = Join-Path ([IO.Path]::GetFullPath($StateRoot)) 'winception-v2.db'
$databaseBackup = "$database.pre-upgrade"
$services = @('Winception.Web', 'Winception.Agent')
$swapped = $false

function Assert-Package([string]$Root) {
  $manifestPath = Join-Path $Root 'package-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Package manifest is missing.' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  foreach ($entry in $manifest.files) {
    $path = Join-Path $Root $entry.path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Package file is missing: $($entry.path)" }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Package hash failed: $($entry.path)" }
  }
  if (-not $AllowUnsigned) {
    foreach ($executable in Get-ChildItem -LiteralPath $Root -Recurse -File -Include *.exe,*.dll,*.ps1) {
      if ((Get-AuthenticodeSignature -LiteralPath $executable.FullName).Status -ne 'Valid') { throw "Unsigned package file: $($executable.Name)" }
    }
  }
}

try {
  Assert-Package $package
  New-Item -ItemType Directory -Path $stage | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $package -Force) {
    Copy-Item -LiteralPath $item.FullName -Destination $stage -Recurse -Force
  }
  Assert-Package $stage
  foreach ($name in $services) { Stop-Service -Name $name -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $database) { Copy-Item -LiteralPath $database -Destination $databaseBackup -Force }
  if (Test-Path -LiteralPath $install) { Move-Item -LiteralPath $install -Destination $rollback }
  Move-Item -LiteralPath $stage -Destination $install
  $swapped = $true
  Start-Service -Name 'Winception.Agent'
  Start-Service -Name 'Winception.Web'
  $healthy = $false
  foreach ($attempt in 1..30) {
    try {
      $response = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
      if ($response.ok -eq $true -and $response.service -eq 'web') { $healthy = $true; break }
    }
    catch { Start-Sleep -Seconds 1 }
  }
  if (-not $healthy) { throw 'The upgraded Web service did not pass its health probe.' }
  if (Test-Path -LiteralPath $rollback) { Remove-Item -LiteralPath $rollback -Recurse -Force }
  if (Test-Path -LiteralPath $databaseBackup) { Remove-Item -LiteralPath $databaseBackup -Force }
}
catch {
  foreach ($name in $services) { Stop-Service -Name $name -Force -ErrorAction SilentlyContinue }
  if ($swapped -and (Test-Path -LiteralPath $install)) { Remove-Item -LiteralPath $install -Recurse -Force }
  if (Test-Path -LiteralPath $rollback) { Move-Item -LiteralPath $rollback -Destination $install }
  if (Test-Path -LiteralPath $databaseBackup) { Copy-Item -LiteralPath $databaseBackup -Destination $database -Force }
  foreach ($name in @('Winception.Agent', 'Winception.Web')) { Start-Service -Name $name -ErrorAction SilentlyContinue }
  throw
}
finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
