[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$packagePath = Join-Path $repo 'installer\wix\Package.wxs'
$source = Get-Content -LiteralPath $packagePath -Raw

if ($source -notmatch 'Id="ProvisionServiceSettings"[^\r\n]+-AppRoot &quot;\[APPFOLDER\]\.&quot;') {
  throw 'ProvisionServiceSettings must neutralize the trailing APPFOLDER separator with a dot path segment.'
}
if ($source -match '-AppRoot &quot;\[APPFOLDER\]&quot;') {
  throw 'ProvisionServiceSettings contains a quoted APPFOLDER value whose trailing separator can escape the closing quote.'
}
if ($source -notmatch 'Action="ProvisionServiceSettings" After="BackupDatabase" Condition="NOT Installed AND NOT WIX_UPGRADE_DETECTED"') {
  throw 'ProvisionServiceSettings must run only for a fresh install and preserve service settings during major upgrades.'
}
if ($source -notmatch 'Id="RemoveFirewallRules"[^\r\n]+Remove-WinceptionFirewallRules\.ps1') {
  throw 'The MSI must execute the product-owned firewall cleanup script during uninstall.'
}
if ($source -notmatch 'Action="RemoveFirewallRules" Before="RemoveFiles" Condition="REMOVE~=&quot;ALL&quot; AND NOT UPGRADINGPRODUCTCODE"') {
  throw 'The MSI must remove product-owned firewall rules only during full uninstall, not during a major upgrade.'
}

$serviceSettingsPath = Join-Path $repo 'tools\v2\Initialize-WinceptionServices.ps1'
$serviceSettingsSource = Get-Content -LiteralPath $serviceSettingsPath -Raw
if ($serviceSettingsSource -notmatch "Contains\('tls'\)") {
  throw 'Loopback service provisioning must guard optional TLS settings under StrictMode.'
}

$upgradeStepPath = Join-Path $repo 'tools\v2\Invoke-MsiUpgradeStep.ps1'
$upgradeStepSource = Get-Content -LiteralPath $upgradeStepPath -Raw
if ($upgradeStepSource -notmatch "PSObject\.Properties\['tls'\]") {
  throw 'The MSI health probe must guard optional TLS settings under StrictMode.'
}
if ($upgradeStepSource -match '\$settings\.tls') {
  throw 'The MSI health probe must not directly access an optional TLS property.'
}
if ($upgradeStepSource -notmatch 'handler\.UseProxy = false;') {
  throw 'The pinned local HTTPS health probe must bypass system proxy configuration.'
}

$managementEndpointPath = Join-Path $repo 'tools\v2\Set-WinceptionManagementEndpoint.ps1'
$managementEndpointSource = Get-Content -LiteralPath $managementEndpointPath -Raw
if (@([regex]::Matches($managementEndpointSource, 'powershell\.exe[^\r\n]+2>&1 \| Out-Null')).Count -lt 2) {
  throw 'Management endpoint child PowerShell errors must be reduced to exit codes so rollback catch/finally always executes.'
}

'MSI custom-action command lines passed.'
