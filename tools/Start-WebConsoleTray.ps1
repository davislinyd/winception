[CmdletBinding()]
param(
    [string] $AppRoot,
    [string] $StateConfigPath,
    [string] $WebHost,
    [int] $WebPort,
    [switch] $NoBrowser
)

$ErrorActionPreference = 'Stop'

# Add Windows Forms and Drawing assemblies
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Set environment variable for configuration path so node can inherit it
$env:OSDCLOUD_CONSOLE_CONFIG = $StateConfigPath

$HostToolsRoot = Split-Path -Parent $AppRoot
$RunRoot = Join-Path $HostToolsRoot 'State\run'
$TrayStatePath = Join-Path $RunRoot 'web-console-tray.json'
$TrayStopRequestPath = Join-Path $RunRoot 'web-console-tray.stop.json'
$global:StoppingTray = $false

function Get-AppRootMutexName {
    $fullAppRoot = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd('\').ToLowerInvariant()
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($fullAppRoot)
        $hash = ($sha256.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
        return "Local\Winception.OSDCloud.WebConsoleTray.$($hash.Substring(0, 16))"
    }
    finally {
        $sha256.Dispose()
    }
}

$mutexCreated = $false
$global:TrayMutex = [System.Threading.Mutex]::new($true, (Get-AppRootMutexName), [ref] $mutexCreated)
if (-not $mutexCreated) {
    Write-Host "OSDCloud Web Console tray is already running for this AppRoot."
    exit 0
}

function Write-TrayState {
    New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null
    $state = [ordered]@{
        appRoot = [System.IO.Path]::GetFullPath($AppRoot)
        stateConfigPath = [System.IO.Path]::GetFullPath($StateConfigPath)
        webHost = $WebHost
        webPort = $WebPort
        trayPid = $PID
        nodePid = if ($global:NodeProcess) { $global:NodeProcess.Id } else { $null }
        startedAt = [DateTimeOffset]::Now.ToString('o')
    }
    [System.IO.File]::WriteAllText(
        $TrayStatePath,
        (($state | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Stop-TrayApplication {
    if ($global:StoppingTray) {
        return
    }
    $global:StoppingTray = $true

    if ($global:StopTimer) {
        $global:StopTimer.Stop()
        $global:StopTimer.Dispose()
    }
    if ($global:NodeProcess -and -not $global:NodeProcess.HasExited) {
        $global:NodeProcess | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    if ($global:NotifyIcon) {
        $global:NotifyIcon.Visible = $false
        $global:NotifyIcon.Dispose()
    }
    Remove-Item -LiteralPath $TrayStatePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $TrayStopRequestPath -Force -ErrorAction SilentlyContinue
    if ($global:TrayMutex) {
        try { $global:TrayMutex.ReleaseMutex() } catch {}
        $global:TrayMutex.Dispose()
    }
    [System.Windows.Forms.Application]::Exit()
}

function Test-StopRequest {
    if (-not (Test-Path -LiteralPath $TrayStopRequestPath -PathType Leaf)) {
        return
    }

    try {
        $request = Get-Content -LiteralPath $TrayStopRequestPath -Raw | ConvertFrom-Json
        $requestedRoot = if ($request.appRoot) { [System.IO.Path]::GetFullPath([string] $request.appRoot).TrimEnd('\') } else { '' }
        $currentRoot = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
        if ([string]::IsNullOrWhiteSpace($requestedRoot) -or $requestedRoot -ieq $currentRoot) {
            Stop-TrayApplication
        }
    }
    catch {
        Remove-Item -LiteralPath $TrayStopRequestPath -Force -ErrorAction SilentlyContinue
    }
}

# Function to spawn the Node.js web server process in background
function Start-NodeServer {
    $webServerScript = Join-Path $AppRoot 'tools\osdcloud-console\src\webServer.js'
    $nodeProcess = Start-Process node -WorkingDirectory $AppRoot -ArgumentList $webServerScript -WindowStyle Hidden -PassThru
    return $nodeProcess
}

function Get-TrayIcon {
    $webIconPath = Join-Path $AppRoot 'tools\osdcloud-console\web\logo.ico'
    if (Test-Path -LiteralPath $webIconPath -PathType Leaf) {
        try {
            return [System.Drawing.Icon]::new($webIconPath)
        }
        catch {
            # Fall through to host icon fallback.
        }
    }

    try {
        $currentProcessPath = (Get-Process -Id $PID).Path
        return [System.Drawing.Icon]::ExtractAssociatedIcon($currentProcessPath)
    }
    catch {
        return [System.Drawing.SystemIcons]::Application
    }
}

# Start the Node.js server
$global:NodeProcess = Start-NodeServer

# Setup System Tray Icon
try {
    $global:NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
    $global:NotifyIcon.Text = "OSDCloud Web Console"
    $global:NotifyIcon.Icon = Get-TrayIcon

    $global:NotifyIcon.Visible = $true

    # Create context menu
    $contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

    $itemOpen = New-Object System.Windows.Forms.ToolStripMenuItem("Open Web Console")
    $itemOpen.add_Click({
        Start-Process "http://${WebHost}:${WebPort}"
    })
    $contextMenu.Items.Add($itemOpen) | Out-Null

    $itemRestart = New-Object System.Windows.Forms.ToolStripMenuItem("Restart Web Server")
    $itemRestart.add_Click({
        if ($global:NodeProcess -and -not $global:NodeProcess.HasExited) {
            $global:NodeProcess | Stop-Process -Force
        }
        $global:NodeProcess = Start-NodeServer
        $global:NotifyIcon.ShowBalloonTip(3000, "OSDCloud Console", "Web server restarted", [System.Windows.Forms.ToolTipIcon]::Info)
    })
    $contextMenu.Items.Add($itemRestart) | Out-Null

    $contextMenu.Items.Add("-") | Out-Null # Separator

    $itemExit = New-Object System.Windows.Forms.ToolStripMenuItem("Exit")
    $itemExit.add_Click({
        if ($global:NodeProcess -and -not $global:NodeProcess.HasExited) {
            $global:NodeProcess | Stop-Process -Force
        }
        $global:NotifyIcon.Visible = $false
        $global:NotifyIcon.Dispose()
        [System.Windows.Forms.Application]::Exit()
    })
    $contextMenu.Items.Add($itemExit) | Out-Null

    $global:NotifyIcon.ContextMenuStrip = $contextMenu

    # Double click opens the web console
    $global:NotifyIcon.add_DoubleClick({
        Start-Process "http://${WebHost}:${WebPort}"
    })

    # Show Balloon Notification on startup
    if (-not $NoBrowser) {
        $global:NotifyIcon.ShowBalloonTip(3000, "OSDCloud Console", "Web Console running in background", [System.Windows.Forms.ToolTipIcon]::Info)
    }

    Write-TrayState

    $global:StopTimer = New-Object System.Windows.Forms.Timer
    $global:StopTimer.Interval = 1000
    $global:StopTimer.add_Tick({ Test-StopRequest })
    $global:StopTimer.Start()
}
catch {
    Write-Warning "Could not initialize System Tray Icon (non-interactive session): $_"
}

# Run message loop
try {
    [System.Windows.Forms.Application]::Run()
}
finally {
    Stop-TrayApplication
}
