[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$PackageRoot,
  [Parameter(Mandatory)][string]$CertificateThumbprint,
  [string]$TimestampServer = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path -LiteralPath $PackageRoot).Path
$thumbprint = $CertificateThumbprint.Replace(' ', '').ToUpperInvariant()
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -ErrorAction SilentlyContinue
if (-not $certificate) { $certificate = Get-Item -LiteralPath "Cert:\LocalMachine\My\$thumbprint" -ErrorAction Stop }
if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -le [DateTime]::UtcNow) { throw 'The code-signing certificate is invalid.' }
$codeSigning = @($certificate.EnhancedKeyUsageList | Where-Object { $_.ObjectId.Value -eq '1.3.6.1.5.5.7.3.3' }).Count -gt 0
if (-not $codeSigning) { throw 'The certificate does not allow Code Signing.' }

foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File -Include *.exe,*.dll,*.ps1,*.msi) {
  $signature = Set-AuthenticodeSignature -LiteralPath $file.FullName -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer $TimestampServer -IncludeChain All
  if ($signature.Status -ne 'Valid') { throw "Signing failed: $($file.FullName)" }
}
