[CmdletBinding()]
param(
    [string] $HostToolsRoot,
    [string] $TransactionPath,
    [switch] $ConsoleAlreadyStopped
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($HostToolsRoot)) {
    if ((Split-Path -Leaf $PSScriptRoot) -ieq 'tools') {
        $HostToolsRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    } else {
        $HostToolsRoot = $PSScriptRoot
    }
}
$HostToolsRoot = [System.IO.Path]::GetFullPath($HostToolsRoot)
$AppRoot = Join-Path $HostToolsRoot 'App'
$StateRoot = Join-Path $HostToolsRoot 'State'
$modulePath = Join-Path $HostToolsRoot 'HostManagementUpgrade.ps1'
if (-not (Test-Path -LiteralPath $modulePath -PathType Leaf)) {
    $modulePath = Join-Path $PSScriptRoot 'lib\HostManagementUpgrade.ps1'
}
if (-not (Test-Path -LiteralPath $modulePath -PathType Leaf)) {
    throw "HostTools upgrade recovery module not found: $modulePath"
}
. $modulePath

if (-not $ConsoleAlreadyStopped) {
    $configPath = Join-Path $StateRoot 'config\osdcloud-console.json'
    $localConfigPath = Join-Path $StateRoot 'config\osdcloud-console.local.json'
    $port = 8080
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        try {
            $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
            if ($config.web.port) { $port = [int]$config.web.port }
        } catch {}
    }
    if (Test-Path -LiteralPath $localConfigPath -PathType Leaf) {
        try {
            $localConfig = Get-Content -LiteralPath $localConfigPath -Raw | ConvertFrom-Json
            if ($localConfig.web.port) { $port = [int]$localConfig.web.port }
        } catch {}
    }
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        throw "HostTools Web Console port $port is still listening. Stop the console, then run Restore-HostManagementUpgrade.ps1 again."
    }
}

if (-not [string]::IsNullOrWhiteSpace($TransactionPath)) {
    $transaction = Read-HostToolsUpgradeTransaction -TransactionPath $TransactionPath
    Restore-HostToolsUpgradeTransaction -TransactionPath $transaction.manifestPath -HostToolsRoot $HostToolsRoot -AppRoot ([string]$transaction.manifest.appRoot) -StateRoot ([string]$transaction.manifest.stateRoot)
    Write-Host "Restored HostTools upgrade transaction $($transaction.manifest.transactionId)."
    exit 0
}

$restored = Restore-HostToolsUpgradeFromPointer -HostToolsRoot $HostToolsRoot
if ($restored) {
    Write-Host 'Restored the interrupted HostTools upgrade to its previous App and scoped State.'
} else {
    Write-Host 'No pending HostTools upgrade transaction.'
}
