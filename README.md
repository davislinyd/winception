# OSDCloud Windows 11 Zero-Touch Deployment Lab

這個資料夾記錄 VM + OSDCloud 自動部署 Windows 11 的測試結果與交接資訊。目標是先在 VM 驗證完整流程，再延伸到實體筆電與 iPXE 大量部署。

## 目前狀態

已驗證成功的目標：

- 從 OSDCloud ISO 自動部署 Windows 11
- 使用 ISO 內建 Windows 11 ESD 快取，不重複從外網下載 OS
- 從 VM iPXE 網路開機下載 WinPE，WinPE 再從 host SMB share 直接套用 Windows 11 ESD
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

iPXE 網路安裝驗證 VM：

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
IPv4             : 192.168.100.100
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

這個目錄保存從 `C:\OSDCloud` 匯出的真實部署腳本、PXE helper、`boot.ipxe`、以及從 iPXE `boot.wim` 抽出的 `Startnet.cmd` / `Start-OSDCloud-iPXE.ps1`。大型 `ISO/WIM/ESD/VHDX` 和上游 boot binary 不進 Git，只在 `osdcloud-assets\manifest.json` 記錄路徑、大小、時間與 SHA-256。

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
\\192.168.100.1\OSDCloudiPXE\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd
```

## iPXE 網路安裝流程

這條流程的重點是：VM 不掛 ISO，先用 VM PXE 啟動 iPXE，再由 iPXE 用 HTTP 載入 OSDCloud WinPE。WinPE 進入後掛載 `\\192.168.100.1\OSDCloudiPXE`，直接用該 SMB share 上的 Windows 11 ESD 套用 `Index 6`，避免每台 VM 再把 5GB ESD 下載到 WinPE 暫存目錄。

端到端流程：

1. Host 建立隔離 VM switch `PXE-Lab`，並把 host vEthernet 設為 `192.168.100.1/24`。
2. Host 啟動 PXE helper：PowerShell DHCP、PowerShell TFTP、Node HTTP server。
3. 測試 VM `OSDCloud-Win11-iPXE-01` 從 `PXE-Lab` NIC 開機，不掛 ISO/DVD。
4. UEFI PXE client 透過 DHCP 拿到 `192.168.100.100` 與第一階段 boot file `ipxeboot/x86_64-sb/snponly.efi`。
5. UEFI PXE client 透過 TFTP 下載 `snponly.efi`，進入 iPXE。
6. iPXE 再次 DHCP，DHCP helper 偵測到 iPXE client 後改回傳 `http://192.168.100.1/osdcloud/boot.ipxe`。
7. iPXE 透過 HTTP 下載 `boot.ipxe`，再載入 `wimboot`、`bootmgr`、`bootx64.efi`、`BCD`、`boot.sdi`、`boot.wim`。
8. OSDCloud WinPE 啟動，`Startnet.cmd` 執行 `Initialize-OSDCloudStartnet`，再呼叫 iPXE 專用 `Start-OSDCloud-iPXE.ps1`。
9. `Start-OSDCloud-iPXE.ps1` 用 `net use Z: \\192.168.100.1\OSDCloudiPXE` 掛載 read-only SMB share。
10. 腳本把 `$Global:StartOSDCloud.ImageFileDestination` 指向 `Z:\OSDCloud\OS\...zh-tw.esd`，並固定 `OSImageIndex=6` 後呼叫 `Invoke-OSDCloud`。
11. OSDCloud 直接用 SMB 上的 ESD 執行 DISM 套用 Windows 11 Pro，不再執行 `Download Operating System` 的 HTTP ESD 下載。
12. WinPE Shutdown script `Invoke-DavisOobe.ps1` 對新 Windows 離線注入：
    - `Unattend.xml`
    - OOBE skip registry
    - Winlogon 自動登入
    - Windows Update policy
    - `SetupComplete.cmd/.ps1`
13. WinPE 自動關機。
14. Host 把 VM 改成 VHD 優先開機，硬碟階段使用 Secure Boot `MicrosoftWindows` template 與 vTPM。
15. Windows 第一次開機執行 SetupComplete，建立/修正 `davis/password`，設定 zh-TW、Taipei timezone、OOBE registry 與桌面 marker。
16. Host 用 PowerShell Direct 驗證桌面、版本、語系、時區、OOBE registry、OSDCloud log、HTTP access log。

目前實作中特別重要的限制：

- iPXE no-redownload 模式不能使用 `-ImageFileUrl`，因為 OSDCloud 會先把 ESD 下載到 WinPE 暫存位置。現在改由 WinPE 掛載 SMB share，設定 `$Global:StartOSDCloud.ImageFileDestination` 為 ESD `FileInfo` 後呼叫 `Invoke-OSDCloud`。
- `PXE-Lab` 是隔離網段，iPXE 版 WinPE 會略過 `Initialize-OSDCloudStartnetUpdate`，避免在部署前卡住外網更新檢查。
- iPXE 只載入 `boot.wim`，沒有 ISO 光碟路徑，所以 Shutdown script 必須先找 `$PSScriptRoot\..\SetupComplete`，不能只假設 `D:\OSDCloud\Config\Scripts\SetupComplete` 存在。
- VM vTPM 初始化後不能原地修改 Secure Boot template。若 PXE 階段曾用不同 template，第一次硬碟開機前要保留 VHDX 並重建 VM 設定檔，再套用 `MicrosoftWindows` template 和 vTPM。

時間測試可用專案內腳本重跑。腳本會建立新 VM、啟動 PXE helper、只記錄狀態與時間。WinPE 關機後，腳本會自動切到 VHD + Secure Boot `MicrosoftWindows` + vTPM，並預設保留 VM NIC 在 `PXE-Lab`。`PXE-Lab` 現在由 host `PXE-Lab-NAT` 提供 NAT 出口，所以第一次硬碟開機可在同一個安裝網段完成 DNS / HTTP / 軟體註冊類工作。最後用 PowerShell Direct 驗證桌面與 internet：

```powershell
.\tools\Invoke-IpxeTimingRun.ps1 -VmName OSDCloud-Win11-iPXE-Timing-XX
```

若要刻意改接其他 switch，可明確指定：

```powershell
.\tools\Invoke-IpxeTimingRun.ps1 -VmName OSDCloud-Win11-iPXE-Timing-XX -PostDeploySwitchName 'Default Switch'
```

早期 HTTP ESD 成功樣本，已由 no-redownload 模式取代：

```text
VM: OSDCloud-Win11-iPXE-Timing-06
Run: C:\OSDCloud\Win11-iPXE-Lab\TimingRuns\20260507-111415-OSDCloud-Win11-iPXE-Timing-06
Total: 1059.2 seconds
Result: Succeeded
```

最新 no-redownload 成功樣本：

```text
VM: OSDCloud-Win11-iPXE-Timing-10
Run: C:\OSDCloud\Win11-iPXE-Lab\TimingRuns\20260507-135251-OSDCloud-Win11-iPXE-Timing-10
Total: 819.0 seconds
HTTP ESD GET: 0
ImageFileDestination: Z:\OSDCloud\OS\...zh-tw.esd
ImageFileUrl: <empty>
Result: Succeeded
```

Timing VM 必須使用固定 8GB RAM 並關閉 Dynamic Memory。`Timing-04` 曾在 WinPE DISM `Expand-WindowsImage` 階段失敗，畫面顯示 `Insufficient memory to continue the execution of the program`；主因是 Dynamic Memory 讓 WinPE 實際只拿到約 1.5GB。`Invoke-IpxeTimingRun.ps1` 目前預設會建立 8GB static memory VM。

若安裝後 Start menu 顯示灰色 placeholder，先確認 VM 是否有 `PXE-Lab` NAT 出口。已部署的 VM 可在 `PXE-Lab` 使用 `192.168.100.1` 作 gateway，再重啟 Start menu / Explorer 或清除目前使用者的 icon cache。

## Git 管理

這個資料夾使用 Git 追蹤文件、流程設定，以及從 `C:\OSDCloud` 同步出來的可讀部署資產。實際部署仍以 `C:\OSDCloud` 為執行位置；repo 的作用是保存可審查、可比較、可重建的腳本與 manifest。

應納入版本控制：

- `README.md`
- `AGENTS.md`
- `OSDCloud-Win11-Automated-Deployment-Test-Report.md`
- `tools\Invoke-IpxeTimingRun.ps1`
- `tools\Sync-OsdCloudAssets.ps1`
- `osdcloud-assets\README.md`
- `osdcloud-assets\manifest.json`
- `osdcloud-assets\Win11-Lab\...`
- `osdcloud-assets\Win11-iPXE-Lab\...`
- `.gitignore`

當 `C:\OSDCloud` 內的部署腳本、PXE helper、`boot.ipxe` 或 iPXE `boot.wim` 內容改變時，先同步再提交：

```powershell
.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts
```

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

- 測試 VM 沒有掛 ISO/DVD
- HTTP access log 有 `boot.ipxe`、`wimboot`、`boot.wim`，且沒有 zh-TW ESD `HEAD` / `GET`
- `C:\OSDCloud\Logs\OSDCloud.json` 的 `ImageFileUrl` 為空
- `ImageFileDestination` / `ExpandWindowsImage.ImagePath` 指向 `Z:\OSDCloud\OS\...zh-tw.esd`
- `ImageFileDestination.PSDrive.DisplayRoot` 為 `\\192.168.100.1\OSDCloudiPXE`
- `OSImageIndex=6`
- 硬碟第一次開機使用 Secure Boot `MicrosoftWindows` template 與 vTPM

目前 caveat：

- 完整 iPXE 安裝驗證時，PXE 階段是先暫時關閉 Secure Boot 完成排障。
- 已測試 `snponly-shim.efi` 與 `ipxe-shim.efi`，VM Secure Boot probe 停在 TFTP 下載 shim 階段，尚未通過 signed shim PXE。
- 最終 Windows 硬碟開機已切回 Secure Boot `MicrosoftWindows` 並啟用 vTPM。

## 後續方向

下一步若要移到實體筆電 / 完成 signed shim PXE：

- 將目前已驗證的 iPXE HTTP boot 來源與 SMB image share 搬到正式 PXE server
- 繼續排查 VM signed shim PXE，完成 `MicrosoftUEFICertificateAuthority` template 下的 iPXE 啟動
- 依硬體型號分流 driver pack
- Dell Latitude 5430 等機型可加入 Dell driver pack 與 Dell Command Update
- Firmware / BIOS 更新應放在 Windows 階段，並檢查 AC 電源、電池與 BitLocker 狀態
