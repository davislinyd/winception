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
    Write-Host "正在強制處理 $vmName..." -ForegroundColor Cyan

    try {
        $vm = Get-VM -Name $vmName

        if ($vm.Generation -ne 2) {
            throw "$vmName 不是第 2 代 VM，無法使用 Set-VMFirmware。"
        }

        Stop-VM -Name $vmName -TurnOff -Force -Confirm:$false

        $netAdapter = Get-VMNetworkAdapter -VMName $vmName | Select-Object -First 1
        if (-not $netAdapter) {
            throw "$vmName 找不到可用的網卡。"
        }

        Set-VMFirmware -VMName $vmName -FirstBootDevice $netAdapter
        Start-VM -Name $vmName

        Write-Host "-> $vmName 已強制關閉並設定為網卡開機" -ForegroundColor Yellow
        Write-Host "-> $vmName 已重新開機！`n" -ForegroundColor Green

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
        Write-Host "-> $vmName 失敗：$($_.Exception.Message)`n" -ForegroundColor Red

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
