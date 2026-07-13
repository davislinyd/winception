[CmdletBinding()]
param([string]$Root = '')
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Join-Path $PSScriptRoot '..\..' }
$errors = [Collections.Generic.List[object]]::new()
foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -File -Filter *.ps1 | Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' }) {
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
