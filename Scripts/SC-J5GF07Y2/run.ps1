# 1. SetupComplete runs as SYSTEM, so "Desktop" resolves to Public. Target davis explicitly.
$targetUser = 'davis'
$profileKey = Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList' |
    ForEach-Object {
        $profile = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
        if ($profile.ProfileImagePath -and (Split-Path -Leaf $profile.ProfileImagePath) -ieq $targetUser) {
            $profile.ProfileImagePath
        }
    } |
    Select-Object -First 1

if ($profileKey) {
    $desktopPath = Join-Path $profileKey 'Desktop'
}
else {
    $desktopPath = Join-Path $env:SystemDrive 'Users\Default\Desktop'
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
