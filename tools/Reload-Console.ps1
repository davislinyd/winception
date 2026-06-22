[CmdletBinding()]
param(
    [string] $AppRoot = 'C:\OSDCloud\HostTools\App'
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom

$SourceRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Copying updated files to $AppRoot..."
Copy-Item -Path (Join-Path $SourceRoot "tools") -Destination $AppRoot -Recurse -Force
Copy-Item -Path (Join-Path $SourceRoot "Softwares") -Destination $AppRoot -Recurse -Force
Copy-Item -Path (Join-Path $SourceRoot "osdcloud-assets") -Destination $AppRoot -Recurse -Force
Copy-Item -Path (Join-Path $SourceRoot "package.json") -Destination $AppRoot -Force
Copy-Item -Path (Join-Path $SourceRoot 'New-WinceptionUsbInstaller.cmd') -Destination $AppRoot -Force
$ManualRoot = Join-Path $AppRoot 'docs'
New-Item -ItemType Directory -Path $ManualRoot -Force | Out-Null
Copy-Item -Path (Join-Path $SourceRoot 'docs\winception-operations-manual.html') -Destination $ManualRoot -Force
Copy-Item -Path (Join-Path $SourceRoot 'docs\manual-assets') -Destination $ManualRoot -Recurse -Force

Write-Host "Finding and terminating active Web Console process..."
# Kill the tray process first — it is the persistent parent that spawns node.
# If only node is killed, Start-InstalledWebConsole.ps1 detects the still-running
# tray and exits early ("already running"), leaving the web server dead.
$trayProcess = Get-CimInstance Win32_Process -Filter "CommandLine like '%Start-WebConsoleTray.ps1%'"
if ($trayProcess) {
    Write-Host "Terminating Web Console Tray process: $($trayProcess.ProcessId)"
    $trayProcess | Invoke-CimMethod -MethodName Terminate | Out-Null
    Start-Sleep -Seconds 1
}
# Some node processes report an empty CommandLine in WMI (orphan after tray exit).
# Fall back to finding any node.exe bound to the web console port.
$webPort = 8080
try {
    $hostToolsRoot = Split-Path -Parent $AppRoot
    $stateConfigPath = Join-Path $hostToolsRoot 'State\config\osdcloud-console.json'
    if (Test-Path $stateConfigPath) {
        $cfg = Get-Content $stateConfigPath -Raw | ConvertFrom-Json
        if ($cfg.web.port) { $webPort = [int]$cfg.web.port }
    }
} catch {}
$nodeByCommandLine = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' and CommandLine like '%webServer.js%'"
$nodeByPort = if (-not $nodeByCommandLine) {
    $conn = Get-NetTCPConnection -LocalPort $webPort -State Listen -ErrorAction SilentlyContinue
    if ($conn) { Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess) and Name = 'node.exe'" -ErrorAction SilentlyContinue }
}
$nodeProcess = if ($nodeByCommandLine) { $nodeByCommandLine } else { $nodeByPort }
if ($nodeProcess) {
    Write-Host "Terminating Web Console node process: $($nodeProcess.ProcessId)"
    $nodeProcess | Invoke-CimMethod -MethodName Terminate | Out-Null
    Start-Sleep -Seconds 1
}
if (-not $trayProcess -and -not $nodeProcess) {
    Write-Host "No running Web Console process detected."
}

Write-Host "Starting Web Console..."
Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Join-Path $AppRoot "tools\Start-InstalledWebConsole.ps1"),
    "-NoBrowser"
)

Write-Host "Reload complete!"
