[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('Backup', 'Restore', 'Probe', 'Commit')][string]$Mode,
  [string]$StateRoot = "$env:ProgramData\Winception\State",
  [ValidateRange(1, 30)][int]$ProbeAttempts = 30
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
    $lastProbeError = $null
    foreach ($attempt in 1..$ProbeAttempts) {
      try {
        if ($settings.tls -and $settings.tls.thumbprint) {
          $expectedThumbprint = ([string]$settings.tls.thumbprint).Replace(' ', '').ToUpperInvariant()
          Add-Type -AssemblyName System.Net.Http
          if (-not ('WinceptionPinnedHttpsClient' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Net.Http;
using System.Security.Cryptography.X509Certificates;
public static class WinceptionPinnedHttpsClient {
  public static string Get(string url, string expectedThumbprint, int timeoutSeconds) {
    using (var handler = new HttpClientHandler()) {
      handler.ServerCertificateCustomValidationCallback = (request, certificate, chain, errors) =>
        certificate != null && String.Equals(certificate.Thumbprint.Replace(" ", ""), expectedThumbprint, StringComparison.OrdinalIgnoreCase);
      using (var client = new HttpClient(handler)) {
        client.Timeout = TimeSpan.FromSeconds(timeoutSeconds);
        return client.GetStringAsync(url).GetAwaiter().GetResult();
      }
    }
  }
}
'@ -ReferencedAssemblies ([Net.Http.HttpClient].Assembly.Location)
          }
          $json = [WinceptionPinnedHttpsClient]::Get($healthUrl, $expectedThumbprint, 2)
          $health = $json | ConvertFrom-Json
        }
        else { $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 }
        if ($health.ok -eq $true -and $health.service -eq 'web') { return }
      }
      catch { $lastProbeError = $_.Exception }
      Start-Sleep -Seconds 1
    }
    $detail = if ($lastProbeError) { " $($lastProbeError.GetType().Name): $($lastProbeError.Message)" } else { '' }
    throw "Winception Web failed the post-upgrade health probe.$detail"
  }
  'Commit' {
    Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
