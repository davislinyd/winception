[CmdletBinding()]
param([string]$ConfigPath,
    [ValidateSet('ExistingDhcp','WinceptionDhcp','LaptopNat')][string]$Scenario='ExistingDhcp',
    [switch]$ValidateOnly,[switch]$Execute,[string]$ConfirmDisposableClient,
    [string]$ReportRoot)
. (Join-Path $PSScriptRoot 'lib\Common.ps1')
. (Join-Path $PSScriptRoot 'lib\Acceptance.ps1')
$ErrorActionPreference='Stop'
if(-not $ConfigPath){$ConfigPath=Join-Path $PSScriptRoot '..\config\acceptance.local.json'}
if(-not $ReportRoot){$ReportRoot=Join-Path $PSScriptRoot ('..\test-results\acceptance-physical\'+[guid]::NewGuid().ToString('N'))}
$report=[ordered]@{layer='Physical';scenario=$Scenario;status='Blocked';deployment='NotRun';network='NotRun';cleanup='NotRun';human='NotRun'}
$report.sourceCommit=(& git -C (Split-Path -Parent $PSScriptRoot) rev-parse HEAD)
$report.sourceHash=(Get-FileHash -LiteralPath $PSCommandPath).Hash
$root=$null;$collector=$null;$rule=$null;$profileId=$null;$scriptId=$null;$old=$null;$createdNat=$false;$lock=$null;$lockHeld=$false;$deploymentStarted=$false
try {
    if(-not (Test-Path -LiteralPath $ConfigPath)){throw 'Ignored site configuration missing'}
    $cfg=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json
    Assert-AcceptanceConfig -Config $cfg -Scenario $Scenario
    $script:AcceptanceWeb=$cfg.webBase;$script:AcceptanceStateRoot=$cfg.stateRoot
    $old=(Invoke-AcceptanceApi -Path '/api/state').state
    if($old.operation.running -or @($old.fleet.runs|Where-Object status -in @('running','awaiting-windows','windows-running')).Count -or @($old.services.psobject.Properties|Where-Object {$_.Value.running}).Count){throw 'Host must be idle with deployment services stopped'}
    $options=(Invoke-AcceptanceApi -Path '/api/network/options').options
    if($Scenario -eq 'LaptopNat'){
        if($options.icsRunning -or @($options.natNetworks|Where-Object {$_.name -ne 'WinceptionNAT'}).Count){throw 'Foreign ICS/NAT conflict; owner must resolve it'}
        if($old.config.network.topology -eq 'dual-nic-nat' -and $old.config.network.nat.internalSubnet -ne $cfg.expected.subnet){throw 'Existing Winception NAT differs; explicit owner action required'}
        if($old.config.network.topology -eq 'dual-nic-nat' -and ($old.config.network.nat.wanInterfaceAlias -ne $cfg.host.wanInterface -or $old.config.network.nat.pxeInterfaceAlias -ne $cfg.host.clientInterface)){throw 'Existing Winception NAT interfaces differ; explicit owner action required'}
    }elseif($old.config.network.topology -eq 'dual-nic-nat'){throw 'Existing laptop NAT must be deliberately removed before shared LAN testing'}
    $report.status='NotRun';$report.reason='Prerequisites checked; deployment not executed'
    if($ValidateOnly -or -not $Execute){$report|ConvertTo-Json -Depth 8;return}
    if(-not (Test-IsAdministrator)){throw 'Elevated PowerShell required before any test mutation'}
    if((Get-AcceptanceMac $ConfirmDisposableClient) -ne (Get-AcceptanceMac $cfg.client.mac)){throw 'Execute must confirm the exact disposable client MAC'}
    $lock=[Threading.Mutex]::new($false,'Global\Winception-AutoLab')
    $lockHeld=$lock.WaitOne(0);if(-not $lockHeld){throw 'Another acceptance/deployment Lab run holds the lock'}
    $report.stateBackup=New-AcceptanceStateBackup $cfg.stateRoot
    $id=[guid]::NewGuid().ToString('N')
    $root=Join-Path $cfg.stateRoot "acceptance\$id";New-Item -ItemType Directory -Path $root -Force|Out-Null
    $report.testRunId=$id;$report.source=(& git -C (Split-Path -Parent $PSScriptRoot) rev-parse HEAD)
    $report.installedHash=(Get-FileHash (Join-Path (Split-Path -Parent $cfg.stateRoot) 'App\tools\osdcloud-console\src\httpServer.js')).Hash
    if($Scenario -eq 'LaptopNat'){
        $createdNat=$old.config.network.topology -ne 'dual-nic-nat'
        $prepared=Invoke-AcceptanceApi -Method POST -Path '/api/network/prepare' -Body @{wanInterfaceAlias=$cfg.host.wanInterface;pxeInterfaceAlias=$cfg.host.clientInterface;internalSubnet=$cfg.expected.subnet}
        if($prepared.result.ready -ne $true){throw 'NAT requires reboot or further preparation; no deployment started'}
    }else{
        $servers=@(Find-AcceptanceDhcpServers -ServiceIp $cfg.host.serviceIp -ClientMac $cfg.client.mac)
        $report.observedDhcp=$servers
        if($Scenario -eq 'ExistingDhcp' -and ($servers.Count -ne 1 -or $servers[0] -ne $cfg.expected.dhcpServer)){throw 'Expected existing DHCP was not uniquely observed'}
        if($Scenario -eq 'WinceptionDhcp' -and $servers.Count){throw 'Another DHCP server was observed; refused service start'}
        $mode=if($Scenario -eq 'ExistingDhcp'){'proxy'}else{'server'}
        Invoke-AcceptanceApi -Method POST -Path '/api/endpoint' -Body @{interfaceAlias=$cfg.host.serviceInterface;ipAddress=$cfg.host.serviceIp;prefixLength=$cfg.expected.prefixLength;gateway=$cfg.expected.gateway;dnsServers=@($cfg.expected.dnsServers);dhcpMode=$mode;leaseStartIp=$cfg.leaseStartIp;leaseEndIp=$cfg.leaseEndIp}|Out-Null
    }
    $live=(Invoke-AcceptanceApi -Path '/api/state').state
    $serviceIp=$live.config.adapter.serverIp
    if(-not $serviceIp){$serviceIp=$live.config.adapter.ipAddress}
    if($serviceIp -ne $cfg.host.serviceIp){throw 'Synced service IP differs from declared site'}
    if($Scenario -eq 'LaptopNat' -and @(Find-AcceptanceDhcpServers -ServiceIp $serviceIp -ClientMac $cfg.client.mac).Count){throw 'Another DHCP server was observed on the client network'}
    $runtimeRoot=[string]$live.config.workspace.runtimeRoot
    if(-not $runtimeRoot -or $live.config.workspace.runtimeInsideRepo -or $live.config.workspace.runtimeInsideHostTools){throw 'Invalid live runtime location'}
    $boot=Join-Path $runtimeRoot 'PXE-HttpRoot\osdcloud\boot.wim'
    $report.winpeHash=(Get-FileHash -LiteralPath $boot).Hash
    $commandPath=Join-Path $root 'command.json'
    $ticketBytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($ticketBytes);$rng.Dispose()
    $clientCfg=@{testRunId=$id;clientMac=(Get-AcceptanceMac $cfg.client.mac);machineId=$cfg.client.machineId;ticket=[Convert]::ToBase64String($ticketBytes);probeHost=$cfg.probeHost;collectorUrl="http://${serviceIp}:$($cfg.collectorPort)"}
    $collectorCfg=@{};foreach($key in $clientCfg.Keys){$collectorCfg[$key]=$clientCfg[$key]}
    $collectorCfg.host=$serviceIp;$collectorCfg.port=$cfg.collectorPort;$collectorCfg.expiresAt=[DateTime]::UtcNow.AddHours(2).ToString('o');$collectorCfg.commandPath=$commandPath;$collectorCfg.outputRoot=$root;$collectorCfg.bindSource=$true
    $collectorPath=Join-Path $root 'collector.local.json';$collectorCfg|ConvertTo-Json|Set-Content -LiteralPath $collectorPath
    $rule="Winception-Acceptance-$id"
    New-NetFirewallRule -Name $rule -Direction Inbound -Protocol TCP -LocalPort $cfg.collectorPort -LocalAddress $serviceIp -RemoteAddress $cfg.expected.subnet -Action Allow|Out-Null
    $collector=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @((Join-Path $PSScriptRoot 'acceptance\collector.mjs'),$collectorPath) -WindowStyle Hidden -PassThru
    Start-Sleep 1;if($collector.HasExited){throw 'Acceptance collector failed to start'}
    $worker=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content (Join-Path $PSScriptRoot 'acceptance\client.ps1') -Raw)))
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($clientCfg|ConvertTo-Json)))
    $installer=@'
$ErrorActionPreference='Stop'
$root=Join-Path $env:ProgramData 'WinceptionAcceptance\__ID__'
New-Item -ItemType Directory -Path $root -Force|Out-Null
$workerPath=Join-Path $root 'client.ps1';$configPath=Join-Path $root 'client.local.json'
[IO.File]::WriteAllText($workerPath,[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__WORKER__')))
[IO.File]::WriteAllText($configPath,[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__CONFIG__')))
$task='Winception-Acceptance-__ID__'
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "'+$workerPath+'" -ConfigPath "'+$configPath+'"')
Register-ScheduledTask -TaskName $task -Action $action -Principal (New-ScheduledTaskPrincipal -UserId SYSTEM -RunLevel Highest) -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 90)) -Force|Out-Null
Start-ScheduledTask -TaskName $task
'@
    $installer=$installer.Replace('__ID__',$id).Replace('__WORKER__',$worker).Replace('__CONFIG__',$encoded)
    $uploadHeaders=@{};$auth=Invoke-RestMethod "$script:AcceptanceWeb/api/auth/status"
    if($auth.required){$uploadHeaders['X-Winception-Token']=(Get-Content (Join-Path $cfg.stateRoot 'config\web-console-token.json') -Raw|ConvertFrom-Json).token}
    $upload=Invoke-RestMethod "$script:AcceptanceWeb/api/script-upload?fileName=acceptance.ps1" -Method POST -Headers $uploadHeaders -ContentType 'application/octet-stream' -Body ([Text.Encoding]::UTF8.GetBytes($installer)) -ErrorAction Stop
    $scriptId="SC-A$($id.Substring(0,7).ToUpper())"
    Invoke-AcceptanceApi -Method POST -Path '/api/scripts/create' -Body @{id=$scriptId;name="[TEST ONLY] Acceptance $id";uploadId=$upload.result.uploadId}|Out-Null
    $created=Invoke-AcceptanceApi -Method POST -Path '/api/profiles/create' -Body @{name="[TEST ONLY] Physical acceptance $id";acceptance=@{testOnly=$true;autoLogonCount=3}}
    $profileId=$created.result.profile.id
    $sequence=@($old.profile.activeProfile.installSequence)+@(@{type='script';id=$scriptId})
    Invoke-AcceptanceApi -Method POST -Path '/api/profile/software' -Body @{profileId=$profileId;installSequence=$sequence}|Out-Null
    Invoke-AcceptanceApi -Method POST -Path '/api/profile' -Body @{profileId=$profileId}|Out-Null
    $preflight=Invoke-AcceptanceApi -Method POST -Path '/api/preflight'
    $report.preflight=@($preflight.result|Select-Object name,ok,warn)
    if(-not $report.preflight.Count -or @($preflight.result|Where-Object {$_.ok -ne $true}).Count){throw 'Blocking Preflight failure'}
    Invoke-AcceptanceApi -Method POST -Path '/api/services/start-all' -Body @{acceptanceClients=@((Get-AcceptanceMac $cfg.client.mac))}|Out-Null
    $deploymentStarted=$true
    Write-Host 'PXE boot the declared disposable client now. This test will reinstall Windows.'
    $report.status='Failed';$report.deployment='Failed'
    $deadline=[DateTime]::UtcNow.AddMinutes(60);$approvedBoot=$null;$fleet=$null
    do {
        $state=(Invoke-AcceptanceApi -Path '/api/state').state
        foreach($request in @($state.bootRequests)) {
            if((Get-AcceptanceMac $request.clientMac) -ne (Get-AcceptanceMac $cfg.client.mac)){throw 'Unknown client pairing request; refused automatic approval'}
            if($approvedBoot){throw 'Repeated physical pairing; no automatic retry'}
            Invoke-AcceptanceApi -Method POST -Path '/api/boot-requests/approve' -Body @{requestId=$request.requestId;pairingCode=$request.pairingCode}|Out-Null
            $approvedBoot=$request.bootId;$report.bootId=$approvedBoot
        }
        $newRuns=@($state.fleet.runs|Where-Object {$_.runId -notin @($old.fleet.runs.runId)})
        if($newRuns.Count -gt 1){throw 'Multiple new deployment runs; refused retry or unknown client'}
        $fleet=$newRuns|Select-Object -First 1
        if($fleet -and $fleet.status -in @('failed','stale')){throw 'This client deployment failed; no retry'}
        if($fleet -and $fleet.status -eq 'completed' -and $fleet.latestStage -eq 'windows-desktop-ready'){@{phase='desktop-ready'}|ConvertTo-Json|Set-Content -LiteralPath $commandPath}
        if($fleet -and $fleet.status -eq 'completed' -and $fleet.latestStage -eq 'windows-desktop-ready' -and (Test-Path (Join-Path $root 'baseline.json'))){break}
        if([DateTime]::UtcNow -gt $deadline){throw 'Physical deployment timed out'}
        Start-Sleep 3
    }while($true)
    $before=Get-Content (Join-Path $root 'baseline.json') -Raw|ConvertFrom-Json
    if($before.runId -ne $fleet.runId -or -not $before.bootId -or ($approvedBoot -and $before.bootId -ne $approvedBoot)){throw 'Client report did not match this Fleet run/boot'}
    $report.bootId=$before.bootId
    $report.runId=$fleet.runId;$report.deployment='Passed';$report.beforeStop=$before
    Stop-AcceptanceServices
    @{phase='post-stop'}|ConvertTo-Json|Set-Content -LiteralPath $commandPath
    $deadline=[DateTime]::UtcNow.AddMinutes(2)
    while(-not (Test-Path (Join-Path $root 'post-stop.json')) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep 2}
    if(-not (Test-Path (Join-Path $root 'post-stop.json'))){throw 'Post-stop Internet report missing'}
    $after=Get-Content (Join-Path $root 'post-stop.json') -Raw|ConvertFrom-Json
    $report.afterStop=$after
    $report.network=if((Test-AcceptanceNetwork $before $cfg.expected) -and (Test-AcceptanceNetwork $after $cfg.expected) -and $after.runId -eq $fleet.runId){'Passed'}else{'Failed'}
    $report.status=if($report.network -eq 'Passed'){'Passed'}else{'Failed'}
}catch{
    $message=[string]$_.Exception.Message
    $report.reason=if($message -match '^[A-Za-z][A-Za-z0-9 .;:/\\-]{1,180}$' -and $message -notmatch '(?i)token|password|bearer|credential|envelope'){$message}else{'Acceptance prerequisite or runtime check failed. No automatic retry.'}
    if($root){$report.status='Failed'}else{$report.status='Blocked'}
}finally{
    if($root){
        $cleanupFailed=$false
        try{Stop-AcceptanceServices;@{phase='abort'}|ConvertTo-Json|Set-Content (Join-Path $root 'command.json')}catch{$cleanupFailed=$true}
        if($deploymentStarted){
            $deadline=[DateTime]::UtcNow.AddSeconds(60)
            while(-not (Test-Path (Join-Path $root 'cleanup.json')) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep 2}
            if(Test-Path (Join-Path $root 'cleanup.json')){$clientCleanup=Get-Content (Join-Path $root 'cleanup.json') -Raw|ConvertFrom-Json;if(-not $clientCleanup.autoLogonCleared -or -not $clientCleanup.taskRemoved){$cleanupFailed=$true}}
            else{$cleanupFailed=$true}
        }
        try{
            if($profileId){Invoke-AcceptanceApi -Method POST -Path '/api/profile' -Body @{profileId=$old.profile.activeProfile.id}|Out-Null;Invoke-AcceptanceApi -Method POST -Path '/api/profiles/delete' -Body @{profileId=$profileId}|Out-Null}
            if($scriptId){Invoke-AcceptanceApi -Method POST -Path '/api/scripts/delete' -Body @{scriptId=$scriptId}|Out-Null}
            if($createdNat){Invoke-AcceptanceApi -Method POST -Path '/api/network/remove'|Out-Null}
            if($old.config.network.topology -ne 'dual-nic-nat'){Invoke-AcceptanceApi -Method POST -Path '/api/endpoint' -Body @{interfaceAlias=$old.config.adapter.interfaceAlias;ipAddress=$old.config.adapter.serverIp;prefixLength=$old.config.adapter.prefixLength;gateway=$old.config.dhcp.router;dnsServers=@($old.config.dhcp.dnsServers);dhcpMode=$old.config.dhcp.dhcpMode;leaseStartIp=$old.config.dhcp.leaseStartIp;leaseEndIp=$old.config.dhcp.leaseEndIp}|Out-Null}
            $restored=Invoke-AcceptanceApi -Method POST -Path '/api/preflight'
            if(-not @($restored.result).Count -or @($restored.result|Where-Object {$_.ok -ne $true}).Count){throw 'Restored endpoint Preflight failed'}
        }catch{$cleanupFailed=$true}
        if($collector -and -not $collector.HasExited){Stop-Process -Id $collector.Id -ErrorAction SilentlyContinue}
        if($rule){try{Remove-NetFirewallRule -Name $rule -ErrorAction Stop}catch{$cleanupFailed=$true}}
        Remove-Item -LiteralPath (Join-Path $root 'collector.local.json') -Force -ErrorAction SilentlyContinue
        $report.cleanup=if($cleanupFailed){'Failed'}else{'Passed'};if($cleanupFailed){$report.status='Failed'}
        $json=$report|ConvertTo-Json -Depth 12;[IO.File]::WriteAllText((Join-Path $root 'result.json'),$json)
        [IO.File]::WriteAllText((Join-Path $root 'result.html'),('<!doctype html><meta charset="utf-8"><h1>Winception acceptance</h1><pre>'+[Net.WebUtility]::HtmlEncode($json)+'</pre>'))
    }
    if($lockHeld){$lock.ReleaseMutex()};if($lock){$lock.Dispose()}
    New-Item -ItemType Directory -Path $ReportRoot -Force|Out-Null
    $json=$report|ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText((Join-Path $ReportRoot 'result.json'),$json)
    [IO.File]::WriteAllText((Join-Path $ReportRoot 'result.html'),('<!doctype html><meta charset="utf-8"><h1>Winception acceptance</h1><pre>'+[Net.WebUtility]::HtmlEncode($json)+'</pre>'))
}
$report|ConvertTo-Json -Depth 12
if($report.status -in @('Failed','Blocked')){exit 1}
