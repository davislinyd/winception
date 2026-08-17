$ErrorActionPreference = 'Stop'

$LogDir = 'C:\Windows\Temp\osdcloud-logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

$msiPath = Join-Path $PSScriptRoot '7z2601-x64.msi'
if (-not (Test-Path -LiteralPath $msiPath -PathType Leaf)) {
    throw "7-Zip MSI not found: $msiPath"
}

$msiLogPath = Join-Path $LogDir '7zip-msi.log'
$argumentList = "/i `"$msiPath`" /qn /norestart REBOOT=ReallySuppress /L*v `"$msiLogPath`""
$process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $argumentList -Wait -PassThru -WindowStyle Hidden

if (@(0, 1641, 3010) -notcontains $process.ExitCode) {
    throw "7-Zip MSI failed with exit code $($process.ExitCode). See $msiLogPath"
}

$installedExe = Join-Path $env:ProgramFiles '7-Zip\7z.exe'
if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
    throw "7-Zip install completed but 7z.exe was not found at $installedExe"
}

Write-Host "7-Zip installed: $installedExe"
