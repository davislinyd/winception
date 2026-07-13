[CmdletBinding()]
param([string]$Root = '')
$ErrorActionPreference = 'Stop'
$excludeBuildOutputs = [string]::IsNullOrWhiteSpace($Root)
if ($excludeBuildOutputs) { $Root = Join-Path $PSScriptRoot '..\..' }
$errors = [Collections.Generic.List[object]]::new()
foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -File -Filter *.ps1 | Where-Object {
  $_.FullName -notmatch '[\\/]node_modules[\\/]' -and (-not $excludeBuildOutputs -or $_.FullName -notmatch '[\\/](?:\.v2-stage|\.v2-cache|\.tmp-v2[^\\/]*|test-results|installer[\\/]output|installer[\\/]wix[\\/]obj)[\\/]')
}) {
  $tokens = $null
  $parseErrors = $null
  $source = Get-Content -LiteralPath $file.FullName -Raw -Encoding utf8
  [void][Management.Automation.Language.Parser]::ParseInput($source, $file.FullName, [ref]$tokens, [ref]$parseErrors)
  foreach ($parseError in $parseErrors) { $errors.Add([pscustomobject]@{ file = $file.FullName; message = $parseError.Message; extent = $parseError.Extent.Text }) }
}
if ($errors.Count -gt 0) {
  $errors | Format-Table -AutoSize | Out-String | Write-Error
  exit 1
}
Write-Output 'PowerShell syntax check passed.'
