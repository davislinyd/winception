[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('Backup', 'Restore', 'Probe', 'Commit')][string]$Mode,
  [string]$StateRoot = "$env:ProgramData\Winception\State"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$state = [IO.Path]::GetFullPath($StateRoot)
$databaseFiles = @('winception-v2.db', 'winception-v2.db-wal', 'winception-v2.db-shm')
$backupRoot = Join-Path $state '.msi-upgrade-backup'

switch ($Mode) {
  'Backup' {
    if (Test-Path -LiteralPath $backupRoot) { Remove-Item -LiteralPath $backupRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    foreach ($name in $databaseFiles) {
      $source = Join-Path $state $name
      if (Test-Path -LiteralPath $source -PathType Leaf) { Copy-Item -LiteralPath $source -Destination (Join-Path $backupRoot $name) -Force }
    }
  }
  'Restore' {
    if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) { return }
    foreach ($name in $databaseFiles) {
      $destination = Join-Path $state $name
      Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
      $backup = Join-Path $backupRoot $name
      if (Test-Path -LiteralPath $backup -PathType Leaf) { Copy-Item -LiteralPath $backup -Destination $destination -Force }
    }
  }
  'Probe' {
    $settingsPath = Join-Path $state 'service-settings.json'
    if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) { throw 'Service settings are missing after installation.' }
    $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding utf8 | ConvertFrom-Json
    $scheme = if ($settings.tls) { 'https' } else { 'http' }
    $healthUrl = '{0}://{1}:{2}/api/v2/health' -f $scheme, $settings.managementHost, $settings.managementPort
    foreach ($attempt in 1..30) {
      try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        if ($health.ok -eq $true -and $health.service -eq 'web') { return }
      }
      catch { }
      Start-Sleep -Seconds 1
    }
    throw 'Winception Web failed the post-upgrade health probe.'
  }
  'Commit' {
    Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
