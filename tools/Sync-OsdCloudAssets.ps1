[CmdletBinding()]
param(
    [string] $SourceRoot = 'C:\OSDCloud',
    [string] $AssetsRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'osdcloud-assets'),
    [switch] $MountWinPe,
    [switch] $HashLargeArtifacts,
    # Installed Web console App root. WinPE endpoint templates are pushed here
    # after every sync so endpoint sync picks up local edits automatically.
    # Set to '' to skip the push (e.g. on a machine without an installed App).
    [string] $AppRoot = 'C:\OSDCloud\HostTools\App'
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

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
        $hash = Get-Sha256Hash -LiteralPath $item.FullName
    }

    [ordered]@{
        length           = $item.Length
        lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('o')
        sha256           = $hash
        hashStatus       = $hashStatus
    }
}

function Test-IsRepoOnlyDownloadPayload {
    param([Parameter(Mandatory)][string] $Path)

    $extension = [System.IO.Path]::GetExtension($Path)
    $extension -in @('.msi', '.exe')
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

$ipxeLab = $SourceRoot
$winPeMount = Join-Path $ipxeLab 'MountReadOnly'
$bootWim = Join-Path $ipxeLab 'Media\sources\boot.wim'
$mountedByScript = $false
$appsRoot = Join-Path $ipxeLab 'Media\OSDCloud\Apps'
$appExports = @()
if (Test-Path -LiteralPath $appsRoot -PathType Container) {
    $appExports = @(Get-ChildItem -LiteralPath $appsRoot -File -Recurse | Where-Object {
        -not (Test-IsRepoOnlyDownloadPayload -Path $_.FullName) -and
        $_.Name -ne 'selected-profile.json'
    } | Sort-Object FullName | ForEach-Object {
        $relativePath = $_.FullName.Substring($appsRoot.Length).TrimStart('\')
        @{
            Source = $_.FullName
            Target = Join-Path 'OSDCloud\Media\OSDCloud\Apps' $relativePath
        }
    })
}
$scriptsRoot = Join-Path $ipxeLab 'Media\OSDCloud\Scripts'
$scriptExports = @()
if (Test-Path -LiteralPath $scriptsRoot -PathType Container) {
    $scriptExports = @(Get-ChildItem -LiteralPath $scriptsRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
        $relativePath = $_.FullName.Substring($scriptsRoot.Length).TrimStart('\')
        @{
            Source = $_.FullName
            Target = Join-Path 'OSDCloud\Media\OSDCloud\Scripts' $relativePath
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
        @{ Source = Join-Path $ipxeLab 'Config\Scripts\Shutdown\Invoke-OobeCustomization.ps1'; Target = 'OSDCloud\Config\Scripts\Shutdown\Invoke-OobeCustomization.ps1' },
        @{ Source = Join-Path $ipxeLab 'Config\Scripts\SetupComplete\SetupComplete.cmd'; Target = 'OSDCloud\Config\Scripts\SetupComplete\SetupComplete.cmd' },
        @{ Source = Join-Path $ipxeLab 'Config\Scripts\SetupComplete\SetupComplete.ps1'; Target = 'OSDCloud\Config\Scripts\SetupComplete\SetupComplete.ps1' }
    ) + $appExports + $scriptExports + @(
        @{ Source = Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\boot.ipxe'; Target = 'OSDCloud\PXE-HttpRoot\osdcloud\boot.ipxe' },
        @{ Source = Join-Path $ipxeLab 'PXE-TFTP\autoexec.ipxe.disabled'; Target = 'OSDCloud\PXE-TFTP\autoexec.ipxe.disabled' },
        @{ Source = Join-Path $ipxeLab 'PXE-TFTP\ipxeboot\x86_64-sb\autoexec.ipxe.disabled'; Target = 'OSDCloud\PXE-TFTP\ipxeboot\x86_64-sb\autoexec.ipxe.disabled' },
        @{ Source = Join-Path $ipxeLab 'PXE-TFTP\ipxeboot\x86_64-sb\snponly.efi'; Target = 'OSDCloud\PXE-TFTP\ipxeboot\x86_64-sb\snponly.efi' },
        @{ Source = Join-Path $ipxeLab 'Tools\Serve-OsdCloudMedia.mjs'; Target = 'OSDCloud\Tools\Serve-OsdCloudMedia.mjs' },
        @{ Source = Join-Path $ipxeLab 'Tools\Serve-OsdCloudMedia.ps1'; Target = 'OSDCloud\Tools\Serve-OsdCloudMedia.ps1' },
        @{ Source = Join-Path $ipxeLab 'Tools\Start-PxeDhcp.ps1'; Target = 'OSDCloud\Tools\Start-PxeDhcp.ps1' },
        @{ Source = Join-Path $ipxeLab 'Tools\Start-PxeTftp.ps1'; Target = 'OSDCloud\Tools\Start-PxeTftp.ps1' },
        @{ Source = Join-Path $winPeMount 'Windows\System32\Startnet.cmd'; Target = 'OSDCloud\WinPE\Windows\System32\Startnet.cmd'; SourceKind = 'boot.wim:index1' },
        @{ Source = Join-Path $winPeMount 'OSDCloud\Config\Scripts\Shutdown\Invoke-OobeCustomization.ps1'; Target = 'OSDCloud\WinPE\OSDCloud\Config\Scripts\Shutdown\Invoke-OobeCustomization.ps1'; SourceKind = 'boot.wim:index1' },
        @{ Source = Join-Path $winPeMount 'OSDCloud\Config\Scripts\SetupComplete\SetupComplete.cmd'; Target = 'OSDCloud\WinPE\OSDCloud\Config\Scripts\SetupComplete\SetupComplete.cmd'; SourceKind = 'boot.wim:index1' },
        @{ Source = Join-Path $winPeMount 'OSDCloud\Config\Scripts\SetupComplete\SetupComplete.ps1'; Target = 'OSDCloud\WinPE\OSDCloud\Config\Scripts\SetupComplete\SetupComplete.ps1'; SourceKind = 'boot.wim:index1' },
        @{ Source = Join-Path $winPeMount 'OSDCloud\Report-OSDCloudProgress.ps1'; Target = 'OSDCloud\WinPE\OSDCloud\Report-OSDCloudProgress.ps1'; SourceKind = 'boot.wim:index1' },
        @{ Source = Join-Path $winPeMount 'OSDCloud\Report-TorrentTelemetry.ps1'; Target = 'OSDCloud\WinPE\OSDCloud\Report-TorrentTelemetry.ps1'; SourceKind = 'boot.wim:index1' },
        @{ Source = Join-Path $winPeMount 'OSDCloud\Start-OSDCloud-iPXE.ps1'; Target = 'OSDCloud\WinPE\OSDCloud\Start-OSDCloud-iPXE.ps1'; SourceKind = 'boot.wim:index1' }
    )

    # WIM-sourced exports require the boot.wim to be mounted. When it isn't and
    # -MountWinPe was not requested, skip those entries with a warning rather than
    # failing: the common case of "I just edited a WinPE template" still completes
    # and pushes the updated file to the App copy so endpoint sync picks it up.
    $wimAvailable = Test-Path -LiteralPath (Join-Path $winPeMount 'Windows\System32\Startnet.cmd') -PathType Leaf
    if (-not $wimAvailable) {
        $wimOnlyExports = @($exports | Where-Object { $_.ContainsKey('SourceKind') -and $_['SourceKind'] -eq 'boot.wim:index1' })
        if ($wimOnlyExports.Count -gt 0) {
            Write-Warning "boot.wim not mounted at $winPeMount; skipping $($wimOnlyExports.Count) WIM export(s). Run with -MountWinPe to include them."
        }
        $exports = @($exports | Where-Object { -not ($_.ContainsKey('SourceKind') -and $_['SourceKind'] -eq 'boot.wim:index1') })
    }

    $copied = foreach ($entry in $exports) {
        $sourceKind = if ($entry.ContainsKey('SourceKind')) { $entry.SourceKind } else { 'filesystem' }
        Copy-VersionedAsset -Source $entry.Source -Target $entry.Target -SourceKind $sourceKind
    }

    $osImageExclusions = @()
    foreach ($osImageRoot in @(
        (Join-Path $ipxeLab 'Media\OSDCloud\OS')
    )) {
        if (Test-Path -LiteralPath $osImageRoot -PathType Container) {
            $osImageExclusions += @(Get-ChildItem -LiteralPath $osImageRoot -File -Include '*.esd', '*.wim' -Recurse | Sort-Object FullName | ForEach-Object {
                Add-ExcludedArtifact -Path $_.FullName -Reason 'cached Windows image, too large for Git'
            })
        }
    }

    $excluded = @(
        $osImageExclusions
        Add-ExcludedArtifact -Path $bootWim -Reason 'generated WinPE boot image, rebuilt from versioned scripts'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\boot.wim') -Reason 'published WinPE boot image hardlink/copy'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\BCD') -Reason 'generated Windows boot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\boot.sdi') -Reason 'generated Windows boot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\bootmgr') -Reason 'generated Windows boot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\bootx64.efi') -Reason 'generated Windows boot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\wimboot') -Reason 'upstream iPXE wimboot binary'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-TFTP\bootmgfw.efi') -Reason 'generated Windows boot binary (secureboot PXE)'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-TFTP\Boot\BCD') -Reason 'generated network BCD store (secureboot PXE)'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-TFTP\Boot\boot.sdi') -Reason 'generated Windows boot binary (secureboot PXE)'
        Add-ExcludedArtifact -Path (Join-Path $ipxeLab 'PXE-TFTP\sources\boot.wim') -Reason 'published WinPE boot image hardlink (secureboot PXE)'
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

    # Push WinPE endpoint templates to the installed App copy so that endpoint
    # sync (which reads from App\osdcloud-assets, not the source repo) picks up
    # local edits without a manual copy step. Mirrors BOOT_WIM_TEMPLATE_SOURCES
    # in tools/osdcloud-console/src/windows.js.
    if (-not [string]::IsNullOrWhiteSpace($AppRoot)) {
        $appAssets = Join-Path $AppRoot 'osdcloud-assets'
        if (Test-Path -LiteralPath $appAssets -PathType Container) {
            $templateRelPaths = @(
                'OSDCloud\WinPE\Windows\System32\Startnet.cmd',
                'OSDCloud\WinPE\OSDCloud\Maximize-Console.ps1',
                'OSDCloud\WinPE\OSDCloud\Start-OSDCloud-iPXE.ps1',
                'OSDCloud\WinPE\OSDCloud\Report-OSDCloudProgress.ps1',
                'OSDCloud\WinPE\OSDCloud\Report-TorrentTelemetry.ps1',
                'OSDCloud\Config\Scripts\Shutdown\Invoke-OobeCustomization.ps1',
                'OSDCloud\Config\Scripts\SetupComplete\SetupComplete.cmd',
                'OSDCloud\Config\Scripts\SetupComplete\SetupComplete.ps1'
            )
            $pushed = 0; $alreadySynced = 0
            foreach ($rel in $templateRelPaths) {
                $src = Join-Path $AssetsRoot $rel
                $dst = Join-Path $appAssets $rel
                if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { continue }
                $srcHash = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash
                $dstHash = if (Test-Path -LiteralPath $dst -PathType Leaf) { (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash } else { '' }
                if ($srcHash -ne $dstHash) {
                    New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
                    Copy-Item -LiteralPath $src -Destination $dst -Force
                    Write-Host "  app-push: $rel"
                    $pushed++
                } else {
                    $alreadySynced++
                }
            }
            Write-Host "Pushed $pushed WinPE template(s) to App copy ($alreadySynced already in sync)"
        } else {
            Write-Host "App copy not found at $appAssets; skipping WinPE template push."
        }
    }
}
finally {
    if ($mountedByScript) {
        & dism /English /Unmount-Wim /MountDir:$winPeMount /Discard
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "DISM failed to unmount $winPeMount. Run 'dism /English /Get-MountedWimInfo' before editing boot.wim."
        }
    }
}
