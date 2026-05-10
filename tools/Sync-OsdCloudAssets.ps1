[CmdletBinding()]
param(
    [string] $SourceRoot = 'C:\OSDCloud',
    [string] $AssetsRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'osdcloud-assets'),
    [switch] $MountWinPe,
    [switch] $HashLargeArtifacts
)

$ErrorActionPreference = 'Stop'

function ConvertTo-RepoPath([string] $Path) {
    $Path.Replace('\', '/')
}

function Get-FileMetadata {
    param(
        [Parameter(Mandatory)]
        [string] $Path,
        [bool] $HashLarge
    )

    $item = Get-Item -LiteralPath $Path
    $isLarge = $item.Length -gt 100MB
    $hash = $null
    $hashStatus = 'sha256'
    if ($isLarge -and -not $HashLarge) {
        $hashStatus = 'skipped-large-artifact'
    }
    else {
        $hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
    }

    [ordered]@{
        length           = $item.Length
        lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('o')
        sha256           = $hash
        hashStatus       = $hashStatus
    }
}

function Copy-VersionedAsset {
    param(
        [Parameter(Mandatory)]
        [string] $Source,
        [Parameter(Mandatory)]
        [string] $Target,
        [string] $SourceKind = 'filesystem'
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Required source file not found: $Source"
    }

    $destination = Join-Path $AssetsRoot $Target
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $destination -Force

    $sourceMeta = Get-FileMetadata -Path $Source -HashLarge:$true
    $repoTarget = ConvertTo-RepoPath (Join-Path 'osdcloud-assets' $Target)

    [ordered]@{
        source           = $Source
        sourceKind       = $SourceKind
        repoPath         = $repoTarget
        length           = $sourceMeta.length
        lastWriteTimeUtc = $sourceMeta.lastWriteTimeUtc
        sha256           = $sourceMeta.sha256
    }
}

function Add-ExcludedArtifact {
    param(
        [Parameter(Mandatory)]
        [string] $Path,
        [Parameter(Mandatory)]
        [string] $Reason
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{
            source = $Path
            exists = $false
            reason = $Reason
        }
    }

    $metadata = Get-FileMetadata -Path $Path -HashLarge:$HashLargeArtifacts.IsPresent
    [ordered]@{
        source           = $Path
        exists           = $true
        reason           = $Reason
        length           = $metadata.length
        lastWriteTimeUtc = $metadata.lastWriteTimeUtc
        sha256           = $metadata.sha256
        hashStatus       = $metadata.hashStatus
    }
}

$win11Lab = Join-Path $SourceRoot 'Win11-Lab'
$ipxeLab = Join-Path $SourceRoot 'Win11-iPXE-Lab'
$winPeMount = Join-Path $ipxeLab 'MountReadOnly'
$bootWim = Join-Path $ipxeLab 'Media\sources\boot.wim'
$mountedByScript = $false
$appsRoot = Join-Path $ipxeLab 'Media\OSDCloud\Apps'
$appExports = @()
if (Test-Path -LiteralPath $appsRoot -PathType Container) {
    $appExports = @(Get-ChildItem -LiteralPath $appsRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
        $relativePath = $_.FullName.Substring($appsRoot.Length).TrimStart('\')
        @{
            Source = $_.FullName
            Target = Join-Path 'Win11-iPXE-Lab\Media\OSDCloud\Apps' $relativePath
        }
    })
}

if ($MountWinPe -and -not (Test-Path -LiteralPath (Join-Path $winPeMount 'OSDCloud\Start-OSDCloud-iPXE.ps1') -PathType Leaf)) {
    New-Item -ItemType Directory -Path $winPeMount -Force | Out-Null
    & dism /English /Mount-Wim /WimFile:$bootWim /Index:1 /MountDir:$winPeMount /ReadOnly
    if ($LASTEXITCODE -ne 0) {
        throw "DISM failed to mount $bootWim"
    }
    $mountedByScript = $true
}

try {
    $exports = @(
        @{ Source = Join-Path $win11Lab 'Config\Scripts\Shutdown\Invoke-DavisOobe.ps1'; Target = 'Win11-Lab\Config\Scripts\Shutdown\Invoke-DavisOobe.ps1' },
        @{ Source = Join-Path $win11Lab 'Config\Scripts\SetupComplete\SetupComplete.cmd'; Target = 'Win11-Lab\Config\Scripts\SetupComplete\SetupComplete.cmd' },
        @{ Source = Join-Path $win11Lab 'Config\Scripts\SetupComplete\SetupComplete.ps1'; Target = 'Win11-Lab\Config\Scripts\SetupComplete\SetupComplete.ps1' },
        @{ Source = Join-Path $ipxeLab 'Config\Scripts\Shutdown\Invoke-DavisOobe.ps1'; Target = 'Win11-iPXE-Lab\Config\Scripts\Shutdown\Invoke-DavisOobe.ps1' },
        @{ Source = Join-Path $ipxeLab 'Config\Scripts\SetupComplete\SetupComplete.cmd'; Target = 'Win11-iPXE-Lab\Config\Scripts\SetupComplete\SetupComplete.cmd' },
        @{ Source = Join-Path $ipxeLab 'Config\Scripts\SetupComplete\SetupComplete.ps1'; Target = 'Win11-iPXE-Lab\Config\Scripts\SetupComplete\SetupComplete.ps1' }
    ) + $appExports + @(
        @{ Source = Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\boot.ipxe'; Target = 'Win11-iPXE-Lab\PXE-HttpRoot\osdcloud\boot.ipxe' },
        @{ Source = Join-Path $ipxeLab 'PXE-TFTP\autoexec.ipxe.disabled'; Target = 'Win11-iPXE-Lab\PXE-TFTP\autoexec.ipxe.disabled' },
        @{ Source = Join-Path $ipxeLab 'PXE-TFTP\ipxeboot\x86_64-sb\autoexec.ipxe.disabled'; Target = 'Win11-iPXE-Lab\PXE-TFTP\ipxeboot\x86_64-sb\autoexec.ipxe.disabled' },
        @{ Source = Join-Path $ipxeLab 'Tools\Serve-OsdCloudMedia.mjs'; Target = 'Win11-iPXE-Lab\Tools\Serve-OsdCloudMedia.mjs' },
        @{ Source = Join-Path $ipxeLab 'Tools\Serve-OsdCloudMedia.ps1'; Target = 'Win11-iPXE-Lab\Tools\Serve-OsdCloudMedia.ps1' },
        @{ Source = Join-Path $ipxeLab 'Tools\Start-PxeDhcp.ps1'; Target = 'Win11-iPXE-Lab\Tools\Start-PxeDhcp.ps1' },
        @{ Source = Join-Path $ipxeLab 'Tools\Start-PxeTftp.ps1'; Target = 'Win11-iPXE-Lab\Tools\Start-PxeTftp.ps1' },
        @{ Source = Join-Path $winPeMount 'Windows\System32\Startnet.cmd'; Target = 'Win11-iPXE-Lab\WinPE\Windows\System32\Startnet.cmd'; SourceKind = 'boot.wim:index1' },
        @{ Source = Join-Path $winPeMount 'OSDCloud\Config\Scripts\Shutdown\Invoke-DavisOobe.ps1'; Target = 'Win11-iPXE-Lab\WinPE\OSDCloud\Config\Scripts\Shutdown\Invoke-DavisOobe.ps1'; SourceKind = 'boot.wim:index1' },
        @{ Source = Join-Path $winPeMount 'OSDCloud\Config\Scripts\SetupComplete\SetupComplete.cmd'; Target = 'Win11-iPXE-Lab\WinPE\OSDCloud\Config\Scripts\SetupComplete\SetupComplete.cmd'; SourceKind = 'boot.wim:index1' },
        @{ Source = Join-Path $winPeMount 'OSDCloud\Config\Scripts\SetupComplete\SetupComplete.ps1'; Target = 'Win11-iPXE-Lab\WinPE\OSDCloud\Config\Scripts\SetupComplete\SetupComplete.ps1'; SourceKind = 'boot.wim:index1' },
        @{ Source = Join-Path $winPeMount 'OSDCloud\Report-OSDCloudProgress.ps1'; Target = 'Win11-iPXE-Lab\WinPE\OSDCloud\Report-OSDCloudProgress.ps1'; SourceKind = 'boot.wim:index1' },
        @{ Source = Join-Path $winPeMount 'OSDCloud\Start-OSDCloud-iPXE.ps1'; Target = 'Win11-iPXE-Lab\WinPE\OSDCloud\Start-OSDCloud-iPXE.ps1'; SourceKind = 'boot.wim:index1' }
    )

    $copied = foreach ($entry in $exports) {
        $sourceKind = if ($entry.ContainsKey('SourceKind')) { $entry.SourceKind } else { 'filesystem' }
        Copy-VersionedAsset -Source $entry.Source -Target $entry.Target -SourceKind $sourceKind
    }

    $excluded = @(
        Add-ExcludedArtifact -Path (Join-Path $win11Lab 'OSDCloud_NoPrompt.iso') -Reason 'generated ISO, too large for Git'
        Add-ExcludedArtifact -Path (Join-Path $win11Lab 'Media\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd') -Reason 'cached Windows ESD, too large for Git'
        Add-ExcludedArtifact -Path $bootWim -Reason 'generated WinPE boot image, rebuilt from versioned scripts'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\boot.wim') -Reason 'published WinPE boot image hardlink/copy'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\BCD') -Reason 'generated Windows boot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\boot.sdi') -Reason 'generated Windows boot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\bootmgr') -Reason 'generated Windows boot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\bootx64.efi') -Reason 'generated Windows boot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\wimboot') -Reason 'upstream iPXE wimboot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-TFTP\ipxeboot\x86_64-sb\snponly.efi') -Reason 'upstream iPXE binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-TFTP\ipxeboot\x86_64-sb\snponly-shim.efi') -Reason 'upstream iPXE Secure Boot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-TFTP\ipxeboot\x86_64-sb\ipxe-shim.efi') -Reason 'upstream iPXE Secure Boot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-TFTP\ipxeboot\x86_64-sb\shimx64.efi') -Reason 'upstream shim binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-TFTP\ipxeboot\x86_64-sb\ipxe.efi') -Reason 'upstream iPXE binary'
    )

    $manifest = [ordered]@{
        generatedAt      = (Get-Date).ToUniversalTime().ToString('o')
        sourceRoot       = $SourceRoot
        assetsRoot       = $AssetsRoot
        hashLargeArtifacts = $HashLargeArtifacts.IsPresent
        exports          = @($copied)
        excludedArtifacts = @($excluded)
    }

    New-Item -ItemType Directory -Path $AssetsRoot -Force | Out-Null
    $manifestPath = Join-Path $AssetsRoot 'manifest.json'
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

    Write-Host "Synced $($copied.Count) versioned assets to $AssetsRoot"
    Write-Host "Wrote manifest: $manifestPath"
}
finally {
    if ($mountedByScript) {
        & dism /English /Unmount-Wim /MountDir:$winPeMount /Discard
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "DISM failed to unmount $winPeMount. Run 'dism /English /Get-MountedWimInfo' before editing boot.wim."
        }
    }
}
