$ErrorActionPreference = 'Stop'

$LogDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

$installerPath = Join-Path $PSScriptRoot 'npp.8.9.5.Installer.x64.msi'
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw ('Installer not found: ' + $installerPath)
}

$logPath = Join-Path $LogDir 'SW-4UT7PDID-msi.log'
$silentArgs = '/qn /norestart'
$argumentList = '/i "' + $installerPath + '" ' + $silentArgs + ' /L*v "' + $logPath + '"'
$process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $argumentList -Wait -PassThru -WindowStyle Hidden

$successExitCodes = @(0, 1641, 3010)
if ($successExitCodes -notcontains $process.ExitCode) {
    throw ('Notepad++ 8.9.5' + ' installer failed with exit code ' + $process.ExitCode + '. See ' + $logPath)
}

Write-Host ('Notepad++ 8.9.5' + ' installed; no installed-file verification configured')
