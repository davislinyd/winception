[CmdletBinding()]
param(
    [switch] $NoBrowser
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

$AppRoot = Split-Path -Parent $PSScriptRoot
$HostToolsRoot = Split-Path -Parent $AppRoot
$StateConfigPath = Join-Path $HostToolsRoot 'State\config\osdcloud-console.json'
$LocalConfigPath = Join-Path $HostToolsRoot 'State\config\osdcloud-console.local.json'

if (-not (Test-Path -LiteralPath $StateConfigPath -PathType Leaf)) {
    throw "Installed Web console config not found: $StateConfigPath"
}

$config = Get-Content -LiteralPath $StateConfigPath -Raw | ConvertFrom-Json
if (Test-Path -LiteralPath $LocalConfigPath -PathType Leaf) {
    $overlayRaw = Get-Content -LiteralPath $LocalConfigPath -Raw
    if (-not [string]::IsNullOrWhiteSpace($overlayRaw)) {
        $overlay = $overlayRaw | ConvertFrom-Json
        if ($overlay.web) {
            if ($overlay.web.host) {
                $config.web.host = $overlay.web.host
            }
            if ($overlay.web.port) {
                $config.web.port = $overlay.web.port
            }
        }
    }
}
$webHost = if ($config.web.host) { [string] $config.web.host } else { '127.0.0.1' }
$webPort = if ($config.web.port) { [int] $config.web.port } else { 8080 }
$escapedAppRoot = $AppRoot.Replace("'", "''")
$escapedConfigPath = $StateConfigPath.Replace("'", "''")
$command = "`$env:OSDCLOUD_CONSOLE_CONFIG='$escapedConfigPath'; Set-Location -LiteralPath '$escapedAppRoot'; npm run web"

Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-NoExit',
    '-Command',
    $command
) -Verb $(if (Test-IsAdministrator) { 'Open' } else { 'RunAs' })

if (-not $NoBrowser) {
    Start-Sleep -Seconds 2
    Start-Process "http://${webHost}:$webPort"
}
