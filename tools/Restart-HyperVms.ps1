param(
    [string]$VmPrefix = 'winception-client-',
    [int]$StartIndex = 1,
    [int]$EndIndex = 4,
    [switch]$PassThru
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-VmName {
    param(
        [string]$Prefix,
        [int]$Index
    )

    '{0}{1}' -f $Prefix, $Index.ToString('00')
}

foreach ($index in $StartIndex..$EndIndex) {
    $vmName = Get-VmName -Prefix $VmPrefix -Index $index
    Write-Host "Preparing $vmName for a network boot..." -ForegroundColor Cyan

    try {
        $vm = Get-VM -Name $vmName

        if ($vm.Generation -ne 2) {
            throw "$vmName is not a generation 2 VM; Set-VMFirmware cannot be used."
        }

        Stop-VM -Name $vmName -TurnOff -Force -Confirm:$false

        $netAdapter = Get-VMNetworkAdapter -VMName $vmName | Select-Object -First 1
        if (-not $netAdapter) {
            throw "$vmName has no network adapter."
        }

        Set-VMFirmware -VMName $vmName -FirstBootDevice $netAdapter
        Start-VM -Name $vmName

        Write-Host "-> $vmName was turned off and configured for network boot." -ForegroundColor Yellow
        Write-Host "-> $vmName restarted.`n" -ForegroundColor Green

        if ($PassThru) {
            [pscustomobject]@{
                VMName   = $vmName
                Status   = 'Restarted'
                Adapter  = $netAdapter.Name
                Started  = $true
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
