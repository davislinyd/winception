[CmdletBinding()]
param(
    [ValidateSet('Inspect', 'Prepare', 'Remove')]
    [string] $Action = 'Inspect',
    [string] $WanInterfaceAlias,
    [string] $PxeInterfaceAlias,
    [string] $InternalSubnet = '192.168.100.0/24',
    [string] $SwitchName = 'Winception-PXE',
    [string] $NatName = 'WinceptionNAT',
    [string] $ConfigPath,
    [string] $StateRoot = 'C:\OSDCloud\HostTools\State'
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom
$TaskName = 'Winception-ResumeGateway'
$StatePath = Join-Path $StateRoot 'network-gateway-state.json'

function Write-JsonOutput {
    param([Parameter(Mandatory)] $Value)
    [Console]::Out.Write(($Value | ConvertTo-Json -Depth 10 -Compress))
}

function Get-SubnetInfo {
    param([Parameter(Mandatory)][string] $Cidr)
    $parts = $Cidr -split '/', 2
    if ($parts.Count -ne 2) { throw "Invalid IPv4 subnet: $Cidr" }
    $prefix = [int] $parts[1]
    if ($prefix -lt 8 -or $prefix -gt 30) { throw "Internal subnet prefix must be between /8 and /30: $Cidr" }
    $ip = [System.Net.IPAddress]::Parse($parts[0])
    if ($ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw "Internal subnet must be IPv4: $Cidr" }
    $bytes = $ip.GetAddressBytes()
    [array]::Reverse($bytes)
    $value = [BitConverter]::ToUInt32($bytes, 0)
    $mask = if ($prefix -eq 0) { [uint32] 0 } else { [uint32] ([uint64] 0xffffffff -shl (32 - $prefix)) }
    $network = [uint32] ($value -band $mask)
    $gateway = [uint32] ($network + 1)
    $gatewayBytes = [BitConverter]::GetBytes($gateway)
    [array]::Reverse($gatewayBytes)
    $networkBytes = [BitConverter]::GetBytes($network)
    [array]::Reverse($networkBytes)
    [pscustomobject]@{
        Cidr = "$(([System.Net.IPAddress]::new($networkBytes)).ToString())/$prefix"
        PrefixLength = $prefix
        Gateway = ([System.Net.IPAddress]::new($gatewayBytes)).ToString()
    }
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Test-IsVirtualGatewayAdapter {
    param($Adapter)
    return $Adapter.Name -match '^vEthernet\s*\(' -or $Adapter.InterfaceDescription -match 'Hyper-V Virtual Ethernet'
}

function Assert-PhysicalGatewayAdapter {
    param([Parameter(Mandatory)][string] $InterfaceAlias, [Parameter(Mandatory)][string] $Role)
    $adapter = Get-NetAdapter -Name $InterfaceAlias -ErrorAction Stop
    if (Test-IsVirtualGatewayAdapter $adapter) {
        throw "$Role must be a physical network adapter, not $($adapter.Name). Select the NIC connected to the router or client switch."
    }
    return $adapter
}

function Get-DefaultRoute {
    param([Parameter(Mandatory)][string] $InterfaceAlias)
    Get-NetAdapter -Name $InterfaceAlias -ErrorAction Stop | Out-Null
    return Get-NetRoute -InterfaceAlias $InterfaceAlias -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
        Sort-Object RouteMetric | Select-Object -First 1
}

function Read-State {
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json } catch { return $null }
}

function Save-State {
    param([Parameter(Mandatory)] $Value)
    New-Item -ItemType Directory -Path (Split-Path -Parent $StatePath) -Force | Out-Null
    [System.IO.File]::WriteAllText($StatePath, (($Value | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $Utf8NoBom)
}

function Remove-ResumeTask {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
}

function Register-ResumeTask {
    $argumentList = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath),
        '-Action', 'Prepare', '-WanInterfaceAlias', ('"{0}"' -f $WanInterfaceAlias),
        '-PxeInterfaceAlias', ('"{0}"' -f $PxeInterfaceAlias), '-InternalSubnet', $InternalSubnet,
        '-SwitchName', ('"{0}"' -f $SwitchName), '-NatName', ('"{0}"' -f $NatName),
        '-ConfigPath', ('"{0}"' -f $ConfigPath), '-StateRoot', ('"{0}"' -f $StateRoot)
    ) -join ' '
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argumentList
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
}

function Get-HyperVFeatureState {
    try {
        $feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop
        return [pscustomobject]@{ Installed = ($feature.State -eq 'Enabled'); RestartNeeded = ($feature.State -eq 'EnablePending') }
    }
    catch {
        $feature = Get-WindowsFeature -Name Hyper-V -ErrorAction Stop
        return [pscustomobject]@{ Installed = [bool] $feature.Installed; RestartNeeded = $false }
    }
}

function Get-GatewayState {
    $feature = Get-HyperVFeatureState
    $wan = if ($WanInterfaceAlias) { Get-NetAdapter -Name $WanInterfaceAlias -ErrorAction SilentlyContinue } else { $null }
    $pxe = if ($PxeInterfaceAlias) { Get-NetAdapter -Name $PxeInterfaceAlias -ErrorAction SilentlyContinue } else { $null }
    $switch = if (Get-Command Get-VMSwitch -ErrorAction SilentlyContinue) { Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue } else { $null }
    $virtualAlias = "vEthernet ($SwitchName)"
    $virtual = Get-NetAdapter -Name $virtualAlias -ErrorAction SilentlyContinue
    $nat = if (Get-Command Get-NetNat -ErrorAction SilentlyContinue) { Get-NetNat -Name $NatName -ErrorAction SilentlyContinue } else { $null }
    $allNat = if (Get-Command Get-NetNat -ErrorAction SilentlyContinue) { @(Get-NetNat -ErrorAction SilentlyContinue) } else { @() }
    $sharedAccess = Get-Service -Name SharedAccess -ErrorAction SilentlyContinue
    $wanRoute = if ($wan) { Get-DefaultRoute -InterfaceAlias $WanInterfaceAlias } else { $null }
    $pxeRoute = if ($pxe) { Get-DefaultRoute -InterfaceAlias $PxeInterfaceAlias } else { $null }
    $virtualRoute = if ($virtual) { Get-DefaultRoute -InterfaceAlias $virtualAlias } else { $null }
    $subnet = Get-SubnetInfo -Cidr $InternalSubnet
    $virtualIp = if ($virtual) { Get-NetIPAddress -InterfaceAlias $virtualAlias -AddressFamily IPv4 -IPAddress $subnet.Gateway -ErrorAction SilentlyContinue | Select-Object -First 1 } else { $null }
    $ipInterface = if ($virtual) { Get-NetIPInterface -InterfaceAlias $virtualAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1 } else { $null }
    $stored = Read-State
    $blockers = @()
    if ($WanInterfaceAlias -and -not $wan) { $blockers += "WAN interface not found: $WanInterfaceAlias" }
    if ($PxeInterfaceAlias -and -not $pxe) { $blockers += "PXE interface not found: $PxeInterfaceAlias" }
    if ($wan -and (Test-IsVirtualGatewayAdapter $wan)) { $blockers += "WAN interface must be a physical NIC, not $($wan.Name)." }
    if ($pxe -and (Test-IsVirtualGatewayAdapter $pxe)) { $blockers += "PXE interface must be a physical NIC, not $($pxe.Name)." }
    if ($wan -and $pxe -and $wan.InterfaceIndex -eq $pxe.InterfaceIndex) { $blockers += 'WAN and PXE interfaces are the same adapter.' }
    if ($pxeRoute) { $blockers += "PXE physical interface has a default route via $($pxeRoute.NextHop)." }
    if ($virtualRoute) { $blockers += "PXE management vNIC has a default route via $($virtualRoute.NextHop)." }
    if ($sharedAccess -and $sharedAccess.Status -eq 'Running') { $blockers += 'Internet Connection Sharing (SharedAccess) is running.' }
    foreach ($existingNat in $allNat) {
        if ($existingNat.Name -ne $NatName) { $blockers += "Existing NetNat is owned by another service: $($existingNat.Name)." }
        elseif ($existingNat.InternalIPInterfaceAddressPrefix -ne $subnet.Cidr) { $blockers += "Winception NAT prefix differs: $($existingNat.InternalIPInterfaceAddressPrefix)." }
    }
    if ($switch -and $pxe -and $switch.NetAdapterInterfaceDescription -and $switch.NetAdapterInterfaceDescription -ne $pxe.InterfaceDescription) {
        $blockers += "Existing switch $SwitchName is bound to a different physical adapter."
    }
    $ready = [bool] ($feature.Installed -and $wanRoute -and $switch -and $virtual -and $virtualIp -and $nat -and $ipInterface.Forwarding -eq 'Enabled' -and $blockers.Count -eq 0)
    [pscustomobject]@{
        topology = 'dual-nic-nat'
        ready = $ready
        rebootRequired = [bool] ($stored -and $stored.status -eq 'reboot-required')
        detail = if ($ready) { 'Winception Hyper-V external PXE switch and WinNAT are ready.' } elseif ($blockers.Count) { $blockers -join ' ' } else { 'Gateway preparation is required.' }
        hyperV = [pscustomobject]@{ installed = $feature.Installed; restartNeeded = $feature.RestartNeeded }
        wan = if ($wan) { [pscustomobject]@{ name = $wan.Name; status = $wan.Status.ToString(); gateway = if ($wanRoute) { $wanRoute.NextHop } else { '' } } } else { $null }
        pxe = if ($pxe) { [pscustomobject]@{ name = $pxe.Name; status = $pxe.Status.ToString(); gateway = if ($pxeRoute) { $pxeRoute.NextHop } else { '' } } } else { $null }
        virtualAdapter = if ($virtual) { [pscustomobject]@{ name = $virtual.Name; gateway = $subnet.Gateway; forwarding = if ($ipInterface) { $ipInterface.Forwarding.ToString() } else { '' } } } else { $null }
        nat = if ($nat) { [pscustomobject]@{ name = $nat.Name; internalSubnet = $nat.InternalIPInterfaceAddressPrefix } } else { $null }
        blockers = @($blockers)
    }
}

function Prepare-Gateway {
    if (-not (Test-IsAdministrator)) { throw 'Gateway preparation requires an elevated console.' }
    Assert-PhysicalGatewayAdapter -InterfaceAlias $WanInterfaceAlias -Role 'WAN interface' | Out-Null
    Assert-PhysicalGatewayAdapter -InterfaceAlias $PxeInterfaceAlias -Role 'PXE interface' | Out-Null
    $before = Get-GatewayState
    if ($before.blockers.Count -gt 0) { throw ($before.blockers -join ' ') }
    if (-not $before.hyperV.installed) {
        Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -All -NoRestart | Out-Null
        Save-State ([ordered]@{ status = 'reboot-required'; requestedAt = [DateTimeOffset]::Now.ToString('o'); wanInterfaceAlias = $WanInterfaceAlias; pxeInterfaceAlias = $PxeInterfaceAlias; internalSubnet = $InternalSubnet })
        Register-ResumeTask
        return Get-GatewayState
    }
    if (-not $before.wan.gateway) { throw "WAN interface $WanInterfaceAlias has no IPv4 default route." }
    if (-not $before.pxe) { throw "PXE interface not found: $PxeInterfaceAlias" }
    $switch = if (Get-Command Get-VMSwitch -ErrorAction SilentlyContinue) { Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue } else { $null }
    if (-not $switch) {
        New-VMSwitch -Name $SwitchName -NetAdapterName $PxeInterfaceAlias -AllowManagementOS $true | Out-Null
        Start-Sleep -Seconds 2
    }
    $subnet = Get-SubnetInfo -Cidr $InternalSubnet
    $virtualAlias = "vEthernet ($SwitchName)"
    $virtual = Get-NetAdapter -Name $virtualAlias -ErrorAction Stop
    $existingIp = Get-NetIPAddress -InterfaceAlias $virtualAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' }
    $expectedIp = $existingIp | Where-Object { $_.IPAddress -eq $subnet.Gateway } | Select-Object -First 1
    if (-not $expectedIp -and $existingIp) { throw "$virtualAlias already has an IPv4 address; refusing to replace it." }
    if (-not $expectedIp) { New-NetIPAddress -InterfaceAlias $virtualAlias -IPAddress $subnet.Gateway -PrefixLength $subnet.PrefixLength -ErrorAction Stop | Out-Null }
    $route = Get-DefaultRoute -InterfaceAlias $virtualAlias
    if ($route) { throw "$virtualAlias has a default route; remove it manually before enabling NAT." }
    Set-NetIPInterface -InterfaceAlias $virtualAlias -AddressFamily IPv4 -Forwarding Enabled -ErrorAction Stop | Out-Null
    $nat = if (Get-Command Get-NetNat -ErrorAction SilentlyContinue) { Get-NetNat -Name $NatName -ErrorAction SilentlyContinue } else { $null }
    if (-not $nat) { New-NetNat -Name $NatName -InternalIPInterfaceAddressPrefix $subnet.Cidr | Out-Null }
    $endpointScript = Join-Path $PSScriptRoot 'Set-OsdCloudIpxeEndpoint.ps1'
    if ($ConfigPath -and (Test-Path -LiteralPath $ConfigPath -PathType Leaf) -and (Test-Path -LiteralPath $endpointScript -PathType Leaf)) {
        & $endpointScript -ConfigPath $ConfigPath -InterfaceAlias $virtualAlias -ServerIp $subnet.Gateway -PrefixLength $subnet.PrefixLength -DefaultGateway $subnet.Gateway -CommitWinPe -SyncAssets -HashLargeArtifacts *> $null
    }
    Remove-ResumeTask
    Save-State ([ordered]@{ status = 'ready'; completedAt = [DateTimeOffset]::Now.ToString('o'); wanInterfaceAlias = $WanInterfaceAlias; pxeInterfaceAlias = $PxeInterfaceAlias; internalSubnet = $subnet.Cidr; virtualAdapter = $virtualAlias })
    return Get-GatewayState
}

function Remove-Gateway {
    if (-not (Test-IsAdministrator)) { throw 'Gateway removal requires an elevated console.' }
    $subnet = Get-SubnetInfo -Cidr $InternalSubnet
    $virtualAlias = "vEthernet ($SwitchName)"
    $nat = if (Get-Command Get-NetNat -ErrorAction SilentlyContinue) { Get-NetNat -Name $NatName -ErrorAction SilentlyContinue } else { $null }
    if ($nat -and $nat.InternalIPInterfaceAddressPrefix -eq $subnet.Cidr) { Remove-NetNat -Name $NatName -Confirm:$false | Out-Null }
    $ip = Get-NetIPAddress -InterfaceAlias $virtualAlias -AddressFamily IPv4 -IPAddress $subnet.Gateway -ErrorAction SilentlyContinue
    if ($ip) { Remove-NetIPAddress -InputObject $ip -Confirm:$false | Out-Null }
    $switch = if (Get-Command Get-VMSwitch -ErrorAction SilentlyContinue) { Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue } else { $null }
    if ($switch) { Remove-VMSwitch -Name $SwitchName -Force | Out-Null }
    Remove-ResumeTask
    if (Test-Path -LiteralPath $StatePath) { Remove-Item -LiteralPath $StatePath -Force }
    return Get-GatewayState
}

try {
    switch ($Action) {
        'Inspect' { Write-JsonOutput (Get-GatewayState) }
        'Prepare' { Write-JsonOutput (Prepare-Gateway) }
        'Remove' { Write-JsonOutput (Remove-Gateway) }
    }
}
catch {
    Write-JsonOutput ([ordered]@{ topology = 'dual-nic-nat'; ready = $false; error = $_.Exception.Message; detail = $_.Exception.Message })
    exit 1
}
