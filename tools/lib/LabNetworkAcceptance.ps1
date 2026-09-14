function New-LabAcceptanceProfile {
    $state=Get-ConsoleState
    $script:AcceptanceOriginalProfile=[string]$state.profile.activeProfile.id
    $response=Invoke-ConsoleJson -Method POST -Path '/api/profiles/create' -Body @{name="[TEST ONLY] AutoLab $([guid]::NewGuid().ToString('N').Substring(0,8))";acceptance=@{testOnly=$true;autoLogonCount=3}}
    $script:AcceptanceProfileId=[string]$response.result.profile.id
    $response=Invoke-ConsoleJson -Method POST -Path '/api/profile' -Body @{profileId=$script:AcceptanceProfileId}
    if ($response.state.profile.activeProfile.acceptance.testOnly -ne $true) {throw 'Installed App does not support test-only acceptance profiles; update it before Lab deployment.'}
    $script:AcceptanceProfileId
}

function Invoke-LabPairingDecision {
    param([string[]]$VmNames,[bool]$Approve=$true)
    $expected=@($VmNames|ForEach-Object {(Get-VMNetworkAdapter -VMName $_|Select-Object -First 1).MacAddress -replace '[-:]',''})
    $state=Get-ConsoleState
    foreach ($request in @($state.bootRequests)) {
        $clientMac=[string]$request.clientMac -replace '[-:]',''
        $lastOctet=0
        if ($clientMac -notin $expected -or [string]$request.clientIp -notmatch '^192\.168\.177\.(\d+)$') {throw 'Unexpected client requested Proxy credentials.'}
        $lastOctet=[int]$Matches[1]
        if ($lastOctet -lt 100 -or $lastOctet -gt 149 -or -not $request.bootId -or [DateTime]$request.expiresAt -le [DateTime]::UtcNow) {throw 'Proxy boot identity/pool/expiry mismatch.'}
        if ($script:AcceptanceBootIds.Contains([string]$request.bootId)) {throw 'Proxy boot ID was replayed.'}
        $decision=if($Approve){'approve'}else{'reject'}
        Invoke-ConsoleJson -Method POST -Path "/api/boot-requests/$decision" -Body @{requestId=$request.requestId;pairingCode=$request.pairingCode}|Out-Null
        $script:AcceptanceBootIds.Add([string]$request.bootId)|Out-Null
        return $request
    }
}

function Get-LabNetworkEvidence {
    param([string]$VmName,[pscredential]$Credential,[string]$ExpectedDhcp)
    $session=New-PSSession -VMName $VmName -Credential $Credential -ErrorAction Stop
    try {
        $result=Invoke-Command -Session $session -ScriptBlock {
            $ErrorActionPreference='Stop'
            $adapter=Get-NetAdapter|Where-Object Status -eq Up|Select-Object -First 1
            $address=Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4|Where-Object IPAddress -notlike '169.254.*'|Select-Object -First 1
            $net=Get-NetIPConfiguration -InterfaceIndex $adapter.ifIndex
            $dhcp=(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$($adapter.InterfaceGuid)").DhcpServer
            $dns=@((Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4).ServerAddresses)
            $resolved=@(Resolve-DnsName www.microsoft.com -DnsOnly -QuickTimeout -ErrorAction Stop).Count -gt 0
            $response=Invoke-WebRequest https://www.microsoft.com -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
            @{ip=$address.IPAddress;prefixLength=$address.PrefixLength;gateway=[string]$net.IPv4DefaultGateway.NextHop;dhcpServer=$dhcp;dnsServers=$dns;dns=$resolved;https=($response.StatusCode -ge 200 -and $response.StatusCode -lt 400)}
        }
        $last=[int]([string]$result.ip).Split('.')[-1]
        $pool=if($ExpectedDhcp -eq '192.168.177.254'){$last -ge 100 -and $last -le 149}else{$last -ge 200 -and $last -le 250}
        if ($result.ip -notlike '192.168.177.*' -or $result.prefixLength -ne 24 -or $result.gateway -ne '192.168.177.254' -or $result.dhcpServer -ne $ExpectedDhcp -or -not $pool -or -not $result.dns -or -not $result.https -or ((@($result.dnsServers)|Sort-Object) -join ',') -ne '1.1.1.1,8.8.8.8') {throw 'Client DHCP/gateway/DNS/Internet evidence does not match AutoLab.'}
        $result
    } finally {Remove-PSSession $session}
}

function Invoke-LabProxyRejection {
    param([pscredential]$Credential)
    $name=[string]$script:Config.secureBootVms[0]
    Restore-LabCheckpoint -VmNames @($name)
    Set-LabRoundClientScope -VmNames @($name)
    $script:RoundDhcpMode='proxy'
    Set-ConsoleMode secureboot|Out-Null
    Set-ConsoleEndpoint|Out-Null
    Set-ConsoleDhcpServerMode -Mode proxy|Out-Null
    Invoke-ApiPreflight|Out-Null
    $script:PreflightPassed=$true
    Clear-DeploymentStatus
    $previousLogs=@((Get-ConsoleState).logs)
    Start-LabServices|Out-Null
    try {
        Start-LabVms @($name)
        $deadline=[DateTime]::UtcNow.AddMinutes(5);$rejected=$null
        do {$rejected=Invoke-LabPairingDecision -VmNames @($name) -Approve $false;if(-not $rejected){Start-Sleep 3}}while(-not $rejected -and [DateTime]::UtcNow -lt $deadline)
        if(-not $rejected){throw 'Proxy rejection request timed out.'}
        Start-Sleep 10
        $state=Get-ConsoleState
        $logs=@($state.logs|Where-Object {$_ -notin $previousLogs}) -join "`n"
        $remote=[regex]::Escape([string]$rejected.clientIp)
        if ($logs -notmatch "${remote}(?::\d+)? POST /osdcloud/boot-session 403" -or $logs -match "${remote}(?::\d+)? POST /osdcloud/boot-session 201" -or @($state.fleet.runs).Count -gt 0) {throw 'Rejected Proxy client did not provide denied-session/no-install evidence.'}
        Write-Evidence -Name 'proxy-rejection.json' -Value @{status='Passed';bootId=$rejected.bootId;clientMac=$rejected.clientMac;credentialsDenied=$true;installationStarted=$false}|Out-Null
    } finally {Stop-LabServices;Restore-LabCheckpoint @($name);$script:PreflightPassed=$false}
}

function Invoke-LabNetworkRounds {
    param([pscredential]$Credential,[string]$ProfileId)
    $savedDhcp=$script:Config.dhcp|ConvertTo-Json|ConvertFrom-Json
    $script:Config.dhcp.router='192.168.177.254'
    $script:AcceptanceBootIds=New-Object 'System.Collections.Generic.HashSet[string]'
    $rounds=New-Object System.Collections.Generic.List[object]
    try {
        foreach($mode in @('proxy','server')) {
            Start-LabRouter -Config $script:Config -Credential $Credential -Dhcp ($mode -eq 'proxy')
            try {
                if($mode -eq 'proxy'){Invoke-LabProxyRejection -Credential $Credential}
                $rounds.Add((Invoke-LabRound -RoundId "network-$mode" -BootMode secureboot -VmNames @([string]$script:Config.secureBootVms[0]) -SecureBoot $true -Tpm $true -Credential $Credential -ProfileId $ProfileId -DhcpMode $mode -CheckNetwork))
            } finally {Stop-LabRouter -Config $script:Config}
        }
    } finally {$script:Config.dhcp=$savedDhcp;$script:RoundDhcpMode='server'}
    $rounds.ToArray()
}
