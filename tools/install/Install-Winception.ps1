[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Local')]
param(
  [ValidateSet('Check', 'Install', 'Verify', 'Repair', 'Uninstall')]
  [string]$Action = 'Check',
  [Parameter(ParameterSetName = 'Release')]
  [ValidatePattern('^v2\.\d+\.\d+-(alpha|beta|rc)\.\d+$')]
  [string]$ReleaseTag = '',
  [Parameter(ParameterSetName = 'Local')]
  [string]$MsiPath = '',
  [Parameter(ParameterSetName = 'Local')]
  [string]$CertificatePath = '',
  [switch]$TrustSelfSignedCertificate,
  [switch]$ShowSetupCode,
  [switch]$OpenBrowser,
  [string]$ReportPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:report = [ordered]@{
  schemaVersion = 1
  action = $Action
  startedAt = [DateTime]::UtcNow.ToString('o')
  completedAt = $null
  succeeded = $false
  source = if ($PSCmdlet.ParameterSetName -eq 'Release') { 'github-release' } else { 'local' }
  releaseTag = $ReleaseTag
  checks = @()
  services = @()
  health = $null
  logPath = $null
  diagnostics = @()
}

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $entry = [ordered]@{ name = $Name; passed = $Passed; detail = if ($Passed) { 'Passed.' } else { $Detail } }
  if (-not $Passed) { $entry.correctiveAction = $Detail }
  $script:report.checks += $entry
  if (-not $Passed) { throw $Detail }
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-HostRequirements([bool]$Mutation) {
  $build = [Environment]::OSVersion.Version.Build
  $is64Bit = [Environment]::Is64BitOperatingSystem
  $edition = [string](Get-ItemPropertyValue -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name EditionID -ErrorAction SilentlyContinue)
  Add-Check 'windows-11-x64' ($is64Bit -and $build -ge 22000 -and $edition -in @('Professional', 'ProfessionalWorkstation', 'Enterprise', 'EnterpriseS')) "Windows 11 Pro or Enterprise x64 build 22000 or later is required. Found edition '$edition', build $build."
  if ($Mutation) { Add-Check 'administrator' (Test-Administrator) 'Install, repair and uninstall require an elevated PowerShell session.' }
  $systemDrive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($env:SystemRoot).TrimEnd(':\'))
  Add-Check 'disk-space' ($systemDrive.Free -ge 2GB) 'At least 2 GB of free system drive space is required.'
  $listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  $ownedByWeb = if ($listener) {
    try { $existingHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/v2/health' -TimeoutSec 3; $existingHealth.ok -eq $true -and $existingHealth.service -eq 'web' }
    catch { $false }
  } else { $false }
  Add-Check 'management-port' (-not $listener -or $ownedByWeb) 'TCP port 8080 is already used by another process.'
}

function Get-Asset($Manifest, [string]$Role) {
  $asset = @($Manifest.assets | Where-Object { [string]$_.role -eq $Role })
  if ($asset.Count -ne 1) { throw "Release manifest must contain exactly one '$Role' asset." }
  if ([string]::IsNullOrWhiteSpace([string]$asset[0].fileName) -or [IO.Path]::GetFileName([string]$asset[0].fileName) -ne [string]$asset[0].fileName) { throw "Release manifest contains an unsafe '$Role' filename." }
  $asset[0]
}

function Get-VerifiedManifest([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Release manifest was not found: $Path" }
  $manifest = Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.product.name -ne 'Winception') { throw 'Release manifest schema or product is invalid.' }
  if ([string]$manifest.product.commitSha -notmatch '^[0-9a-fA-F]{40}$') { throw 'Release manifest commit SHA must contain 40 hexadecimal characters.' }
  if ([string]$manifest.product.tag -notmatch '^v2\.\d+\.\d+-(alpha|beta|rc)\.\d+$') { throw 'Release manifest tag is invalid.' }
  if ("v$($manifest.product.version)" -ne [string]$manifest.product.tag) { throw 'Release manifest version and tag do not match.' }
  if ($ReleaseTag -and $manifest.product.tag -ne $ReleaseTag) { throw 'Downloaded manifest tag does not match -ReleaseTag.' }
  $manifest
}

function Get-Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant() }

function Assert-Asset([string]$Path, $Asset) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Release asset was not found: $Path" }
  $item = Get-Item -LiteralPath $Path
  Add-Check "asset-size:$($Asset.role)" ($item.Length -eq [long]$Asset.sizeBytes) "Asset size does not match the release manifest: $($item.Name)"
  Add-Check "asset-sha256:$($Asset.role)" ((Get-Sha256 $Path) -eq ([string]$Asset.sha256).ToUpperInvariant()) "Asset SHA-256 does not match the release manifest: $($item.Name)"
}

function Assert-CodeSigningCertificate([string]$Path, $Manifest) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Code-signing certificate was not found: $Path" }
  $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Path)))
  $eku = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' } | ForEach-Object { $_.EnhancedKeyUsages } | Where-Object { $_.Value -eq '1.3.6.1.5.5.7.3.3' }).Count -gt 0
  Add-Check 'certificate-code-signing-eku' $eku 'The certificate does not allow Code Signing.'
  Add-Check 'certificate-validity' ($certificate.NotBefore.ToUniversalTime() -le [DateTime]::UtcNow -and $certificate.NotAfter.ToUniversalTime() -gt [DateTime]::UtcNow) 'The certificate is not currently valid.'
  Add-Check 'certificate-subject' ($certificate.Subject -eq [string]$Manifest.certificate.subject) 'Certificate subject does not match the release manifest.'
  Add-Check 'certificate-thumbprint' ($certificate.Thumbprint -eq ([string]$Manifest.certificate.thumbprint).Replace(' ', '').ToUpperInvariant()) 'Certificate thumbprint does not match the release manifest.'
  $manifestExpiry = [DateTimeOffset]::Parse([string]$Manifest.certificate.notAfter, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal)
  Add-Check 'certificate-expiry-manifest' ($certificate.NotAfter.ToUniversalTime() -eq $manifestExpiry.UtcDateTime) 'Certificate expiry does not match the release manifest.'
  if ($Manifest.certificate.selfSigned -and $certificate.Subject -ne $certificate.Issuer) { throw 'The manifest identifies a self-signed certificate, but subject and issuer differ.' }
  $certificate
}

function Test-PayloadSignatureIntegrity($Signature, $Certificate, [bool]$AllowUntrustedSelfSigned) {
  if ([string]$Signature.Status -eq 'Valid') { return $true }
  if (-not $AllowUntrustedSelfSigned -or [string]$Signature.Status -notin @('NotTrusted', 'UnknownError')) { return $false }
  if ($null -eq $Signature.SignerCertificate -or $Signature.SignerCertificate.Thumbprint -ne $Certificate.Thumbprint -or $Certificate.Subject -ne $Certificate.Issuer) { return $false }
  $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
  try {
    $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
    $chain.ChainPolicy.VerificationFlags = [Security.Cryptography.X509Certificates.X509VerificationFlags]::AllowUnknownCertificateAuthority
    $built = $chain.Build($Signature.SignerCertificate)
    $unexpected = @($chain.ChainStatus | Where-Object { $_.Status -notin @([Security.Cryptography.X509Certificates.X509ChainStatusFlags]::NoError, [Security.Cryptography.X509Certificates.X509ChainStatusFlags]::UntrustedRoot) })
    $root = if ($chain.ChainElements.Count -gt 0) { $chain.ChainElements[$chain.ChainElements.Count - 1].Certificate } else { $null }
    $built -and $unexpected.Count -eq 0 -and $null -ne $root -and $root.Thumbprint -eq $Certificate.Thumbprint
  }
  finally { $chain.Dispose() }
}

function Assert-PayloadSigner([string]$Path, $Certificate, [string]$Role, [bool]$AllowUntrustedSelfSigned) {
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  Add-Check "$Role-signature-present" ($null -ne $signature.SignerCertificate) "The $Role does not contain an Authenticode signature."
  Add-Check "$Role-signer" ($signature.SignerCertificate.Thumbprint -eq $Certificate.Thumbprint) "The $Role signer does not match the release certificate."
  Add-Check "$Role-signature-integrity" (Test-PayloadSignatureIntegrity $signature $Certificate $AllowUntrustedSelfSigned) "The $Role signature failed integrity validation: $($signature.StatusMessage)"
}

function Import-ExplicitTrust([string]$Path, $Certificate, $Manifest) {
  if (-not $Manifest.certificate.selfSigned) { return }
  $publisherTrusted = Get-Item -LiteralPath "Cert:\LocalMachine\TrustedPublisher\$($Certificate.Thumbprint)" -ErrorAction SilentlyContinue
  $rootTrusted = Get-Item -LiteralPath "Cert:\LocalMachine\Root\$($Certificate.Thumbprint)" -ErrorAction SilentlyContinue
  if ($publisherTrusted -and $rootTrusted) { return }
  if (-not $TrustSelfSignedCertificate) { throw 'The release uses a self-signed test certificate. Re-run with -TrustSelfSignedCertificate only after verifying its thumbprint.' }
  if (-not $PSCmdlet.ShouldProcess($Certificate.Subject, 'Trust self-signed code-signing certificate in LocalMachine Root and TrustedPublisher')) { return }
  if (-not $rootTrusted) { Import-Certificate -FilePath $Path -CertStoreLocation Cert:\LocalMachine\Root | Out-Null }
  if (-not $publisherTrusted) { Import-Certificate -FilePath $Path -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null }
}

function Resolve-ReleaseAssets {
  if ($PSCmdlet.ParameterSetName -eq 'Release') {
    $downloadRoot = Join-Path $env:TEMP "Winception-$ReleaseTag-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $downloadRoot | Out-Null
    $manifestPath = Join-Path $downloadRoot 'release-manifest.json'
    Invoke-WebRequest -Uri "https://github.com/davislinyd/winception/releases/download/$ReleaseTag/release-manifest.json" -OutFile $manifestPath
    $manifest = Get-VerifiedManifest $manifestPath
    $msiAsset = Get-Asset $manifest 'msi'
    $certificateAsset = Get-Asset $manifest 'code-signing-certificate'
    $resolvedMsi = Join-Path $downloadRoot ([string]$msiAsset.fileName)
    $resolvedCertificate = Join-Path $downloadRoot ([string]$certificateAsset.fileName)
    Invoke-WebRequest -Uri "https://github.com/davislinyd/winception/releases/download/$ReleaseTag/$($msiAsset.fileName)" -OutFile $resolvedMsi
    Invoke-WebRequest -Uri "https://github.com/davislinyd/winception/releases/download/$ReleaseTag/$($certificateAsset.fileName)" -OutFile $resolvedCertificate
    return [ordered]@{ Manifest = $manifest; ManifestPath = $manifestPath; Msi = $resolvedMsi; Certificate = $resolvedCertificate }
  }
  if (-not $MsiPath) { return $null }
  $resolvedMsi = (Resolve-Path -LiteralPath $MsiPath).Path
  $root = Split-Path -Parent $resolvedMsi
  $manifestPath = Join-Path $root 'release-manifest.json'
  $manifest = Get-VerifiedManifest $manifestPath
  $certificateAsset = Get-Asset $manifest 'code-signing-certificate'
  $resolvedCertificate = if ($CertificatePath) { (Resolve-Path -LiteralPath $CertificatePath).Path } else { Join-Path $root ([string]$certificateAsset.fileName) }
  [ordered]@{ Manifest = $manifest; ManifestPath = $manifestPath; Msi = $resolvedMsi; Certificate = $resolvedCertificate }
}

function Test-WinceptionInstallation {
  $expected = @(
    @{ Name = 'Winception.Agent'; Account = 'LocalSystem' },
    @{ Name = 'Winception.Web'; Account = 'NT AUTHORITY\LocalService' }
  )
  foreach ($item in $expected) {
    $service = Get-CimInstance Win32_Service -Filter "Name='$($item.Name)'" -ErrorAction SilentlyContinue
    Add-Check "service:$($item.Name)" ($null -ne $service -and $service.StartName -eq $item.Account -and $service.State -eq 'Running') "$($item.Name) must run as $($item.Account)."
    $script:report.services += [ordered]@{ name = $item.Name; state = $service.State; startName = $service.StartName }
  }
  $stateRoot = Join-Path $env:ProgramData 'Winception\State'
  Add-Check 'state-root' (Test-Path -LiteralPath $stateRoot -PathType Container) 'Winception State was not created.'
  Add-Check 'sqlite' (Test-Path -LiteralPath (Join-Path $stateRoot 'winception-v2.db') -PathType Leaf) 'Winception SQLite state was not created.'
  $stateAcl = Get-Acl -LiteralPath $stateRoot
  $stateSids = @($stateAcl.Access | ForEach-Object { try { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { '' } })
  Add-Check 'state-acl-protected' ($stateAcl.AreAccessRulesProtected) 'Winception State still inherits access rules.'
  $missingStateSids = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-19') | Where-Object { $stateSids -notcontains $_ }
  Add-Check 'state-acl-principals' (@($missingStateSids).Count -eq 0) 'Winception State ACL is missing SYSTEM, Administrators or LocalService.'
  $serviceSid = (& sc.exe qsidtype Winception.Web 2>&1) -join "`n"
  Add-Check 'web-service-sid' ($serviceSid -match 'UNRESTRICTED') 'Winception.Web service SID is not unrestricted.'
  $pipeReady = @(Get-ChildItem -LiteralPath '\\.\pipe\' -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*Winception.Agent.v2*' }).Count -gt 0
  Add-Check 'agent-named-pipe' $pipeReady 'The privileged Agent named pipe is unavailable.'
  $appRoot = Join-Path $env:ProgramFiles 'Winception\app'
  $pipeAclHelper = Join-Path $appRoot 'tools\v2\Set-WinceptionNamedPipeAcl.ps1'
  $pipeAcl = & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $pipeAclHelper -PipePath '\\.\pipe\ProtectedPrefix\Administrators\Winception.Agent.v2' -VerifyOnly | ConvertFrom-Json
  Add-Check 'agent-pipe-dacl' ($pipeAcl.protectedDacl -eq $true -and $pipeAcl.broadAccess -eq $false) 'The privileged Agent named-pipe DACL is not restricted to approved identities.'
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/v2/health' -TimeoutSec 10
  Add-Check 'health-api' ($health.ok -eq $true -and $health.service -eq 'web') 'The loopback health endpoint is not ready.'
  $web = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/' -TimeoutSec 10
  Add-Check 'web-static-assets' ($web.StatusCode -eq 200 -and $web.Content -match '<div id="root">') 'The Web application static entry point is unavailable.'
  $setupCode = $null
  try {
    $setupCodeHelper = Join-Path $appRoot 'tools\v2\Get-WinceptionSetupCode.ps1'
    $setupCode = & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $setupCodeHelper
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($setupCode)) { throw 'The setup code could not be decrypted for the local login probe.' }
    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $body = @{ token = $setupCode.Trim() } | ConvertTo-Json -Compress
    $login = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/api/v2/auth/session' -ContentType 'application/json' -Body $body -WebSession $session -TimeoutSec 10
    Add-Check 'local-login' ($login.ok -eq $true) 'Local setup-code login failed.'
    $profiles = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/v2/profiles' -WebSession $session -TimeoutSec 10
    Add-Check 'profile-read' ($profiles.ok -eq $true -and $null -ne $profiles.result.profiles) 'Authenticated profile read failed.'
    $profileCount = @($profiles.result.profiles).Count
  }
  finally { $setupCode = $null; $body = $null }
  $script:report.health = [ordered]@{ ok = $health.ok; service = $health.service; version = $health.version; profileCount = $profileCount; url = 'http://127.0.0.1:8080/api/v2/health' }
}

function Invoke-Msi([string]$Verb, [string]$Path) {
  $logRoot = Join-Path $env:ProgramData 'Winception\InstallerLogs'
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  $log = Join-Path $logRoot "$($Verb.ToLowerInvariant())-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')).log"
  $arguments = switch ($Verb) {
    'Install' { @('/i', $Path, '/qn', '/norestart', '/l*v', $log) }
    'Repair' { @('/fa', $Path, '/qn', '/norestart', '/l*v', $log) }
    'Uninstall' { @('/x', $Path, '/qn', '/norestart', '/l*v', $log) }
  }
  $script:report.logPath = $log
  if (-not $PSCmdlet.ShouldProcess($Path, "$Verb Winception with msiexec /norestart")) { return }
  $process = Start-Process -FilePath msiexec.exe -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) { throw "msiexec $Verb failed with exit code $($process.ExitCode). Review $log" }
}

function Show-SetupCodeToConsole {
  $helper = Join-Path $env:ProgramFiles 'Winception\app\tools\v2\Get-WinceptionSetupCode.ps1'
  if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'The installed setup-code helper was not found.' }
  $code = & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($code)) { throw 'The setup code could not be read.' }
  Write-Host "Winception setup code: $code" -ForegroundColor Yellow
}

if ($MyInvocation.InvocationName -eq '.') { return }

try {
  $mutation = $Action -in @('Install', 'Repair', 'Uninstall')
  Assert-HostRequirements $mutation
  $assets = Resolve-ReleaseAssets
  if ($Action -in @('Install', 'Repair', 'Uninstall') -and $null -eq $assets) { throw '-MsiPath or -ReleaseTag is required for this action.' }
  if ($null -ne $assets) {
    $msiAsset = Get-Asset $assets.Manifest 'msi'
    $certificateAsset = Get-Asset $assets.Manifest 'code-signing-certificate'
    $bootstrapAsset = Get-Asset $assets.Manifest 'bootstrap'
    Assert-Asset $assets.Msi $msiAsset
    Assert-Asset $assets.Certificate $certificateAsset
    if ([string]::IsNullOrWhiteSpace($PSCommandPath)) { throw 'The installer must run from its signed script file.' }
    Assert-Asset $PSCommandPath $bootstrapAsset
    $certificate = Assert-CodeSigningCertificate $assets.Certificate $assets.Manifest
    $allowUntrustedSelfSigned = [bool]$assets.Manifest.certificate.selfSigned
    Assert-PayloadSigner $assets.Msi $certificate 'msi' $allowUntrustedSelfSigned
    Assert-PayloadSigner $PSCommandPath $certificate 'bootstrap' $allowUntrustedSelfSigned
  }
  if ($Action -eq 'Install') { Import-ExplicitTrust $assets.Certificate $certificate $assets.Manifest; Invoke-Msi 'Install' $assets.Msi; Test-WinceptionInstallation }
  elseif ($Action -eq 'Repair') { Invoke-Msi 'Repair' $assets.Msi; Test-WinceptionInstallation }
  elseif ($Action -eq 'Uninstall') {
    Invoke-Msi 'Uninstall' $assets.Msi
    Add-Check 'state-preserved' (Test-Path -LiteralPath (Join-Path $env:ProgramData 'Winception\State') -PathType Container) 'Uninstall removed product State unexpectedly.'
  }
  elseif ($Action -eq 'Verify') { Test-WinceptionInstallation }
  if ($ShowSetupCode -and $Action -ne 'Uninstall') { Show-SetupCodeToConsole }
  if ($OpenBrowser -and $Action -ne 'Uninstall') { Start-Process 'http://127.0.0.1:8080/' }
  $script:report.succeeded = $true
}
catch {
  $script:report.diagnostics += [ordered]@{ message = $_.Exception.Message; category = [string]$_.CategoryInfo.Category }
  Write-Error $_
}
finally {
  $script:report.completedAt = [DateTime]::UtcNow.ToString('o')
  if ($ReportPath) {
    $resolvedReport = [IO.Path]::GetFullPath($ReportPath)
    New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedReport) -Force | Out-Null
    $temporary = "$resolvedReport.$([Guid]::NewGuid().ToString('N')).tmp"
    [IO.File]::WriteAllText($temporary, ($script:report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $resolvedReport -Force
  }
}
if (-not $script:report.succeeded) { exit 1 }
