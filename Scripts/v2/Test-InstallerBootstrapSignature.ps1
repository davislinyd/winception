[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force -ErrorAction Stop
Import-Module (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\PKI\PKI.psd1') -Force -ErrorAction Stop
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$installer = Join-Path $repo 'tools\install\Install-Winception.ps1'
$temporaryRoot = Join-Path $repo "test-results\bootstrap-signature-$([Guid]::NewGuid().ToString('N'))"
$certificate = $null

try {
  New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
  . $installer
  $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Winception Bootstrap Signature Test $([Guid]::NewGuid().ToString('N'))" -CertStoreLocation Cert:\CurrentUser\My -NotAfter ([DateTime]::UtcNow.AddDays(1))
  $payload = Join-Path $temporaryRoot 'payload.ps1'
  [IO.File]::WriteAllText($payload, "Write-Output 'signed test payload'`r`n", [Text.UTF8Encoding]::new($false))
  $signed = Set-AuthenticodeSignature -LiteralPath $payload -Certificate $certificate
  if ([string]$signed.Status -notin @('NotTrusted', 'UnknownError')) { throw "Expected an untrusted clean signature; received $($signed.Status)." }
  if (-not (Test-PayloadSignatureIntegrity $signed $certificate $true)) { throw 'The expected untrusted self-signed payload was rejected.' }

  $tamperedText = [IO.File]::ReadAllText($payload).Replace('signed test payload', 'tampered test payload')
  [IO.File]::WriteAllText($payload, $tamperedText, [Text.UTF8Encoding]::new($false))
  $tampered = Get-AuthenticodeSignature -LiteralPath $payload
  if ([string]$tampered.Status -ne 'HashMismatch') { throw "Expected HashMismatch after tampering; received $($tampered.Status)." }
  if (Test-PayloadSignatureIntegrity $tampered $certificate $true) { throw 'A tampered signed payload was accepted.' }

  [pscustomobject]@{ cleanStatus = [string]$signed.Status; cleanAccepted = $true; tamperedStatus = [string]$tampered.Status; tamperedAccepted = $false } | ConvertTo-Json
}
finally {
  if ($null -ne $certificate) { Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue }
}
