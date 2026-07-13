[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$files = @(Get-ChildItem -LiteralPath (Join-Path $repo 'tools'), (Join-Path $repo 'installer'), (Join-Path $repo 'Scripts\v2') -Recurse -Filter '*.ps1' -File)
$failed = @()
foreach ($file in $files) {
  $tokens = $null
  $errors = $null
  $source = Get-Content -LiteralPath $file.FullName -Raw -Encoding utf8
  [Management.Automation.Language.Parser]::ParseInput($source, $file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) { $failed += "$($file.FullName): $($errors[0].Message)" }
}
if ($failed.Count -gt 0) { throw ($failed -join [Environment]::NewLine) }
"PowerShell syntax: $($files.Count) files parsed."
