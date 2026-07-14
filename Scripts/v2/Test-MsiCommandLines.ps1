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

'MSI custom-action command lines passed.'
