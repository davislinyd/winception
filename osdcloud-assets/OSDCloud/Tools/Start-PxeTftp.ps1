param(
    [string] $Root = 'C:\OSDCloud\PXE-TFTP',
    [string] $ListenIp = '192.168.88.1',
    [int] $Port = 69,
    [string] $LogPath = 'C:\OSDCloud\PXE-TFTP\pxe-tftp.log'
)

$ErrorActionPreference = 'Stop'

function Write-Log([string] $Message) {
    $line = "$(Get-Date -Format o) $Message"
    $line | Add-Content -LiteralPath $LogPath -Encoding ASCII
    Write-Host $line
}

function New-TftpPacket([int] $OpCode, [byte[]] $Payload) {
    $packet = New-Object byte[] (2 + $Payload.Length)
    $packet[0] = [byte] (($OpCode -shr 8) -band 0xff)
    $packet[1] = [byte] ($OpCode -band 0xff)
    if ($Payload.Length -gt 0) {
        [Array]::Copy($Payload, 0, $packet, 2, $Payload.Length)
    }
    return $packet
}

function New-TftpStringPayload([string[]] $Parts) {
    $bytes = [System.Collections.Generic.List[byte]]::new()
    foreach ($part in $Parts) {
        foreach ($b in [System.Text.Encoding]::ASCII.GetBytes($part)) {
            $bytes.Add($b)
        }
        $bytes.Add(0)
    }
    return $bytes.ToArray()
}

function Send-TftpError([System.Net.Sockets.UdpClient] $Client, [System.Net.IPEndPoint] $Endpoint, [int] $Code, [string] $Message) {
    $payload = New-Object byte[] (2 + $Message.Length + 1)
    $payload[0] = [byte] (($Code -shr 8) -band 0xff)
    $payload[1] = [byte] ($Code -band 0xff)
    [Array]::Copy([System.Text.Encoding]::ASCII.GetBytes($Message), 0, $payload, 2, $Message.Length)
    $packet = New-TftpPacket 5 $payload
    [void] $Client.Send($packet, $packet.Length, $Endpoint)
}

function Get-TftpRequest([byte[]] $Packet) {
    if ($Packet.Length -lt 4) { return $null }
    $op = ($Packet[0] -shl 8) -bor $Packet[1]
    if ($op -ne 1) { return $null }

    $parts = [System.Collections.Generic.List[string]]::new()
    $start = 2
    for ($i = 2; $i -lt $Packet.Length; $i++) {
        if ($Packet[$i] -eq 0) {
            $parts.Add([System.Text.Encoding]::ASCII.GetString($Packet, $start, $i - $start))
            $start = $i + 1
        }
    }

    if ($parts.Count -lt 2) { return $null }
    $options = @{}
    for ($i = 2; $i + 1 -lt $parts.Count; $i += 2) {
        $options[$parts[$i].ToLowerInvariant()] = $parts[$i + 1]
    }

    [pscustomobject]@{
        FileName = $parts[0]
        Mode = $parts[1]
        Options = $options
    }
}

function Resolve-TftpPath([string] $RootPath, [string] $RequestPath) {
    $relative = $RequestPath.Replace('\', '/').TrimStart('/')
    if ($relative -match '(^|/)\.\.(/|$)' -or $relative -match ':') {
        return $null
    }

    $rootFull = [System.IO.Path]::GetFullPath($RootPath)
    $fileFull = [System.IO.Path]::GetFullPath((Join-Path $rootFull $relative))
    if (-not $fileFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    return $fileFull
}

function Receive-Ack([System.Net.Sockets.UdpClient] $Client, [System.Net.IPEndPoint] $ExpectedEndpoint, [int] $ExpectedBlock) {
    $remote = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, 0)
    $packet = $Client.Receive([ref] $remote)
    if ($remote.Address.ToString() -ne $ExpectedEndpoint.Address.ToString() -or $remote.Port -ne $ExpectedEndpoint.Port) {
        return $false
    }
    if ($packet.Length -lt 4) { return $false }
    $op = ($packet[0] -shl 8) -bor $packet[1]
    $block = ($packet[2] -shl 8) -bor $packet[3]
    return ($op -eq 4 -and $block -eq ($ExpectedBlock -band 0xffff))
}

function Send-TftpFile([string] $FilePath, [hashtable] $Options, [System.Net.IPEndPoint] $Endpoint, [System.Net.Sockets.UdpClient] $Client) {
    $file = Get-Item -LiteralPath $FilePath
    if ($file.Extension -ieq '.ipxe') {
        $Options = @{}
    }

    $blockSize = 512
    if ($Options.ContainsKey('blksize')) {
        $requestedBlockSize = 0
        if ([int]::TryParse([string] $Options['blksize'], [ref] $requestedBlockSize)) {
            $blockSize = [Math]::Max(8, [Math]::Min($requestedBlockSize, 1468))
        }
    }

    $originalTimeout = $Client.Client.ReceiveTimeout
    $Client.Client.ReceiveTimeout = 3000
    try {
        $oackParts = [System.Collections.Generic.List[string]]::new()
        if ($Options.ContainsKey('tsize')) {
            $oackParts.Add('tsize')
            $oackParts.Add([string] $file.Length)
        }
        if ($Options.ContainsKey('blksize')) {
            $oackParts.Add('blksize')
            $oackParts.Add([string] $blockSize)
        }

        if ($oackParts.Count -gt 0) {
            $oack = New-TftpPacket 6 (New-TftpStringPayload $oackParts.ToArray())
            $acked = $false
            for ($attempt = 1; $attempt -le 6 -and -not $acked; $attempt++) {
                [void] $Client.Send($oack, $oack.Length, $Endpoint)
                try {
                    $acked = Receive-Ack $Client $Endpoint 0
                }
                catch [System.Net.Sockets.SocketException] {
                    $acked = $false
                }
            }
            if (-not $acked) {
                Write-Log "OACK not acknowledged by $($Endpoint.Address):$($Endpoint.Port) for $($file.Name)"
                return
            }
        }

        $buffer = New-Object byte[] $blockSize
        $stream = [System.IO.File]::OpenRead($file.FullName)
        try {
            $block = 1
            do {
                $read = $stream.Read($buffer, 0, $buffer.Length)
                $payload = New-Object byte[] (2 + $read)
                $payload[0] = [byte] (($block -shr 8) -band 0xff)
                $payload[1] = [byte] ($block -band 0xff)
                if ($read -gt 0) {
                    [Array]::Copy($buffer, 0, $payload, 2, $read)
                }
                $data = New-TftpPacket 3 $payload

                $acked = $false
                for ($attempt = 1; $attempt -le 8 -and -not $acked; $attempt++) {
                    [void] $Client.Send($data, $data.Length, $Endpoint)
                    try {
                        $acked = Receive-Ack $Client $Endpoint $block
                    }
                    catch [System.Net.Sockets.SocketException] {
                        $acked = $false
                    }
                }

                if (-not $acked) {
                    Write-Log "DATA block $block not acknowledged by $($Endpoint.Address):$($Endpoint.Port) for $($file.Name)"
                    return
                }

                $block = ($block + 1) -band 0xffff
            } while ($read -eq $blockSize)
        }
        finally {
            $stream.Dispose()
        }

        Write-Log "SENT $($file.Name) bytes=$($file.Length) blockSize=$blockSize to $($Endpoint.Address):$($Endpoint.Port)"
    }
    finally {
        $Client.Client.ReceiveTimeout = $originalTimeout
    }
}

New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force | Out-Null
Write-Log "TFTP responder starting on ${ListenIp}:$Port root=$Root"

$server = [System.Net.Sockets.UdpClient]::new([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse($ListenIp), $Port))
try {
    while ($true) {
        $remote = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, 0)
        $packet = $server.Receive([ref] $remote)
        $request = Get-TftpRequest $packet
        if ($null -eq $request) {
            continue
        }

        $path = Resolve-TftpPath $Root $request.FileName
        if ($null -eq $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
            Write-Log "MISS $($request.FileName) from $($remote.Address):$($remote.Port)"
            Send-TftpError $server $remote 1 'File not found'
            continue
        }

        Write-Log "RRQ $($request.FileName) from $($remote.Address):$($remote.Port)"
        Send-TftpFile $path $request.Options $remote $server
    }
}
finally {
    $server.Dispose()
}
