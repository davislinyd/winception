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

# Function to spawn the Node.js web server process in background
function Start-NodeServer {
    $webServerScript = Join-Path $AppRoot 'tools\osdcloud-console\src\webServer.js'
    $nodeProcess = Start-Process node -WorkingDirectory $AppRoot -ArgumentList $webServerScript -WindowStyle Hidden -PassThru
    return $nodeProcess
}

# Start the Node.js server
$global:NodeProcess = Start-NodeServer

# Setup System Tray Icon
try {
    $global:NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
    $global:NotifyIcon.Text = "OSDCloud Web Console"

    # Try to extract the icon from the current PowerShell/pwsh host executable
    try {
        $currentProcessPath = (Get-Process -Id $PID).Path
        $global:NotifyIcon.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($currentProcessPath)
    }
    catch {
        $global:NotifyIcon.Icon = [System.Drawing.SystemIcons]::Application
    }

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
}
catch {
    Write-Warning "Could not initialize System Tray Icon (non-interactive session): $_"
}

# Run message loop
[System.Windows.Forms.Application]::Run()
