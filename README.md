# OSDCloud Windows 11 Zero-Touch Deployment Lab

這個資料夾記錄 VM + OSDCloud 自動部署 Windows 11 的測試結果與交接資訊。目標是先在 VM 驗證完整流程，再延伸到實體筆電與 iPXE 大量部署。

## 目前狀態

已驗證成功的目標：

- 從 OSDCloud ISO 自動部署 Windows 11
- 使用 ISO 內建 Windows 11 ESD 快取，不重複從外網下載 OS
- 第一次從硬碟開機後自動略過 OOBE
- 建立本地帳號 `davis`
- 密碼為 `password`
- 自動登入桌面
- 語系為 `zh-TW`
- 時區為 `Taipei Standard Time`
- 停用 OOBE 更新檢查

最終驗證 VM：

```text
OSDCloud-Win11-NoTouch-01
```

最終測試結果：

```text
User             : desktop-cfs7s79\davis
ExplorerRunning  : True
DesktopReadyFile : True
OobeProcesses    :
LaunchUserOOBE   : 0
SkipUserOOBE     : 1
NoAutoUpdate     : 1
DisplayVersion   : 25H2
CurrentBuild     : 26200
UBR              : 6584
EditionID        : Professional
Culture          : zh-TW
TimeZone         : Taipei Standard Time
```

## 主要檔案

測試報告：

```text
C:\Users\Davis\Documents\New project\OSDCloud-Win11-Automated-Deployment-Test-Report.md
```

OSDCloud workspace：

```text
C:\OSDCloud\Win11-Lab
```

目前主要 ISO：

```text
C:\OSDCloud\Win11-Lab\OSDCloud_NoPrompt.iso
```

ISO 內建 Windows 11 ESD：

```text
C:\OSDCloud\Win11-Lab\Media\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd
```

自動化腳本：

```text
C:\OSDCloud\Win11-Lab\Config\Scripts\Shutdown\Invoke-DavisOobe.ps1
C:\OSDCloud\Win11-Lab\Config\Scripts\SetupComplete\SetupComplete.cmd
C:\OSDCloud\Win11-Lab\Config\Scripts\SetupComplete\SetupComplete.ps1
```

## Git 管理

這個資料夾使用 Git 追蹤文件與流程設定。

應納入版本控制：

- `README.md`
- `AGENTS.md`
- `OSDCloud-Win11-Automated-Deployment-Test-Report.md`
- `.gitignore`

不應納入版本控制：

- ISO / WIM / ESD
- VHD / AVHDX
- 下載暫存
- VMConnect 截圖
- log / transcript

## ISO 重新產生

使用目前 workspace 重新產生 ISO：

```powershell
Import-Module OSD -Force
Set-OSDCloudWorkspace -WorkspacePath 'C:\OSDCloud\Win11-Lab'

$startArgs = "-OSName 'Windows 11 25H2 x64' -OSLanguage zh-tw -OSEdition Pro -OSActivation Retail -ZTI -SkipAutopilot -SkipODT -Shutdown"

Edit-OSDCloudWinPE `
  -WorkspacePath 'C:\OSDCloud\Win11-Lab' `
  -UseDefaultWallpaper `
  -StartOSDCloud $startArgs

New-OSDCloudISO -WorkspacePath 'C:\OSDCloud\Win11-Lab'
```

## 驗證重點

部署完成後，應確認：

- `ImageFileSource` 指向 `D:\OSDCloud\OS\...zh-tw.esd`
- `ImageFileUrl` 為空
- `C:\OSDCloud\Logs\DavisOobeInjected.txt` 存在
- `C:\Users\Public\Desktop\OSDCloud-Desktop-Ready.txt` 存在
- `ExplorerRunning=True`
- `OobeProcesses` 為空
- `LaunchUserOOBE=0`
- `SkipUserOOBE=1`
- `NoAutoUpdate=1`

## 後續方向

下一步若要移到實體筆電 / iPXE：

- 將 WinPE 改為 iPXE 啟動來源
- 將 Windows 11 ESD 放在內網 HTTP 或 SMB 來源
- 依硬體型號分流 driver pack
- Dell Latitude 5430 等機型可加入 Dell driver pack 與 Dell Command Update
- Firmware / BIOS 更新應放在 Windows 階段，並檢查 AC 電源、電池與 BitLocker 狀態
