[CmdletBinding()]
param(
  [string]$AppRoot = "$env:ProgramFiles\Winception\app",
  [string]$StateRoot = "$env:ProgramData\Winception\State"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$settingsPath = Join-Path ([IO.Path]::GetFullPath($StateRoot)) 'service-settings.json'
if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) { throw 'Winception service settings were not found.' }
$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($settings.schemaVersion -ne 1 -or [string]::IsNullOrWhiteSpace([string]$settings.managementTokenProtected)) {
  throw 'Winception service settings do not contain a protected setup code.'
}
$protector = Join-Path ([IO.Path]::GetFullPath($AppRoot)) 'tools\v2\Protect-WinceptionSecret.ps1'
if (-not (Test-Path -LiteralPath $protector -PathType Leaf)) { throw 'The Winception DPAPI helper was not found.' }
$setupCode = [string]$settings.managementTokenProtected | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $protector -Mode Unprotect -Name management-token
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($setupCode)) { throw 'Unable to decrypt the Winception setup code.' }
[Console]::Out.Write($setupCode.Trim())
