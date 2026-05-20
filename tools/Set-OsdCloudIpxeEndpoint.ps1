[CmdletBinding()]
param(
    [string] $ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'config\osdcloud-console.json'),
    [string] $InterfaceAlias,
    [string] $ServerIp,
    [int] $PrefixLength = 24,
    [string] $DefaultGateway,
    [string] $SmbShareName = 'OSDCloudiPXE',
    [string] $SmbFirewallRuleName = 'PXE-Lab SMB Inbound',
    [string] $ImageNamePattern,
    [switch] $SkipSmbFirewall,
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

function Get-Sha256Hash {
    param([Parameter(Mandatory)][string] $LiteralPath)

    $resolvedPath = (Resolve-Path -LiteralPath $LiteralPath -ErrorAction Stop).ProviderPath
    $hashCommand = Get-Command -Name Get-FileHash -ErrorAction SilentlyContinue
    if ($hashCommand) {
        return (& $hashCommand -LiteralPath $resolvedPath -Algorithm SHA256).Hash
    }

    $stream = [System.IO.File]::OpenRead($resolvedPath)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hashBytes = $sha256.ComputeHash($stream)
            return (-join ($hashBytes | ForEach-Object { $_.ToString('x2') })).ToUpperInvariant()
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
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

function ConvertTo-IPv4UInt32 {
    param([Parameter(Mandatory)][string] $Address)

    $bytes = [System.Net.IPAddress]::Parse($Address).GetAddressBytes()
    if ([BitConverter]::IsLittleEndian) {
        [Array]::Reverse($bytes)
    }
    [BitConverter]::ToUInt32($bytes, 0)
}

function ConvertFrom-IPv4UInt32 {
    param([Parameter(Mandatory)][uint32] $Value)

    $bytes = [BitConverter]::GetBytes($Value)
    if ([BitConverter]::IsLittleEndian) {
        [Array]::Reverse($bytes)
    }
    [System.Net.IPAddress]::new($bytes).ToString()
}

function ConvertTo-PrefixMask {
    param([Parameter(Mandatory)][int] $PrefixLength)

    if ($PrefixLength -lt 0 -or $PrefixLength -gt 32) {
        throw "Invalid IPv4 prefix length: $PrefixLength"
    }
    if ($PrefixLength -eq 0) {
        return [uint32] 0
    }
    [uint32] (([uint64] 4294967295 -shl (32 - $PrefixLength)) -band [uint64] 4294967295)
}

function Test-IPv4InPrefix {
    param(
        [Parameter(Mandatory)][string] $Address,
        [Parameter(Mandatory)][string] $NetworkAddress,
        [Parameter(Mandatory)][int] $PrefixLength
    )

    $mask = ConvertTo-PrefixMask -PrefixLength $PrefixLength
    ((ConvertTo-IPv4UInt32 $Address) -band $mask) -eq ((ConvertTo-IPv4UInt32 $NetworkAddress) -band $mask)
}

function Get-SubnetInfo {
    param(
        [Parameter(Mandatory)][string] $Address,
        [Parameter(Mandatory)][int] $PrefixLength
    )

    $addressValue = ConvertTo-IPv4UInt32 $Address
    $mask = ConvertTo-PrefixMask -PrefixLength $PrefixLength
    $network = [uint32] ($addressValue -band $mask)
    $broadcast = [uint32] ($network -bor ([uint32](([uint64] 4294967295) -bxor [uint64] $mask)))
    $firstUsable = if ($PrefixLength -ge 31) { $network } else { [uint32] ($network + 1) }
    $lastUsable = if ($PrefixLength -ge 31) { $broadcast } else { [uint32] ($broadcast - 1) }

    [pscustomobject]@{
        AddressValue = $addressValue
        Network = $network
        Broadcast = $broadcast
        FirstUsable = $firstUsable
        LastUsable = $lastUsable
        Mask = $mask
    }
}

function Get-DhcpLeaseRange {
    param(
        [Parameter(Mandatory)][string] $ServerIp,
        [Parameter(Mandatory)][int] $PrefixLength
    )

    $info = Get-SubnetInfo -Address $ServerIp -PrefixLength $PrefixLength
    $preferredStart = [uint32] ($info.Network + 200)
    $preferredEnd = [uint32] ($info.Network + 250)
    if ($preferredStart -ge $info.FirstUsable -and
        $preferredEnd -le $info.LastUsable -and
        ($info.AddressValue -lt $preferredStart -or $info.AddressValue -gt $preferredEnd)) {
        return [pscustomobject]@{
            LeaseStartIp = ConvertFrom-IPv4UInt32 $preferredStart
            LeaseEndIp = ConvertFrom-IPv4UInt32 $preferredEnd
        }
    }

    $end = if ($info.LastUsable -eq $info.AddressValue) { [uint32] ($info.AddressValue - 1) } else { $info.LastUsable }
    $start = [uint32] [Math]::Max($info.FirstUsable, $end - 50)
    if ($info.AddressValue -ge $start -and $info.AddressValue -le $end) {
        if ($info.AddressValue -eq $start) {
            $start = [uint32] ($start + 1)
        }
        else {
            $end = [uint32] ($info.AddressValue - 1)
        }
    }

    if ($start -gt $end) {
        throw "No DHCP lease range available outside server IP $ServerIp/$PrefixLength"
    }

    [pscustomobject]@{
        LeaseStartIp = ConvertFrom-IPv4UInt32 $start
        LeaseEndIp = ConvertFrom-IPv4UInt32 $end
    }
}

function Get-SubnetCidr {
    param(
        [Parameter(Mandatory)][string] $ServerIp,
        [Parameter(Mandatory)][int] $PrefixLength
    )

    $info = Get-SubnetInfo -Address $ServerIp -PrefixLength $PrefixLength
    "$(ConvertFrom-IPv4UInt32 $info.Network)/$PrefixLength"
}

function Get-ReservationIp {
    param([Parameter(Mandatory)][object] $Reservation)

    foreach ($name in @('ip', 'IP', 'ipAddress', 'IPAddress')) {
        $property = $Reservation.PSObject.Properties[$name]
        if ($property -and -not [string]::IsNullOrWhiteSpace([string] $property.Value)) {
            return [string] $property.Value
        }
    }
    return ''
}

function Update-DhcpReservationsForPrefix {
    param(
        [Parameter(Mandatory)][object] $Config,
        [Parameter(Mandatory)][string] $ServerIp,
        [Parameter(Mandatory)][int] $PrefixLength
    )

    if (-not $Config.dhcp.PSObject.Properties['reservations']) {
        return @()
    }

    $kept = @()
    $removed = @()
    foreach ($reservation in @($Config.dhcp.reservations)) {
        if (-not $reservation) {
            continue
        }
        $ip = Get-ReservationIp -Reservation $reservation
        $inPrefix = $false
        if (-not [string]::IsNullOrWhiteSpace($ip)) {
            try {
                $inPrefix = Test-IPv4InPrefix -Address $ip -NetworkAddress $ServerIp -PrefixLength $PrefixLength
            }
            catch {
                $inPrefix = $false
            }
        }

        if ($inPrefix) {
            $kept += $reservation
        }
        else {
            $removed += $reservation
        }
    }

    Set-Property -Object $Config.dhcp -Name reservations -Value @($kept)
    return @($removed)
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
    $matched = [regex]::IsMatch($content, $Pattern)
    if (-not $matched) {
        if ($Optional) {
            return $false
        }
        throw "No endpoint replacement matched in $Path"
    }

    $updated = [regex]::Replace($content, $Pattern, $Replacement)
    if ($updated -eq $content) {
        return $true
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
    param(
        [string] $IpxeLab,
        [string] $LeaseStartIp,
        [string] $LeaseEndIp,
        [string] $SubnetMask,
        [string] $Router
    )

    Set-RegexInFile `
        -Path (Join-Path $IpxeLab 'Tools\Start-PxeDhcp.ps1') `
        -Pattern "\[string\]\s*\`$ServerIp\s*=\s*'[^']*'" `
        -Replacement "[string] `$ServerIp = '$ServerIp'" `
        -Optional | Out-Null
    Set-RegexInFile `
        -Path (Join-Path $IpxeLab 'Tools\Start-PxeDhcp.ps1') `
        -Pattern "\[string\]\s*\`$LeaseStartIp\s*=\s*'[^']*'" `
        -Replacement "[string] `$LeaseStartIp = '$LeaseStartIp'" `
        -Optional | Out-Null
    Set-RegexInFile `
        -Path (Join-Path $IpxeLab 'Tools\Start-PxeDhcp.ps1') `
        -Pattern "\[string\]\s*\`$LeaseEndIp\s*=\s*'[^']*'" `
        -Replacement "[string] `$LeaseEndIp = '$LeaseEndIp'" `
        -Optional | Out-Null
    Set-RegexInFile `
        -Path (Join-Path $IpxeLab 'Tools\Start-PxeDhcp.ps1') `
        -Pattern "\[string\]\s*\`$SubnetMask\s*=\s*'[^']*'" `
        -Replacement "[string] `$SubnetMask = '$SubnetMask'" `
        -Optional | Out-Null
    Set-RegexInFile `
        -Path (Join-Path $IpxeLab 'Tools\Start-PxeDhcp.ps1') `
        -Pattern "\[string\]\s*\`$Router\s*=\s*'[^']*'" `
        -Replacement "[string] `$Router = '$Router'" `
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

function Copy-IfPresent {
    param(
        [Parameter(Mandatory)]
        [string] $Source,
        [Parameter(Mandatory)]
        [string] $Destination
    )

    if (Test-Path -LiteralPath $Source -PathType Leaf) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
        return $true
    }

    return $false
}

function Get-DeploymentSecretSource {
    param(
        [Parameter(Mandatory)]
        [string] $RepoRoot,
        [Parameter(Mandatory)]
        [string] $IpxeLab
    )

    $candidates = @(
        (Join-Path $RepoRoot 'config\osdcloud-secrets.json'),
        (Join-Path $IpxeLab 'secrets.json'),
        (Join-Path $IpxeLab 'Config\secrets.json')
    )

    $candidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
}

function Set-SmbFirewallEndpoint {
    param(
        [Parameter(Mandatory)]
        [string] $RuleName,
        [Parameter(Mandatory)]
        [string] $LocalAddress,
        [Parameter(Mandatory)]
        [string] $RemoteSubnet
    )

    $rule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    if ($rule) {
        $rule |
            Get-NetFirewallAddressFilter |
            Set-NetFirewallAddressFilter -LocalAddress $LocalAddress -RemoteAddress $RemoteSubnet
        $rule |
            Get-NetFirewallPortFilter |
            Set-NetFirewallPortFilter -Protocol TCP -LocalPort 445
        $rule | Enable-NetFirewallRule | Out-Null
        return 'updated'
    }

    New-NetFirewallRule `
        -DisplayName $RuleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort 445 `
        -LocalAddress $LocalAddress `
        -RemoteAddress $RemoteSubnet `
        -Profile Any | Out-Null
    return 'created'
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$repoRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

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
$existingRouter = [string] $config.dhcp.router
if ([string]::IsNullOrWhiteSpace($DefaultGateway)) {
    if (-not [string]::IsNullOrWhiteSpace($existingRouter) -and (Test-IPv4InPrefix -Address $existingRouter -NetworkAddress $ServerIp -PrefixLength $PrefixLength)) {
        $DefaultGateway = $existingRouter
    }
    else {
        $DefaultGateway = $ServerIp
    }
}
$dhcpRouter = if (Test-IPv4InPrefix -Address $DefaultGateway -NetworkAddress $ServerIp -PrefixLength $PrefixLength) { $DefaultGateway } else { $ServerIp }
$dhcpRange = Get-DhcpLeaseRange -ServerIp $ServerIp -PrefixLength $PrefixLength
$subnetMask = ConvertFrom-IPv4UInt32 (ConvertTo-PrefixMask -PrefixLength $PrefixLength)
$remoteSubnet = Get-SubnetCidr -ServerIp $ServerIp -PrefixLength $PrefixLength

Set-Property -Object $config.adapter -Name interfaceAlias -Value $InterfaceAlias
Set-Property -Object $config.adapter -Name serverIp -Value $ServerIp
Set-Property -Object $config.adapter -Name prefixLength -Value $PrefixLength
Set-Property -Object $config.adapter -Name defaultGateway -Value $dhcpRouter
Set-Property -Object $config.adapter -Name remoteSubnet -Value $remoteSubnet
Set-Property -Object $config.dhcp -Name listenIp -Value $ServerIp
Set-Property -Object $config.dhcp -Name ipxeBootUrl -Value "http://$ServerIp/osdcloud/boot.ipxe"
Set-Property -Object $config.dhcp -Name leaseStartIp -Value $dhcpRange.LeaseStartIp
Set-Property -Object $config.dhcp -Name leaseEndIp -Value $dhcpRange.LeaseEndIp
Set-Property -Object $config.dhcp -Name subnetMask -Value $subnetMask
Set-Property -Object $config.dhcp -Name router -Value $dhcpRouter
$removedReservations = @(Update-DhcpReservationsForPrefix -Config $config -ServerIp $ServerIp -PrefixLength $PrefixLength)
Set-Property -Object $config.tftp -Name listenIp -Value $ServerIp
Set-Property -Object $config.http -Name host -Value $ServerIp
Set-Property -Object $config.smb -Name share -Value $share
if (-not [string]::IsNullOrWhiteSpace($ImageNamePattern)) {
    Set-Property -Object $config.smb -Name imagePath -Value "$share\OSDCloud\OS\$ImageNamePattern"
}

Write-Utf8NoBom -Path $ConfigPath -Content (($config | ConvertTo-Json -Depth 12) + [Environment]::NewLine)
Write-Host "Updated config endpoint: $ServerIp on $InterfaceAlias/$PrefixLength"
if ($removedReservations.Count -gt 0) {
    $removedDescriptions = foreach ($reservation in $removedReservations) {
        $ip = Get-ReservationIp -Reservation $reservation
        $mac = ''
        foreach ($name in @('mac', 'Mac', 'macAddress', 'MacAddress')) {
            $property = $reservation.PSObject.Properties[$name]
            if ($property -and -not [string]::IsNullOrWhiteSpace([string] $property.Value)) {
                $mac = [string] $property.Value
                break
            }
        }
        if ($mac -or $ip) {
            "$mac=>$ip"
        }
    }
    Write-Host "Removed DHCP reservations outside ${ServerIp}/${PrefixLength}: $($removedDescriptions -join ', ')"
}

Set-BootIpxeEndpoint -Path (Join-Path $ipxeLab 'PXE-HttpRoot\osdcloud\boot.ipxe')
Set-AutoexecEndpoint -Path (Join-Path $ipxeLab 'PXE-TFTP\autoexec.ipxe.disabled')
Set-AutoexecEndpoint -Path (Join-Path $ipxeLab 'PXE-TFTP\ipxeboot\x86_64-sb\autoexec.ipxe.disabled')
Set-SetupCompleteEndpoint -Path (Join-Path $ipxeLab 'Config\Scripts\SetupComplete\SetupComplete.ps1')
Set-LegacyHelperDefaults -IpxeLab $ipxeLab -LeaseStartIp $dhcpRange.LeaseStartIp -LeaseEndIp $dhcpRange.LeaseEndIp -SubnetMask $subnetMask -Router $dhcpRouter
Write-Host "Updated live PXE endpoint files under $ipxeLab"

$smbFirewallStatus = 'skipped'
if (-not $SkipSmbFirewall) {
    $smbFirewallStatus = Set-SmbFirewallEndpoint -RuleName $SmbFirewallRuleName -LocalAddress $ServerIp -RemoteSubnet $remoteSubnet
    Write-Host "Updated SMB firewall rule '$SmbFirewallRuleName': local=$ServerIp remote=$remoteSubnet"
}

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

        Copy-IfPresent `
            -Source (Join-Path $repoRoot 'osdcloud-assets\Win11-iPXE-Lab\WinPE\OSDCloud\Start-OSDCloud-iPXE.ps1') `
            -Destination (Join-Path $mountDir 'OSDCloud\Start-OSDCloud-iPXE.ps1') | Out-Null
        Copy-IfPresent `
            -Source (Join-Path $ipxeLab 'Config\Scripts\Shutdown\Invoke-DavisOobe.ps1') `
            -Destination (Join-Path $mountDir 'OSDCloud\Config\Scripts\Shutdown\Invoke-DavisOobe.ps1') | Out-Null
        Copy-IfPresent `
            -Source (Join-Path $ipxeLab 'Config\Scripts\SetupComplete\SetupComplete.cmd') `
            -Destination (Join-Path $mountDir 'OSDCloud\Config\Scripts\SetupComplete\SetupComplete.cmd') | Out-Null
        Copy-IfPresent `
            -Source (Join-Path $ipxeLab 'Config\Scripts\SetupComplete\SetupComplete.ps1') `
            -Destination (Join-Path $mountDir 'OSDCloud\Config\Scripts\SetupComplete\SetupComplete.ps1') | Out-Null

        $deploymentSecretSource = Get-DeploymentSecretSource -RepoRoot $repoRoot -IpxeLab $ipxeLab
        if ($deploymentSecretSource) {
            Copy-Item -LiteralPath $deploymentSecretSource -Destination (Join-Path $mountDir 'OSDCloud\secrets.json') -Force
            Write-Host "Injected local deployment secrets into boot.wim from $deploymentSecretSource"
        }
        else {
            Write-Warning "No local deployment secrets found. Create config\osdcloud-secrets.json before deployment so WinPE can map SMB and configure autologon."
        }

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
        $sourceHash = Get-Sha256Hash -LiteralPath $bootWim
        $publishedHash = Get-Sha256Hash -LiteralPath $publishedBootWim
        if ($sourceHash -ne $publishedHash) {
            Copy-Item -LiteralPath $bootWim -Destination $publishedBootWim -Force
            $publishedHash = Get-Sha256Hash -LiteralPath $publishedBootWim
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
    $syncArgs = @{
        MountWinPe = $true
    }
    if ($HashLargeArtifacts) {
        $syncArgs.HashLargeArtifacts = $true
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
    SmbFirewallRule = $SmbFirewallRuleName
    SmbFirewallStatus = $smbFirewallStatus
    CommitWinPe = [bool] $CommitWinPe
    SyncAssets = [bool] $SyncAssets
} | ConvertTo-Json -Compress
