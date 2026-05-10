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

## 流程分界

本 workspace 有兩條部署路徑，不能混用：

| 路徑 | 用途 | Host endpoint | 入口 | 驗證意義 |
| --- | --- | --- | --- | --- |
| 實體筆電 iPXE | Active path，用來驗證真實大量部署 | TUI 選定的 service interface / service IP | `npm run tui` | 可作為實體部署證據 |
| VM VM iPXE | Regression path，用來快速驗證 WinPE、OOBE、status callback | `Ethernet` / `192.168.100.1` | `node .\tools\osdcloud-tui\src\headless.js` 或 TUI | 只證明 VM regression，不代表實體筆電路徑已準備好 |
| ISO VM | Historical path，用來驗證 ISO zero-touch | `C:\OSDCloud\Win11-Lab\OSDCloud_NoPrompt.iso` | VM DVD/ISO boot | 只保留為歷史證據 |

切換路徑時必須同步 live `C:\OSDCloud`、published `boot.wim`、`config\osdcloud-tui.json` 與 `osdcloud-assets`。不要把 VM 的 `192.168.100.1` endpoint 當成實體筆電設定，也不要把某一次實體筆電測試使用的 service IP 當成永久設定。

實體筆電 endpoint 每次以 TUI 選定的 service interface / service IP 為準。下一次實體筆電測試前，先確認 `config\osdcloud-tui.json`、live `boot.ipxe`、published `boot.wim` 內嵌 endpoint 與 host 網卡狀態一致。

## 目前主機網路拓樸

目前主機用兩張實體 NIC 分工：

| 介面 | 角色 | Host IP | Gateway | 備註 |
| --- | --- | --- | --- | --- |
| `WAN` | Host 預設上網 | `192.168.100.1/24` | `192.168.100.1` | Default route 只走這張，metric `5` |
| `LAN` | 實體 client / PXE lab | `192.168.88.1/24` | 無 | Metric `500`，IP forwarding enabled |

`LAN` 目前規劃為獨立 client subnet。Windows NAT 已建立：

```text
Name   : OSDCloud-PhysicalClient-NAT
Prefix : 192.168.88.0/24
```

接在 `LAN` 後面的 client 若手動設定，可使用：

```text
IP      : 192.168.88.x
Mask    : 255.255.255.0
Gateway : 192.168.88.1
DNS     : 1.1.1.1 / 8.8.8.8
```

若下一次實體筆電 PXE 部署要走這張 `LAN`，必須先在 TUI 選取 `LAN` 或用同步工具把 live iPXE endpoint 改到 `LAN` / `192.168.88.1`，並同步 `boot.wim` / `osdcloud-assets`。單純改 Windows NIC IP 或名稱不會自動修改 WinPE 內嵌 endpoint。

## 使用手冊

本節是給實際操作人員看的流程。除非要做 VM regression，日常部署都走「實體筆電 iPXE」路徑，入口是 TUI。

### 操作前檢查

操作前先確認：

- Host 以系統管理員身分開啟 PowerShell。
- 工作目錄是 `C:\Users\Davis\Documents\New project`。
- `WAN` 是 host 上網介面，保留 default route。
- `LAN` 是接實體 client / PXE switch 的介面，預期為 `192.168.88.1/24`。
- 要做 PXE 測試的實體 LAN 上，不應同時有另一台 DHCP server 回答同一台 client。
- Client 使用 UEFI IPv4 PXE 開機；目前已驗證路徑使用 `snponly.efi`，signed shim Secure Boot PXE 還不是已驗證路徑。
- 不需要在 client 插 USB 或掛 ISO。

若 `LAN` IP 還沒有設定，先執行：

```powershell
.\tools\Set-IpxePhysicalNic.ps1 -InterfaceAlias 'LAN' -ServerIp '192.168.88.1'
```

這只設定 Windows host NIC，不會修改 `boot.ipxe` 或 WinPE endpoint。實際部署前仍要在 TUI 選取 service interface，或執行 endpoint sync 工具。

### 啟動 TUI

在 elevated PowerShell 執行：

```powershell
cd 'C:\Users\Davis\Documents\New project'
npm install
npm run tui
```

`npm install` 只需要在第一次或 `package-lock.json` 改變後執行。平常直接 `npm run tui`。

TUI 主要區塊：

| 區塊 | 用途 |
| --- | --- |
| `Actions` | 執行 preflight、選 service interface、啟停服務、清除 status |
| `Services` | 顯示 HTTP/TFTP/DHCP 是否 running、目前 service IP、DHCP pool/router |
| `Clients` | 顯示多台 client / 多個 run 的狀態、stage、percent、last seen |
| `Client Detail` | 顯示選定 run 的詳細階段、時間、訊息與截圖 metadata |
| `Preflight` | 顯示檢查結果；選 service interface 時也會顯示 endpoint 更新進度 |
| `Validation` | 顯示 fleet counts、最近截圖、最近 status events |
| `Logs` | 顯示 TUI、DHCP、TFTP、HTTP、endpoint sync 的即時 log |

鍵盤與滑鼠：

- `Tab` / `Shift+Tab` 在各區塊間切換焦點。
- `Alt+A/S/C/D/P/V/L` 可直接跳到 Actions、Services、Clients、Client Detail、Preflight、Validation、Logs。
- 滑鼠點任一區塊可切換焦點。
- 滑鼠滾輪會 scroll 目前游標所在區塊。
- Logs 往上滾會暫停 auto-follow；滾到底或按 `End` 後恢復。

### 每次實體部署流程

1. 在 TUI 選 `Run preflight`。
2. 如果 service IP、DHCP pool、SMB image、HTTP files 或 port 檢查失敗，先處理失敗項目，不要啟動 DHCP。
3. 選 `Select service interface`，選擇這次要服務 client 的 NIC，例如 `LAN 192.168.88.1/24`。
4. TUI 會要求先停止正在 running 的 HTTP/TFTP/DHCP service，然後自動同步所有受 endpoint 影響的設定與檔案。
5. 在 Preflight panel 看 endpoint update 進度；在 Logs panel 看同步腳本輸出。
6. 確認同步完成後自動 preflight 沒有失敗。
7. 確認真實 LAN DHCP server 已暫時關閉。
8. 在 TUI 選 `Start all services`，或依序啟動 `Start HTTP/status`、`Start TFTP`、`Start DHCP`。
9. 實體筆電從 UEFI IPv4 PXE 開機。
10. 在 TUI 的 `Clients` / `Client Detail` / `Logs` 觀察流程。
11. WinPE 完成後會自動 `wpeutil reboot`；此時 client 應從內部硬碟開機，不要再反覆 PXE 開機。
12. Windows 第一次開機後應自動登入 `davis` 桌面，TUI 最終應收到 `windows-desktop-ready`。
13. 完成後在 TUI 停止 DHCP/TFTP/HTTP services，避免 host DHCP 留在網段上。

選 `Select service interface` 時，TUI 會同步：

- `config\osdcloud-tui.json`
- DHCP lease pool、subnet mask、router
- HTTP / TFTP bind IP
- SMB share / image path
- live `boot.ipxe`
- iPXE `autoexec`
- SetupComplete status URL
- WinPE 內嵌 `Start-OSDCloud-iPXE.ps1`
- WinPE 內嵌 `Report-OSDCloudProgress.ps1`
- WinPE 內嵌 SetupComplete scripts
- SMB firewall rule
- `Media\sources\boot.wim`
- `PXE-HttpRoot\osdcloud\boot.wim`
- repo 內的 `osdcloud-assets`

不要只手動改 `boot.ipxe`。如果 `boot.ipxe` 更新了，但 WinPE 內的 SMB/status endpoint 還是舊 IP，client 可能可以進 WinPE，後續卻掛不到 SMB image 或回報不到狀態。

### 網路環境變更時

只要「client 看到的 service IP」沒有變，不需要改 `boot.ipxe`。例如 WAN 換網段、WAN gateway 改變、host 外網 IP 改變，但 LAN 仍是 `192.168.88.1/24`，PXE endpoint 就不需要變。

需要重新同步 endpoint 的情況：

- `LAN` service IP 從 `192.168.88.1` 改成別的 IP。
- 從實體 `LAN` 切到 VM `Ethernet`。
- 從 VM regression 切回實體 `LAN`。
- `config\osdcloud-tui.json`、live `boot.ipxe`、SMB share 或 `boot.wim` 內嵌 endpoint 不一致。
- Client 拿到正確 DHCP lease，但 iPXE 後續 HTTP 仍跑去另一張 NIC 或舊 IP。

TUI 方式是首選：使用 `Select service interface`。

非互動方式可執行：

```powershell
.\tools\Set-OsdCloudIpxeEndpoint.ps1 `
  -InterfaceAlias 'LAN' `
  -ServerIp '192.168.88.1' `
  -PrefixLength 24 `
  -DefaultGateway '192.168.88.1' `
  -CommitWinPe `
  -SyncAssets `
  -HashLargeArtifacts
```

### 成功判斷

TUI 最終應看到：

```text
Final stage : windows-desktop-ready
Percent     : 100
Message     : Windows desktop is ready for davis.
```

Windows 端應符合：

```text
User             : <computer>\davis
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
```

iPXE no-redownload 還要確認：

- HTTP access log 有 `boot.ipxe`、`wimboot`、`boot.wim`。
- HTTP access log 沒有 zh-TW ESD `HEAD` / `GET`。
- OSDCloud log 中 `ImageFileUrl` 為空。
- `ImageFileDestination` 指向 `Z:\OSDCloud\OS\...zh-tw.esd`。
- `ImageFileDestination.PSDrive.DisplayRoot` 是當次 service IP 的 SMB share，例如 `\\192.168.88.1\OSDCloudiPXE`。
- `OSImageIndex` 是 `6`。

### 常見問題判斷

| 現象 | 優先檢查 |
| --- | --- |
| Client 沒拿到 IP | DHCP service 是否 running、真實 LAN DHCP 是否衝突、client 是否接到 `LAN` |
| Client 拿到 IP 但沒有下載 `boot.ipxe` | TFTP `snponly.efi` 是否成功、DHCP 是否在 iPXE 階段回傳 boot URL |
| Client 拿到 LAN IP 但 HTTP 跑去 WAN | live `boot.ipxe` 的 `set base` 是否仍是舊 IP；在 TUI 重新 `Select service interface` |
| 有 `boot.ipxe` / `boot.wim` 但不套用 Windows | WinPE 是否掛到 `\\<service-ip>\OSDCloudiPXE`，ESD 是否存在，SMB firewall 是否允許 |
| HTTP log 出現 zh-TW ESD `HEAD` / `GET` | 可能誤用 `-ImageFileUrl` 或沒有走 SMB direct image |
| WinPE 完成後又進 PXE | Client boot order 或一次性 boot menu 沒有回到內部硬碟 |
| 第一次 Windows boot 停在 OOBE | 檢查 `Invoke-DavisOobe.ps1`、SetupComplete 注入、OOBE registry |
| TUI 停在 `awaiting-windows` | 檢查 SetupComplete status URL、desktop-ready scheduled task、Windows 網路是否能連回 service IP |
| `windows-desktop-ready` 重複出現 | 舊版 reporter 可能未 unregister，可在 client 執行 `Unregister-ScheduledTask -TaskName OSDCloudDesktopReadyReport -Confirm:$false` |

### 收尾

部署或測試結束後：

- 在 TUI 停止 DHCP、TFTP、HTTP services。
- 若測試時關閉了環境原本的 DHCP server，確認是否需要恢復。
- 不要提交 VMConnect 截圖、log、ISO/WIM/ESD/VHDX。
- 若修改了部署行為或 `C:\OSDCloud` 內容，先同步 `osdcloud-assets`，再 commit。

歷史 ISO 驗證 VM：

```text
OSDCloud-Win11-NoTouch-01
```

歷史 iPXE 網路安裝驗證 VM：

```text
OSDCloud-Win11-iPXE-01
```

最新 VM vSwitch 回歸驗證 VM：

```text
OSDCloud-Win11-vSwitch-04
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

實體筆電 iPXE 版 WinPE 使用的 Windows 11 ESD 來源：

```text
\\<service-ip>\OSDCloudiPXE\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd
```

## 實體筆電 iPXE 流程

這條流程的重點是：實體筆電不需要 USB 或 ISO，直接用 UEFI PXE 啟動 iPXE，再由 iPXE 用 HTTP 載入 OSDCloud WinPE。WinPE 進入後掛載 `\\<service-ip>\OSDCloudiPXE`，直接用該 SMB share 上的 Windows 11 ESD 套用 `Index 6`，避免每台機器再把 5GB ESD 下載到 WinPE 暫存目錄。

端到端流程：

1. 確認真實環境 DHCP server 已暫時關閉，避免和本機 PXE DHCP responder 衝突。
2. Host service IP 必須存在於一張已啟用的 IPv4 介面上；介面名稱和 IP 每次以 TUI 選取結果為準。
3. Host 啟動 PXE helper：PowerShell DHCP、PowerShell TFTP、Node HTTP server。
4. 實體筆電從 UEFI IPv4 PXE 開機，不使用 USB/ISO。
5. UEFI PXE client 透過 DHCP 拿到目前 TUI config 範圍內的 lease、設定中的 gateway/router、DNS 與第一階段 boot file `ipxeboot/x86_64-sb/snponly.efi`。若測試目標需要走 upstream gateway，先在 endpoint/config 中設定清楚並重新同步。
6. UEFI PXE client 透過 TFTP 下載 `snponly.efi`，進入 iPXE。
7. iPXE 再次 DHCP，DHCP helper 偵測到 iPXE client 後改回傳 `http://<service-ip>/osdcloud/boot.ipxe`。
8. iPXE 透過 HTTP 下載 `boot.ipxe`，再載入 `wimboot`、`bootmgr`、`bootx64.efi`、`BCD`、`boot.sdi`、`boot.wim`。
9. OSDCloud WinPE 啟動，`Startnet.cmd` 執行 `Initialize-OSDCloudStartnet`，再呼叫 iPXE 專用 `Start-OSDCloud-iPXE.ps1`。
10. `Start-OSDCloud-iPXE.ps1` 啟動 `Report-OSDCloudProgress.ps1`，定期 POST 部署狀態到 `http://<service-ip>/osdcloud/status`，並在關鍵階段 best-effort 上傳 PNG 截圖到 `/osdcloud/screenshot`。
11. `Start-OSDCloud-iPXE.ps1` 用 `net use Z: \\<service-ip>\OSDCloudiPXE` 掛載 read-only SMB share。
12. 腳本把 `$Global:StartOSDCloud.ImageFileDestination` 指向 `Z:\OSDCloud\OS\...zh-tw.esd`，並固定 `OSImageIndex=6` 後呼叫 `Invoke-OSDCloud`。
13. OSDCloud 直接用 SMB 上的 ESD 執行 DISM 套用 Windows 11 Pro，不再執行 `Download Operating System` 的 HTTP ESD 下載。
14. WinPE Shutdown script `Invoke-DavisOobe.ps1` 對新 Windows 離線注入：
    - `Unattend.xml`
    - OOBE skip registry
    - Winlogon 自動登入
    - Windows Update policy
    - `SetupComplete.cmd/.ps1`
    - client app payload `C:\ProgramData\OSDCloud\Apps`
15. `Start-OSDCloud-iPXE.ps1` 在 `Invoke-OSDCloud` 返回後送出完成狀態，等待 10 秒並執行 `wpeutil reboot`。
16. Windows 第一次開機執行 SetupComplete，建立/修正 `davis/password`，設定 zh-TW、Taipei timezone、OOBE registry，靜默安裝 client apps，並寫入桌面 marker。
17. 在實體筆電本機或遠端管理通道驗證桌面、版本、語系、時區、OOBE registry、OSDCloud log、HTTP access log。

目前實作中特別重要的限制：

- iPXE no-redownload 模式不能使用 `-ImageFileUrl`，因為 OSDCloud 會先把 ESD 下載到 WinPE 暫存位置。現在改由 WinPE 掛載 SMB share，設定 `$Global:StartOSDCloud.ImageFileDestination` 為 ESD `FileInfo` 後呼叫 `Invoke-OSDCloud`。
- Driver pack 採 host-first cache：OSDCloud 先用原生離線搜尋檢查 `Z:\OSDCloud\DriverPacks\<catalog FileName>`；若 host SMB cache 沒有對應檔案，才由 OSDCloud 原生流程從官方來源下載到 client `C:\Drivers` 並套用。Windows `SetupComplete` 只回報 `C:\Drivers\*.json` metadata，host TUI 再自行從官方 URL 下載到 `C:\OSDCloud\Win11-iPXE-Lab\Media\OSDCloud\DriverPacks`，主 SMB share 維持 read-only。
- Driver pack cache v1 只允許純檔名與 `.exe` / `.cab` / `.zip` / `.msi`，且官方下載 host 預設只允許 `downloads.dell.com`。host 不覆寫既有 cache 檔案，結果記錄在 `C:\OSDCloud\Win11-iPXE-Lab\Media\OSDCloud\DriverPacks\driverpack-cache.jsonl`。
- Client app payload 放在 `C:\OSDCloud\Win11-iPXE-Lab\Media\OSDCloud\Apps`。WinPE shutdown 會複製到 client `C:\ProgramData\OSDCloud\Apps`，SetupComplete 再執行 `Install-Apps.ps1`。目前包含 `7zip\7z2601-x64.msi`，使用 `msiexec /qn /norestart REBOOT=ReallySuppress` 靜默安裝。
- 測試時真實環境 DHCP server 必須暫時關閉，避免和本機 PXE DHCP responder 衝突。
- iPXE 只載入 `boot.wim`，沒有 ISO 光碟路徑，所以 Shutdown script 必須先找 `$PSScriptRoot\..\SetupComplete`，不能只假設 `D:\OSDCloud\Config\Scripts\SetupComplete` 存在。
- VM / PowerShell Direct 只屬於歷史 VM 回歸測試，不屬於目前實體筆電流程。

若目前 endpoint 留在 VM 測試狀態，先切回實體筆電：

```powershell
.\tools\Set-OsdCloudIpxeEndpoint.ps1 -InterfaceAlias 'LAN' -ServerIp '192.168.88.1' -PrefixLength 24 -CommitWinPe -SyncAssets -HashLargeArtifacts
```

設定實體網卡：

```powershell
.\tools\Set-IpxePhysicalNic.ps1 -InterfaceAlias 'LAN' -ServerIp '192.168.88.1'
```

啟動 host 端服務時，日常操作使用 TUI：

```powershell
npm run tui
```

進入 TUI 後先 `Select service interface`，再 `Run preflight`，最後 `Start all services`。`Start-PxeDhcp.ps1`、`Start-PxeTftp.ps1`、`Serve-OsdCloudMedia.mjs` 只保留作為低階 fallback；一般實體部署不要優先使用這些 helper，否則使用者看不到 fleet status、endpoint sync progress 與完整 validation。

## VM VM 回歸流程

這條流程只用來驗證 VM regression。它使用 VM `vSwitch` 與 `192.168.100.1/24`，不應作為實體筆電部署 runbook。

VM 回歸用途：

- 快速確認 iPXE first stage、HTTP WinPE、SMB direct image、OOBE injection、SetupComplete、desktop-ready callback 是否仍可端到端完成
- 在不碰實體筆電的情況下重跑 Windows 11 zero-touch 邏輯
- 驗證文件或工具變更沒有破壞已知 VM path

VM 回歸前切到 vSwitch endpoint：

```powershell
.\tools\Set-OsdCloudIpxeEndpoint.ps1 -InterfaceAlias 'Ethernet' -ServerIp '192.168.100.1' -PrefixLength 24 -CommitWinPe -SyncAssets -HashLargeArtifacts
```

VM 回歸可用 headless services：

```powershell
node .\tools\osdcloud-tui\src\headless.js
```

VM 回歸注意事項：

- VM 使用 `vSwitch` / `192.168.100.1` / `\\192.168.100.1\OSDCloudiPXE`
- 成功條件仍是 `windows-desktop-ready`、`davis` 桌面、OOBE registry 正確、HTTP log 沒有 zh-TW ESD `HEAD` / `GET`
- `osdcloud-finished` 後不要強制關機，讓 WinPE 自然 `wpeutil reboot`
- 測試結束後停止 headless/TUI services，避免 DHCP responder 留著
- 回到實體筆電前必須切回 TUI 選定的實體 service interface / service IP

OSDCloud 進度回報會由 Node HTTP server 接收，並寫入：

```text
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest.json
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\progress.jsonl
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest-summary.json
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\<runId>.summary.json
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\runs-index.json
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\deployment-runs.jsonl
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest-screenshot.json
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\<runId>.screenshots.jsonl
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\screenshots\<runId>\*.png
```

WinPE reporter 目前每 `3` 秒檢查一次部署 log；若階段訊息沒有變化，至少每 `15` 秒送出 heartbeat。TUI 會把每次部署整理成 run summary，明確記錄 `run-start`、`winpe-end`、`windows-start`、`run-end` 或 `run-failed`。
TUI v0.2.0 會額外維護 `runs-index.json` 與 `GET /osdcloud/status/runs`，用來顯示多台 client / 多個 run 的 fleet overview；既有 `GET /osdcloud/status` 仍只回傳最後一筆 status 以維持相容。若 TUI 重新開啟時只看到上一輪資料，它不會把舊資料當成 active deployment；WinPE 已交棒但還沒有 Windows final callback 時會顯示 `awaiting-windows`，超過約 15 分鐘沒有新事件會標示為 `stale (...; previous run)`。

截圖只作為部署證據，不是部署成功條件。WinPE 會在 `winpe-start`、SMB 掛載、OSDCloud 開始/結束、reboot、錯誤階段，以及 `apply-image` 進度跨過 25/50/75/100 時嘗試截圖。Windows 完成判定仍只依賴 JSON status；不要在 SetupComplete 內安裝互動桌面截圖 Startup helper，先前的螢幕擷取加上 hidden PowerShell helper 曾被 AMSI 擋成 `ScriptContainedMaliciousContent`，造成 TUI 收不到 Windows completion callback。

部署完成進入 Windows 後，SetupComplete 會讀取 WinPE 寫入的：

```text
C:\ProgramData\OSDCloud\DeploymentStatus.json
```

然後回報 Windows 階段：

```text
windows-setupcomplete-start
windows-apps-start
windows-apps-finished
windows-driverpack-cache-request
windows-setupcomplete-finished
windows-logon-start
windows-desktop-ready
```

`windows-driverpack-cache-request` 只帶 driver pack metadata，不帶 driver pack 本體。host 端收到後會在背景處理 cache backfill；即使下載失敗，也不會阻斷 `windows-setupcomplete-finished` 或 `windows-desktop-ready`。

`windows-apps-start` / `windows-apps-finished` 代表 SetupComplete 正在安裝 `C:\ProgramData\OSDCloud\Apps` 內的 client app payload。若 installer 回傳非成功碼，會送出 `windows-apps-error` 與 `windows-setupcomplete-error`，log 在 `C:\Windows\Temp\osdcloud-logs\apps-install.log` 和各軟體自己的 log。

`windows-desktop-ready` 代表已看到 Explorer、桌面 ready marker，且沒有 `CloudExperienceHost` / `msoobe`。
Desktop-ready reporter 會等到 `windows-desktop-ready` 成功 POST 到 host 後才移除 scheduled task；如果 Windows 桌面先出現但網路尚未連上目前 host status endpoint，它會每 `5` 秒重試，最多 `30` 分鐘，避免 TUI 永遠停在 `awaiting-windows`。`Send-Status` 必須在 HTTP POST 或 WebClient fallback 成功後回傳 `$true`，否則 reporter 會把 HTTP `204` 當成未完成並每 5 秒重送相同 `windows-desktop-ready`，直到 30 分鐘 deadline。

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

最新 VM vSwitch 回歸驗證結果：

```text
RunId       : 20260509-180631-3516-7778-8933-1804-0874-8294-77
VM          : OSDCloud-Win11-vSwitch-04
Switch      : vSwitch
Status      : windows-desktop-ready
User        : DESKTOP-BM8R03K\davis
IPv4        : 192.168.100.200/24
Gateway     : 192.168.100.1
DNS         : 1.1.1.1,8.8.8.8
Explorer    : True
OOBE        : skipped
OS          : Windows 11 Pro 25H2 build 26200 zh-TW
HTTP ESD    : 0 HEAD/GET matches during this run
Internet    : ping 1.1.1.1, DNS, and msftconnecttest all passed
```

`config\osdcloud-tui.json` 與 live iPXE WinPE endpoint 會隨 TUI `Select service interface` 或 `Set-OsdCloudIpxeEndpoint.ps1` 改變。下一次實體筆電驗證前，先確認 service IP、DHCP router、HTTP base、SMB share、live `boot.ipxe` 與 `boot.wim` 內嵌 endpoint 都指向同一個本次要使用的 service IP。

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

VM 回歸測試若不需要 blessed TUI 畫面，可用 headless host services：

```powershell
node .\tools\osdcloud-tui\src\headless.js
```

這個入口同樣啟動 HTTP/status、TFTP、DHCP。測試結束後必須停止該 `node.exe`，避免 DHCP responder 留在測試網段上。

TUI 設定檔：

```text
C:\Users\Davis\Documents\New project\config\osdcloud-tui.json
```

TUI 會接管 host 端 DHCP、TFTP、HTTP media server、`/osdcloud/status` status API、`/osdcloud/status/runs` fleet API、`/osdcloud/screenshot` screenshot API、live log 與 validation 摘要。v0.2.0 起，`Clients` 區塊會以 scrollable table 顯示多台 client / run 的 status、client、run、stage、percent、last seen 與 elapsed；`Client Detail` 區塊顯示選定 run 的 start / WinPE end / Windows start / final end、最後訊息與最新截圖 metadata。v0.2.7 起，panel label 常態只顯示 Actions、Services、Clients、Client Detail、Preflight、Validation、Logs；按住 `Alt` 時會立即替可用快捷字母加底線，放開 `Alt` 時移除底線。v0.2.8 起，部署 payload 會在 Windows SetupComplete 靜默安裝 7-Zip，並用 `windows-apps-*` status stages 回報。可用 `Alt+A`、`Alt+S`、`Alt+C`、`Alt+D`、`Alt+P`、`Alt+V`、`Alt+L` 直接切換到對應區塊；Caps Lock 開啟時 terminal 可能送出 `M-C` 這類大寫 meta key，TUI 會同樣接受。也可以按 `Tab` / `Shift+Tab` 依序循環 Actions -> Services -> Clients -> Preflight -> Client Detail -> Validation -> Logs。滑鼠點選任一 panel 會切換焦點；滑鼠停在哪個 panel 上滾輪就會 scroll 哪個 panel。Logs 往上滾會暫停自動跟隨最新 log，滾回底部或按 `End` 後恢復。
舊部署殘留的 status 只會當作 previous run 顯示，不會被標為 running；開始新的 PXE 部署後，新的 `winpe-start` 會加入 Clients 清單，不會覆蓋其他 client 的 run summary。

使用原則：

- 用 elevated PowerShell 啟動 `npm run tui`
- Repo `.npmrc` 會讓 npm scripts 以前景 stdio 並靜默 banner 執行，避免 `npm run tui` 的 script header 干擾 TUI 啟動與鍵盤輸入
- 先執行 `Run preflight`；preflight 會檢查服務綁定 IP 是否存在於任一張啟用中的 IPv4 介面，不要求固定 NIC alias
- 若要改服務監聽介面，使用 `Select service interface`；它會列出目前啟用、具 IPv4、非 APIPA 的介面，選定後寫回 `config\osdcloud-tui.json`，同步 DHCP lease pool / subnet mask / router、live `boot.ipxe`、iPXE WinPE status/SMB endpoint、SMB firewall、published `boot.wim` 與 `osdcloud-assets`
- `Select service interface` 觸發 endpoint 更新時，Preflight panel 會顯示目前正在更新的項目，Logs 會即時串流同步腳本輸出，完成後會自動針對新 endpoint 跑 preflight
- 選擇新介面時，HTTP/TFTP/DHCP 任一服務若正在 running，TUI 會先要求停止服務再更新 endpoint
- 切換介面後 DHCP responder 必須使用新 endpoint 的 lease pool；若 log 顯示服務在 `192.168.100.x` 但仍 OFFER/ACK `192.168.100.x`，代表正在跑舊 TUI process，停止服務並重新啟動 `npm run tui`
- `dhcp.reservations` 可針對已知實體 client MAC 固定派發 IP；切到新 endpoint 時，TUI / `Set-OsdCloudIpxeEndpoint.ps1` 會移除不在新 subnet 內的 reservation，避免沿用舊 `192.168.100.x` 或 vSwitch 位址
- 只有確認真實 LAN DHCP server 已暫時停用後，才在 TUI 啟動 DHCP
- `Start HTTP/status`、`Start TFTP`、`Start DHCP` 是個別服務 toggle；服務 running 時同一個 action 會顯示為 `Stop ...` 並可關閉服務
- TUI 不再提供 `Configure physical NIC` 動作；如需改 Windows 網卡 IP，請在 TUI 外手動執行 `.\tools\Set-IpxePhysicalNic.ps1`
- 服務啟停、`Start all services`、`Clear status files` 都會要求二次確認；清理 status 時也會刪除 fleet index、本機 screenshot metadata 與 `status\screenshots`
- `Run preflight` 也會檢查 DHCP lease range / router 是否仍落在選定服務 IP 的 prefix 內；這是防止手動改 JSON 或舊設定殘留的最後防線
- 實體筆電從 UEFI IPv4 PXE 開機後，在 TUI 內看 Clients、Client Detail、Logs、Validation

驗證與測試：

```powershell
npm test
npm run smoke
```

`npm run smoke` 只使用暫存 root 與測試 port，不會啟動真實 PXE/DHCP 流程。

狀態截圖是本機 evidence，不應提交到 Git；需要保留時以 runId 對應 `status\screenshots\<runId>`。

歷史 VM timing evidence 保留在詳細測試報告；實體筆電驗證不使用 VM timing script。

若安裝後 Start menu 顯示灰色 placeholder，先確認筆電是否能經由當次部署設定的 gateway 出口連網，再重啟 Start menu / Explorer 或清除目前使用者的 icon cache。

## Git 管理

這個資料夾使用 Git 追蹤文件、流程設定，以及從 `C:\OSDCloud` 同步出來的可讀部署資產。實際部署仍以 `C:\OSDCloud` 為執行位置；repo 的作用是保存可審查、可比較、可重建的腳本與 manifest。

應納入版本控制：

- `README.md`
- `AGENTS.md`
- `OSDCloud-Win11-Automated-Deployment-Test-Report.md`
- `tools\Invoke-IpxeTimingRun.ps1`
- `tools\Set-IpxePhysicalNic.ps1`
- `tools\Set-OsdCloudIpxeEndpoint.ps1`
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

若是要更換 TUI 服務監聽介面，優先在 TUI 使用 `Select service interface`，或直接執行：

```powershell
.\tools\Set-OsdCloudIpxeEndpoint.ps1 -ServerIp <host-ip> -InterfaceAlias '<alias>' -PrefixLength <prefix> -CommitWinPe -SyncAssets -HashLargeArtifacts
```

這個 helper 會同步 config、DHCP pool / mask / router、live PXE endpoint、WinPE 內嵌 status/SMB endpoint、published `boot.wim`，最後再刷新 `osdcloud-assets` mirror。

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

## 共通 Windows 完成條件

部署完成後，應確認：

- `C:\OSDCloud\Logs\DavisOobeInjected.txt` 存在
- `C:\Users\Public\Desktop\OSDCloud-Desktop-Ready.txt` 存在
- `C:\Program Files\7-Zip\7z.exe` 存在
- `ExplorerRunning=True`
- `OobeProcesses` 為空
- `LaunchUserOOBE=0`
- `SkipUserOOBE=1`
- `NoAutoUpdate=1`

ISO VM 還要確認：

- `ImageFileSource` 指向 `D:\OSDCloud\OS\...zh-tw.esd`
- `ImageFileUrl` 為空

## 實體筆電 iPXE 驗證重點

實體筆電部署還要確認：

- 測試筆電沒有使用 USB/ISO
- HTTP access log 有 `boot.ipxe`、`wimboot`、`boot.wim`，且沒有 zh-TW ESD `HEAD` / `GET`
- `C:\OSDCloud\Logs\OSDCloud.json` 的 `ImageFileUrl` 為空
- `ImageFileDestination` / `ExpandWindowsImage.ImagePath` 指向 `Z:\OSDCloud\OS\...zh-tw.esd`
- `ImageFileDestination.PSDrive.DisplayRoot` 為目前實體 endpoint 的 SMB share，例如 `\\<service-ip>\OSDCloudiPXE`
- `OSImageIndex=6`
- 硬碟第一次開機直接進入 `davis` 桌面，不停在 OOBE

## VM VM 驗證重點

VM 回歸完成後，應確認：

- VM 網卡接在 `vSwitch`
- VM endpoint 使用 `192.168.100.1`
- HTTP access log 有 `boot.ipxe`、`wimboot`、`boot.wim`
- 本次 run window 沒有 zh-TW ESD `HEAD` / `GET`
- `DeploymentStatus.share` 為 `\\192.168.100.1\OSDCloudiPXE`
- `DeploymentStatus.imagePath` 指向 `Z:\OSDCloud\OS\...zh-tw.esd`
- `windows-desktop-ready` 回報成功
- PowerShell Direct 驗證 `DESKTOP-...\davis`、Explorer、OOBE registry、版本、語系、時區、網路

VM 結果只能作為 regression evidence。要宣告實體筆電 path 可用，仍必須跑實體筆電 iPXE 流程。

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
