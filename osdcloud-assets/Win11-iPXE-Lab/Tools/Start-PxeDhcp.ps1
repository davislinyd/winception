param(
    [string] $ServerIp = '192.168.100.1',
    [string] $ClientIp = '192.168.100.100',
    [string] $BootFile = 'ipxeboot/x86_64-sb/snponly.efi',
    [string] $LogPath = 'C:\OSDCloud\Win11-iPXE-Lab\PXE-TFTP\pxe-dhcp.log'
)

$ErrorActionPreference = 'Stop'

function ConvertTo-IPv4Bytes([string] $Address) {
    [System.Net.IPAddress]::Parse($Address).GetAddressBytes()
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
    $Options.Add($Code)
    $Options.Add([byte] $Value.Length)
    foreach ($b in $Value) { $Options.Add($b) }
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

function New-DhcpReply([byte[]] $Request, [byte] $MessageType) {
    $effectiveBootFile = $BootFile
    $isIpxeClient = Test-IpxeClient $Request
    if ($isIpxeClient) {
        $effectiveBootFile = 'http://192.168.100.1/osdcloud/boot.ipxe'
    }

    $reply = New-Object byte[] 240
    $reply[0] = 2
    $reply[1] = $Request[1]
    $reply[2] = $Request[2]
    $reply[3] = 0
    [Array]::Copy($Request, 4, $reply, 4, 4)
    [Array]::Copy($Request, 8, $reply, 8, 4)
    [Array]::Copy((ConvertTo-IPv4Bytes $ClientIp), 0, $reply, 16, 4)
    [Array]::Copy((ConvertTo-IPv4Bytes $ServerIp), 0, $reply, 20, 4)
    [Array]::Copy($Request, 28, $reply, 28, 16)

    $fileBytes = [System.Text.Encoding]::ASCII.GetBytes($effectiveBootFile)
    [Array]::Copy($fileBytes, 0, $reply, 108, [Math]::Min($fileBytes.Length, 127))

    $reply[236] = 99
    $reply[237] = 130
    $reply[238] = 83
    $reply[239] = 99

    $options = [System.Collections.Generic.List[byte]]::new()
    Add-DhcpOption $options 53 ([byte[]] @($MessageType))
    Add-DhcpOption $options 54 (ConvertTo-IPv4Bytes $ServerIp)
    Add-DhcpOption $options 51 ([byte[]] @(0, 0, 14, 16))
    Add-DhcpOption $options 1 (ConvertTo-IPv4Bytes '255.255.255.0')
    Add-DhcpOption $options 3 (ConvertTo-IPv4Bytes $ServerIp)
    Add-DhcpOption $options 6 ([byte[]] ((ConvertTo-IPv4Bytes '1.1.1.1') + (ConvertTo-IPv4Bytes '8.8.8.8')))
    Add-DhcpOption $options 28 (ConvertTo-IPv4Bytes '192.168.100.255')
    if (-not $isIpxeClient) {
        Add-DhcpOption $options 43 (New-PxeVendorOption)
    }
    $options.Add(255)

    $packet = New-Object byte[] ($reply.Length + $options.Count)
    [Array]::Copy($reply, 0, $packet, 0, $reply.Length)
    [Array]::Copy($options.ToArray(), 0, $packet, $reply.Length, $options.Count)
    return $packet
}

New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force | Out-Null
"$(Get-Date -Format o) DHCP responder starting on $ServerIp for $ClientIp -> $BootFile" | Add-Content -LiteralPath $LogPath -Encoding ASCII

$socket = [System.Net.Sockets.Socket]::new([System.Net.Sockets.AddressFamily]::InterNetwork, [System.Net.Sockets.SocketType]::Dgram, [System.Net.Sockets.ProtocolType]::Udp)
$socket.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]::ReuseAddress, $true)
$socket.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]::Broadcast, $true)
$socket.Bind([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse($ServerIp), 67))

$buffer = New-Object byte[] 1500
$remote = [System.Net.EndPoint] [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, 0)
$broadcastAddressBytes = ConvertTo-IPv4Bytes $ServerIp
$broadcastAddressBytes[3] = 255
$broadcastTargets = @(
    [System.Net.IPEndPoint]::new([System.Net.IPAddress]::new($broadcastAddressBytes), 68),
    [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse('255.255.255.255'), 68)
)

try {
    while ($true) {
        $received = $socket.ReceiveFrom($buffer, [ref] $remote)
        if ($received -lt 240) { continue }

        $packet = New-Object byte[] $received
        [Array]::Copy($buffer, 0, $packet, 0, $received)
        $msgType = Get-DhcpMessageType $packet
        $mac = (($packet[28..33] | ForEach-Object { $_.ToString('X2') }) -join '-')
        $logBootFile = if (Test-IpxeClient $packet) { 'http://192.168.100.1/osdcloud/boot.ipxe' } else { $BootFile }

        if ($msgType -eq 1) {
            $reply = New-DhcpReply $packet 2
            foreach ($target in $broadcastTargets) { [void] $socket.SendTo($reply, $target) }
            "$(Get-Date -Format o) OFFER $ClientIp to $mac boot=$logBootFile" | Add-Content -LiteralPath $LogPath -Encoding ASCII
        }
        elseif ($msgType -eq 3) {
            $reply = New-DhcpReply $packet 5
            foreach ($target in $broadcastTargets) { [void] $socket.SendTo($reply, $target) }
            "$(Get-Date -Format o) ACK $ClientIp to $mac boot=$logBootFile" | Add-Content -LiteralPath $LogPath -Encoding ASCII
        }
        else {
            "$(Get-Date -Format o) IGNORE type=$msgType from $mac" | Add-Content -LiteralPath $LogPath -Encoding ASCII
        }
    }
}
finally {
    $socket.Dispose()
}
