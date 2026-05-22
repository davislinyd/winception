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

    (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToUpperInvariant()
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

function Assert-MicrosoftSignedFile {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][string] $Label
    )

    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid') {
        throw "$Label Authenticode signature is not valid: $($signature.Status) $Path"
    }
    if ($null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') {
        throw "$Label is not signed by a Microsoft certificate: $Path"
    }
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
    Import-Module OSD -Force
    New-OSDCloudWorkspace -WorkspacePath $ipxeLab -Public | Out-Null
    Set-OSDCloudWorkspace -WorkspacePath $ipxeLab | Out-Null
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
