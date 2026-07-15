[CmdletBinding()]
param(
  [string]$OutputRoot = 'installer/output',
  [ValidatePattern('^v2\.\d+\.\d+-(alpha|beta|rc)\.\d+$')]
  [string]$ReleaseTag = 'v2.0.0-alpha.15',
  [ValidateSet('internal-prerelease', 'prerelease', 'stable')]
  [string]$Channel = 'internal-prerelease',
  [string]$CommitSha = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$root = [IO.Path]::GetFullPath((Join-Path $repo $OutputRoot))
if (-not $root.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'OutputRoot must remain inside the workspace.' }
if (-not $CommitSha) { $CommitSha = (& git -C $repo rev-parse HEAD).Trim() }
if ($CommitSha -notmatch '^[0-9a-fA-F]{40}$') { throw 'CommitSha must contain 40 hexadecimal characters.' }
$package = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
$files = [ordered]@{
  msi = 'Winception-v2.msi'
  'code-signing-certificate' = 'Winception-Local-CodeSigning.cer'
  bootstrap = 'Install-Winception.ps1'
  sbom = 'winception-v2-sbom.cdx.json'
  license = 'LICENSE'
}
foreach ($name in $files.Values) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $name) -PathType Leaf)) { throw "Release asset is missing: $name" }
}
$certificatePath = Join-Path $root $files['code-signing-certificate']
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new([IO.File]::ReadAllBytes($certificatePath))
$assets = foreach ($entry in $files.GetEnumerator()) {
  $item = Get-Item -LiteralPath (Join-Path $root $entry.Value)
  [ordered]@{ role = $entry.Key; fileName = $item.Name; sizeBytes = $item.Length; sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash }
}
$manifest = [ordered]@{
  schemaVersion = 1
  product = [ordered]@{
    name = 'Winception'
    version = [string]$package.version
    tag = $ReleaseTag
    commitSha = $CommitSha.ToLowerInvariant()
    channel = $Channel
    sourceUrl = "https://github.com/davislinyd/winception/tree/$ReleaseTag"
  }
  assets = @($assets)
  certificate = [ordered]@{
    subject = $certificate.Subject
    thumbprint = $certificate.Thumbprint
    purpose = 'Code Signing'
    notAfter = $certificate.NotAfter.ToUniversalTime().ToString('o')
    selfSigned = $certificate.Subject -eq $certificate.Issuer
  }
  support = [ordered]@{ operatingSystems = @('Windows 11 Pro x64', 'Windows 11 Enterprise x64'); architecture = 'x64' }
  warnings = @('This internal prerelease uses a self-signed test certificate. Verify the published thumbprint before explicitly trusting it.', 'Do not use the PXE DHCP service on a network with another DHCP responder.')
}
$json = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $root 'release-manifest.json'), $json, [Text.UTF8Encoding]::new($false))
$sumFiles = @($files.Values) + 'release-manifest.json'
$sums = foreach ($file in $sumFiles) { "{0}  {1}" -f (Get-FileHash -LiteralPath (Join-Path $root $file) -Algorithm SHA256).Hash.ToLowerInvariant(), $file }
[IO.File]::WriteAllLines((Join-Path $root 'SHA256SUMS'), $sums, [Text.UTF8Encoding]::new($false))
$manifest
