# OSDCloud Windows 11 Zero-Touch Deployment Lab

這個資料夾記錄 OSDCloud + iPXE 自動部署 Windows 11 的測試結果與交接資訊。現在的 active path 是實體筆電從真實有線內網 PXE 開機，不使用 VM；既有 VM 內容只作為歷史驗證紀錄。

## 目前狀態

已驗證成功的目標：

- 從 OSDCloud ISO 自動部署 Windows 11
- 使用 ISO 內建 Windows 11 ESD 快取，不重複從外網下載 OS
- 從 iPXE 網路開機下載 WinPE，WinPE 再從 host SMB share 直接套用 Windows 11 ESD
- 第一次從硬碟開機後自動略過 OOBE
- 建立本地帳號 `davis`
- 密碼為 `password`
- 自動登入桌面
- 語系為 `zh-TW`
- 時區為 `Taipei Standard Time`
- 停用 OOBE 更新檢查

歷史 ISO 驗證 VM：

```text
OSDCloud-Win11-NoTouch-01
```

歷史 iPXE 網路安裝驗證 VM：

```text
OSDCloud-Win11-iPXE-01
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

iPXE 網路安裝驗證結果：

```text
User             : DESKTOP-LTK4NLM\davis
ExplorerRunning  : True
DesktopReadyFile : True
OobeProcesses    :
LaunchUserOOBE   : 0
SkipUserOOBE     : 1
NoAutoUpdate     : 1
DisplayVersion   : 25H2
CurrentBuild     : 26200
EditionID        : Professional
Culture          : zh-TW
TimeZone         : Taipei Standard Time
IPv4             : 192.168.100.200
Gateway          : 192.168.100.1
Dns              : 1.1.1.1,8.8.8.8
PingCloudflare   : True
DnsMicrosoft     : True
HttpConnectTest  : True
```

## 主要檔案

測試報告：

```text
C:\Users\Davis\Documents\New project\OSDCloud-Win11-Automated-Deployment-Test-Report.md
```

Repo 內的可版本化 OSDCloud 資產鏡像：

```text
C:\Users\Davis\Documents\New project\osdcloud-assets
```

這個目錄保存從 `C:\OSDCloud` 匯出的真實部署腳本、PXE helper、`boot.ipxe`、以及從 iPXE `boot.wim` 抽出的 `Startnet.cmd`、WinPE OSDCloud scripts、WinPE 內嵌 `Config\Scripts`。大型 `ISO/WIM/ESD/VHDX` 和上游 boot binary 不進 Git，只在 `osdcloud-assets\manifest.json` 記錄路徑、大小、時間與 SHA-256。

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

iPXE 網路安裝 workspace：

```text
C:\OSDCloud\Win11-iPXE-Lab
```

iPXE HTTP root：

```text
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\osdcloud
```

iPXE 版 WinPE 使用的 Windows 11 ESD 來源：

```text
\\192.168.100.100\OSDCloudiPXE\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd
```

## iPXE 網路安裝流程

這條流程的重點是：實體筆電不需要 USB 或 ISO，直接用 UEFI PXE 啟動 iPXE，再由 iPXE 用 HTTP 載入 OSDCloud WinPE。WinPE 進入後掛載 `\\192.168.100.100\OSDCloudiPXE`，直接用該 SMB share 上的 Windows 11 ESD 套用 `Index 6`，避免每台機器再把 5GB ESD 下載到 WinPE 暫存目錄。

端到端流程：

1. 確認真實環境 DHCP server 已暫時關閉，避免和本機 PXE DHCP responder 衝突。
2. Host 有線網卡 `乙太網路 3` 使用 `192.168.100.100/24`；需要時用 `.\tools\Set-IpxePhysicalNic.ps1` 設定。
3. Host 啟動 PXE helper：PowerShell DHCP、PowerShell TFTP、Node HTTP server。
4. 實體筆電從 UEFI IPv4 PXE 開機，不使用 USB/ISO。
5. UEFI PXE client 透過 DHCP 拿到 `192.168.100.200-192.168.100.250` 範圍內的 lease、gateway `192.168.100.1`、DNS `1.1.1.1` / `8.8.8.8` 與第一階段 boot file `ipxeboot/x86_64-sb/snponly.efi`。
6. UEFI PXE client 透過 TFTP 下載 `snponly.efi`，進入 iPXE。
7. iPXE 再次 DHCP，DHCP helper 偵測到 iPXE client 後改回傳 `http://192.168.100.100/osdcloud/boot.ipxe`。
8. iPXE 透過 HTTP 下載 `boot.ipxe`，再載入 `wimboot`、`bootmgr`、`bootx64.efi`、`BCD`、`boot.sdi`、`boot.wim`。
9. OSDCloud WinPE 啟動，`Startnet.cmd` 執行 `Initialize-OSDCloudStartnet`，再呼叫 iPXE 專用 `Start-OSDCloud-iPXE.ps1`。
10. `Start-OSDCloud-iPXE.ps1` 啟動 `Report-OSDCloudProgress.ps1`，定期 POST 部署狀態到 `http://192.168.100.100/osdcloud/status`，並在關鍵階段 best-effort 上傳 PNG 截圖到 `/osdcloud/screenshot`。
11. `Start-OSDCloud-iPXE.ps1` 用 `net use Z: \\192.168.100.100\OSDCloudiPXE` 掛載 read-only SMB share。
12. 腳本把 `$Global:StartOSDCloud.ImageFileDestination` 指向 `Z:\OSDCloud\OS\...zh-tw.esd`，並固定 `OSImageIndex=6` 後呼叫 `Invoke-OSDCloud`。
13. OSDCloud 直接用 SMB 上的 ESD 執行 DISM 套用 Windows 11 Pro，不再執行 `Download Operating System` 的 HTTP ESD 下載。
14. WinPE Shutdown script `Invoke-DavisOobe.ps1` 對新 Windows 離線注入：
    - `Unattend.xml`
    - OOBE skip registry
    - Winlogon 自動登入
    - Windows Update policy
    - `SetupComplete.cmd/.ps1`
15. `Start-OSDCloud-iPXE.ps1` 在 `Invoke-OSDCloud` 返回後送出完成狀態，等待 10 秒並執行 `wpeutil reboot`。
16. Windows 第一次開機執行 SetupComplete，建立/修正 `davis/password`，設定 zh-TW、Taipei timezone、OOBE registry 與桌面 marker。
17. 在實體筆電本機或遠端管理通道驗證桌面、版本、語系、時區、OOBE registry、OSDCloud log、HTTP access log。

目前實作中特別重要的限制：

- iPXE no-redownload 模式不能使用 `-ImageFileUrl`，因為 OSDCloud 會先把 ESD 下載到 WinPE 暫存位置。現在改由 WinPE 掛載 SMB share，設定 `$Global:StartOSDCloud.ImageFileDestination` 為 ESD `FileInfo` 後呼叫 `Invoke-OSDCloud`。
- 測試時真實環境 DHCP server 必須暫時關閉，避免和本機 PXE DHCP responder 衝突。
- iPXE 只載入 `boot.wim`，沒有 ISO 光碟路徑，所以 Shutdown script 必須先找 `$PSScriptRoot\..\SetupComplete`，不能只假設 `D:\OSDCloud\Config\Scripts\SetupComplete` 存在。
- VM / PowerShell Direct 只屬於歷史 VM 回歸測試，不屬於目前實體筆電流程。

設定實體網卡並啟動 PXE helper：

```powershell
.\tools\Set-IpxePhysicalNic.ps1
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\OSDCloud\Win11-iPXE-Lab\Tools\Start-PxeDhcp.ps1'
powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\OSDCloud\Win11-iPXE-Lab\Tools\Start-PxeTftp.ps1'
node 'C:\OSDCloud\Win11-iPXE-Lab\Tools\Serve-OsdCloudMedia.mjs'
```

OSDCloud 進度回報會由 Node HTTP server 接收，並寫入：

```text
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest.json
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\progress.jsonl
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest-summary.json
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\<runId>.summary.json
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\deployment-runs.jsonl
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest-screenshot.json
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\<runId>.screenshots.jsonl
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\screenshots\<runId>\*.png
```

WinPE reporter 目前每 `3` 秒檢查一次部署 log；若階段訊息沒有變化，至少每 `15` 秒送出 heartbeat。TUI 會把每次部署整理成 run summary，明確記錄 `run-start`、`winpe-end`、`windows-start`、`run-end` 或 `run-failed`。
若 TUI 重新開啟時只看到上一輪 `latest.json`，它不會把舊資料當成 active deployment；WinPE 已交棒但還沒有 Windows final callback 時會顯示 `awaiting-windows`，超過約 15 分鐘沒有新事件會標示為 `stale (...; previous run)`。

截圖只作為部署證據，不是部署成功條件。WinPE 會在 `winpe-start`、SMB 掛載、OSDCloud 開始/結束、reboot、錯誤階段，以及 `apply-image` 進度跨過 25/50/75/100 時嘗試截圖。Windows 完成判定仍只依賴 JSON status；不要在 SetupComplete 內安裝互動桌面截圖 Startup helper，先前的螢幕擷取加上 hidden PowerShell helper 曾被 AMSI 擋成 `ScriptContainedMaliciousContent`，造成 TUI 收不到 Windows completion callback。

部署完成進入 Windows 後，SetupComplete 會讀取 WinPE 寫入的：

```text
C:\ProgramData\OSDCloud\DeploymentStatus.json
```

然後回報 Windows 階段：

```text
windows-setupcomplete-start
windows-setupcomplete-finished
windows-logon-start
windows-desktop-ready
```

`windows-desktop-ready` 代表已看到 Explorer、桌面 ready marker，且沒有 `CloudExperienceHost` / `msoobe`。
Desktop-ready reporter 會等到 `windows-desktop-ready` 成功 POST 到 host 後才移除 scheduled task；如果 Windows 桌面先出現但網路尚未連上 `192.168.100.100`，它會每 `5` 秒重試，最多 `30` 分鐘，避免 TUI 永遠停在 `awaiting-windows`。`Send-Status` 必須在 HTTP POST 或 WebClient fallback 成功後回傳 `$true`，否則 reporter 會把 HTTP `204` 當成未完成並每 5 秒重送相同 `windows-desktop-ready`，直到 30 分鐘 deadline。

若已部署 client 還在使用舊 reporter 並持續重送 `windows-desktop-ready`，可在 client 端以系統管理員執行：

```powershell
Unregister-ScheduledTask -TaskName OSDCloudDesktopReadyReport -Confirm:$false
```

最新實體筆電驗證結果：

```text
RunId       : 20260509-031647-9VDYLD4
Status      : completed
Final stage : windows-desktop-ready
Percent     : 100
Started     : 2026-05-08T19:16:49.151Z
WinPE End   : 2026-05-08T19:23:39.219Z
Finished    : 2026-05-08T19:28:19.736Z
Computer    : DESKTOP-8AMUG6V
Message     : Windows desktop is ready for davis.
```

可用下列方式即時監看：

```powershell
Get-Content -Wait 'C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\progress.jsonl'
```

## Node TUI 操作台

現在 host 端主要操作入口是 Node TUI：

```powershell
npm install
npm run tui
```

TUI 設定檔：

```text
C:\Users\Davis\Documents\New project\config\osdcloud-tui.json
```

TUI 會接管 host 端 DHCP、TFTP、HTTP media server、`/osdcloud/status` status API、`/osdcloud/screenshot` screenshot API、live log 與 validation 摘要。Deployment 區塊會顯示目前 stage、percent、elapsed、最後收到時間、本 run 的 start / WinPE end / final end 時間，以及最新截圖 metadata。Validation 區塊會列出最近幾筆 screenshot metadata。
舊部署殘留的 status 只會當作 previous run 顯示，不會被標為 running；開始新的 PXE 部署後，新的 `winpe-start` 會取代畫面中的上一輪資料。

使用原則：

- 用 elevated PowerShell 啟動 `npm run tui`
- 先執行 `Run preflight`；preflight 會檢查服務綁定 IP 是否存在於任一張啟用中的 IPv4 介面，不要求固定 NIC alias
- 只有確認真實 LAN DHCP server 已暫時停用後，才在 TUI 啟動 DHCP
- `Configure physical NIC` 只用於需要 TUI 幫忙設定指定 NIC 時；`Configure physical NIC`、`Start all services`、`Clear status files` 都會要求二次確認；清理 status 時也會刪除本機 screenshot metadata 與 `status\screenshots`
- 實體筆電從 UEFI IPv4 PXE 開機後，在 TUI 內看 Deployment、Logs、Validation

驗證與測試：

```powershell
npm test
npm run smoke
```

`npm run smoke` 只使用暫存 root 與測試 port，不會啟動真實 PXE/DHCP 流程。

狀態截圖是本機 evidence，不應提交到 Git；需要保留時以 runId 對應 `status\screenshots\<runId>`。

歷史 VM timing evidence 保留在詳細測試報告；實體筆電驗證不使用 VM timing script。

若安裝後 Start menu 顯示灰色 placeholder，先確認筆電是否能經由真實內網 gateway `192.168.100.1` 出口連網，再重啟 Start menu / Explorer 或清除目前使用者的 icon cache。

## Git 管理

這個資料夾使用 Git 追蹤文件、流程設定，以及從 `C:\OSDCloud` 同步出來的可讀部署資產。實際部署仍以 `C:\OSDCloud` 為執行位置；repo 的作用是保存可審查、可比較、可重建的腳本與 manifest。

應納入版本控制：

- `README.md`
- `AGENTS.md`
- `OSDCloud-Win11-Automated-Deployment-Test-Report.md`
- `tools\Invoke-IpxeTimingRun.ps1`
- `tools\Set-IpxePhysicalNic.ps1`
- `tools\Sync-OsdCloudAssets.ps1`
- `package.json`
- `package-lock.json`
- `config\osdcloud-tui.json`
- `tools\osdcloud-tui\...`
- `TUI-REWRITE-PLAN.md`
- `osdcloud-assets\README.md`
- `osdcloud-assets\manifest.json`
- `osdcloud-assets\Win11-Lab\...`
- `osdcloud-assets\Win11-iPXE-Lab\...`
- `.gitignore`

當 `C:\OSDCloud` 內的部署腳本、PXE helper、`boot.ipxe` 或 iPXE `boot.wim` 內容改變時，先同步再提交：

```powershell
.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts
```

iPXE 只載入 `boot.wim`。若更新 `C:\OSDCloud\Win11-iPXE-Lab\Config\Scripts\SetupComplete`，也必須確認 `boot.wim` 內的 `X:\OSDCloud\Config\Scripts\SetupComplete` 已同步；否則 client 仍會注入舊版 SetupComplete，TUI 會停在 `awaiting-windows` / `rebooting`，收不到 `windows-setupcomplete-*` 或 `windows-desktop-ready`。

`OSDCloudDesktopReadyReport` 使用 any-user logon trigger 並以 SYSTEM 執行。不要把 scheduled task trigger 綁到 `$env:COMPUTERNAME\davis`；SetupComplete 階段可能尚無法穩定解析本機帳號 SID，會造成 `HRESULT 0x80070534`，導致 TUI 停在 `windows-setupcomplete-finished`。

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

iPXE 網路安裝還要確認：

- 測試筆電沒有使用 USB/ISO
- HTTP access log 有 `boot.ipxe`、`wimboot`、`boot.wim`，且沒有 zh-TW ESD `HEAD` / `GET`
- `C:\OSDCloud\Logs\OSDCloud.json` 的 `ImageFileUrl` 為空
- `ImageFileDestination` / `ExpandWindowsImage.ImagePath` 指向 `Z:\OSDCloud\OS\...zh-tw.esd`
- `ImageFileDestination.PSDrive.DisplayRoot` 為 `\\192.168.100.100\OSDCloudiPXE`
- `OSImageIndex=6`
- 硬碟第一次開機直接進入 `davis` 桌面，不停在 OOBE

目前 caveat：

- 完整 iPXE 安裝驗證時，PXE 階段可先暫時關閉 Secure Boot 完成排障。
- signed shim PXE 尚未成為已驗證路徑；目前先沿用 `snponly.efi`。

## 後續方向

下一步若要完成實體筆電驗證 / signed shim PXE：

- 將目前已驗證的 iPXE HTTP boot 來源與 SMB image share 搬到正式 PXE server
- 繼續排查 signed shim PXE
- 依硬體型號分流 driver pack
- Dell Latitude 5430 等機型可加入 Dell driver pack 與 Dell Command Update
- Firmware / BIOS 更新應放在 Windows 階段，並檢查 AC 電源、電池與 BitLocker 狀態
