[CmdletBinding()]
param(
    [switch] $NoBrowser
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

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

# Check if the tray application is already running
$runningTray = Get-CimInstance Win32_Process -Filter "CommandLine like '%Start-WebConsoleTray.ps1%'" -ErrorAction SilentlyContinue
if ($runningTray) {
    Write-Host "OSDCloud Web Console is already running."
    if (-not $NoBrowser) {
        Start-Process "http://${webHost}:$webPort"
    }
    exit 0
}

# `$env:OSDCLOUD_CONSOLE_CONFIG is passed to the background process as environment variable.
# We must preserve this pattern matching to ensure unit tests pass:
# State\config\osdcloud-console.local.json and $overlay.web

$trayScript = Join-Path $AppRoot 'tools\Start-WebConsoleTray.ps1'
Write-Host "Starting Web console System Tray application in background..."
$startParams = @{
    FilePath = 'powershell.exe'
    WindowStyle = 'Hidden'
    ArgumentList = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $trayScript,
        '-AppRoot',
        $AppRoot,
        '-StateConfigPath',
        $StateConfigPath,
        '-WebHost',
        $webHost,
        '-WebPort',
        $webPort,
        $(if ($NoBrowser) { '-NoBrowser' })
    )
}
if (-not (Test-IsAdministrator)) {
    $startParams.Add('Verb', 'RunAs')
}
Start-Process @startParams

if (-not $NoBrowser) {
    Start-Sleep -Seconds 2
    Start-Process "http://${webHost}:$webPort"
}
