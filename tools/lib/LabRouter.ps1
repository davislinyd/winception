function Assert-LabRouterOwnership {
    param($Config, [switch]$Ready)
    if($Config.stateRoot -ne 'C:\OSDCloud\HostTools\State'){throw 'Router assets must use installed Lab State.'}
    $name = 'winception-autolab-router'
    $ownershipPath = Join-Path $Config.stateRoot 'lab\router\ownership.json'
    if (-not (Test-Path -LiteralPath $ownershipPath)) { throw 'AutoLab router ownership is missing. Run the explicit router bootstrap.' }
    $owner = Get-Content -LiteralPath $ownershipPath -Raw | ConvertFrom-Json
    $vm = Get-VM -Name $name -ErrorAction Stop
    if ([string]$owner.vmId -ne [string]$vm.Id -or $owner.switchName -ne 'Winception-AutoLab' -or $vm.Generation -ne 2 -or
        $owner.vhdxPath -ne (Join-Path $Config.stateRoot 'lab\router\winception-autolab-router.vhdx')) { throw 'Router VM ownership mismatch.' }
    $memory = Get-VMMemory -VMName $name
    if ($memory.DynamicMemoryEnabled -or $memory.Startup -ne 4GB) { throw 'Router requires fixed 4 GiB.' }
    $nics = @(Get-VMNetworkAdapter -VMName $name)
    if (@($nics | Where-Object {$_.Name -eq 'LAN' -and $_.SwitchName -eq 'Winception-AutoLab'}).Count -ne 1 -or
        @($nics | Where-Object {$_.Name -ne 'LAN' -and -not ($_.Name -eq 'WAN' -and $_.SwitchName -eq 'Default Switch')}).Count -or
        @($nics | Where-Object Name -eq WAN).Count -gt 1) { throw 'Router network attachments mismatch.' }
    $disk = @(Get-VMHardDiskDrive -VMName $name)
    if ($disk.Count -ne 1) { throw 'Router disk ownership mismatch.' }
    $diskPath=[string]$disk[0].Path;$ownedRoot=(Split-Path -Parent $owner.vhdxPath)+'\'
    for($depth=0;$depth -lt 16 -and $diskPath -ne $owner.vhdxPath;$depth++){
        if(-not $diskPath.StartsWith($ownedRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Router differencing disk is outside owned State.'}
        $diskPath=[string](Get-VHD -Path $diskPath -ErrorAction Stop).ParentPath
    }
    if($diskPath -ne $owner.vhdxPath -or -not (Get-VMSnapshot -VMName $name -Name 'Winception-Clean' -ErrorAction SilentlyContinue)){throw 'Router disk or clean checkpoint ownership mismatch.'}
    if ((Get-VMFirmware -VMName $name).SecureBoot -ne 'On' -or -not (Get-VMSecurity -VMName $name).TpmEnabled) { throw 'Router firmware mismatch.' }
    if ($Ready -and (@($nics).Count -ne 2 -or -not (Get-VMSnapshot -VMName $name -Name 'Winception-Router-Ready' -ErrorAction SilentlyContinue))) { throw 'Router ready checkpoint is missing.' }
    if($Ready -and $owner.dhcpSourceHash -ne (Get-FileHash (Join-Path $PSScriptRoot '..\acceptance\router-dhcp.mjs')).Hash){throw 'Router DHCP tools changed; explicit bootstrap required.'}
    $vm
}

function Initialize-LabRouterGuest {
    param($Config, [pscredential]$Credential, [string]$SourceRoot)
    $name = 'winception-autolab-router'
    Assert-LabRouterOwnership $Config | Out-Null
    if (-not (Get-VMNetworkAdapter -VMName $name -Name WAN -ErrorAction SilentlyContinue)) { Add-VMNetworkAdapter -VMName $name -Name WAN -SwitchName 'Default Switch' }
    $nics = @(Get-VMNetworkAdapter -VMName $name)
    $session = New-PSSession -VMName $name -Credential $Credential -ErrorAction Stop
    try {
        Invoke-Command -Session $session -ScriptBlock { New-Item C:\ProgramData\WinceptionLabRouter -ItemType Directory -Force | Out-Null }
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        Copy-Item -LiteralPath $node -Destination 'C:\ProgramData\WinceptionLabRouter\node.exe' -ToSession $session
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'tools\acceptance\router-dhcp.mjs') -Destination 'C:\ProgramData\WinceptionLabRouter\router-dhcp.mjs' -ToSession $session
        Invoke-Command -Session $session -ArgumentList @([string]($nics|Where-Object Name -eq LAN).MacAddress,[string]($nics|Where-Object Name -eq WAN).MacAddress) -ScriptBlock {
            param($LanMac,$WanMac)
            $ErrorActionPreference = 'Stop'
            $lan = Get-NetAdapter|Where-Object {($_.MacAddress -replace '[-:]','') -eq $LanMac}
            $wan = Get-NetAdapter|Where-Object {($_.MacAddress -replace '[-:]','') -eq $WanMac}
            if (-not $lan -or -not $wan) { throw 'Router guest adapters missing' }
            Get-NetIPAddress -InterfaceIndex $lan.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue|Remove-NetIPAddress -Confirm:$false
            Set-NetIPInterface -InterfaceIndex $lan.ifIndex -AddressFamily IPv4 -Dhcp Disabled -Forwarding Enabled
            New-NetIPAddress -InterfaceIndex $lan.ifIndex -IPAddress 192.168.177.254 -PrefixLength 24 | Out-Null
            Set-NetIPInterface -InterfaceIndex $wan.ifIndex -AddressFamily IPv4 -Forwarding Enabled
            Set-DnsClientServerAddress -InterfaceIndex $lan.ifIndex -ServerAddresses @('1.1.1.1','8.8.8.8')
            if (@(Get-NetNat -ErrorAction SilentlyContinue).Count) { throw 'Router guest contains unexpected NAT' }
            New-NetNat -Name WinceptionLabRouterNAT -InternalIPInterfaceAddressPrefix '192.168.177.0/24'|Out-Null
            $broadcast=Get-NetRoute -DestinationPrefix '255.255.255.255/32' -InterfaceIndex $lan.ifIndex -ErrorAction SilentlyContinue
            if($broadcast){$broadcast|Set-NetRoute -RouteMetric 1}else{New-NetRoute -DestinationPrefix '255.255.255.255/32' -InterfaceIndex $lan.ifIndex -NextHop '0.0.0.0' -RouteMetric 1|Out-Null}
            New-NetFirewallRule -Name WinceptionLabRouterDHCP -Direction Inbound -Action Allow -Protocol UDP -LocalPort 67 -InterfaceAlias $lan.Name|Out-Null
            @{serverIp='192.168.177.254';dnsServers=@('1.1.1.1','8.8.8.8');leasePath='C:\ProgramData\WinceptionLabRouter\leases.json'}|ConvertTo-Json|Set-Content C:\ProgramData\WinceptionLabRouter\dhcp.json
            Remove-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name DefaultPassword -ErrorAction SilentlyContinue
            Remove-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name AutoAdminLogon -ErrorAction SilentlyContinue
        }
    } finally { Remove-PSSession $session }
    Stop-VM -Name $name -Force -ErrorAction Stop
    Set-VMFirmware -VMName $name -FirstBootDevice (Get-VMHardDiskDrive -VMName $name)
    Checkpoint-VM -Name $name -SnapshotName 'Winception-Router-Ready' | Out-Null
    $ownershipPath=Join-Path $Config.stateRoot 'lab\router\ownership.json'
    $owner=Get-Content -LiteralPath $ownershipPath -Raw|ConvertFrom-Json
    $owner|Add-Member -NotePropertyName dhcpSourceHash -NotePropertyValue (Get-FileHash (Join-Path $SourceRoot 'tools\acceptance\router-dhcp.mjs')).Hash -Force
    $owner|ConvertTo-Json|Set-Content -LiteralPath $ownershipPath
}

function Enable-LabRouterTpm {
    $protector=Get-VMKeyProtector -VMName winception-autolab-router
    if($protector -isnot [byte[]] -or $protector.Length -lt 32){Set-VMKeyProtector -VMName winception-autolab-router -NewLocalKeyProtector}
    Enable-VMTPM -VMName winception-autolab-router
}

function Start-LabRouter {
    param($Config, [pscredential]$Credential, [bool]$Dhcp)
    Assert-LabRouterOwnership $Config -Ready | Out-Null
    $name = 'winception-autolab-router'
    if ((Get-VM -Name $name).State -ne 'Off') { throw 'Router must be Off before restore' }
    Restore-VMSnapshot -VMName $name -Name 'Winception-Router-Ready' -Confirm:$false
    Set-VMFirmware -VMName $name -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows -FirstBootDevice (Get-VMHardDiskDrive -VMName $name)
    Enable-LabRouterTpm
    Start-VM -Name $name
    $session = $null; $deadline = [DateTime]::UtcNow.AddSeconds(120)
    do {try {$session=New-PSSession -VMName $name -Credential $Credential -ErrorAction Stop} catch {Start-Sleep 2}} while (-not $session -and [DateTime]::UtcNow -lt $deadline)
    if (-not $session) { throw 'Router PowerShell Direct timed out' }
    try {
        Invoke-Command -Session $session -ArgumentList $Dhcp -ScriptBlock {
            param($Dhcp)
            $ErrorActionPreference='Stop'
            Resolve-DnsName www.microsoft.com -DnsOnly -QuickTimeout -ErrorAction Stop|Out-Null
            Invoke-WebRequest https://www.microsoft.com -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop|Out-Null
            if ($Dhcp) {
                $process=Start-Process C:\ProgramData\WinceptionLabRouter\node.exe -ArgumentList 'C:\ProgramData\WinceptionLabRouter\router-dhcp.mjs','C:\ProgramData\WinceptionLabRouter\dhcp.json' -WindowStyle Hidden -PassThru
                Start-Sleep 2
                if ($process.HasExited -or -not (Get-NetUDPEndpoint -LocalAddress 192.168.177.254 -LocalPort 67 -ErrorAction SilentlyContinue)) {throw 'Router DHCP failed to bind'}
            } elseif (Get-NetUDPEndpoint -LocalAddress 192.168.177.254 -LocalPort 67 -ErrorAction SilentlyContinue) {throw 'Unexpected router DHCP during Server round'}
        }
    } finally {Remove-PSSession $session}
}

function Stop-LabRouter {
    param($Config)
    if (Get-VM -Name winception-autolab-router -ErrorAction SilentlyContinue) {
        Assert-LabRouterOwnership $Config | Out-Null
        Stop-VM -Name winception-autolab-router -TurnOff -Force -Confirm:$false
        if (Get-VMSnapshot -VMName winception-autolab-router -Name Winception-Router-Ready -ErrorAction SilentlyContinue) {
            Restore-VMSnapshot -VMName winception-autolab-router -Name Winception-Router-Ready -Confirm:$false
            Set-VMFirmware -VMName winception-autolab-router -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows -FirstBootDevice (Get-VMHardDiskDrive -VMName winception-autolab-router)
            Enable-LabRouterTpm
        } else {
            Restore-LabCheckpoint -VmNames @('winception-autolab-router')
        }
    }
}
