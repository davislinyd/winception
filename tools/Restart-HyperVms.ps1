<#
.SYNOPSIS
  Turn off Hyper-V clients, optionally restore Winception-Clean, then PXE-restart them.

.DESCRIPTION
  Operator helper for a Console-driven Hyper-V PXE test. It does not start HTTP/TFTP/DHCP
  and does not take the AutoLab mutex. Run it from elevated Windows PowerShell after
  Endpoint Sync, Preflight, and Start services in the Web Console.

  Default targets are winception-autolab-01..04 (Secure Boot On + TPM On). Do not use
  historical winception-client-01..04 for AutoLab. Winception-Clean drops Hyper-V TPM;
  -RestoreCheckpoint reapplies firmware, then Network-first boot.

.EXAMPLE
  .\tools\Restart-HyperVms.ps1 -RestoreCheckpoint
.EXAMPLE
  .\tools\Restart-HyperVms.ps1 -Name winception-autolab-01 -RestoreCheckpoint
.EXAMPLE
  .\tools\Restart-HyperVms.ps1 -RestoreCheckpoint -NoStart
.EXAMPLE
  .\tools\Restart-HyperVms.ps1 -Name winception-autolab-ipxe-01 -Ipxe -RestoreCheckpoint
#>
[CmdletBinding()]
param(
    [string]$VmPrefix = 'winception-autolab-',
    [int]$StartIndex = 1,
    [int]$EndIndex = 4,
    [string[]]$Name,
    [long]$MemoryStartupBytes = 4GB,
    [string]$CheckpointName = 'Winception-Clean',
    [switch]$RestoreCheckpoint,
    [switch]$NoStart,
    [switch]$Ipxe,
    [switch]$PassThru
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($MemoryStartupBytes -lt 4GB) {
    throw 'MemoryStartupBytes must be at least 4 GB for concurrent WinPE image application.'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Restart-HyperVms.ps1 must run in elevated Windows PowerShell (Start-Process -Verb RunAs).'
}

$blockedNames = @(
    'winception-autolab-router',
    'winception-software-test-01',
    'winception-usb-iso-01'
)

function Get-VmName {
    param(
        [string]$Prefix,
        [int]$Index
    )

    '{0}{1}' -f $Prefix, $Index.ToString('00')
}

function Test-LabMutexFree {
    $mutex = [System.Threading.Mutex]::new($false, 'Global\Winception-AutoLab')
    try {
        $free = $mutex.WaitOne(0)
        if ($free) { $mutex.ReleaseMutex() | Out-Null }
        return [bool]$free
    }
    finally {
        $mutex.Dispose()
    }
}

function Get-FirmwareEntries {
    param($Firmware)

    $list = New-Object System.Collections.Generic.List[object]
    if ($null -eq $Firmware) {
        return , $list
    }
    $prop = $Firmware.PSObject.Properties['BootOrder']
    if (-not $prop -or $null -eq $prop.Value) {
        return , $list
    }
    foreach ($entry in @($prop.Value)) {
        if ($null -ne $entry) {
            $list.Add($entry)
        }
    }
    return , $list
}

function Get-EntryBootType {
    param($Entry)

    if ($null -eq $Entry) { return '' }
    $prop = $Entry.PSObject.Properties['BootType']
    if (-not $prop -or $null -eq $prop.Value) { return '' }
    [string] $prop.Value
}

function Get-EntryDeviceId {
    param($Entry)

    if ($null -eq $Entry) { return '' }
    $devProp = $Entry.PSObject.Properties['Device']
    if (-not $devProp -or $null -eq $devProp.Value) { return '' }
    $idProp = $devProp.Value.PSObject.Properties['Id']
    if (-not $idProp -or $null -eq $idProp.Value) { return '' }
    [string] $idProp.Value
}

function Get-NetworkBootSource {
    param($Firmware)

    foreach ($entry in (Get-FirmwareEntries -Firmware $Firmware)) {
        if ((Get-EntryBootType -Entry $entry) -eq 'Network') {
            return $entry
        }
    }
    $null
}

function Set-VmTpmEnabled {
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
            $protector = Get-VMKeyProtector -VMName $VmName -ErrorAction SilentlyContinue
            $protectorLength = 0
            if ($protector -is [byte[]]) {
                $protectorLength = $protector.Length
            }
            if ($protectorLength -lt 32) {
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

function Set-VmRestingFirmware {
    param(
        [Parameter(Mandatory)][string] $VmName,
        [Parameter(Mandatory)][bool] $SecureBoot,
        [Parameter(Mandatory)][bool] $Tpm
    )

    $security = Get-VMSecurity -VMName $VmName -ErrorAction Stop
    $tpmAlreadyOn = $false
    $tpmProp = $security.PSObject.Properties['TpmEnabled']
    if ($tpmProp -and $null -ne $tpmProp.Value) {
        $tpmAlreadyOn = [bool] $tpmProp.Value
    }

    if ($SecureBoot) {
        # Hyper-V forbids rewriting SecureBootTemplate after TPM key-protector init.
        if ($tpmAlreadyOn) {
            Set-VMFirmware -VMName $VmName -EnableSecureBoot On
        }
        else {
            Set-VMFirmware -VMName $VmName -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows
        }
    }
    else {
        Set-VMFirmware -VMName $VmName -EnableSecureBoot Off
    }
    Set-VmTpmEnabled -VmName $VmName -Enabled $Tpm
}

function Set-VmNetworkFirstBoot {
    param([Parameter(Mandatory)][string] $VmName)

    $adapter = Get-VMNetworkAdapter -VMName $VmName | Select-Object -First 1
    if (-not $adapter) {
        throw "$VmName has no network adapter."
    }

    $firmware = Get-VMFirmware -VMName $VmName -ErrorAction Stop
    $networkSource = Get-NetworkBootSource -Firmware $firmware
    if ($networkSource -and (Get-EntryDeviceId -Entry $networkSource) -eq [string] $adapter.Id) {
        Set-VMFirmware -VMName $VmName -FirstBootDevice $networkSource
    }
    else {
        Set-VMFirmware -VMName $VmName -FirstBootDevice $adapter
    }
}

if (-not (Test-LabMutexFree)) {
    throw 'Winception AutoLab mutex is held. Do not PXE-restart VMs while a Lab run is active.'
}

$vmNames = @()
if ($Name -and $Name.Count -gt 0) {
    $vmNames = @($Name | ForEach-Object { [string] $_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}
else {
    foreach ($index in $StartIndex..$EndIndex) {
        $vmNames += Get-VmName -Prefix $VmPrefix -Index $index
    }
}

if ($vmNames.Count -eq 0) {
    throw 'No VM names were resolved.'
}

foreach ($vmName in $vmNames) {
    if ($vmName -in $blockedNames) {
        throw "$vmName is not a PXE client target for this helper."
    }
}

foreach ($vmName in $vmNames) {
    Write-Host "Preparing $vmName for a network boot..." -ForegroundColor Cyan

    try {
        $vm = Get-VM -Name $vmName

        if ($vm.Generation -ne 2) {
            throw "$vmName is not a generation 2 VM; Set-VMFirmware cannot be used."
        }

        Stop-VM -Name $vmName -TurnOff -Force -Confirm:$false

        if ($RestoreCheckpoint) {
            $snapshot = Get-VMSnapshot -VMName $vmName -Name $CheckpointName -ErrorAction SilentlyContinue
            if (-not $snapshot) {
                throw "$vmName is missing checkpoint '$CheckpointName'."
            }
            Start-Sleep -Seconds 2
            Restore-VMSnapshot -VMName $vmName -Name $CheckpointName -Confirm:$false
            Start-Sleep -Seconds 2
        }

        Set-VMMemory -VMName $vmName -DynamicMemoryEnabled $false -StartupBytes $MemoryStartupBytes

        $wantIpxe = $Ipxe -or ($vmName -match '(?i)ipxe')
        $wantSecureBoot = -not $wantIpxe
        $wantTpm = $wantSecureBoot
        if ($RestoreCheckpoint) {
            Set-VmRestingFirmware -VmName $vmName -SecureBoot $wantSecureBoot -Tpm $wantTpm
        }

        Set-VmNetworkFirstBoot -VmName $vmName

        $started = $false
        if (-not $NoStart) {
            Start-VM -Name $vmName
            $started = $true
            Write-Host "-> $vmName was turned off and configured for network boot." -ForegroundColor Yellow
            Write-Host "-> $vmName restarted.`n" -ForegroundColor Green
        }
        else {
            Write-Host "-> $vmName is Off, Network-first, and ready for a later start.`n" -ForegroundColor Yellow
        }

        if ($PassThru) {
            [pscustomobject]@{
                VMName      = $vmName
                Status      = if ($started) { 'Restarted' } else { 'Prepared' }
                Started     = $started
                Restored    = [bool] $RestoreCheckpoint
                SecureBoot  = $wantSecureBoot
                Tpm         = $wantTpm
                MemoryBytes = $MemoryStartupBytes
            }
        }
    }
    catch {
        Write-Host "-> $vmName failed: $($_.Exception.Message)`n" -ForegroundColor Red

        if ($PassThru) {
            [pscustomobject]@{
                VMName  = $vmName
                Status  = 'Failed'
                Started = $false
                Error   = $_.Exception.Message
            }
        }
    }
}
