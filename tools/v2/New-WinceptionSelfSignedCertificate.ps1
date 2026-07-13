[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('CodeSigning', 'Tls')][string]$Purpose,
  [string]$DnsName = '',
  [ValidateSet('CurrentUser', 'LocalMachine')][string]$StoreLocation = 'CurrentUser'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($Purpose -eq 'Tls' -and ($DnsName -notmatch '^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])$')) {
  throw 'A valid DNS management name is required for a self-signed TLS certificate.'
}

$store = "Cert:\$StoreLocation\My"
$certificate = Get-ChildItem -LiteralPath $store | Where-Object {
  $_.HasPrivateKey -and $_.NotAfter.ToUniversalTime() -gt [DateTime]::UtcNow.AddDays(30) -and (
    ($Purpose -eq 'CodeSigning' -and $_.Subject -eq 'CN=Winception Local Development Code Signing') -or
    ($Purpose -eq 'Tls' -and $_.Subject -eq "CN=$DnsName")
  )
} | Sort-Object NotAfter -Descending | Select-Object -First 1
if (-not $certificate) { $certificate = if ($Purpose -eq 'CodeSigning') {
  New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=Winception Local Development Code Signing' -CertStoreLocation $store -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotAfter ([DateTime]::UtcNow.AddYears(2))
} else {
  New-SelfSignedCertificate -Type SSLServerAuthentication -Subject "CN=$DnsName" -DnsName $DnsName -CertStoreLocation $store -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotAfter ([DateTime]::UtcNow.AddYears(2))
} }

$temporary = Join-Path ([IO.Path]::GetTempPath()) ("winception-$([Guid]::NewGuid().ToString('N')).cer")
try {
  Export-Certificate -Cert $certificate -FilePath $temporary -Force | Out-Null
  if ($Purpose -eq 'CodeSigning') {
    $scope = [Security.Cryptography.X509Certificates.StoreLocation]::$StoreLocation
    $publicCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($temporary)
    $rootStore = [Security.Cryptography.X509Certificates.X509Store]::new('Root', $scope)
    try { $rootStore.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite); $rootStore.Add($publicCertificate) }
    finally { $rootStore.Close() }
    $publisherStore = [Security.Cryptography.X509Certificates.X509Store]::new('TrustedPublisher', $scope)
    try { $publisherStore.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite); $publisherStore.Add($publicCertificate) }
    finally { $publisherStore.Close() }
  }
}
finally {
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
}

[pscustomobject]@{ thumbprint = $certificate.Thumbprint; purpose = $Purpose; dnsName = $DnsName; selfSigned = $true; notAfter = $certificate.NotAfter.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
