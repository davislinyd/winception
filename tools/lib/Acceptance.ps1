function Get-AcceptanceMac([string]$Mac) {
    $normalized=$Mac -replace '[-:]',''
    if ($normalized -notmatch '^[A-Fa-f0-9]{12}$') {throw 'Invalid client MAC'}
    ($normalized.ToUpper() -replace '(.{2})(?!$)','$1-')
}
function Get-AcceptanceIpv4Value([string]$Address) {
    $parsed=$null
    if($Address -notmatch '^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$' -or -not [Net.IPAddress]::TryParse($Address,[ref]$parsed) -or $parsed.AddressFamily -ne 'InterNetwork'){throw 'Canonical IPv4 address required'}
    $bytes=$parsed.GetAddressBytes()
    [uint64]$bytes[0]*16777216+[uint64]$bytes[1]*65536+[uint64]$bytes[2]*256+[uint64]$bytes[3]
}
function Assert-AcceptanceConfig {
    param($Config,[string]$Scenario)
    Get-AcceptanceMac $Config.client.mac|Out-Null
    if ($Config.client.machineId -notmatch '^[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$' -or -not $Config.client.name -or $Config.client.disposableConfirmed -ne $true) {throw 'Disposable client identity and confirmation required'}
    if ($Config.host.computerName -ne $env:COMPUTERNAME -or $Config.stateRoot -ne 'C:\OSDCloud\HostTools\State') {throw 'Deployment host/State mismatch'}
    if ($Config.webBase -notmatch '^http://127\.0\.0\.1:\d+$' -or $Config.schemaVersion -ne 1) {throw 'Local Console and supported schema required'}
    if ($Scenario -notin @('ExistingDhcp','WinceptionDhcp','LaptopNat')) {throw 'Invalid scenario'}
    foreach($value in @($Config.expected.gateway,$Config.expected.dhcpServer)+@($Config.expected.dnsServers)) {
        $parsed=$null
        if(-not [Net.IPAddress]::TryParse($value,[ref]$parsed) -or $parsed.AddressFamily -ne 'InterNetwork') {throw 'Expected IPv4 network values required'}
    }
    if ($Config.expected.subnet -notmatch '^\d+\.\d+\.\d+\.\d+/\d+$' -or $Config.expected.prefixLength -lt 1 -or $Config.expected.prefixLength -gt 30 -or -not $Config.expected.dnsServers.Count) {throw 'Expected subnet/prefix/DNS required'}
    $base,$prefix=$Config.expected.subnet.Split('/')
    $parsed=$null
    if(-not [Net.IPAddress]::TryParse($base,[ref]$parsed) -or $parsed.AddressFamily -ne 'InterNetwork' -or [int]$prefix -ne $Config.expected.prefixLength){throw 'Subnet and prefix differ'}
    $service=$null
    if(-not [Net.IPAddress]::TryParse($Config.host.serviceIp,[ref]$service) -or $service.AddressFamily -ne 'InterNetwork'){throw 'IPv4 service address required'}
    if($Scenario -ne 'ExistingDhcp' -and $Config.expected.dhcpServer -ne $Config.host.serviceIp){throw 'Winception DHCP must match the service address'}
    $network=Get-AcceptanceIpv4Value $base
    $size=[uint64][Math]::Pow(2,32-$Config.expected.prefixLength)
    if($network % $size -ne 0){throw 'Subnet must be a network address'}
    foreach($address in @($Config.host.serviceIp,$Config.expected.gateway,$Config.expected.dhcpServer)){
        $value=Get-AcceptanceIpv4Value $address
        if($value -le $network -or $value -ge $network+$size-1){throw 'Service DHCP and gateway must be usable addresses in the client subnet'}
    }
    if($Scenario -ne 'ExistingDhcp'){
        $start=Get-AcceptanceIpv4Value $Config.leaseStartIp;$end=Get-AcceptanceIpv4Value $Config.leaseEndIp
        if($start -gt $end -or $start -le $network -or $end -ge $network+$size-1){throw 'Lease pool must be usable and ordered within the subnet'}
        foreach($address in @($Config.host.serviceIp,$Config.expected.gateway)){
            $value=Get-AcceptanceIpv4Value $address
            if($value -ge $start -and $value -le $end){throw 'Lease pool must exclude service and gateway addresses'}
        }
    }
    if ($Config.probeHost -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]+$') {throw 'Probe must be a DNS host, without URL or credentials'}
    if ([int]$Config.collectorPort -lt 1024 -or [int]$Config.collectorPort -gt 65535) {throw 'Invalid collector port'}
    if ($Scenario -ne 'ExistingDhcp' -and ($Config.dhcpClearConfirmed -ne $true -or [DateTime]$Config.testWindowExpiresAt -le [DateTime]::UtcNow)) {throw 'Confirmed DHCP-free test window required'}
    if ($Scenario -eq 'LaptopNat' -and (!$Config.host.wanInterface -or !$Config.host.clientInterface -or $Config.host.wanInterface -eq $Config.host.clientInterface)) {throw 'Distinct WAN and client NICs required'}
    if($Scenario -eq 'LaptopNat' -and $Config.host.serviceInterface -ne $Config.host.clientInterface){throw 'NAT service interface must be the client interface'}
    $required=@($Config.host.serviceInterface)
    if($Scenario -eq 'LaptopNat') {$required=@($Config.host.wanInterface,$Config.host.clientInterface)}
    foreach($alias in $required) {
        $adapter=Get-NetAdapter -Name $alias -ErrorAction Stop
        if ($adapter.HardwareInterface -ne $true -or $adapter.Status -eq 'Not Present') {throw 'Required present physical adapter missing'}
    }
}
function New-AcceptanceStateBackup([string]$StateRoot) {
    $backup=Join-Path (Split-Path -Parent $StateRoot) ('Backups\HostTools-State-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff'))
    # Same protected State copy flow as HostTools installation. Refuse before stopping anything on ACL failure.
    New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force|Out-Null
    Copy-Item -LiteralPath $StateRoot -Destination $backup -Recurse -Force -ErrorAction Stop
    $backup
}
function Invoke-AcceptanceApi {
    param([string]$Method='GET',[string]$Path,$Body=$null,[int]$TimeoutSec=900)
    $headers=@{}
    $status=Invoke-RestMethod "$script:AcceptanceWeb/api/auth/status" -TimeoutSec 30
    if ($status.required) {
        $token=Get-Content (Join-Path $script:AcceptanceStateRoot 'config\web-console-token.json') -Raw|ConvertFrom-Json
        $headers['X-Winception-Token']=$token.token
    }
    $args=@{Uri="$script:AcceptanceWeb$Path";Method=$Method;Headers=$headers;TimeoutSec=$TimeoutSec;ErrorAction='Stop'}
    if($Method -eq 'POST') {$args.ContentType='application/json';$args.Body=if($null -eq $Body){'{}'}else{$Body|ConvertTo-Json -Depth 12}}
    Invoke-RestMethod @args
}
function Stop-AcceptanceServices {
    $response=Invoke-AcceptanceApi -Method POST -Path '/api/services/stop-all'
    if(-not $response.state.services -or @($response.state.services.psobject.Properties|Where-Object {$_.Value.running}).Count){throw 'Test services did not stop completely'}
}
function Get-DhcpOfferServer {
    param([byte[]]$Packet,[byte[]]$Transaction)
    if($Packet.Length -lt 268) {return}
    $header=($Packet[0] -band 15)*4
    if($header -lt 20 -or $Packet.Length -lt $header+248 -or $Packet[9] -ne 17 -or
        ($Packet[$header]*256+$Packet[$header+1]) -ne 67 -or ($Packet[$header+2]*256+$Packet[$header+3]) -ne 68) {return}
    $offset=$header+8
    if($Packet[$offset] -ne 2 -or ($Packet[($offset+236)..($offset+239)] -join ',') -ne '99,130,83,99'){return}
    if(($Packet[($offset+4)..($offset+7)] -join ',') -ne ($Transaction -join ',')) {return}
    $cursor=$offset+240;$server=$null;$offer=$false
    while($cursor -lt $Packet.Length) {
        $code=$Packet[$cursor++];if($code -eq 255){break};if($code -eq 0){continue}
        if($cursor -ge $Packet.Length){return};$length=$Packet[$cursor++];if($cursor+$length -gt $Packet.Length){return}
        if($code -eq 54 -and $length -eq 4) {$server=$Packet[$cursor..($cursor+3)] -join '.'}
        if($code -eq 53 -and $length -eq 1 -and $Packet[$cursor] -eq 2){$offer=$true}
        $cursor+=$length
    }
    if($offer){$server}
}
function Find-AcceptanceDhcpServers {
    param([string]$ServiceIp,[string]$ClientMac)
    $servers=New-Object 'System.Collections.Generic.HashSet[string]'
    $receive=New-Object Net.Sockets.Socket([Net.Sockets.AddressFamily]::InterNetwork,[Net.Sockets.SocketType]::Raw,[Net.Sockets.ProtocolType]::IP)
    $send=New-Object Net.Sockets.UdpClient
    try {
        $receive.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Parse($ServiceIp),0));$receive.ReceiveTimeout=250
        $receive.IOControl([Net.Sockets.IOControlCode]::ReceiveAll,[byte[]](1,0,0,0),[byte[]](0,0,0,0))|Out-Null
        $send.Client.SetSocketOption([Net.Sockets.SocketOptionLevel]::Socket,[Net.Sockets.SocketOptionName]::ReuseAddress,$true)
        $send.Client.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Parse($ServiceIp),68));$send.EnableBroadcast=$true
        foreach($attempt in 1..2) {
            $packet=New-Object byte[] 244;$packet[0]=1;$packet[1]=1;$packet[2]=6;$packet[10]=128
            $transaction=New-Object byte[] 4;([Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($transaction);$transaction.CopyTo($packet,4)
            $macBytes=([string]$ClientMac -split '[-:]'|ForEach-Object {[Convert]::ToByte($_,16)});[byte[]]$macBytes|ForEach-Object -Begin {$i=28} -Process {$packet[$i++]=$_}
            ([byte[]](99,130,83,99,53,1,1,255)).CopyTo($packet,236)
            $send.Send($packet,$packet.Length,[Net.IPEndPoint]::new([Net.IPAddress]::Broadcast,67))|Out-Null
            $deadline=[DateTime]::UtcNow.AddSeconds(5)
            do {try {$buffer=New-Object byte[] 4096;$count=$receive.Receive($buffer);$server=Get-DhcpOfferServer -Packet $buffer[0..($count-1)] -Transaction $transaction;if($server){$servers.Add($server)|Out-Null}}catch [Net.Sockets.SocketException] {}}while([DateTime]::UtcNow -lt $deadline)
        }
    } finally {$receive.Dispose();$send.Dispose()}
    @($servers)
}
function Test-AcceptanceNetwork($Report,$Expected) {
    if(!$Report.dns -or !$Report.https -or $Report.network.gateway -ne $Expected.gateway -or $Report.network.dhcpServer -ne $Expected.dhcpServer -or $Report.network.prefixLength -ne $Expected.prefixLength) {return $false}
    $ip=[Net.IPAddress]::Parse($Report.network.ip).GetAddressBytes();$subnet=[Net.IPAddress]::Parse($Expected.subnet.Split('/')[0]).GetAddressBytes()
    $bits=[int]$Expected.prefixLength
    foreach($index in 0..3){$count=[Math]::Min(8,[Math]::Max(0,$bits-$index*8));$mask=if($count -eq 0){0}else{(255 -shl (8-$count)) -band 255};if(($ip[$index] -band $mask) -ne ($subnet[$index] -band $mask)){return $false}}
    ((@($Report.network.dnsServers)|Sort-Object) -join ',') -eq ((@($Expected.dnsServers)|Sort-Object) -join ',')
}
