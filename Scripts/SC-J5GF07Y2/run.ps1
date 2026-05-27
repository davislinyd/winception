# 1. SetupComplete runs as SYSTEM, so use the deployment-provided target desktop.
$desktopPath = if ($env:OSDCloudTargetDesktopPath) {
    $env:OSDCloudTargetDesktopPath
}
else {
    Join-Path $env:SystemDrive 'Users\Default\Desktop'
}

New-Item -ItemType Directory -Path $desktopPath -Force | Out-Null
$filePath = Join-Path $desktopPath 'auto.txt'

$computerName = $env:COMPUTERNAME
$currentTime = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

$content = "ComputerName: $computerName`r`nGeneratedAt: $currentTime"

[System.IO.File]::WriteAllText($filePath, $content, [System.Text.Encoding]::UTF8)

Write-Host "Created $filePath"
