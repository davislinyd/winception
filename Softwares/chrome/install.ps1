$ErrorActionPreference = 'Stop'

$logDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$msiPath = Join-Path $PSScriptRoot 'googlechromestandaloneenterprise64.msi'
if (-not (Test-Path -LiteralPath $msiPath -PathType Leaf)) {
    throw "Google Chrome Enterprise MSI not found: $msiPath"
}

$msiLogPath = Join-Path $logDir 'google-chrome-msi.log'
$arguments = "/i `"$msiPath`" /qn /norestart REBOOT=ReallySuppress /L*v `"$msiLogPath`""
$process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden

$successExitCodes = @(0, 1641, 3010)
if ($successExitCodes -notcontains $process.ExitCode) {
    throw "Google Chrome Enterprise MSI failed with exit code $($process.ExitCode). See $msiLogPath"
}

$installedExe = Join-Path ${env:ProgramFiles} 'Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
    $installedExe = Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'
}

if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
    throw "Google Chrome Enterprise MSI completed but chrome.exe was not found under Program Files"
}

Write-Host "Google Chrome Enterprise installed: $installedExe"
