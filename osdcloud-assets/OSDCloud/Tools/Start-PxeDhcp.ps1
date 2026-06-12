param(
    [string] $ServerIp = '192.168.77.1',
    [string] $ClientIp = '',
    [string] $LeaseStartIp = '192.168.77.200',
    [string] $LeaseEndIp = '192.168.77.250',
    [string] $SubnetMask = '255.255.255.0',
    [string] $Router = '192.168.77.1',
    [string[]] $DnsServers = @('1.1.1.1', '8.8.8.8'),
    [string] $BootFile = 'ipxeboot/x86_64-sb/snponly.efi',
    [string] $IpxeBootUrl = '',
    [int] $LeaseSeconds = 3600,
    [string] $LogPath = 'C:\OSDCloud\PXE-TFTP\pxe-dhcp.log'
)

$ErrorActionPreference = 'Stop'

function Write-Log([string] $Message) {
    $line = "$(Get-Date -Format o) $Message"
    $line | Add-Content -LiteralPath $LogPath -Encoding ASCII
    Write-Host $line
}

if (-not [string]::IsNullOrWhiteSpace($ClientIp)) {
    $LeaseStartIp = $ClientIp
    $LeaseEndIp = $ClientIp
}

if ([string]::IsNullOrWhiteSpace($IpxeBootUrl)) {
    $IpxeBootUrl = "http://$ServerIp/osdcloud/boot.ipxe"
}

function ConvertTo-IPv4Bytes([string] $Address) {
    [System.Net.IPAddress]::Parse($Address).GetAddressBytes()
}

function ConvertTo-IPv4UInt32([string] $Address) {
    $bytes = ConvertTo-IPv4Bytes $Address
    if ([BitConverter]::IsLittleEndian) {
        [Array]::Reverse($bytes)
    }
    [BitConverter]::ToUInt32($bytes, 0)
}

function ConvertFrom-IPv4UInt32([uint32] $Value) {
    $bytes = [BitConverter]::GetBytes($Value)
    if ([BitConverter]::IsLittleEndian) {
        [Array]::Reverse($bytes)
    }
    [System.Net.IPAddress]::new($bytes).ToString()
}

function ConvertTo-UInt32Bytes([uint32] $Value) {
    $bytes = [BitConverter]::GetBytes($Value)
    if ([BitConverter]::IsLittleEndian) {
        [Array]::Reverse($bytes)
    }
    $bytes
}

function Get-BroadcastAddress([string] $Address, [string] $Mask) {
    $addressValue = ConvertTo-IPv4UInt32 $Address
    $maskValue = ConvertTo-IPv4UInt32 $Mask
    $networkValue = $addressValue -band $maskValue
    $wildcardValue = (-bnot $maskValue) -band [uint32]::MaxValue
    ConvertFrom-IPv4UInt32 ([uint32] ($networkValue -bor $wildcardValue))
}

function Get-DhcpMessageType([byte[]] $Packet) {
    $i = 240
    while ($i -lt $Packet.Length) {
        $code = $Packet[$i]
        if ($code -eq 255) { break }
        if ($code -eq 0) { $i++; continue }
        if ($i + 1 -ge $Packet.Length) { break }
        $len = $Packet[$i + 1]
        if ($code -eq 53 -and $len -ge 1) {
            return $Packet[$i + 2]
        }
        $i += 2 + $len
    }
    return 0
}

function Get-DhcpOptionValue([byte[]] $Packet, [byte] $OptionCode) {
    $i = 240
    while ($i -lt $Packet.Length) {
        $code = $Packet[$i]
        if ($code -eq 255) { break }
        if ($code -eq 0) { $i++; continue }
        if ($i + 1 -ge $Packet.Length) { break }
        $len = $Packet[$i + 1]
        if ($i + 2 + $len -gt $Packet.Length) { break }
        if ($code -eq $OptionCode) {
            $value = New-Object byte[] $len
            [Array]::Copy($Packet, $i + 2, $value, 0, $len)
            return $value
        }
        $i += 2 + $len
    }
    return $null
}

function Get-RequestedIp([byte[]] $Packet) {
    $value = Get-DhcpOptionValue $Packet 50
    if ($null -eq $value -or $value.Length -ne 4) {
        return $null
    }
    [System.Net.IPAddress]::new($value).ToString()
}

function Get-ClientMac([byte[]] $Packet) {
    $hardwareLength = [Math]::Max(1, [Math]::Min([int] $Packet[2], 16))
    (($Packet[28..(27 + $hardwareLength)] | ForEach-Object { $_.ToString('X2') }) -join '-')
}

function Test-IpxeClient([byte[]] $Packet) {
    if ($null -ne (Get-DhcpOptionValue $Packet 175)) {
        return $true
    }

    foreach ($optionCode in 60, 77) {
        $value = Get-DhcpOptionValue $Packet ([byte] $optionCode)
        if ($null -ne $value) {
            $text = [System.Text.Encoding]::ASCII.GetString($value)
            if ($text -match 'iPXE') {
                return $true
            }
        }
    }

    return $false
}

function Add-DhcpOption([System.Collections.Generic.List[byte]] $Options, [byte] $Code, [byte[]] $Value) {
    if ($Value.Length -gt 255) {
        throw "DHCP option $Code is too long: $($Value.Length) bytes"
    }

    $Options.Add($Code)
    $Options.Add([byte] $Value.Length)
    foreach ($b in $Value) { $Options.Add($b) }
}

function Get-DnsOptionBytes {
    $bytes = [System.Collections.Generic.List[byte]]::new()
    foreach ($dns in $DnsServers) {
        foreach ($b in (ConvertTo-IPv4Bytes $dns)) {
            $bytes.Add($b)
        }
    }
    $bytes.ToArray()
}

function New-PxeVendorOption {
    $pxe = [System.Collections.Generic.List[byte]]::new()

    function Add-PxeSubOption([System.Collections.Generic.List[byte]] $Options, [byte] $Code, [byte[]] $Value) {
        $Options.Add($Code)
        $Options.Add([byte] $Value.Length)
        foreach ($b in $Value) { $Options.Add($b) }
    }

    $serverBytes = ConvertTo-IPv4Bytes $ServerIp
    $menuText = [System.Text.Encoding]::ASCII.GetBytes('iPXE')
    $promptText = [System.Text.Encoding]::ASCII.GetBytes('Boot iPXE')

    Add-PxeSubOption $pxe 6 ([byte[]] @(7))
    Add-PxeSubOption $pxe 8 ([byte[]] (@(0, 0, 1) + $serverBytes))
    Add-PxeSubOption $pxe 9 ([byte[]] (@(0, 0, [byte] $menuText.Length) + $menuText))
    Add-PxeSubOption $pxe 10 ([byte[]] (@(0) + $promptText))
    $pxe.Add(255)

    return $pxe.ToArray()
}

$leaseStartValue = ConvertTo-IPv4UInt32 $LeaseStartIp
$leaseEndValue = ConvertTo-IPv4UInt32 $LeaseEndIp
if ($leaseEndValue -lt $leaseStartValue) {
    throw "LeaseEndIp must be greater than or equal to LeaseStartIp: $LeaseStartIp - $LeaseEndIp"
}

$script:LeasesByMac = @{}

function Test-IpInPool([string] $Address) {
    if ([string]::IsNullOrWhiteSpace($Address)) {
        return $false
    }

    $value = ConvertTo-IPv4UInt32 $Address
    return ($value -ge $leaseStartValue -and $value -le $leaseEndValue)
}

function Test-IpAlreadyLeased([string] $Address, [string] $RequestMac) {
    foreach ($entry in $script:LeasesByMac.GetEnumerator()) {
        if ($entry.Key -ne $RequestMac -and $entry.Value -eq $Address) {
            return $true
        }
    }
    return $false
}

function Get-LeaseIp([string] $Mac, [string] $RequestedIp) {
    if ($script:LeasesByMac.ContainsKey($Mac)) {
        return $script:LeasesByMac[$Mac]
    }

    if ((Test-IpInPool $RequestedIp) -and -not (Test-IpAlreadyLeased $RequestedIp $Mac)) {
        $script:LeasesByMac[$Mac] = $RequestedIp
        return $RequestedIp
    }

    for ($candidate = $leaseStartValue; $candidate -le $leaseEndValue; $candidate++) {
        $candidateIp = ConvertFrom-IPv4UInt32 ([uint32] $candidate)
        if (-not (Test-IpAlreadyLeased $candidateIp $Mac)) {
            $script:LeasesByMac[$Mac] = $candidateIp
            return $candidateIp
        }
    }

    throw "No available leases in $LeaseStartIp-$LeaseEndIp"
}

function New-DhcpReply([byte[]] $Request, [byte] $MessageType, [string] $AssignedIp, [string] $EffectiveBootFile, [bool] $IsIpxeClient) {
    $reply = New-Object byte[] 240
    $reply[0] = 2
    $reply[1] = $Request[1]
    $reply[2] = $Request[2]
    $reply[3] = 0
    [Array]::Copy($Request, 4, $reply, 4, 4)
    [Array]::Copy($Request, 8, $reply, 8, 4)
    [Array]::Copy((ConvertTo-IPv4Bytes $AssignedIp), 0, $reply, 16, 4)
    [Array]::Copy((ConvertTo-IPv4Bytes $ServerIp), 0, $reply, 20, 4)
    [Array]::Copy($Request, 28, $reply, 28, 16)

    $fileBytes = [System.Text.Encoding]::ASCII.GetBytes($EffectiveBootFile)
    [Array]::Copy($fileBytes, 0, $reply, 108, [Math]::Min($fileBytes.Length, 128))

    $reply[236] = 99
    $reply[237] = 130
    $reply[238] = 83
    $reply[239] = 99

    $options = [System.Collections.Generic.List[byte]]::new()
    Add-DhcpOption $options 53 ([byte[]] @($MessageType))
    Add-DhcpOption $options 54 (ConvertTo-IPv4Bytes $ServerIp)
    Add-DhcpOption $options 51 (ConvertTo-UInt32Bytes ([uint32] $LeaseSeconds))
    Add-DhcpOption $options 1 (ConvertTo-IPv4Bytes $SubnetMask)
    Add-DhcpOption $options 3 (ConvertTo-IPv4Bytes $Router)
    Add-DhcpOption $options 6 (Get-DnsOptionBytes)
    Add-DhcpOption $options 28 (ConvertTo-IPv4Bytes (Get-BroadcastAddress $ServerIp $SubnetMask))
    Add-DhcpOption $options 66 ([System.Text.Encoding]::ASCII.GetBytes($ServerIp))
    Add-DhcpOption $options 67 ([System.Text.Encoding]::ASCII.GetBytes($EffectiveBootFile))
    if (-not $IsIpxeClient) {
        Add-DhcpOption $options 43 (New-PxeVendorOption)
    }
    $options.Add(255)

    $packet = New-Object byte[] ($reply.Length + $options.Count)
    [Array]::Copy($reply, 0, $packet, 0, $reply.Length)
    [Array]::Copy($options.ToArray(), 0, $packet, $reply.Length, $options.Count)
    return $packet
}

New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force | Out-Null
$dnsText = $DnsServers -join ','
Write-Log "DHCP responder starting on $ServerIp leases=$LeaseStartIp-$LeaseEndIp router=$Router dns=$dnsText boot=$BootFile ipxe=$IpxeBootUrl"

$socket = [System.Net.Sockets.Socket]::new([System.Net.Sockets.AddressFamily]::InterNetwork, [System.Net.Sockets.SocketType]::Dgram, [System.Net.Sockets.ProtocolType]::Udp)
$socket.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]::ReuseAddress, $true)
$socket.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]::Broadcast, $true)
$socket.Bind([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse($ServerIp), 67))

$buffer = New-Object byte[] 1500
$remote = [System.Net.EndPoint] [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, 0)
$broadcastTargets = @(
    [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse((Get-BroadcastAddress $ServerIp $SubnetMask)), 68),
    [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse('255.255.255.255'), 68)
)

try {
    while ($true) {
        $received = $socket.ReceiveFrom($buffer, [ref] $remote)
        if ($received -lt 240) { continue }

        $packet = New-Object byte[] $received
        [Array]::Copy($buffer, 0, $packet, 0, $received)
        $msgType = Get-DhcpMessageType $packet
        $mac = Get-ClientMac $packet
        $requestedIp = Get-RequestedIp $packet
        $isIpxeClient = Test-IpxeClient $packet
        $effectiveBootFile = if ($isIpxeClient) { $IpxeBootUrl } else { $BootFile }

        if ($msgType -eq 1) {
            try {
                $assignedIp = Get-LeaseIp -Mac $mac -RequestedIp $requestedIp
                $reply = New-DhcpReply $packet 2 $assignedIp $effectiveBootFile $isIpxeClient
                foreach ($target in $broadcastTargets) { [void] $socket.SendTo($reply, $target) }
                Write-Log "OFFER $assignedIp to $mac requested=$requestedIp boot=$effectiveBootFile"
            }
            catch {
                Write-Log "ERROR type=DISCOVER from $mac requested=$requestedIp message=$($_.Exception.Message)"
            }
        }
        elseif ($msgType -eq 3) {
            try {
                $assignedIp = Get-LeaseIp -Mac $mac -RequestedIp $requestedIp
                $reply = New-DhcpReply $packet 5 $assignedIp $effectiveBootFile $isIpxeClient
                foreach ($target in $broadcastTargets) { [void] $socket.SendTo($reply, $target) }
                Write-Log "ACK $assignedIp to $mac requested=$requestedIp boot=$effectiveBootFile"
            }
            catch {
                Write-Log "ERROR type=REQUEST from $mac requested=$requestedIp message=$($_.Exception.Message)"
            }
        }
        else {
            Write-Log "IGNORE type=$msgType from $mac requested=$requestedIp"
        }
    }
}
finally {
    $socket.Dispose()
}
