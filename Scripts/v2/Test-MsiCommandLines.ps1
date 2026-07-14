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

'MSI custom-action command lines passed.'
