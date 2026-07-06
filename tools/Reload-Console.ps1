[CmdletBinding()]
param(
    [string] $AppRoot = 'C:\OSDCloud\HostTools\App'
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8NoBom

$SourceRoot = Split-Path -Parent $PSScriptRoot
$HostToolsRoot = Split-Path -Parent $AppRoot
$RunRoot = Join-Path $HostToolsRoot 'State\run'
$TrayStatePath = Join-Path $RunRoot 'web-console-tray.json'
$TrayStopRequestPath = Join-Path $RunRoot 'web-console-tray.stop.json'

function Get-WebPort {
    $webPort = 8080
    try {
        $stateConfigPath = Join-Path $HostToolsRoot 'State\config\osdcloud-console.json'
        if (Test-Path -LiteralPath $stateConfigPath -PathType Leaf) {
            $cfg = Get-Content -LiteralPath $stateConfigPath -Raw | ConvertFrom-Json
            if ($cfg.web.port) {
                $webPort = [int] $cfg.web.port
            }
        }
    }
    catch {}
    return $webPort
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
    if (-not (Test-Path -LiteralPath $TrayStatePath -PathType Leaf)) {
        return $false
    }
    New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null
    $request = [ordered]@{
        appRoot = [System.IO.Path]::GetFullPath($AppRoot)
        requestedAt = [DateTimeOffset]::Now.ToString('o')
        requesterPid = $PID
        reason = 'reload'
    }
    [System.IO.File]::WriteAllText(
        $TrayStopRequestPath,
        (($request | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
        $Utf8NoBom
    )
    return $true
}

function Wait-TrayStop {
    param([int] $TimeoutSeconds = 8)

    $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::Now -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $webPort = Get-WebPort
        $conn = Get-NetTCPConnection -LocalPort $webPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not (Test-Path -LiteralPath $TrayStatePath -PathType Leaf) -and -not $conn) {
            return $true
        }
    }
    return $false
}

function Wait-WebPortClosed {
    param([int] $TimeoutSeconds = 8)

    $webPort = Get-WebPort
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

function Stop-ProcessById {
    param($ProcessId)

    if (-not $ProcessId) {
        return
    }
    $process = Get-Process -Id ([int] $ProcessId) -ErrorAction SilentlyContinue
    if ($process) {
        Write-Host "Terminating Web Console process: $($process.Id)"
        $process | Stop-Process -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $process.Id -Timeout 5 -ErrorAction SilentlyContinue
    }
}

function Stop-WebPortOwner {
    $webPort = Get-WebPort
    $conn = Get-NetTCPConnection -LocalPort $webPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        $processes = Get-CimInstance Win32_Process
        $nodeProcess = $processes | Where-Object { $_.ProcessId -eq $conn.OwningProcess -and $_.Name -eq 'node.exe' } | Select-Object -First 1
        if ($nodeProcess) {
            $parentProcess = $processes | Where-Object { $_.ProcessId -eq $nodeProcess.ParentProcessId -and $_.Name -in @('powershell.exe', 'pwsh.exe') } | Select-Object -First 1
            Stop-ProcessById -ProcessId $nodeProcess.ProcessId
            if ($parentProcess) {
                Stop-ProcessById -ProcessId $parentProcess.ProcessId
            }
        }
    }
}

function Stop-WebConsoleFallback {
    $trayState = Read-TrayState
    if ($trayState) {
        Stop-ProcessById -ProcessId $trayState.nodePid
        Stop-ProcessById -ProcessId $trayState.trayPid
    }

    Stop-WebPortOwner
    for ($attempt = 0; $attempt -lt 3 -and -not (Wait-WebPortClosed -TimeoutSeconds 2); $attempt++) {
        Stop-WebPortOwner
    }

    Remove-Item -LiteralPath $TrayStatePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $TrayStopRequestPath -Force -ErrorAction SilentlyContinue
    if (-not (Wait-WebPortClosed)) {
        throw "Timed out waiting for Web Console port $(Get-WebPort) to close."
    }
}

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

Write-Host "Stopping active Web Console..."
if ((Request-TrayStop) -and (Wait-TrayStop)) {
    Write-Host "Web Console tray stopped gracefully."
}
else {
    Stop-WebConsoleFallback
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
