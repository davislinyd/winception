param([Parameter(Mandatory)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$headers = @{Authorization = "Bearer $($cfg.ticket)"}
$taskName = "Winception-Acceptance-$($cfg.testRunId)"
$cleaned = $false
function Clear-TestLogin {
    $key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    foreach ($name in @('DefaultPassword','AutoAdminLogon','ForceAutoLogon','AutoLogonCount')) { Remove-ItemProperty -LiteralPath $key -Name $name -ErrorAction SilentlyContinue }
}
function Send-Report([string]$Phase) {
    $adapter = Get-NetAdapter | Where-Object { ($_.MacAddress -replace '[-:]','') -eq ($cfg.clientMac -replace '[-:]','') } | Select-Object -First 1
    if (-not $adapter) { throw 'Expected client adapter missing' }
    $ip = Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '169.254.*'} | Select-Object -First 1
    $net = Get-NetIPConfiguration -InterfaceIndex $adapter.ifIndex
    $dhcp = (Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$($adapter.InterfaceGuid)").DhcpServer
    $dns = $false; $https = $false
    try { $dns = @(Resolve-DnsName $cfg.probeHost -DnsOnly -QuickTimeout -ErrorAction Stop).Count -gt 0 } catch {}
    try { $response = Invoke-WebRequest "https://$($cfg.probeHost)/" -UseBasicParsing -TimeoutSec 30; $https = $response.StatusCode -ge 200 -and $response.StatusCode -lt 400 } catch {}
    $status = Get-Content 'C:\ProgramData\OSDCloud\DeploymentStatus.json' -Raw | ConvertFrom-Json
    $body = @{testRunId=$cfg.testRunId;clientMac=$cfg.clientMac;machineId=(Get-CimInstance Win32_ComputerSystemProduct).UUID;
        runId=$status.runId;bootId=$status.bootId;phase=$Phase;nonce=[guid]::NewGuid().ToString('N');dns=$dns;https=$https;
        network=@{ip=$ip.IPAddress;prefixLength=$ip.PrefixLength;gateway=[string]$net.IPv4DefaultGateway.NextHop;dhcpServer=$dhcp;dnsServers=@((Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4).ServerAddresses)};
        autoLogonCleared=(@((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon').PSObject.Properties|Where-Object Name -in @('DefaultPassword','AutoAdminLogon','ForceAutoLogon','AutoLogonCount')).Count -eq 0);taskRemoved=$cleaned}
    Invoke-RestMethod "$($cfg.collectorUrl)/report" -Method Post -Headers $headers -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 6) -TimeoutSec 30 | Out-Null
}
try {
    $deadline = [DateTime]::UtcNow.AddMinutes(75)
    do {
        $status = if (Test-Path 'C:\ProgramData\OSDCloud\DeploymentStatus.json') {Get-Content 'C:\ProgramData\OSDCloud\DeploymentStatus.json' -Raw|ConvertFrom-Json} else {$null}
        $command = Invoke-RestMethod "$($cfg.collectorUrl)/command" -Headers $headers -TimeoutSec 30
        if ($status -and $status.runId -and $status.bootId -and $command.phase -eq 'desktop-ready') {break}
        if ($command.phase -eq 'abort') {throw 'Acceptance aborted before completion'}
        if ([DateTime]::UtcNow -gt $deadline) {throw 'Desktop readiness timed out'}
        Start-Sleep 5
    } while ($true)
    Clear-TestLogin
    Send-Report 'baseline'
    $deadline = [DateTime]::UtcNow.AddMinutes(15)
    do {
        $command = Invoke-RestMethod "$($cfg.collectorUrl)/command" -Headers $headers -TimeoutSec 30
        if ($command.phase -eq 'abort') {throw 'Acceptance aborted'}
        if ($command.phase -eq 'post-stop') {Send-Report 'post-stop';break}
        if ([DateTime]::UtcNow -gt $deadline) {throw 'Stop verification timed out'}
        Start-Sleep 3
    } while ($true)
} finally {
    Clear-TestLogin
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $ConfigPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
    $cleaned = -not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath $ConfigPath) -and -not (Test-Path -LiteralPath $PSCommandPath)
    try { Send-Report 'cleanup' } catch {}
}
