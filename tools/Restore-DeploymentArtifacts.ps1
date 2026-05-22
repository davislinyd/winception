[CmdletBinding()]
param(
    [string] $CatalogPath,
    [string] $LiveRoot = 'C:\OSDCloud',
    [switch] $DryRun,
    [switch] $IncludeOptional,
    [switch] $SkipOsImageDownload,
    [switch] $SkipWinPeBuild,
    [switch] $SkipPrerequisiteCheck,
    [switch] $NoAdkAutoInstall
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($CatalogPath)) {
    $CatalogPath = Join-Path $RepoRoot 'config\runtime-artifacts.json'
}

$AdkVersion = '10.1.26100.2454'
$AdkSetupUrl = 'https://go.microsoft.com/fwlink/?linkid=2289980'
$WinPeSetupUrl = 'https://go.microsoft.com/fwlink/?linkid=2289981'

function Write-Step {
    param([Parameter(Mandatory)][string] $Message)
    Write-Host ""
    Write-Host "== $Message =="
}

function Get-FullPath {
    param([Parameter(Mandatory)][string] $Path)
    [System.IO.Path]::GetFullPath($Path)
}

function Assert-ChildPath {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $Path,
        [string] $Label = 'path'
    )

    $rootFull = (Get-FullPath $Root).TrimEnd('\')
    $candidate = Get-FullPath $Path
    $rootWithSlash = "$rootFull\"
    if ($candidate -ne $rootFull -and -not $candidate.StartsWith($rootWithSlash, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label escapes expected root. Root=$rootFull Path=$candidate"
    }
    $candidate
}

function Join-ChildPath {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $RelativePath,
        [string] $Label = 'path'
    )

    if ([System.IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -match '^[A-Za-z]:') {
        throw "$Label must be relative: $RelativePath"
    }
    Assert-ChildPath -Root $Root -Path (Join-Path $Root $RelativePath) -Label $Label
}

function Get-Sha256Hash {
    param([Parameter(Mandatory)][string] $LiteralPath)

    $resolvedPath = (Resolve-Path -LiteralPath $LiteralPath -ErrorAction Stop).ProviderPath
    $hashCommand = Get-Command -Name Get-FileHash -ErrorAction SilentlyContinue
    if ($hashCommand) {
        return (& $hashCommand -LiteralPath $resolvedPath -Algorithm SHA256).Hash.ToUpperInvariant()
    }

    $stream = [System.IO.File]::OpenRead($resolvedPath)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return (-join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })).ToUpperInvariant()
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Test-ArtifactMatches {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)] $Artifact
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }
    $item = Get-Item -LiteralPath $Path
    if ($null -ne $Artifact.length -and $item.Length -ne [int64] $Artifact.length) {
        return $false
    }
    if (-not [string]::IsNullOrWhiteSpace([string] $Artifact.sha256)) {
        return (Get-Sha256Hash -LiteralPath $Path) -eq ([string] $Artifact.sha256).ToUpperInvariant()
    }
    $true
}

function Assert-ArtifactMatches {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)] $Artifact,
        [Parameter(Mandatory)][string] $Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label missing: $Path"
    }
    $item = Get-Item -LiteralPath $Path
    if ($null -ne $Artifact.length -and $item.Length -ne [int64] $Artifact.length) {
        throw "$Label size mismatch: $Path actual=$($item.Length) expected=$($Artifact.length)"
    }
    if (-not [string]::IsNullOrWhiteSpace([string] $Artifact.sha256)) {
        $actual = Get-Sha256Hash -LiteralPath $Path
        $expected = ([string] $Artifact.sha256).ToUpperInvariant()
        if ($actual -ne $expected) {
            throw "$Label SHA-256 mismatch: $Path actual=$actual expected=$expected"
        }
    }
}

function Read-RuntimeCatalog {
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Runtime artifact catalog not found: $Path"
    }
    $catalog = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
    if ($catalog.schemaVersion -ne 1) {
        throw "Unsupported runtime artifact catalog schemaVersion: $($catalog.schemaVersion)"
    }
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($artifact in @($catalog.artifacts)) {
        $items.Add($artifact)
    }
    foreach ($artifact in @($catalog.software)) {
        $items.Add($artifact)
    }
    $items.ToArray()
}

function Get-ArtifactTargets {
    param([Parameter(Mandatory)] $Artifact)

    if ($Artifact.targets) {
        return @($Artifact.targets)
    }
    @($Artifact.target)
}

function Resolve-ArtifactTarget {
    param([Parameter(Mandatory)][string] $RelativePath)

    $relative = $RelativePath.Replace('/', '\')
    if ($relative.StartsWith('Softwares\', [System.StringComparison]::OrdinalIgnoreCase)) {
        return Join-ChildPath -Root $RepoRoot -RelativePath $relative -Label 'repo artifact path'
    }
    Join-ChildPath -Root $LiveRoot -RelativePath $relative -Label 'live artifact path'
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory)][string] $Source,
        [Parameter(Mandatory)][string] $Destination
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        return
    }
    if ($DryRun) {
        Write-Host "[dry-run] restore mirror $Source -> $Destination"
        return
    }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        Copy-Item -LiteralPath $item.FullName -Destination $Destination -Recurse -Force
    }
}

function Assert-DownloadUrl {
    param(
        [Parameter(Mandatory)] $Artifact
    )

    if ([string]::IsNullOrWhiteSpace([string] $Artifact.url)) {
        throw "Download artifact $($Artifact.id) has no url"
    }
    $uri = [uri] [string] $Artifact.url
    if ($uri.Scheme -notin @('https', 'http')) {
        throw "Download artifact $($Artifact.id) has unsupported URL scheme: $($uri.Scheme)"
    }
}

function Invoke-DownloadFile {
    param(
        [Parameter(Mandatory)][string] $Url,
        [Parameter(Mandatory)][string] $Destination,
        [int] $MaxAttempts = 3
    )

    $curl = Get-Command -Name 'curl.exe' -ErrorAction SilentlyContinue
    $lastError = $null
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
        try {
            if ($curl) {
                & $curl.Source --location --fail --retry 3 --retry-delay 5 --connect-timeout 30 --output $Destination $Url
                if ($LASTEXITCODE -ne 0) {
                    throw "curl.exe failed with exit code $LASTEXITCODE"
                }
            }
            else {
                Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -TimeoutSec 900
            }
            if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
                throw "download produced no file"
            }
            return
        }
        catch {
            $lastError = $_.Exception.Message
            Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
            if ($attempt -lt $MaxAttempts) {
                $delay = [Math]::Min(30, 5 * $attempt)
                Write-Warning "Download attempt $attempt/$MaxAttempts failed: $lastError. Retrying in $delay seconds."
                Start-Sleep -Seconds $delay
            }
        }
    }
    throw "Download failed after $MaxAttempts attempts: $lastError"
}

function Save-DownloadArtifact {
    param([Parameter(Mandatory)] $Artifact)

    Assert-DownloadUrl -Artifact $Artifact
    $targets = @(Get-ArtifactTargets -Artifact $Artifact | ForEach-Object { Resolve-ArtifactTarget -RelativePath ([string] $_) })
    $allTargetsMatch = $true
    foreach ($target in $targets) {
        if (-not (Test-ArtifactMatches -Path $target -Artifact $Artifact)) {
            $allTargetsMatch = $false
            break
        }
    }
    if ($allTargetsMatch) {
        Write-Host "Reusing verified artifact: $($Artifact.id)"
        return
    }

    if ($DryRun) {
        Write-Host "[dry-run] download $($Artifact.id) from $($Artifact.url)"
        foreach ($target in $targets) {
            Write-Host "[dry-run]   -> $target"
        }
        return
    }

    $stagingRoot = Join-ChildPath -Root $RepoRoot -RelativePath '.downloads\deployment-artifacts' -Label 'download staging path'
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    $stagingFile = Join-ChildPath -Root $stagingRoot -RelativePath "$($Artifact.id).download" -Label 'download staging file'
    Remove-Item -LiteralPath $stagingFile -Force -ErrorAction SilentlyContinue

    Write-Host "Downloading $($Artifact.id)"
    Invoke-DownloadFile -Url ([string] $Artifact.url) -Destination $stagingFile
    Assert-ArtifactMatches -Path $stagingFile -Artifact $Artifact -Label "Downloaded artifact $($Artifact.id)"
    foreach ($target in $targets) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $stagingFile -Destination $target -Force
        Assert-ArtifactMatches -Path $target -Artifact $Artifact -Label "Restored artifact $($Artifact.id)"
    }
    Remove-Item -LiteralPath $stagingFile -Force -ErrorAction SilentlyContinue
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Get-AdkPrerequisiteState {
    $adkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Assessment and Deployment Kit'
    $deploymentToolsRoot = Join-Path $adkRoot 'Deployment Tools'
    $winPeRoot = Join-Path $adkRoot 'Windows Preinstallation Environment\amd64'
    $hasDeploymentTools = Test-Path -LiteralPath $deploymentToolsRoot -PathType Container
    $hasWinPe = Test-Path -LiteralPath $winPeRoot -PathType Container
    $missing = New-Object System.Collections.Generic.List[string]
    if (-not $hasDeploymentTools) {
        $missing.Add("Windows ADK Deployment Tools were not found: $deploymentToolsRoot")
    }
    if (-not $hasWinPe) {
        $missing.Add("Windows PE Add-on amd64 files were not found: $winPeRoot")
    }
    [pscustomobject]@{
        AdkRoot = $adkRoot
        DeploymentToolsRoot = $deploymentToolsRoot
        WinPeRoot = $winPeRoot
        HasDeploymentTools = $hasDeploymentTools
        HasWinPe = $hasWinPe
        Missing = $missing.ToArray()
    }
}

function Assert-MicrosoftSignerCertificate {
    param(
        [Parameter(Mandatory)] $Certificate,
        [Parameter(Mandatory)][string] $Label
    )

    if ($null -eq $Certificate) {
        throw "$Label has no signer certificate."
    }
    if ([string] $Certificate.Subject -notmatch 'Microsoft Corporation|Microsoft Windows') {
        throw "$Label is not signed by a Microsoft certificate. Subject=$($Certificate.Subject)"
    }
}

function Get-EmbeddedSignerCertificate {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Label
    )

    try {
        $rawCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($Path)
        [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($rawCertificate)
    }
    catch {
        throw "$Label has no readable embedded signer certificate: $($_.Exception.Message)"
    }
}

function Ensure-WinTrustType {
    if ('OSDCloudBootstrap.WinTrust' -as [type]) {
        return
    }

    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace OSDCloudBootstrap
{
    public static class WinTrust
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WINTRUST_FILE_INFO
        {
            public UInt32 cbStruct;
            public string pcwszFilePath;
            public IntPtr hFile;
            public IntPtr pgKnownSubject;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WINTRUST_DATA
        {
            public UInt32 cbStruct;
            public IntPtr pPolicyCallbackData;
            public IntPtr pSIPClientData;
            public UInt32 dwUIChoice;
            public UInt32 fdwRevocationChecks;
            public UInt32 dwUnionChoice;
            public IntPtr pFile;
            public UInt32 dwStateAction;
            public IntPtr hWVTStateData;
            public IntPtr pwszURLReference;
            public UInt32 dwProvFlags;
            public UInt32 dwUIContext;
            public IntPtr pSignatureSettings;
        }

        public const UInt32 WTD_UI_NONE = 2;
        public const UInt32 WTD_REVOKE_NONE = 0;
        public const UInt32 WTD_CHOICE_FILE = 1;
        public const UInt32 WTD_STATEACTION_IGNORE = 0;
        public const UInt32 WTD_REVOCATION_CHECK_NONE = 0x00000010;

        [DllImport("wintrust.dll", ExactSpelling = true, PreserveSig = true, SetLastError = false)]
        public static extern UInt32 WinVerifyTrust(
            IntPtr hwnd,
            [MarshalAs(UnmanagedType.LPStruct)] Guid pgActionID,
            IntPtr pWVTData);
    }
}
"@
}

function Assert-WinTrustSignature {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Label
    )

    Ensure-WinTrustType
    $fileInfoType = [OSDCloudBootstrap.WinTrust+WINTRUST_FILE_INFO]
    $dataType = [OSDCloudBootstrap.WinTrust+WINTRUST_DATA]
    $fileInfo = [OSDCloudBootstrap.WinTrust+WINTRUST_FILE_INFO]::new()
    $fileInfoSize = [System.Runtime.InteropServices.Marshal]::SizeOf($fileInfo)
    $fileInfo.cbStruct = [uint32] $fileInfoSize
    $fileInfo.pcwszFilePath = $Path
    $fileInfo.hFile = [IntPtr]::Zero
    $fileInfo.pgKnownSubject = [IntPtr]::Zero

    $data = [OSDCloudBootstrap.WinTrust+WINTRUST_DATA]::new()
    $dataSize = [System.Runtime.InteropServices.Marshal]::SizeOf($data)
    $data.cbStruct = [uint32] $dataSize
    $data.pPolicyCallbackData = [IntPtr]::Zero
    $data.pSIPClientData = [IntPtr]::Zero
    $data.dwUIChoice = [OSDCloudBootstrap.WinTrust]::WTD_UI_NONE
    $data.fdwRevocationChecks = [OSDCloudBootstrap.WinTrust]::WTD_REVOKE_NONE
    $data.dwUnionChoice = [OSDCloudBootstrap.WinTrust]::WTD_CHOICE_FILE
    $data.dwStateAction = [OSDCloudBootstrap.WinTrust]::WTD_STATEACTION_IGNORE
    $data.hWVTStateData = [IntPtr]::Zero
    $data.pwszURLReference = [IntPtr]::Zero
    $data.dwProvFlags = [OSDCloudBootstrap.WinTrust]::WTD_REVOCATION_CHECK_NONE
    $data.dwUIContext = 0
    $data.pSignatureSettings = [IntPtr]::Zero

    $fileInfoPtr = [IntPtr]::Zero
    $dataPtr = [IntPtr]::Zero
    try {
        $fileInfoPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($fileInfoSize)
        [System.Runtime.InteropServices.Marshal]::StructureToPtr($fileInfo, $fileInfoPtr, $false)
        $data.pFile = $fileInfoPtr

        $dataPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($dataSize)
        [System.Runtime.InteropServices.Marshal]::StructureToPtr($data, $dataPtr, $false)

        $genericVerifyV2 = [Guid] '00AAC56B-CD44-11d0-8CC2-00C04FC295EE'
        $result = [OSDCloudBootstrap.WinTrust]::WinVerifyTrust([IntPtr]::Zero, $genericVerifyV2, $dataPtr)
        if ($result -ne 0) {
            $code = '{0:X8}' -f [uint32] $result
            throw "$Label Authenticode verification failed through WinVerifyTrust: 0x$code $Path"
        }
    }
    finally {
        if ($dataPtr -ne [IntPtr]::Zero) {
            [System.Runtime.InteropServices.Marshal]::FreeHGlobal($dataPtr)
        }
        if ($fileInfoPtr -ne [IntPtr]::Zero) {
            [System.Runtime.InteropServices.Marshal]::FreeHGlobal($fileInfoPtr)
        }
    }
}

function Assert-MicrosoftSignedFile {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Label
    )

    try {
        Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
        $signature = Get-AuthenticodeSignature -FilePath $Path -ErrorAction Stop
        if ($signature.Status -ne 'Valid') {
            throw "$Label Authenticode signature is not valid: $($signature.Status) $Path"
        }
        Assert-MicrosoftSignerCertificate -Certificate $signature.SignerCertificate -Label $Label
        return
    }
    catch {
        Write-Warning "$Label could not be validated with Get-AuthenticodeSignature; using WinVerifyTrust fallback. $($_.Exception.Message)"
    }

    Assert-WinTrustSignature -Path $Path -Label $Label
    $certificate = Get-EmbeddedSignerCertificate -Path $Path -Label $Label
    Assert-MicrosoftSignerCertificate -Certificate $certificate -Label $Label
}

function Invoke-Installer {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string[]] $ArgumentList,
        [Parameter(Mandatory)][string] $Label
    )

    Write-Host "+ $Path $($ArgumentList -join ' ')"
    $process = Start-Process -FilePath $Path -ArgumentList $ArgumentList -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) {
        throw "$Label installer failed with exit code $($process.ExitCode)."
    }
    if ($process.ExitCode -eq 3010) {
        Write-Warning "$Label installer requested a reboot. Continuing only if required files are already present."
    }
}

function Install-AdkPrerequisites {
    param([Parameter(Mandatory)] $InitialState)

    if ($InitialState.Missing.Count -eq 0) {
        return
    }

    Write-Step "Installing Windows ADK prerequisites"
    Write-Host "Missing ADK prerequisite(s):"
    foreach ($item in @($InitialState.Missing)) {
        Write-Host " - $item"
    }
    Write-Host "Downloading Microsoft Windows ADK $AdkVersion installers."

    $stagingRoot = Join-ChildPath -Root $RepoRoot -RelativePath '.downloads\prerequisites\windows-adk' -Label 'ADK prerequisite staging path'
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

    if (-not $InitialState.HasDeploymentTools) {
        $adkInstaller = Join-ChildPath -Root $stagingRoot -RelativePath 'adksetup.exe' -Label 'ADK installer path'
        Invoke-DownloadFile -Url $AdkSetupUrl -Destination $adkInstaller -MaxAttempts 3
        Assert-MicrosoftSignedFile -Path $adkInstaller -Label 'Windows ADK installer'
        Invoke-Installer -Path $adkInstaller -Label 'Windows ADK' -ArgumentList @(
            '/quiet',
            '/norestart',
            '/ceip',
            'off',
            '/features',
            'OptionId.DeploymentTools'
        )
    }
    else {
        Write-Host "Windows ADK Deployment Tools already present."
    }

    $stateAfterAdk = Get-AdkPrerequisiteState
    if (-not $stateAfterAdk.HasWinPe) {
        $winPeInstaller = Join-ChildPath -Root $stagingRoot -RelativePath 'adkwinpesetup.exe' -Label 'WinPE Add-on installer path'
        Invoke-DownloadFile -Url $WinPeSetupUrl -Destination $winPeInstaller -MaxAttempts 3
        Assert-MicrosoftSignedFile -Path $winPeInstaller -Label 'Windows PE Add-on installer'
        Invoke-Installer -Path $winPeInstaller -Label 'Windows PE Add-on' -ArgumentList @(
            '/quiet',
            '/norestart',
            '/ceip',
            'off',
            '/features',
            'OptionId.WindowsPreinstallationEnvironment'
        )
    }
    else {
        Write-Host "Windows PE Add-on already present."
    }

    $finalState = Get-AdkPrerequisiteState
    if ($finalState.Missing.Count -gt 0) {
        throw "Windows ADK prerequisite auto-install did not produce the required path(s):`n - $($finalState.Missing -join "`n - ")"
    }
}

function Assert-Prerequisites {
    param([switch] $InstallAdkIfMissing)

    $missing = New-Object System.Collections.Generic.List[string]
    if (-not (Get-Command -Name node -ErrorAction SilentlyContinue)) {
        $missing.Add('Install Node.js LTS and make node.exe available in PATH.')
    }
    if (-not (Get-Command -Name npm -ErrorAction SilentlyContinue)) {
        $missing.Add('Install npm with Node.js LTS and make npm available in PATH.')
    }
    if (-not (Get-Module -ListAvailable -Name OSD)) {
        $missing.Add("Install the OSD PowerShell module: Install-Module OSD -Scope CurrentUser -Force")
    }

    $adkState = Get-AdkPrerequisiteState
    if ($adkState.Missing.Count -gt 0) {
        if ($InstallAdkIfMissing) {
            Install-AdkPrerequisites -InitialState $adkState
        }
        else {
            foreach ($item in @($adkState.Missing)) {
                $missing.Add("$item. Re-run without -NoAdkAutoInstall to download and install ADK/WinPE automatically, or install Windows ADK $AdkVersion and the matching Windows PE Add-on manually.")
            }
        }
    }
    if ($missing.Count -gt 0) {
        throw "Missing bootstrap prerequisite(s):`n - $($missing -join "`n - ")"
    }
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory)][string] $FilePath,
        [string[]] $ArgumentList = @(),
        [string] $WorkingDirectory = $RepoRoot
    )

    Push-Location -LiteralPath $WorkingDirectory
    try {
        Write-Host "+ $FilePath $($ArgumentList -join ' ')"
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

function Test-OsdCloudTemplateReady {
    param([string] $TemplatePath)

    if ([string]::IsNullOrWhiteSpace($TemplatePath)) {
        return $false
    }
    if (-not (Test-Path -LiteralPath $TemplatePath -PathType Container)) {
        return $false
    }

    $required = @(
        'Media\sources\boot.wim',
        'Media\bootmgr',
        'Media\EFI\Boot\bootx64.efi',
        'Media\Boot\BCD',
        'Media\Boot\boot.sdi'
    )
    foreach ($relativePath in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $TemplatePath $relativePath) -PathType Leaf)) {
            return $false
        }
    }
    $true
}

function Get-CurrentOsdCloudTemplatePath {
    try {
        $templatePath = [string] (Get-OSDCloudTemplate -ErrorAction Stop)
        if (-not [string]::IsNullOrWhiteSpace($templatePath)) {
            return $templatePath
        }
    }
    catch {
        return $null
    }
    $null
}

function Set-OsdCloudTemplateGalleryFallback {
    $osdModule = Get-Module -Name OSD
    if ($null -eq $osdModule) {
        throw "OSD module is not loaded."
    }

    & $osdModule {
        Set-Item -Path Function:\Enable-PEWindowsImagePSGallery -Force -Value {
            [CmdletBinding()]
            param (
                [Parameter(ValueFromPipelineByPropertyName = $true)]
                [string[]] $Path
            )

            begin {
                Block-WinPE
                Block-StandardUser
                if ($null -eq $Path) {
                    $Path = (Get-WindowsImage -Mounted | Select-Object -Property Path).Path
                }
            }
            process {
                foreach ($inputPath in $Path) {
                    $mountPath = (Get-Item -Path $inputPath | Select-Object FullName).FullName
                    if (-not (Test-Path $mountPath -ErrorAction SilentlyContinue)) {
                        Write-Warning "Unable to locate Mounted WindowsImage at $inputPath"
                        break
                    }

                    $infContent = @'
[Version]
Signature   = "$WINDOWS NT$"
Class       = System
ClassGuid   = {4D36E97d-E325-11CE-BFC1-08002BE10318}
Provider    = OSDeploy
DriverVer   = 03/08/2021,2021.03.08.0

[DefaultInstall]
AddReg      = AddReg

[AddReg]
HKLM,"SYSTEM\ControlSet001\Control\Session Manager\Environment",APPDATA,0x00000,"%SystemRoot%\System32\Config\SystemProfile\AppData\Roaming"
HKLM,"SYSTEM\ControlSet001\Control\Session Manager\Environment",HOMEDRIVE,0x00000,"X:"
HKLM,"SYSTEM\ControlSet001\Control\Session Manager\Environment",HOMEPATH,0x00000,"Windows\System32\Config\SystemProfile"
HKLM,"SYSTEM\ControlSet001\Control\Session Manager\Environment",LOCALAPPDATA,0x00000,"%SystemRoot%\System32\Config\SystemProfile\AppData\Local"
'@
                    $infFile = Join-Path $env:TEMP 'Set-WinPEEnvironment.inf'
                    New-Item -Path $infFile -Force | Out-Null
                    Set-Content -Path $infFile -Value $infContent -Encoding Unicode -Force
                    Add-WindowsDriver -Path $mountPath -Driver $infFile -ForceUnsigned

                    try {
                        Import-Module PowerShellGet -ErrorAction Stop
                        Save-Module -Name PackageManagement -Path "$mountPath\Program Files\WindowsPowerShell\Modules" -Force -ErrorAction Stop
                        Save-Module -Name PowerShellGet -Path "$mountPath\Program Files\WindowsPowerShell\Modules" -Force -ErrorAction Stop
                    }
                    catch {
                        Write-Warning "Skipping WinPE PowerShell Gallery module injection because PowerShellGet/Save-Module failed: $($_.Exception.Message)"
                    }

                    Get-WindowsImage -Mounted | Where-Object { $_.Path -eq $mountPath }
                }
            }
        }
    }
}

function Ensure-OsdCloudTemplate {
    Import-Module OSD -Force
    Set-OsdCloudTemplateGalleryFallback

    $templatePath = Get-CurrentOsdCloudTemplatePath
    if (Test-OsdCloudTemplateReady -TemplatePath $templatePath) {
        Write-Host "Using existing OSDCloud Template: $templatePath"
        return $templatePath
    }

    if ([string]::IsNullOrWhiteSpace($templatePath)) {
        Write-Host "No usable OSDCloud Template found. Creating the default template from ADK WinPE media."
    }
    else {
        Write-Host "OSDCloud Template is incomplete: $templatePath"
        Write-Host "Rebuilding the default template from ADK WinPE media."
    }

    New-OSDCloudTemplate -Name 'default' | Out-Null
    $templatePath = Get-CurrentOsdCloudTemplatePath
    if (-not (Test-OsdCloudTemplateReady -TemplatePath $templatePath)) {
        throw "OSDCloud Template build did not produce required WinPE media: $templatePath"
    }
    Write-Host "Created OSDCloud Template: $templatePath"
    $templatePath
}

function Ensure-OsdCloudWorkspace {
    if ($SkipWinPeBuild) {
        Write-Host "Skipping WinPE/workspace rebuild by request."
        return
    }
    if ($DryRun) {
        Write-Host "[dry-run] create/update OSDCloud workspace at $LiveRoot\Win11-iPXE-Lab"
        return
    }

    $ipxeLab = Join-Path $LiveRoot 'Win11-iPXE-Lab'
    New-Item -ItemType Directory -Path $ipxeLab -Force | Out-Null
    $templatePath = Ensure-OsdCloudTemplate
    Write-Host "Building OSDCloud workspace from template: $templatePath"
    New-OSDCloudWorkspace -WorkspacePath $ipxeLab -Public | Out-Null
    Set-OSDCloudWorkspace -WorkspacePath $ipxeLab | Out-Null

    $workspaceBootWim = Join-Path $ipxeLab 'Media\sources\boot.wim'
    if (-not (Test-Path -LiteralPath $workspaceBootWim -PathType Leaf)) {
        throw "OSDCloud workspace build did not produce required boot.wim: $workspaceBootWim"
    }
}

function Publish-BootFiles {
    $ipxeLab = Join-Path $LiveRoot 'Win11-iPXE-Lab'
    $mediaRoot = Join-Path $ipxeLab 'Media'
    $httpRoot = Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud'
    $files = @(
        @{ Source = 'sources\boot.wim'; Target = 'boot.wim' },
        @{ Source = 'bootmgr'; Target = 'bootmgr' },
        @{ Source = 'EFI\Boot\bootx64.efi'; Target = 'bootx64.efi' },
        @{ Source = 'Boot\BCD'; Target = 'BCD' },
        @{ Source = 'Boot\boot.sdi'; Target = 'boot.sdi' }
    )
    if ($DryRun) {
        foreach ($file in $files) {
            Write-Host "[dry-run] publish $mediaRoot\$($file.Source) -> $httpRoot\$($file.Target)"
        }
        return
    }
    New-Item -ItemType Directory -Path $httpRoot -Force | Out-Null
    foreach ($file in $files) {
        $source = Join-Path $mediaRoot $file.Source
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Required generated boot file missing after workspace rebuild: $source"
        }
        Copy-Item -LiteralPath $source -Destination (Join-Path $httpRoot $file.Target) -Force
    }
}

function Restore-VersionedAssets {
    $source = Join-Path $RepoRoot 'osdcloud-assets\Win11-iPXE-Lab'
    $target = Join-Path $LiveRoot 'Win11-iPXE-Lab'
    Copy-DirectoryContents -Source $source -Destination $target
}

function Restore-OsImageArtifact {
    param([Parameter(Mandatory)] $Artifact)

    $targets = @(Get-ArtifactTargets -Artifact $Artifact | ForEach-Object { Resolve-ArtifactTarget -RelativePath ([string] $_) })
    foreach ($target in $targets) {
        if (Test-ArtifactMatches -Path $target -Artifact $Artifact) {
            Write-Host "Reusing verified OS image: $($Artifact.id)"
            return
        }
    }
    if ($SkipOsImageDownload) {
        throw "Required OS image is missing or invalid, and -SkipOsImageDownload was specified: $($Artifact.id)"
    }
    if ([string]::IsNullOrWhiteSpace([string] $Artifact.osImageId)) {
        throw "OS catalog artifact $($Artifact.id) must include osImageId"
    }
    if ($DryRun) {
        Write-Host "[dry-run] download/publish active OS image $($Artifact.osImageId) through OSD catalog"
        return
    }
    Invoke-ExternalCommand -FilePath 'node' -ArgumentList @(
        'tools/osdcloud-console/src/osImageDownloadCli.js',
        '--config',
        (Join-Path $RepoRoot 'config\osdcloud-console.json'),
        '--image-id',
        ([string] $Artifact.osImageId)
    )
    foreach ($target in $targets) {
        Assert-ArtifactMatches -Path $target -Artifact $Artifact -Label "OS image artifact $($Artifact.id)"
    }
}

try {
    $LiveRoot = Get-FullPath $LiveRoot
    if ($LiveRoot -ne 'C:\OSDCloud') {
        throw "Refusing unsupported LiveRoot. Repo-only bootstrap writes only to C:\OSDCloud. Actual: $LiveRoot"
    }
    if (-not $DryRun -and -not (Test-IsAdministrator)) {
        throw "Run this artifact restore from an elevated PowerShell session or use Deploy-DeploymentServer.cmd."
    }
    if (-not $DryRun -and -not $SkipPrerequisiteCheck) {
        Write-Step "Checking bootstrap prerequisites"
        Assert-Prerequisites -InstallAdkIfMissing:(-not $NoAdkAutoInstall)
    }

    Write-Step "Reading runtime artifact catalog"
    $artifacts = @(Read-RuntimeCatalog -Path $CatalogPath | Where-Object { $_.required -ne $false -or $IncludeOptional })
    Write-Host "Catalog artifacts selected: $($artifacts.Count)"

    Write-Step "Preparing OSDCloud iPXE workspace"
    $generated = @($artifacts | Where-Object { $_.sourceType -in @('generated', 'generated-winpe') })
    $generatedMissing = $false
    foreach ($artifact in $generated) {
        foreach ($target in @(Get-ArtifactTargets -Artifact $artifact)) {
            if (-not (Test-ArtifactMatches -Path (Resolve-ArtifactTarget -RelativePath ([string] $target)) -Artifact $artifact)) {
                $generatedMissing = $true
            }
        }
    }
    if ($generatedMissing) {
        Ensure-OsdCloudWorkspace
        Publish-BootFiles
    }
    else {
        Write-Host "Generated WinPE and boot binaries already match catalog."
    }
    Restore-VersionedAssets

    Write-Step "Restoring downloadable artifacts"
    foreach ($artifact in @($artifacts | Where-Object { $_.sourceType -eq 'download' })) {
        Save-DownloadArtifact -Artifact $artifact
    }

    Write-Step "Restoring OS catalog artifacts"
    foreach ($artifact in @($artifacts | Where-Object { $_.sourceType -eq 'osd-catalog' })) {
        Restore-OsImageArtifact -Artifact $artifact
    }

    Write-Step "Artifact restore completed"
    if ($DryRun) {
        Write-Host "Dry run only; no files were written."
    }
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
