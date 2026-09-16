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
    if ($Ready) {
        $processor = Get-VMProcessor -VMName $name
        if ($processor.Count -lt 2 -or -not $processor.ExposeVirtualizationExtensions) { throw 'Router ready processor prerequisites are missing.' }
    }
    if($Ready -and $owner.dhcpSourceHash -ne (Get-FileHash (Join-Path $PSScriptRoot '..\acceptance\router-dhcp.mjs')).Hash){throw 'Router DHCP tools changed; explicit bootstrap required.'}
    $vm
}

function Get-LabRouterFirmwareEvidence {
    param([Parameter(Mandatory)][string]$VmName)
    $firmware = Get-VMFirmware -VMName $VmName -ErrorAction Stop
    $bootOrder = New-Object System.Collections.Generic.List[object]
    foreach ($entry in @($firmware.BootOrder)) {
        $device = if ($entry -and $entry.PSObject.Properties['Device']) { $entry.Device } else { $null }
        $bootOrder.Add([ordered]@{
            bootType = if ($entry -and $entry.PSObject.Properties['BootType']) { [string]$entry.BootType } else { '' }
            deviceId = if ($device -and $device.PSObject.Properties['Id']) { [string]$device.Id } else { '' }
            description = if ($device -and $device.PSObject.Properties['Description']) { [string]$device.Description } else { '' }
        })
    }
    [ordered]@{
        secureBoot = [string]$firmware.SecureBoot
        secureBootTemplate = [string]$firmware.SecureBootTemplate
        bootOrder = $bootOrder.ToArray()
    }
}

function Write-LabRouterSessionFailure {
    param(
        [Parameter(Mandatory)][string]$VmName,
        [Parameter(Mandatory)][string]$Phase,
        [Parameter(Mandatory)][string]$EvidencePath,
        [Parameter(Mandatory)][int]$Attempts,
        [string]$LastError
    )
    try {
        $vm = Get-VM -Name $VmName -ErrorAction Stop
        $firmware = Get-LabRouterFirmwareEvidence -VmName $VmName
        $integration = @(Get-VMIntegrationService -VMName $VmName -ErrorAction SilentlyContinue |
            Select-Object Name, Enabled, PrimaryStatusDescription, SecondaryStatusDescription)
        $evidence = [ordered]@{
            capturedAt = [DateTimeOffset]::Now.ToString('o')
            vmName = $VmName
            phase = $Phase
            attempts = $Attempts
            vmState = [string]$vm.State
            heartbeat = @($integration | Where-Object { $_.Name -eq 'Heartbeat' } | Select-Object -First 1)
            firmware = $firmware
            lastError = [string]$LastError
        }
    }
    catch {
        $evidence = [ordered]@{
            capturedAt = [DateTimeOffset]::Now.ToString('o')
            vmName = $VmName
            phase = $Phase
            attempts = $Attempts
            lastError = [string]$LastError
            diagnosticError = 'Host VM diagnostics could not be collected.'
        }
    }
    $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}

function New-LabRouterPSSession {
    param(
        [string]$VmName,
        [pscredential]$Credential,
        [int]$TimeoutSec = 600,
        [string]$Phase = 'guest-boot',
        [string]$EvidencePath
    )
    $session = $null
    $attempts = 0
    $lastError = ''
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
    do {
        $attempts++
        try {
            if ((Get-VM -Name $VmName -ErrorAction Stop).State -eq 'Running') {
                # PowerShell Direct's VMName parameter set does not accept SessionOption.
                $session = New-PSSession -VMName $VmName -Credential $Credential -ErrorAction Stop
            }
        } catch {
            $session = $null
            $lastError = [string]$_.Exception.Message
        }
        if (-not $session) { Start-Sleep -Seconds 5 }
    } while (-not $session -and [DateTime]::UtcNow -lt $deadline)
    if (-not $session) {
        if ($EvidencePath) {
            Write-LabRouterSessionFailure -VmName $VmName -Phase $Phase -EvidencePath $EvidencePath -Attempts $attempts -LastError $lastError
        }
        throw "Router PowerShell Direct timed out during $Phase."
    }
    $session
}

function Invoke-LabRouterGuestCommand {
    param(
        [Parameter(Mandatory)]$Session,
        [Parameter(Mandatory)][scriptblock]$ScriptBlock,
        [object[]]$ArgumentList,
        [Parameter(Mandatory)][string]$Name,
        [int]$TimeoutSec = 90,
        [string]$EvidencePath
    )
    $job = $null
    try {
        $job = Invoke-Command -Session $Session -ScriptBlock $ScriptBlock -ArgumentList $ArgumentList -AsJob -ErrorAction Stop
        try {
            $completedJob = Wait-Job -Job $job -Timeout $TimeoutSec -ErrorAction Stop
        }
        catch {
            $blockedOutput = @(
                Receive-Job -Job $job -ErrorAction SilentlyContinue 2>&1 |
                    ForEach-Object { $_.ToString() }
            ) -join [Environment]::NewLine
            if ($blockedOutput) {
                throw "Router guest command blocked during ${Name}: $blockedOutput"
            }
            throw
        }
        if (-not $completedJob) {
            if ($EvidencePath) {
                [ordered]@{
                    capturedAt = [DateTimeOffset]::Now.ToString('o')
                    phase = $Name
                    timeoutSec = $TimeoutSec
                    error = 'Router guest command timed out.'
                } | ConvertTo-Json | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
            }
            throw "Router guest command timed out during $Name."
        }
        if ($job.State -eq 'Failed') {
            throw "Router guest command failed during $Name."
        }
        Receive-Job -Job $job -ErrorAction Stop
    }
    finally {
        if ($job) {
            Stop-Job -Job $job -ErrorAction SilentlyContinue
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
    }
}

function Wait-LabRouterConfigurationSettled {
    param(
        [Parameter(Mandatory)][string[]]$ExpectedAdapterNames,
        [int]$TimeoutSec = 20
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
    $previous = ''
    do {
        $vm = Get-VM -Name winception-autolab-router -ErrorAction Stop
        $adapterNames = @(
            Get-VMNetworkAdapter -VMName winception-autolab-router -ErrorAction Stop |
                ForEach-Object Name |
                Sort-Object
        )
        $fingerprint = "$(($vm.State).ToString())|$($adapterNames -join ',')|$((Get-VMHardDiskDrive -VMName winception-autolab-router -ErrorAction Stop).Path)"
        if ($vm.State -eq 'Off' -and @($adapterNames | Where-Object { $_ -notin $ExpectedAdapterNames }).Count -eq 0 -and
            @($ExpectedAdapterNames | Where-Object { $_ -notin $adapterNames }).Count -eq 0 -and $fingerprint -eq $previous) {
            return
        }
        $previous = $fingerprint
        Start-Sleep -Seconds 1
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Router VM configuration did not settle with adapters: $($ExpectedAdapterNames -join ', ')."
}

function Initialize-LabRouterGuest {
    param($Config, [pscredential]$Credential, [string]$SourceRoot)
    $name = 'winception-autolab-router'
    Assert-LabRouterOwnership $Config | Out-Null
    if (-not (Get-VMNetworkAdapter -VMName $name -Name WAN -ErrorAction SilentlyContinue)) { Add-VMNetworkAdapter -VMName $name -Name WAN -SwitchName 'Default Switch' }
    $wanMac = ''
    $lanMac = ''
    $nicDeadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $nics = @(Get-VMNetworkAdapter -VMName $name)
        $lanMac = [string]($nics | Where-Object Name -eq LAN).MacAddress
        $wanMac = [string]($nics | Where-Object Name -eq WAN).MacAddress
        if ($lanMac -and $wanMac -and $lanMac -ne '000000000000' -and $wanMac -ne '000000000000') { break }
        Start-Sleep -Seconds 1
    } while ([DateTime]::UtcNow -lt $nicDeadline)
    if (-not $lanMac -or -not $wanMac -or $lanMac -eq '000000000000' -or $wanMac -eq '000000000000') {
        throw 'Router LAN/WAN MAC was not assigned before guest NAT setup.'
    }
    $processorBefore = Get-VMProcessor -VMName $name -ErrorAction Stop
    [pscustomobject]@{
        count = [int]$processorBefore.Count
        exposeVirtualizationExtensions = [bool]$processorBefore.ExposeVirtualizationExtensions
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Config.evidenceRoot 'router-processor-before.json') -Encoding UTF8
    Stop-VM -Name $name -Force -ErrorAction Stop
    Set-VMProcessor -VMName $name -Count 2 -ExposeVirtualizationExtensions $true -ErrorAction Stop
    $processor = Get-VMProcessor -VMName $name -ErrorAction Stop
    if ($processor.Count -lt 2 -or -not $processor.ExposeVirtualizationExtensions) {
        throw 'Router nested virtualization could not be enabled.'
    }
    $hardDisk = Get-VMHardDiskDrive -VMName $name -ErrorAction Stop
    Set-VMFirmware -VMName $name -FirstBootDevice $hardDisk -ErrorAction Stop
    $firmware = Get-VMFirmware -VMName $name -ErrorAction Stop
    if (-not $firmware.BootOrder -or $firmware.BootOrder[0].Device.Id -ne $hardDisk.Id) {
        throw 'Router guest setup must boot the deployed hard disk, not PXE.'
    }
    [ordered]@{
        capturedAt = [DateTimeOffset]::Now.ToString('o')
        vmName = $name
        vmStateBeforeStart = [string](Get-VM -Name $name -ErrorAction Stop).State
        hardDiskId = [string]$hardDisk.Id
        firmware = Get-LabRouterFirmwareEvidence -VmName $name
        processor = [ordered]@{ count = [int]$processor.Count; nestedVirtualization = [bool]$processor.ExposeVirtualizationExtensions }
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Config.evidenceRoot 'router-guest-boot.json') -Encoding UTF8
    Start-VM -Name $name -ErrorAction Stop
    $session = New-LabRouterPSSession -VmName $name -Credential $Credential -Phase 'after-deployed-disk-boot' -EvidencePath (Join-Path $Config.evidenceRoot 'router-guest-session-failure.json')
    [ordered]@{
        capturedAt = [DateTimeOffset]::Now.ToString('o')
        vmName = $name
        phase = 'after-deployed-disk-boot'
        firmware = Get-LabRouterFirmwareEvidence -VmName $name
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Config.evidenceRoot 'router-guest-session.json') -Encoding UTF8
    try {
        Invoke-LabRouterGuestCommand -Session $session -Name 'stage-router-files' -EvidencePath (Join-Path $Config.evidenceRoot 'router-guest-command-timeout.json') -ScriptBlock { New-Item C:\ProgramData\WinceptionLabRouter -ItemType Directory -Force | Out-Null }
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        Copy-Item -LiteralPath $node -Destination 'C:\ProgramData\WinceptionLabRouter\node.exe' -ToSession $session
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'tools\acceptance\router-dhcp.mjs') -Destination 'C:\ProgramData\WinceptionLabRouter\router-dhcp.mjs' -ToSession $session
        try {
            $featureBefore = Invoke-LabRouterGuestCommand -Session $session -Name 'inspect-hyperv-prerequisite' -EvidencePath (Join-Path $Config.evidenceRoot 'router-guest-command-timeout.json') -ScriptBlock {
                $feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -ErrorAction Stop
                $cimClass = Get-CimClass -Namespace root/StandardCimv2 -ClassName MSFT_NetNat -ErrorAction SilentlyContinue
                [pscustomobject]@{ featureName = $feature.FeatureName; featureState = [string]$feature.State; cimClassPresent = [bool]$cimClass }
            }
            $featureEnabled = $false
            if ($featureBefore.featureState -ne 'Enabled') {
                Invoke-LabRouterGuestCommand -Session $session -Name 'enable-hyperv-prerequisite' -TimeoutSec 120 -EvidencePath (Join-Path $Config.evidenceRoot 'router-guest-command-timeout.json') -ScriptBlock {
                    $ErrorActionPreference = 'Stop'
                    Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart | Out-Null
                }
                $featureEnabled = $true
                Invoke-LabRouterGuestCommand -Session $session -Name 'restart-after-hyperv-enable' -EvidencePath (Join-Path $Config.evidenceRoot 'router-guest-command-timeout.json') -ScriptBlock { shutdown.exe /r /t 0 /f | Out-Null }
                Remove-PSSession $session
                $session = $null
                Start-Sleep -Seconds 10
                $restartState = (Get-VM -Name $name -ErrorAction Stop).State.ToString()
                $hostStartRequired = $false
                if ($restartState -eq 'Off') {
                    Start-VM -Name $name -ErrorAction Stop
                    $hostStartRequired = $true
                } elseif ($restartState -ne 'Running') {
                    throw "Router guest restart left VM in unsupported state: $restartState"
                }
                [pscustomobject]@{
                    capturedAt = [DateTimeOffset]::Now.ToString('o')
                    stateAfterGuestRestart = $restartState
                    hostStartRequired = $hostStartRequired
                } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Config.evidenceRoot 'router-hyperv-restart.json') -Encoding UTF8
                $session = New-LabRouterPSSession -VmName $name -Credential $Credential -Phase 'after-hyperv-restart' -EvidencePath (Join-Path $Config.evidenceRoot 'router-guest-session-failure.json')
            }
            $featureAfter = Invoke-LabRouterGuestCommand -Session $session -Name 'wait-hyperv-prerequisite' -TimeoutSec 150 -EvidencePath (Join-Path $Config.evidenceRoot 'router-guest-command-timeout.json') -ScriptBlock {
                $deadline = [DateTime]::UtcNow.AddSeconds(120)
                do {
                    $feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -ErrorAction Stop
                    $cimClass = Get-CimClass -Namespace root/StandardCimv2 -ClassName MSFT_NetNat -ErrorAction SilentlyContinue
                    if ($feature.State -eq 'Enabled' -and $cimClass) { break }
                    Start-Sleep -Seconds 5
                } while ([DateTime]::UtcNow -lt $deadline)
                [pscustomobject]@{ featureName = $feature.FeatureName; featureState = [string]$feature.State; cimClassPresent = [bool]$cimClass }
            }
            [pscustomobject]@{
                capturedAt = [DateTimeOffset]::Now.ToString('o')
                processorCount = [int]$processor.Count
                nestedVirtualization = [bool]$processor.ExposeVirtualizationExtensions
                featureEnabledThisRun = $featureEnabled
                before = $featureBefore
                after = $featureAfter
            } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Config.evidenceRoot 'router-hyperv-prerequisite.json') -Encoding UTF8
            if ($featureAfter.featureState -ne 'Enabled' -or -not $featureAfter.cimClassPresent) {
                throw 'Router MSFT_NetNat is unavailable after Hyper-V enablement.'
            }
            try {
                Invoke-LabRouterGuestCommand -Session $session -Name 'configure-router-network' -TimeoutSec 120 -EvidencePath (Join-Path $Config.evidenceRoot 'router-guest-command-timeout.json') -ArgumentList @($lanMac,$wanMac) -ScriptBlock {
                param($LanMac,$WanMac)
                $ErrorActionPreference = 'Stop'
                $deadline = [DateTime]::UtcNow.AddSeconds(30)
                $lan = $null
                $wan = $null
                do {
                    $lan = Get-NetAdapter|Where-Object {($_.MacAddress -replace '[-:]','') -eq $LanMac}
                    $wan = Get-NetAdapter|Where-Object {($_.MacAddress -replace '[-:]','') -eq $WanMac}
                    if ($lan -and $wan) { break }
                    Start-Sleep -Seconds 2
                } while ([DateTime]::UtcNow -lt $deadline)
                if (-not $lan -or -not $wan) { throw 'Router guest adapters missing' }
                Get-NetIPAddress -InterfaceIndex $lan.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue|Remove-NetIPAddress -Confirm:$false
                Set-NetIPInterface -InterfaceIndex $lan.ifIndex -AddressFamily IPv4 -Dhcp Disabled -Forwarding Enabled
                New-NetIPAddress -InterfaceIndex $lan.ifIndex -IPAddress 192.168.177.254 -PrefixLength 24 | Out-Null
                Set-NetIPInterface -InterfaceIndex $wan.ifIndex -AddressFamily IPv4 -Forwarding Enabled
                Set-DnsClientServerAddress -InterfaceIndex $lan.ifIndex -ServerAddresses @('1.1.1.1','8.8.8.8')
                Get-Service -Name WinNat -ErrorAction SilentlyContinue | Start-Service -ErrorAction SilentlyContinue
                $existingNat = @()
                try {
                    $existingNat = @(Get-NetNat -ErrorAction Stop)
                } catch {
                    if ($_.Exception.Message -notmatch 'Invalid class') { throw }
                }
                if ($existingNat.Count) { throw 'Router guest contains unexpected NAT' }
                try {
                    New-NetNat -Name WinceptionLabRouterNAT -InternalIPInterfaceAddressPrefix '192.168.177.0/24'|Out-Null
                } catch {
                    throw "Router New-NetNat failed: $($_.Exception.Message.Trim())"
                }
                $broadcast=Get-NetRoute -DestinationPrefix '255.255.255.255/32' -InterfaceIndex $lan.ifIndex -ErrorAction SilentlyContinue
                if($broadcast){$broadcast|Set-NetRoute -RouteMetric 1}else{New-NetRoute -DestinationPrefix '255.255.255.255/32' -InterfaceIndex $lan.ifIndex -NextHop '0.0.0.0' -RouteMetric 1|Out-Null}
                New-NetFirewallRule -Name WinceptionLabRouterDHCP -Direction Inbound -Action Allow -Protocol UDP -LocalPort 67 -InterfaceAlias $lan.Name|Out-Null
                @{serverIp='192.168.177.254';dnsServers=@('1.1.1.1','8.8.8.8');leasePath='C:\ProgramData\WinceptionLabRouter\leases.json'}|ConvertTo-Json|Set-Content C:\ProgramData\WinceptionLabRouter\dhcp.json
                Remove-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name DefaultPassword -ErrorAction SilentlyContinue
                Remove-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name AutoAdminLogon -ErrorAction SilentlyContinue
                }
            } catch {
                [ordered]@{
                    capturedAt = [DateTimeOffset]::Now.ToString('o')
                    stage = 'configure-router-network'
                    error = $_.Exception.Message
                } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Config.evidenceRoot 'router-nat-error.json') -Encoding UTF8
                throw
            }
        } catch {
            $setupError = $_
            try {
                $diagnostics = Invoke-LabRouterGuestCommand -Session $session -Name 'collect-router-nat-diagnostics' -TimeoutSec 60 -ScriptBlock {
                    $service = Get-CimInstance Win32_Service -Filter "Name='WinNat'" -ErrorAction SilentlyContinue
                    $cimError = ''
                    $cimClass = $null
                    try {
                        $cimClass = Get-CimClass -Namespace root/StandardCimv2 -ClassName MSFT_NetNat -ErrorAction Stop
                    } catch {
                        $cimError = $_.Exception.Message
                    }
                    [pscustomobject]@{
                        capturedAt = [DateTimeOffset]::Now.ToString('o')
                        winNatService = if ($service) { [pscustomobject]@{ state = $service.State; startMode = $service.StartMode; exitCode = $service.ExitCode } } else { $null }
                        cimClassPresent = [bool]$cimClass
                        cimClassError = $cimError
                        netNatModule = @(Get-Module -ListAvailable NetNat | Select-Object Name, Version)
                        optionalFeatures = @(@('Microsoft-Hyper-V-All', 'Containers') | ForEach-Object {
                            Get-WindowsOptionalFeature -Online -FeatureName $_ -ErrorAction SilentlyContinue |
                                Select-Object FeatureName, State
                        })
                        adapters = @(Get-NetAdapter | Select-Object Name, Status, MacAddress, InterfaceIndex)
                        addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object InterfaceIndex, IPAddress, PrefixLength)
                        systemEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = (Get-Date).AddMinutes(-15) } -ErrorAction SilentlyContinue |
                            Where-Object { $_.ProviderName -match 'WinNat|HNS|Tcpip|NetworkProfile' } |
                            Select-Object -First 50 TimeCreated, Id, LevelDisplayName, ProviderName, Message)
                    }
                }
                $diagnostics | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Config.evidenceRoot 'router-nat-diagnostics.json') -Encoding UTF8
            } catch {
                [pscustomobject]@{ capturedAt = [DateTimeOffset]::Now.ToString('o'); error = 'Guest NAT diagnostics could not be collected.' } |
                    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Config.evidenceRoot 'router-nat-diagnostics.json') -Encoding UTF8
            }
            throw $setupError
        }
    } finally { if ($session) { Remove-PSSession $session } }
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
    Set-VMProcessor -VMName $name -Count 2 -ExposeVirtualizationExtensions $true
    Enable-LabRouterTpm
    Start-VM -Name $name
    $session = New-LabRouterPSSession -VmName $name -Credential $Credential
    try {
        Invoke-LabRouterGuestCommand -Session $session -Name 'verify-router-upstream' -TimeoutSec 90 -ArgumentList $Dhcp -ScriptBlock {
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
        $hasReadyCheckpoint = [bool](Get-VMSnapshot -VMName winception-autolab-router -Name Winception-Router-Ready -ErrorAction SilentlyContinue)
        Wait-LabRouterConfigurationSettled -ExpectedAdapterNames @('LAN','WAN')
        if ($hasReadyCheckpoint) {
            Restore-VMSnapshot -VMName winception-autolab-router -Name Winception-Router-Ready -Confirm:$false
            Set-VMFirmware -VMName winception-autolab-router -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows -FirstBootDevice (Get-VMHardDiskDrive -VMName winception-autolab-router)
            Set-VMProcessor -VMName winception-autolab-router -Count 2 -ExposeVirtualizationExtensions $true
            Enable-LabRouterTpm
        } else {
            $wan = Get-VMNetworkAdapter -VMName winception-autolab-router -Name WAN -ErrorAction SilentlyContinue
            if ($wan) {
                Remove-VMNetworkAdapter -VMName winception-autolab-router -Name WAN -Confirm:$false -ErrorAction Stop
                Wait-LabRouterConfigurationSettled -ExpectedAdapterNames @('LAN')
            }
            Restore-LabCheckpoint -VmNames @('winception-autolab-router')
            $processorEvidence = Join-Path $Config.evidenceRoot 'router-processor-before.json'
            if (Test-Path -LiteralPath $processorEvidence) {
                $processorBefore = Get-Content -LiteralPath $processorEvidence -Raw | ConvertFrom-Json
                Set-VMProcessor -VMName winception-autolab-router -Count ([int]$processorBefore.count) -ExposeVirtualizationExtensions ([bool]$processorBefore.exposeVirtualizationExtensions)
            }
        }
    }
}
