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
Copy-Item -Path (Join-Path $SourceRoot "package.json") -Destination $AppRoot -Force

Write-Host "Finding and terminating active Web Console process..."
$process = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' and CommandLine like '%webServer.js%'"
if ($process) {
    Write-Host "Terminating Web Console process: $($process.ProcessId)"
    $process | Invoke-CimMethod -MethodName Terminate | Out-Null
    Start-Sleep -Seconds 1
} else {
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
