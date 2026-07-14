[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$AppRoot,
  [string]$StateRoot = "$env:ProgramData\Winception\State",
  [string]$ManagementHost = '127.0.0.1',
  [ValidateRange(1, 65535)][int]$ManagementPort = 8080,
  [string]$CertificateThumbprint = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function New-RandomToken {
  $bytes = [byte[]]::new(48)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) }
  finally { $generator.Dispose() }
  [Convert]::ToBase64String($bytes)
}

function Protect-Value([string]$Name, [string]$Value) {
  $script = Join-Path $AppRoot 'tools\v2\Protect-WinceptionSecret.ps1'
  $result = $Value | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Mode Protect -Name $Name
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($result)) { throw "Failed to protect $Name." }
  $result.Trim()
}

$resolvedApp = (Resolve-Path -LiteralPath $AppRoot).Path
$resolvedState = [IO.Path]::GetFullPath($StateRoot)
New-Item -ItemType Directory -Path $resolvedState -Force | Out-Null
$stagingRoot = Join-Path $resolvedState 'staging'
$agentLogRoot = Join-Path $resolvedState 'logs\agent'
$webLogRoot = Join-Path $resolvedState 'logs\web'
New-Item -ItemType Directory -Path $stagingRoot, $agentLogRoot, $webLogRoot -Force | Out-Null
$legacyRoot = Join-Path $resolvedState 'legacy'
$legacyConfigRoot = Join-Path $legacyRoot 'config'
New-Item -ItemType Directory -Path $legacyConfigRoot -Force | Out-Null
$legacyBaseConfig = Join-Path $legacyConfigRoot 'osdcloud-console.json'
if (-not (Test-Path -LiteralPath $legacyBaseConfig)) {
  Copy-Item -LiteralPath (Join-Path $resolvedApp 'config\osdcloud-console.json') -Destination $legacyBaseConfig
}

$settings = [ordered]@{
  schemaVersion = 1
  appRoot = $resolvedApp
  stateRoot = $resolvedState
  legacyConfigPath = $legacyBaseConfig
  agentPipe = '\\.\pipe\ProtectedPrefix\Administrators\Winception.Agent.v2'
  managementHost = $ManagementHost
  managementPort = $ManagementPort
  managementTokenProtected = Protect-Value 'management-token' (New-RandomToken)
  agentTokenProtected = Protect-Value 'agent-token' (New-RandomToken)
}

$loopback = $ManagementHost -eq 'localhost' -or $ManagementHost -eq '::1' -or $ManagementHost.StartsWith('127.')
if (-not $loopback) {
  $selfSigned = $false
  if ([string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
    $createdJson = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'New-WinceptionSelfSignedCertificate.ps1') -Purpose Tls -DnsName $ManagementHost -StoreLocation LocalMachine
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create the local self-signed TLS certificate.' }
    $created = $createdJson | ConvertFrom-Json
    $CertificateThumbprint = [string]$created.thumbprint
    $selfSigned = $true
  }
  $thumbprint = $CertificateThumbprint.Replace(' ', '').ToUpperInvariant()
  $certificate = Get-Item -LiteralPath "Cert:\LocalMachine\My\$thumbprint" -ErrorAction Stop
  if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -le [DateTime]::UtcNow) { throw 'The HTTPS certificate is expired or has no private key.' }
  $serverAuth = @($certificate.EnhancedKeyUsageList | Where-Object { [string]$_.ObjectId -eq '1.3.6.1.5.5.7.3.1' }).Count -gt 0
  if (-not $serverAuth) { throw 'The HTTPS certificate does not allow Server Authentication.' }
  $dnsName = $certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::DnsName, $false)
  if ($dnsName -ne $ManagementHost) { throw 'The HTTPS certificate DNS name does not match the management host.' }
  $pfxPassword = New-RandomToken
  $pfxPath = Join-Path $resolvedState 'management-tls.pfx'
  $publicCertificatePath = Join-Path $resolvedState 'management-tls.cer'
  Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password (ConvertTo-SecureString $pfxPassword -AsPlainText -Force) -Force | Out-Null
  Export-Certificate -Cert $certificate -FilePath $publicCertificatePath -Force | Out-Null
  $settings.tls = [ordered]@{
    pfxPath = $pfxPath
    publicCertificatePath = $publicCertificatePath
    pfxPasswordProtected = Protect-Value 'tls-pfx-password' $pfxPassword
    thumbprint = $thumbprint
    notAfter = $certificate.NotAfter.ToUniversalTime().ToString('o')
    selfSigned = $selfSigned
  }
}

$settingsPath = Join-Path $resolvedState 'service-settings.json'
$temporaryPath = "$settingsPath.$([Guid]::NewGuid().ToString('N')).tmp"
[IO.File]::WriteAllText($temporaryPath, ($settings | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporaryPath -Destination $settingsPath -Force

& icacls.exe $resolvedState /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' '*S-1-5-19:(RX)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply State directory ACLs.' }
& icacls.exe $legacyRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to isolate privileged product state from the Web service.' }
$webReadableFiles = @($settingsPath)
if ($settings.Contains('tls')) { $webReadableFiles += [string]$settings['tls'].pfxPath }
foreach ($webReadableFile in $webReadableFiles) {
  & icacls.exe $webReadableFile /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' '*S-1-5-19:(R)' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to apply Web read ACL: $webReadableFile" }
}
& icacls.exe $stagingRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' '*S-1-5-19:(OI)(CI)(M)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply staging directory ACLs.' }
& icacls.exe $webLogRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' '*S-1-5-19:(OI)(CI)(M)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply Web log directory ACLs.' }
& icacls.exe $agentLogRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply Agent log directory ACLs.' }

[pscustomobject]@{ stateRoot = $resolvedState; managementHost = $ManagementHost; managementPort = $ManagementPort; tls = -not $loopback }
