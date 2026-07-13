[CmdletBinding()]
param(
  [string]$Root = '',
  [string]$CacheRoot = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$version = '8.30.1'
$expectedSha256 = 'D29144DEFF3A68AA93CED33DDDF84B7FDC26070ADD4AA0F4513094C8332AFC4E'
function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '') }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Join-Path $PSScriptRoot '..\..' }
$Root = [IO.Path]::GetFullPath($Root)
if ([string]::IsNullOrWhiteSpace($CacheRoot)) { $CacheRoot = Join-Path $Root ".v2-cache\gitleaks-$version" }
$CacheRoot = [IO.Path]::GetFullPath($CacheRoot)
New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null

$archive = Join-Path $CacheRoot "gitleaks_${version}_windows_x64.zip"
$executable = Join-Path $CacheRoot 'gitleaks.exe'
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/gitleaks/gitleaks/releases/download/v$version/gitleaks_${version}_windows_x64.zip" -OutFile $archive
}
if ((Get-Sha256 $archive) -ne $expectedSha256) {
  throw 'The pinned Gitleaks archive checksum is invalid.'
}
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  Expand-Archive -LiteralPath $archive -DestinationPath $CacheRoot
}

$reportRoot = Join-Path $CacheRoot "reports-$PID"
if (Test-Path -LiteralPath $reportRoot) { throw 'The secret-scan report directory already exists.' }
New-Item -ItemType Directory -Path $reportRoot | Out-Null
try {
  $historyReport = Join-Path $reportRoot 'history.json'
  $treeReport = Join-Path $reportRoot 'working-tree.json'
  & $executable git $Root --log-opts='--all' --redact=100 --no-banner --no-color --report-format json --report-path $historyReport
  if ($LASTEXITCODE -ne 0) { throw 'Gitleaks found a potential secret in Git history.' }
  & $executable dir $Root --redact=100 --no-banner --no-color --report-format json --report-path $treeReport
  if ($LASTEXITCODE -ne 0) { throw 'Gitleaks found a potential secret in the working tree.' }
  Write-Output 'Gitleaks history and working tree scans passed.'
}
finally {
  Remove-Item -LiteralPath $reportRoot -Recurse -Force -ErrorAction SilentlyContinue
}
