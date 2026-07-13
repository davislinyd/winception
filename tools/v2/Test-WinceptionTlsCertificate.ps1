[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{40,128}$')][string]$Thumbprint,
  [Parameter(Mandatory)][ValidateLength(1, 253)][string]$ExpectedDnsName
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$normalized = $Thumbprint.Replace(' ', '').ToUpperInvariant()
$certificate = Get-Item -LiteralPath "Cert:\LocalMachine\My\$normalized" -ErrorAction Stop
if (-not $certificate.HasPrivateKey -or $certificate.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or $certificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow) {
  throw 'The HTTPS certificate is not currently valid or has no private key.'
}
$serverAuth = @($certificate.EnhancedKeyUsageList | Where-Object { [string]$_.ObjectId -eq '1.3.6.1.5.5.7.3.1' }).Count -gt 0
if (-not $serverAuth) { throw 'The HTTPS certificate does not allow Server Authentication.' }
$dnsName = $certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::DnsName, $false)
if ($dnsName -ne $ExpectedDnsName) { throw 'The HTTPS certificate DNS name does not match the management host.' }
