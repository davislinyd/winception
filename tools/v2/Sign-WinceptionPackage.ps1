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
$codeSigning = @($certificate.EnhancedKeyUsageList | Where-Object { [string]$_.ObjectId -eq '1.3.6.1.5.5.7.3.3' }).Count -gt 0
if (-not $codeSigning) { throw 'The certificate does not allow Code Signing.' }

$signableExtensions = @('.exe', '.dll', '.ps1', '.msi')
$bundledModuleRoot = Join-Path $root 'app\powershell-modules'
foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
  $signableExtensions -contains $_.Extension.ToLowerInvariant() -and
  -not $_.FullName.StartsWith($bundledModuleRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}) {
  $existing = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($existing.Status -eq 'Valid') { continue }
  if ($file.Extension -ieq '.ps1') {
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    $hasUtf8Bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    if (-not $hasUtf8Bom) {
      $strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
      $content = $strictUtf8.GetString($bytes)
      [IO.File]::WriteAllText($file.FullName, $content, [Text.UTF8Encoding]::new($true))
    }
  }
  $signing = @{ LiteralPath = $file.FullName; Certificate = $certificate; HashAlgorithm = 'SHA256'; IncludeChain = 'All' }
  if (-not [string]::IsNullOrWhiteSpace($TimestampServer)) { $signing.TimestampServer = $TimestampServer }
  $signature = Set-AuthenticodeSignature @signing
  if ($signature.Status -ne 'Valid') { throw "Signing failed: $($file.FullName)" }
}
