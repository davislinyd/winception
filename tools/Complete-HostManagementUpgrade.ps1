[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $WebHost,
    [Parameter(Mandatory)][ValidateRange(1,65535)][int] $WebPort,
    [string] $HostToolsRoot,
    [ValidateRange(1,300)][int] $TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($HostToolsRoot)) {
    if ((Split-Path -Leaf $PSScriptRoot) -ieq 'tools') {
        $HostToolsRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    } else {
        $HostToolsRoot = Split-Path -Parent $PSScriptRoot
    }
}
$HostToolsRoot = [System.IO.Path]::GetFullPath($HostToolsRoot)
$modulePath = Join-Path $HostToolsRoot 'HostManagementUpgrade.ps1'
if (-not (Test-Path -LiteralPath $modulePath -PathType Leaf)) {
    $modulePath = Join-Path $PSScriptRoot 'lib\HostManagementUpgrade.ps1'
}
if (-not (Test-Path -LiteralPath $modulePath -PathType Leaf)) {
    throw "HostTools upgrade module not found: $modulePath"
}
. $modulePath

$transactionPath = Get-ActiveHostToolsUpgradeTransaction -HostToolsRoot $HostToolsRoot
if (-not $transactionPath) {
    throw 'No pending HostTools upgrade transaction exists.'
}
$transaction = Read-HostToolsUpgradeTransaction -TransactionPath $transactionPath
if ([System.IO.Path]::GetFullPath([string]$transaction.manifest.appRoot) -ine [System.IO.Path]::GetFullPath((Join-Path $HostToolsRoot 'App'))) {
    throw 'Pending HostTools transaction AppRoot does not match this installation.'
}
if ([System.IO.Path]::GetFullPath([string]$transaction.manifest.stateRoot) -ine [System.IO.Path]::GetFullPath((Join-Path $HostToolsRoot 'State'))) {
    throw 'Pending HostTools transaction StateRoot does not match this installation.'
}

Wait-HostToolsUpgradeReady -WebHost $WebHost -WebPort $WebPort -TimeoutSeconds $TimeoutSeconds
Complete-HostToolsUpgradeTransaction -TransactionPath $transactionPath -HostToolsRoot $HostToolsRoot
Write-Host "Committed HostTools upgrade transaction $($transaction.manifest.transactionId) after HTTP and API readiness passed."
