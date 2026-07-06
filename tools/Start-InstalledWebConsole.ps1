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
$RunRoot = Join-Path $HostToolsRoot 'State\run'
$TrayStatePath = Join-Path $RunRoot 'web-console-tray.json'
$TrayStopRequestPath = Join-Path $RunRoot 'web-console-tray.stop.json'

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

function Test-WebConsoleHealthy {
    try {
        $state = Invoke-RestMethod -Uri "http://${webHost}:$webPort/api/state" -TimeoutSec 3 -ErrorAction Stop
        return ($state.ok -eq $true)
    }
    catch {
        return $false
    }
}

function Read-TrayState {
    if (-not (Test-Path -LiteralPath $TrayStatePath -PathType Leaf)) {
        return $null
    }
    try {
        return Get-Content -LiteralPath $TrayStatePath -Raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Request-TrayStop {
    New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null
    $request = [ordered]@{
        appRoot = [System.IO.Path]::GetFullPath($AppRoot)
        requestedAt = [DateTimeOffset]::Now.ToString('o')
        requesterPid = $PID
        reason = 'launcher-restart'
    }
    [System.IO.File]::WriteAllText(
        $TrayStopRequestPath,
        (($request | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
        $Utf8NoBom
    )
}

function Wait-TrayStop {
    param([int] $TimeoutSeconds = 6)

    $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::Now -lt $deadline) {
        Start-Sleep -Milliseconds 250
        if (-not (Test-Path -LiteralPath $TrayStatePath -PathType Leaf) -and -not (Test-WebConsoleHealthy)) {
            return $true
        }
    }
    return $false
}

function Wait-WebPortClosed {
    param([int] $TimeoutSeconds = 6)

    $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::Now -lt $deadline) {
        $conn = Get-NetTCPConnection -LocalPort $webPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $conn) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Stop-RecordedProcess {
    param($ProcessId)

    if (-not $ProcessId) {
        return
    }
    $process = Get-Process -Id ([int] $ProcessId) -ErrorAction SilentlyContinue
    if ($process) {
        $process | Stop-Process -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $process.Id -Timeout 5 -ErrorAction SilentlyContinue
    }
}

function Stop-WebPortOwner {
    $conn = Get-NetTCPConnection -LocalPort $webPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        $processes = Get-CimInstance Win32_Process
        $nodeProcess = $processes | Where-Object { $_.ProcessId -eq $conn.OwningProcess -and $_.Name -eq 'node.exe' } | Select-Object -First 1
        if ($nodeProcess) {
            $parentProcess = $processes | Where-Object { $_.ProcessId -eq $nodeProcess.ParentProcessId -and $_.Name -in @('powershell.exe', 'pwsh.exe') } | Select-Object -First 1
            Stop-RecordedProcess -ProcessId $nodeProcess.ProcessId
            if ($parentProcess) {
                Stop-RecordedProcess -ProcessId $parentProcess.ProcessId
            }
        }
    }
}

function Stop-StaleWebConsole {
    $trayState = Read-TrayState
    if ($trayState) {
        Stop-RecordedProcess -ProcessId $trayState.nodePid
        Stop-RecordedProcess -ProcessId $trayState.trayPid
    }

    Stop-WebPortOwner
    for ($attempt = 0; $attempt -lt 3 -and -not (Wait-WebPortClosed -TimeoutSeconds 2); $attempt++) {
        Stop-WebPortOwner
    }
    if (-not (Wait-WebPortClosed)) {
        throw "Timed out waiting for Web Console port $webPort to close."
    }
    Remove-Item -LiteralPath $TrayStatePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $TrayStopRequestPath -Force -ErrorAction SilentlyContinue
}

$trayState = Read-TrayState
if (Test-WebConsoleHealthy) {
    if ($trayState) {
        Write-Host "OSDCloud Web Console is already running."
        if (-not $NoBrowser) {
            Start-Process "http://${webHost}:$webPort"
        }
        exit 0
    }
    Write-Host "Web Console server is running without tray state; restarting tray wrapper."
    Stop-StaleWebConsole
}
elseif ($trayState) {
    Request-TrayStop
    if (-not (Wait-TrayStop)) {
        Stop-StaleWebConsole
    }
}

# `$env:OSDCLOUD_CONSOLE_CONFIG is passed to the background process as environment variable.
# We must preserve this pattern matching to ensure unit tests pass:
# State\config\osdcloud-console.local.json and $overlay.web

$trayScript = Join-Path $AppRoot 'tools\Start-WebConsoleTray.ps1'
Write-Host "Starting Web console System Tray application in background..."
$argumentList = @(
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
    $webPort
)
if ($NoBrowser) {
    $argumentList += '-NoBrowser'
}
$startParams = @{
    FilePath = 'powershell.exe'
    WindowStyle = 'Hidden'
    ArgumentList = $argumentList
}
if (-not (Test-IsAdministrator)) {
    $startParams.Add('Verb', 'RunAs')
}
Start-Process @startParams

if (-not $NoBrowser) {
    Start-Sleep -Seconds 2
    Start-Process "http://${webHost}:$webPort"
}
