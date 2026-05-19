# 1. SetupComplete runs as SYSTEM, so use the deployment-provided target desktop.
$desktopPath = if ($env:OSDCloudTargetDesktopPath) {
    $env:OSDCloudTargetDesktopPath
}
else {
    Join-Path $env:SystemDrive 'Users\Default\Desktop'
}

New-Item -ItemType Directory -Path $desktopPath -Force | Out-Null
$filePath = Join-Path $desktopPath "auto.txt"

# 2. 取得主機名稱與當下時間
$computerName = $env:COMPUTERNAME
$currentTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# 3. 組合文字內容（`r`n 為 Windows 的標準換行符號）
$content = "主機名稱: $computerName`r`n產出時間: $currentTime"

# 4. 使用 .NET 類別直接寫入檔案（強制轉為帶 BOM 的 UTF-8）
[System.IO.File]::WriteAllText($filePath, $content, [System.Text.Encoding]::UTF8)

Write-Host "已成功在 $desktopPath 建立 auto.txt！(採用 .NET 方法)" -ForegroundColor Green
