[CmdletBinding()]
param(
    [string] $ConfigPath,
    [switch] $ValidateOnly
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $RepoRoot 'config\lab-regression.example.json'
}

function Read-LabConfig {
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Lab configuration was not found: $Path"
    }
    Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Get-RequiredProperty {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)][string] $Name
    )

    $property = $Object.PSObject.Properties[$Name]
    if (-not $property -or [string]::IsNullOrWhiteSpace([string] $property.Value)) {
        throw "Lab configuration is missing '$Name'."
    }
    $property.Value
}

function Assert-Ipv4 {
    param([Parameter(Mandatory)][string] $Address)

    $parsed = $null
    if (-not [System.Net.IPAddress]::TryParse($Address, [ref] $parsed) -or $parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
        throw "Lab service IP is not a valid IPv4 address: $Address"
    }
}

function Assert-LabConfig {
    param([Parameter(Mandatory)] $Config)

    if ([int] $Config.schemaVersion -ne 1) {
        throw "Unsupported Lab configuration schema: $($Config.schemaVersion)"
    }
    $switchName = Get-RequiredProperty -Object $Config -Name 'switchName'
    $interfaceAlias = Get-RequiredProperty -Object $Config -Name 'serviceInterfaceAlias'
    $serviceIp = Get-RequiredProperty -Object $Config -Name 'serviceIp'
    $checkpointName = Get-RequiredProperty -Object $Config -Name 'checkpointName'
    $stateRoot = Get-RequiredProperty -Object $Config -Name 'stateRoot'
    $baseVhdxPath = Get-RequiredProperty -Object $Config -Name 'baseVhdxPath'
    Assert-Ipv4 -Address $serviceIp
    if ([int] $Config.prefixLength -lt 1 -or [int] $Config.prefixLength -gt 30) {
        throw "Lab prefixLength must be between 1 and 30."
    }
    if ($switchName -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,62}$') {
        throw "Lab switch name contains unsupported characters: $switchName"
    }
    if ($interfaceAlias -ne "vEthernet ($switchName)") {
        throw "serviceInterfaceAlias must be vEthernet ($switchName)."
    }
    $allVms = @($Config.secureBootVms) + @($Config.ipxeVm)
    $invalidVms = @($allVms | Where-Object { [string]::IsNullOrWhiteSpace([string] $_) -or $_ -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,99}$' })
    if ($allVms.Count -ne 5 -or $invalidVms.Count -gt 0) {
        throw 'Lab configuration must contain four secureboot VM names and one iPXE VM name.'
    }
    if (@($allVms | Sort-Object -Unique).Count -ne 5) {
        throw 'Lab VM names must be unique.'
    }
    if ([string] $checkpointName -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,99}$') {
        throw "Invalid Lab checkpoint name: $checkpointName"
    }
}

function Assert-CommandAvailable {
    param([Parameter(Mandatory)][string] $Name)
    if (-not (Get-Command -Name $Name -ErrorAction SilentlyContinue)) {
        throw "Required Hyper-V command is not available: $Name"
    }
}

function Ensure-LabSwitch {
    param([Parameter(Mandatory)][string] $Name)

    $switch = Get-VMSwitch -Name $Name -ErrorAction SilentlyContinue
    if (-not $switch) {
        if ($ValidateOnly) {
            throw "Lab switch is missing: $Name"
        }
        Write-Host "Creating isolated Internal Hyper-V switch '$Name'."
        New-VMSwitch -Name $Name -SwitchType Internal | Out-Null
        $switch = Get-VMSwitch -Name $Name -ErrorAction Stop
    }
    if ([string] $switch.SwitchType -ne 'Internal') {
        throw "Lab switch '$Name' is not Internal; refusing to use an external switch."
    }
    $switch
}

function Ensure-LabAdapter {
    param(
        [Parameter(Mandatory)][string] $InterfaceAlias,
        [Parameter(Mandatory)][string] $ServiceIp,
        [Parameter(Mandatory)][int] $PrefixLength
    )

    $adapter = Get-NetAdapter -Name $InterfaceAlias -ErrorAction SilentlyContinue
    if (-not $adapter) {
        throw "Lab vEthernet adapter was not found: $InterfaceAlias"
    }
    if ($adapter.Status -ne 'Up') {
        throw "Lab vEthernet adapter is not up: $InterfaceAlias"
    }
    $gateway = Get-NetIPConfiguration -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue
    if ($gateway.IPv4DefaultGateway) {
        throw "Lab adapter $InterfaceAlias must not have a default gateway."
    }
    $addresses = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue)
    $matching = @($addresses | Where-Object { $_.IPAddress -eq $ServiceIp -and [int] $_.PrefixLength -eq $PrefixLength })
    if ($matching.Count -eq 0) {
        if ($ValidateOnly) {
            throw "Lab adapter $InterfaceAlias does not have $ServiceIp/$PrefixLength."
        }
        if ($addresses | Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' }) {
            throw "Lab adapter $InterfaceAlias already has an unexpected IPv4 address; refusing to replace it."
        }
        New-NetIPAddress -InterfaceIndex $adapter.ifIndex -IPAddress $ServiceIp -PrefixLength $PrefixLength -Type Unicast | Out-Null
    }
    $adapter
}

function Set-LabVmTpmEnabled {
    # Winception-Clean does not keep Hyper-V TPM; apply the requested TPM state after firmware.
    param(
        [Parameter(Mandatory)][string] $VmName,
        [Parameter(Mandatory)][bool] $Enabled
    )

    $security = Get-VMSecurity -VMName $VmName -ErrorAction Stop
    $tpmOn = $false
    $tpmProp = $security.PSObject.Properties['TpmEnabled']
    if ($tpmProp -and $null -ne $tpmProp.Value) {
        $tpmOn = [bool] $tpmProp.Value
    }
    if ($Enabled) {
        if (-not $tpmOn) {
            $protectors = @(Get-VMKeyProtector -VMName $VmName -ErrorAction SilentlyContinue)
            if ($protectors.Count -eq 0) {
                Set-VMKeyProtector -VMName $VmName -NewLocalKeyProtector -ErrorAction Stop
            }
            Enable-VMTPM -VMName $VmName -ErrorAction Stop
            $security = Get-VMSecurity -VMName $VmName -ErrorAction Stop
            $tpmProp = $security.PSObject.Properties['TpmEnabled']
            $tpmOn = $tpmProp -and $null -ne $tpmProp.Value -and [bool] $tpmProp.Value
        }
        if (-not $tpmOn) {
            throw "$VmName TPM is off; expected TPM on after firmware apply."
        }
        return
    }

    if ($tpmOn) {
        Disable-VMTPM -VMName $VmName -ErrorAction Stop
        $security = Get-VMSecurity -VMName $VmName -ErrorAction Stop
        $tpmProp = $security.PSObject.Properties['TpmEnabled']
        $tpmOn = $tpmProp -and $null -ne $tpmProp.Value -and [bool] $tpmProp.Value
    }
    if ($tpmOn) {
        throw "$VmName TPM is on; expected TPM off after firmware apply."
    }
}

function Ensure-LabVm {
    param(
        [Parameter(Mandatory)][string] $VmName,
        [Parameter(Mandatory)][bool] $SecureBoot,
        [Parameter(Mandatory)][bool] $Tpm,
        [Parameter(Mandatory)][string] $SwitchName,
        [Parameter(Mandatory)][string] $BaseVhdx,
        [Parameter(Mandatory)][string] $StateRoot,
        [Parameter(Mandatory)][string] $CheckpointName
    )

    $vm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
    if (-not $vm) {
        if ($ValidateOnly) {
            throw "Lab VM is missing: $VmName"
        }
        if (-not (Test-Path -LiteralPath $BaseVhdx -PathType Leaf)) {
            throw ("Base VHDX is missing; cannot create {0}: {1}" -f $VmName, $BaseVhdx)
        }
        $vmRoot = Join-Path $StateRoot 'lab\vms'
        New-Item -ItemType Directory -Path $vmRoot -Force | Out-Null
        $vhdx = Join-Path $vmRoot ($VmName + '.vhdx')
        if (-not (Test-Path -LiteralPath $vhdx -PathType Leaf)) {
            Copy-Item -LiteralPath $BaseVhdx -Destination $vhdx -Force
        }
        New-VM -Name $VmName -Generation 2 -MemoryStartupBytes 4GB -SwitchName $SwitchName -VHDPath $vhdx | Out-Null
        $vm = Get-VM -Name $VmName -ErrorAction Stop
    }

    if ($vm.Generation -ne 2) {
        throw "$VmName is not a Generation 2 VM."
    }
    if ([string] $vm.State -ne 'Off') {
        if ($ValidateOnly) {
            throw "$VmName must be Off during Lab validation."
        }
        Stop-VM -Name $VmName -TurnOff -Force -Confirm:$false | Out-Null
    }

    $memory = Get-VMMemory -VMName $VmName -ErrorAction Stop
    if (-not $ValidateOnly) {
        Set-VMMemory -VMName $VmName -DynamicMemoryEnabled $false -StartupBytes 4GB
        $memory = Get-VMMemory -VMName $VmName -ErrorAction Stop
    }
    if ($memory.DynamicMemoryEnabled -eq $true -or [int64] $memory.Startup -ne [int64] 4GB) {
        throw "$VmName must use fixed 4 GiB startup memory with Dynamic Memory disabled."
    }
    $networkAdapters = @(Get-VMNetworkAdapter -VMName $VmName)
    if ($networkAdapters.Count -ne 1) {
        throw "$VmName must have exactly one network adapter; found $($networkAdapters.Count)."
    }
    if ([string] $networkAdapters[0].SwitchName -ne $SwitchName) {
        if ($ValidateOnly) {
            throw "$VmName is connected to '$($networkAdapters[0].SwitchName)' instead of '$SwitchName'."
        }
        Connect-VMNetworkAdapter -VMName $VmName -SwitchName $SwitchName
        $networkAdapters = @(Get-VMNetworkAdapter -VMName $VmName)
    }

    if (-not $ValidateOnly) {
        if ($SecureBoot) {
            Set-VMFirmware -VMName $VmName -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows
        }
        else {
            Set-VMFirmware -VMName $VmName -EnableSecureBoot Off
        }
        Set-LabVmTpmEnabled -VmName $VmName -Enabled $Tpm
        Set-VMFirmware -VMName $VmName -FirstBootDevice $networkAdapters[0]
    }
    else {
        $firmware = Get-VMFirmware -VMName $VmName
        $expected = if ($SecureBoot) { 'On' } else { 'Off' }
        if ([string] $firmware.SecureBoot -ne $expected) {
            throw "$VmName Secure Boot is $($firmware.SecureBoot), expected $expected."
        }
        $security = Get-VMSecurity -VMName $VmName -ErrorAction Stop
        if ([bool] $security.TpmEnabled -ne $Tpm) {
            $actual = if ([bool] $security.TpmEnabled) { 'on' } else { 'off' }
            $wanted = if ($Tpm) { 'on' } else { 'off' }
            throw "$VmName TPM is $actual; expected $wanted. Winception-Clean restore drops Hyper-V TPM."
        }
    }

    $checkpoint = Get-VMSnapshot -VMName $VmName -Name $CheckpointName -ErrorAction SilentlyContinue
    if (-not $checkpoint) {
        if ($ValidateOnly) {
            throw "$VmName is missing checkpoint '$CheckpointName'."
        }
        Checkpoint-VM -Name $VmName -SnapshotName $CheckpointName | Out-Null
        $deadline = (Get-Date).AddSeconds(30)
        do {
            $checkpoint = Get-VMSnapshot -VMName $VmName -Name $CheckpointName -ErrorAction SilentlyContinue
            if ($checkpoint) { break }
            Start-Sleep -Milliseconds 200
        } while ((Get-Date) -lt $deadline)
        if (-not $checkpoint) {
            throw "$VmName failed to create checkpoint '$CheckpointName'."
        }
    }

    [pscustomobject]@{
        name = $VmName
        secureBoot = $SecureBoot
        tpm = $Tpm
        tpmEnabled = [bool] (Get-VMSecurity -VMName $VmName -ErrorAction Stop).TpmEnabled
        checkpoint = $CheckpointName
        state = [string] (Get-VM -Name $VmName).State
    }
}

Assert-CommandAvailable -Name 'Get-VMSwitch'
Assert-CommandAvailable -Name 'Get-VM'
Assert-CommandAvailable -Name 'Get-VMSnapshot'
Assert-CommandAvailable -Name 'Get-VMMemory'
Assert-CommandAvailable -Name 'Get-VMSecurity'
Assert-CommandAvailable -Name 'Set-VMKeyProtector'
Assert-CommandAvailable -Name 'Get-VMKeyProtector'
Assert-CommandAvailable -Name 'Enable-VMTPM'
Assert-CommandAvailable -Name 'Disable-VMTPM'
$config = Read-LabConfig -Path $ConfigPath
Assert-LabConfig -Config $config
if (-not (Test-IsAdministrator)) {
    throw 'Initialize-WinceptionLab.ps1 requires an elevated PowerShell session.'
}

$switchName = [string] $config.switchName
$interfaceAlias = [string] $config.serviceInterfaceAlias
$serviceIp = [string] $config.serviceIp
$prefixLength = [int] $config.prefixLength
$stateRoot = Get-FullPath ([string] $config.stateRoot)
$baseVhdx = Get-FullPath ([string] $config.baseVhdxPath)
$checkpointName = [string] $config.checkpointName

$switch = Ensure-LabSwitch -Name $switchName
$adapter = Ensure-LabAdapter -InterfaceAlias $interfaceAlias -ServiceIp $serviceIp -PrefixLength $prefixLength
$vmResults = New-Object System.Collections.Generic.List[object]
foreach ($vmName in @($config.secureBootVms)) {
    $vmResults.Add((Ensure-LabVm -VmName ([string] $vmName) -SecureBoot $true -Tpm $true -SwitchName $switchName -BaseVhdx $baseVhdx -StateRoot $stateRoot -CheckpointName $checkpointName))
}
$vmResults.Add((Ensure-LabVm -VmName ([string] $config.ipxeVm) -SecureBoot $false -Tpm $false -SwitchName $switchName -BaseVhdx $baseVhdx -StateRoot $stateRoot -CheckpointName $checkpointName))

[pscustomobject]@{
    validateOnly = [bool] $ValidateOnly
    switchName = $switch.Name
    switchType = [string] $switch.SwitchType
    serviceInterfaceAlias = $adapter.Name
    serviceIp = $serviceIp
    vmCount = $vmResults.Count
    vms = @($vmResults.ToArray())
} | ConvertTo-Json -Depth 8
