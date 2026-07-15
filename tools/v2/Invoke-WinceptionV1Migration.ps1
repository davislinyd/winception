[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('Migrate', 'Rollback', 'Commit')][string]$Mode,
  [string]$AppRoot = "$env:ProgramFiles\Winception\app",
  [string]$StateRoot = "$env:ProgramData\Winception\State",
  [string]$LegacyAppRoot = 'C:\OSDCloud\HostTools\App',
  [string]$LegacyStateRoot = 'C:\OSDCloud\HostTools\State'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$app = [IO.Path]::GetFullPath($AppRoot)
$state = [IO.Path]::GetFullPath($StateRoot)
$legacyApp = [IO.Path]::GetFullPath($LegacyAppRoot)
$legacyState = [IO.Path]::GetFullPath($LegacyStateRoot)
$transactionRoot = Join-Path $state '.v1-migration-transaction'
$transactionPath = Join-Path $transactionRoot 'transaction.json'
$targetLegacyRoot = Join-Path $state 'legacy'
$targetConfigRoot = Join-Path $targetLegacyRoot 'config'
$rollbackConfigRoot = Join-Path $transactionRoot 'config'

function Remove-Transaction {
  Remove-Item -LiteralPath $transactionRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($Mode -eq 'Rollback') {
  if (-not (Test-Path -LiteralPath $transactionPath -PathType Leaf)) { return }
  $transaction = Get-Content -LiteralPath $transactionPath -Raw -Encoding utf8 | ConvertFrom-Json
  if ($transaction.schemaVersion -ne 1) { throw 'The v1 migration rollback marker is invalid.' }
  if ($transaction.configExisted -eq $true) {
    if (-not (Test-Path -LiteralPath $rollbackConfigRoot -PathType Container)) { throw 'The v1 migration config backup is missing.' }
    Remove-Item -LiteralPath $targetConfigRoot -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath $rollbackConfigRoot -Destination $targetConfigRoot -Recurse
  }
  else { Remove-Item -LiteralPath $targetConfigRoot -Recurse -Force -ErrorAction SilentlyContinue }
  if ($transaction.softwareExisted -ne $true) { Remove-Item -LiteralPath (Join-Path $targetLegacyRoot 'Softwares') -Recurse -Force -ErrorAction SilentlyContinue }
  if ($transaction.scriptsExisted -ne $true) { Remove-Item -LiteralPath (Join-Path $targetLegacyRoot 'Scripts') -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Transaction
  return
}

if ($Mode -eq 'Commit') {
  Remove-Transaction
  return
}

$legacyBaseConfig = Join-Path $legacyApp 'config\osdcloud-console.json'
if (-not (Test-Path -LiteralPath $legacyBaseConfig -PathType Leaf) -or -not (Test-Path -LiteralPath $legacyState -PathType Container)) {
  [pscustomobject]@{ status = 'skipped'; reason = 'v1-state-not-found' }
  return
}
if (Test-Path -LiteralPath $transactionRoot) { throw 'A previous v1 migration transaction still requires rollback or commit.' }
$activeV1 = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessId -ne $PID -and -not [string]::IsNullOrWhiteSpace([string]$_.CommandLine) -and
    $_.CommandLine.IndexOf($legacyApp, [StringComparison]::OrdinalIgnoreCase) -ge 0
})
if ($activeV1.Count -gt 0) { throw 'Stop the v1 Web console and deployment services before migration, then retry installation.' }

New-Item -ItemType Directory -Path $transactionRoot -Force | Out-Null
$configExisted = Test-Path -LiteralPath $targetConfigRoot -PathType Container
if ($configExisted) { Copy-Item -LiteralPath $targetConfigRoot -Destination $rollbackConfigRoot -Recurse }
$transaction = [ordered]@{
  schemaVersion = 1
  configExisted = $configExisted
  softwareExisted = Test-Path -LiteralPath (Join-Path $targetLegacyRoot 'Softwares') -PathType Container
  scriptsExisted = Test-Path -LiteralPath (Join-Path $targetLegacyRoot 'Scripts') -PathType Container
}
$temporaryPath = "$transactionPath.$([Guid]::NewGuid().ToString('N')).tmp"
[IO.File]::WriteAllText($temporaryPath, ($transaction | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporaryPath -Destination $transactionPath -Force

$node = Join-Path (Split-Path -Parent $app) 'node\node.exe'
$cli = Join-Path $app 'dist\v2\node\apps\agent\src\migrateV1.js'
$protector = Join-Path $app 'tools\v2\Protect-WinceptionSecret.ps1'
foreach ($path in @($node, $cli, $protector)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required v1 migration component was not found: $path" }
}
$arguments = @($cli,
  '--app-root', $legacyApp,
  '--state-root', $legacyState,
  '--v2-state-root', $state,
  '--database', (Join-Path $state 'winception-v2.db'),
  '--backup-root', (Join-Path $state 'migration-backups'),
  '--protector-script', $protector)
& $node @arguments
if ($LASTEXITCODE -ne 0) { throw "The v1 migration CLI failed with exit code $LASTEXITCODE." }
