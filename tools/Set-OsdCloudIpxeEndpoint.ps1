[CmdletBinding()]
param(
    [string] $ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'config\osdcloud-tui.json'),
    [string] $InterfaceAlias,
    [string] $ServerIp,
    [int] $PrefixLength = 24,
    [string] $SmbShareName = 'OSDCloudiPXE',
    [string] $ImageNamePattern,
    [switch] $CommitWinPe,
    [switch] $SyncAssets,
    [switch] $HashLargeArtifacts
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory)]
        [string] $Path,
        [Parameter(Mandatory)]
        [string] $Content
    )

    [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

function Set-Property {
    param(
        [Parameter(Mandatory)]
        [object] $Object,
        [Parameter(Mandatory)]
        [string] $Name,
        [object] $Value
    )

    if ($Object.PSObject.Properties[$Name]) {
        $Object.$Name = $Value
    }
    else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Set-RegexInFile {
    param(
        [Parameter(Mandatory)]
        [string] $Path,
        [Parameter(Mandatory)]
        [string] $Pattern,
        [Parameter(Mandatory)]
        [string] $Replacement,
        [switch] $Optional
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        if ($Optional) {
            return $false
        }
        throw "Required endpoint file not found: $Path"
    }

    $content = [System.IO.File]::ReadAllText($Path)
    $updated = [regex]::Replace($content, $Pattern, $Replacement)
    if ($updated -eq $content) {
        if ($Optional) {
            return $false
        }
        throw "No endpoint replacement matched in $Path"
    }

    Write-Utf8NoBom -Path $Path -Content $updated
    return $true
}

function Set-BootIpxeEndpoint {
    param([string] $Path)

    Set-RegexInFile `
        -Path $Path `
        -Pattern '(?m)^set base http://[^\r\n]+/osdcloud\s*$' `
        -Replacement "set base http://$ServerIp/osdcloud" | Out-Null
}

function Set-AutoexecEndpoint {
    param([string] $Path)

    Set-RegexInFile `
        -Path $Path `
        -Pattern 'http://[^/\s]+/osdcloud/boot\.ipxe' `
        -Replacement "http://$ServerIp/osdcloud/boot.ipxe" `
        -Optional | Out-Null
}

function Set-SetupCompleteEndpoint {
    param([string] $Path)

    $statusUrl = "http://$ServerIp/osdcloud/status"
    $matchedUpper = Set-RegexInFile `
        -Path $Path `
        -Pattern "(?m)^\`$DefaultStatusUrl\s*=\s*'[^']*'\s*$" `
        -Replacement "`$DefaultStatusUrl = '$statusUrl'" `
        -Optional
    $matchedLower = Set-RegexInFile `
        -Path $Path `
        -Pattern "(?m)^\`$defaultStatusUrl\s*=\s*'[^']*'\s*$" `
        -Replacement "`$defaultStatusUrl = '$statusUrl'" `
        -Optional

    if (-not $matchedUpper -and -not $matchedLower) {
        throw "No SetupComplete status URL replacement matched in $Path"
    }
}

function Set-StartOsdCloudEndpoint {
    param([string] $Path)

    Set-RegexInFile `
        -Path $Path `
        -Pattern "(?m)^\`$server\s*=\s*'[^']*'\s*$" `
        -Replacement "`$server = '$ServerIp'" | Out-Null
}

function Set-ProgressReporterEndpoint {
    param([string] $Path)

    Set-RegexInFile `
        -Path $Path `
        -Pattern "\[string\]\s*\`$StatusUrl\s*=\s*'[^']*'" `
        -Replacement "[string] `$StatusUrl = 'http://$ServerIp/osdcloud/status'" | Out-Null
}

function Set-LegacyHelperDefaults {
    param([string] $IpxeLab)

    Set-RegexInFile `
        -Path (Join-Path $IpxeLab 'Tools\Start-PxeDhcp.ps1') `
        -Pattern "\[string\]\s*\`$ServerIp\s*=\s*'[^']*'" `
        -Replacement "[string] `$ServerIp = '$ServerIp'" `
        -Optional | Out-Null
    Set-RegexInFile `
        -Path (Join-Path $IpxeLab 'Tools\Start-PxeTftp.ps1') `
        -Pattern "\[string\]\s*\`$ListenIp\s*=\s*'[^']*'" `
        -Replacement "[string] `$ListenIp = '$ServerIp'" `
        -Optional | Out-Null
    Set-RegexInFile `
        -Path (Join-Path $IpxeLab 'Tools\Serve-OsdCloudMedia.mjs') `
        -Pattern "const host = process\.argv\[3\] \?\? '[^']*'" `
        -Replacement "const host = process.argv[3] ?? '$ServerIp'" `
        -Optional | Out-Null
    Set-RegexInFile `
        -Path (Join-Path $IpxeLab 'Tools\Serve-OsdCloudMedia.ps1') `
        -Pattern 'http://[^/:]+:8088/' `
        -Replacement "http://${ServerIp}:8088/" `
        -Optional | Out-Null
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$repoRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($InterfaceAlias)) {
    $InterfaceAlias = [string] $config.adapter.interfaceAlias
}
if ([string]::IsNullOrWhiteSpace($ServerIp)) {
    $ServerIp = [string] $config.adapter.serverIp
}
if (-not $PSBoundParameters.ContainsKey('PrefixLength') -and $config.adapter.prefixLength) {
    $PrefixLength = [int] $config.adapter.prefixLength
}
if ([string]::IsNullOrWhiteSpace($ImageNamePattern)) {
    $ImageNamePattern = [string] $config.paths.imageNamePattern
}

$osdCloudRoot = if ($config.paths.osdCloudRoot) { [string] $config.paths.osdCloudRoot } else { 'C:\OSDCloud' }
$ipxeLab = Join-Path $osdCloudRoot 'Win11-iPXE-Lab'
$share = "\\$ServerIp\$SmbShareName"
$statusUrl = "http://$ServerIp/osdcloud/status"

Set-Property -Object $config.adapter -Name interfaceAlias -Value $InterfaceAlias
Set-Property -Object $config.adapter -Name serverIp -Value $ServerIp
Set-Property -Object $config.adapter -Name prefixLength -Value $PrefixLength
Set-Property -Object $config.dhcp -Name listenIp -Value $ServerIp
Set-Property -Object $config.dhcp -Name ipxeBootUrl -Value "http://$ServerIp/osdcloud/boot.ipxe"
Set-Property -Object $config.tftp -Name listenIp -Value $ServerIp
Set-Property -Object $config.http -Name host -Value $ServerIp
Set-Property -Object $config.smb -Name share -Value $share
if (-not [string]::IsNullOrWhiteSpace($ImageNamePattern)) {
    Set-Property -Object $config.smb -Name imagePath -Value "$share\OSDCloud\OS\$ImageNamePattern"
}

Write-Utf8NoBom -Path $ConfigPath -Content (($config | ConvertTo-Json -Depth 12) + [Environment]::NewLine)
Write-Host "Updated config endpoint: $ServerIp on $InterfaceAlias/$PrefixLength"

Set-BootIpxeEndpoint -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\boot.ipxe')
Set-AutoexecEndpoint -Path (Join-Path $ipxeLab 'PXE-TFTP\autoexec.ipxe.disabled')
Set-AutoexecEndpoint -Path (Join-Path $ipxeLab 'PXE-TFTP\ipxeboot\x86_64-sb\autoexec.ipxe.disabled')
Set-SetupCompleteEndpoint -Path (Join-Path $ipxeLab 'Config\Scripts\SetupComplete\SetupComplete.ps1')
Set-LegacyHelperDefaults -IpxeLab $ipxeLab
Write-Host "Updated live PXE endpoint files under $ipxeLab"

if ($CommitWinPe) {
    $bootWim = Join-Path $ipxeLab 'Media\sources\boot.wim'
    $publishedBootWim = Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\boot.wim'
    $mountDir = Join-Path $ipxeLab 'MountEndpointUpdate'
    $mounted = $false
    $commit = $false

    if (-not (Test-Path -LiteralPath $bootWim -PathType Leaf)) {
        throw "boot.wim not found: $bootWim"
    }
    if (Test-Path -LiteralPath $mountDir) {
        $children = @(Get-ChildItem -LiteralPath $mountDir -Force -ErrorAction SilentlyContinue)
        if ($children.Count -gt 0) {
            throw "Mount directory is not empty: $mountDir"
        }
    }
    else {
        New-Item -ItemType Directory -Path $mountDir -Force | Out-Null
    }

    try {
        & dism /English /Mount-Wim /WimFile:$bootWim /Index:1 /MountDir:$mountDir
        if ($LASTEXITCODE -ne 0) {
            throw "DISM failed to mount $bootWim"
        }
        $mounted = $true

        Set-StartOsdCloudEndpoint -Path (Join-Path $mountDir 'OSDCloud\Start-OSDCloud-iPXE.ps1')
        Set-ProgressReporterEndpoint -Path (Join-Path $mountDir 'OSDCloud\Report-OSDCloudProgress.ps1')
        Set-SetupCompleteEndpoint -Path (Join-Path $mountDir 'OSDCloud\Config\Scripts\SetupComplete\SetupComplete.ps1')
        $commit = $true
    }
    finally {
        if ($mounted) {
            $mode = if ($commit) { '/Commit' } else { '/Discard' }
            & dism /English /Unmount-Wim /MountDir:$mountDir $mode
            if ($LASTEXITCODE -ne 0) {
                throw "DISM failed to unmount $mountDir with $mode"
            }
        }
    }

    if (Test-Path -LiteralPath $publishedBootWim -PathType Leaf) {
        $sourceHash = (Get-FileHash -LiteralPath $bootWim -Algorithm SHA256).Hash
        $publishedHash = (Get-FileHash -LiteralPath $publishedBootWim -Algorithm SHA256).Hash
        if ($sourceHash -ne $publishedHash) {
            Copy-Item -LiteralPath $bootWim -Destination $publishedBootWim -Force
            $publishedHash = (Get-FileHash -LiteralPath $publishedBootWim -Algorithm SHA256).Hash
        }
        if ($sourceHash -ne $publishedHash) {
            throw "Published boot.wim hash still differs after copy"
        }
    }
    else {
        Copy-Item -LiteralPath $bootWim -Destination $publishedBootWim -Force
    }
    Write-Host "Updated boot.wim embedded endpoint files and verified published boot.wim"
}
else {
    Write-Host "Skipped boot.wim mount/commit; run with -CommitWinPe before deployment"
}

if ($SyncAssets) {
    $syncScript = Join-Path $repoRoot 'tools\Sync-OsdCloudAssets.ps1'
    $syncArgs = @('-MountWinPe')
    if ($HashLargeArtifacts) {
        $syncArgs += '-HashLargeArtifacts'
    }
    & $syncScript @syncArgs
    Write-Host "Synced osdcloud-assets from live files"
}
else {
    Write-Host "Skipped osdcloud-assets sync; run tools\Sync-OsdCloudAssets.ps1 before commit"
}

[pscustomobject]@{
    InterfaceAlias = $InterfaceAlias
    ServerIp = $ServerIp
    PrefixLength = $PrefixLength
    StatusUrl = $statusUrl
    SmbShare = $share
    CommitWinPe = [bool] $CommitWinPe
    SyncAssets = [bool] $SyncAssets
} | ConvertTo-Json -Compress
