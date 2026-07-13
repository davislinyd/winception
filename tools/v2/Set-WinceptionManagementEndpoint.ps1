[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ManagementHost,
  [ValidateRange(1, 65535)][int]$ManagementPort = 8080,
  [string]$CertificateThumbprint = '',
  [string]$AppRoot = "$env:ProgramFiles\Winception\app",
  [string]$StateRoot = "$env:ProgramData\Winception\State"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this command from an elevated PowerShell session.'
}
$loopback = $ManagementHost -eq 'localhost' -or $ManagementHost -eq '::1' -or $ManagementHost.StartsWith('127.')
if (-not $loopback -and $ManagementHost -notmatch '^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])$') {
  throw 'LAN management requires a valid DNS host name.'
}

$resolvedApp = [IO.Path]::GetFullPath($AppRoot)
$resolvedState = [IO.Path]::GetFullPath($StateRoot)
$initializer = Join-Path $resolvedApp 'tools\v2\Initialize-WinceptionServices.ps1'
$probe = Join-Path $resolvedApp 'tools\v2\Invoke-MsiUpgradeStep.ps1'
foreach ($path in @($initializer, $probe)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required Winception tool was not found: $path" }
}
$agent = Get-Service -Name 'Winception.Agent' -ErrorAction Stop
$web = Get-Service -Name 'Winception.Web' -ErrorAction Stop
$agentWasRunning = $agent.Status -eq 'Running'
$webWasRunning = $web.Status -eq 'Running'
$managedFiles = @('service-settings.json', 'management-tls.pfx', 'management-tls.cer')
$backupRoot = Join-Path $resolvedState ".management-endpoint-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $backupRoot | Out-Null
$existingFiles = @{}
foreach ($name in $managedFiles) {
  $source = Join-Path $resolvedState $name
  $existingFiles[$name] = Test-Path -LiteralPath $source -PathType Leaf
  if ($existingFiles[$name]) { Copy-Item -LiteralPath $source -Destination (Join-Path $backupRoot $name) }
}

try {
  Stop-Service -Name 'Winception.Web' -Force -ErrorAction SilentlyContinue
  Stop-Service -Name 'Winception.Agent' -Force -ErrorAction SilentlyContinue
  $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $initializer,
    '-AppRoot', $resolvedApp, '-StateRoot', $resolvedState, '-ManagementHost', $ManagementHost, '-ManagementPort', $ManagementPort)
  if (-not [string]::IsNullOrWhiteSpace($CertificateThumbprint)) { $arguments += @('-CertificateThumbprint', $CertificateThumbprint) }
  & powershell.exe @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Management endpoint provisioning failed.' }
  Start-Service -Name 'Winception.Agent'
  Start-Service -Name 'Winception.Web'
  & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $probe -Mode Probe -StateRoot $resolvedState
  if ($LASTEXITCODE -ne 0) { throw 'The configured management endpoint failed its pinned health probe.' }
  if (-not $webWasRunning) { Stop-Service -Name 'Winception.Web' -Force }
  if (-not $agentWasRunning) { Stop-Service -Name 'Winception.Agent' -Force }
  [pscustomobject]@{
    managementUrl = "$(if ($loopback) { 'http' } else { 'https' })://$ManagementHost`:$ManagementPort"
    selfSigned = -not $loopback -and [string]::IsNullOrWhiteSpace($CertificateThumbprint)
    publicCertificate = if ($loopback) { $null } else { Join-Path $resolvedState 'management-tls.cer' }
  }
}
catch {
  Stop-Service -Name 'Winception.Web' -Force -ErrorAction SilentlyContinue
  Stop-Service -Name 'Winception.Agent' -Force -ErrorAction SilentlyContinue
  foreach ($name in $managedFiles) {
    $destination = Join-Path $resolvedState $name
    if ($existingFiles[$name]) { Copy-Item -LiteralPath (Join-Path $backupRoot $name) -Destination $destination -Force }
    else { Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue }
  }
  if ($agentWasRunning) { Start-Service -Name 'Winception.Agent' -ErrorAction SilentlyContinue }
  if ($webWasRunning) { Start-Service -Name 'Winception.Web' -ErrorAction SilentlyContinue }
  throw
}
finally {
  Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
}
