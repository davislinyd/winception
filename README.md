# Winception Windows 11 Zero-Touch Deployment

[繁體中文](#繁體中文) | [English](#english)

## 繁體中文

### 01. 產品概要

Winception 是一套 Windows 11 zero-touch deployment 工具。技術人員在部署主機上安裝 Web Console，準備 runtime、Windows 映像、deployment profile 與服務端點後，目標電腦只需要從 UEFI IPv4 PXE 開機，後續的 WinPE、OSDCloud、Windows SetupComplete、應用程式與自訂腳本流程會自動完成。

主要能力：

- 安裝自包含的 host management bundle 到 `C:\OSDCloud\HostTools\App`。
- 將可變主機狀態保存到 `C:\OSDCloud\HostTools\State`。
- 由 Web Console 管理 deployment project root，預設可使用 `C:\OSDCloud`。
- 透過 DHCP、TFTP、HTTP、SMB 與 Torrent P2P 提供 Windows 11 部署資料。
- 支援 Secure Boot boot mode 與 iPXE fallback boot mode。
- 以 deployment profile 控制 OS image、display language、regional format、input language、time zone、client software 與 custom scripts。
- 透過 Client Fleet、Activity、Validation Evidence 與 System Log 追蹤每台電腦的部署狀態。
- 在 Deploy 主畫面提供 `Offline ISO` 卡片，從 active deployment state 建立 host-side ISO，並顯示主機輸出資料夾與完整檔案路徑。

適用對象：

- 建置或維護部署主機的技術人員。
- 在現場啟動 PXE 服務並部署 Windows 11 電腦的操作人員。
- 需要判斷部署是否完成、失敗原因與可採取動作的支援人員。

完整圖解手冊可開啟 [`docs/winception-operations-manual.html`](docs/winception-operations-manual.html)，安裝後也可在 Web Console 右上角用 **Manual** 開啟 `/manual/`。

### 02. 部署主機安裝

從系統管理員 PowerShell 執行：

```powershell
git clone <repo-url> <repo-root>
cd '<repo-root>'
.\Setup-DeploymentServer.cmd
```

既有 clone 更新後可重新執行同一個 setup：

```powershell
cd '<repo-root>'
git pull
.\Setup-DeploymentServer.cmd
```

部署主機需求：

- Windows 11。
- 系統管理員 PowerShell。
- Git。
- 可連網的主機介面。
- 連接目標電腦或部署交換器的服務介面。
- Node.js LTS 與 npm；若缺少，setup 會嘗試透過 `winget` 安裝。
- PowerShell Gallery、NuGet provider、`OSD` 與 `OSDCloud` modules；setup 會準備所需 module。

`Setup-DeploymentServer.cmd` 只負責讓 Web Console 可啟動：

| 階段 | 會做 | 不會做 |
| --- | --- | --- |
| Prerequisites | 檢查 Git、Node.js、npm、PowerShell modules | 不建立部署 runtime |
| Install bundle | 安裝 `C:\OSDCloud\HostTools\App` 與 `State` | 不寫入 deployment secrets |
| Node setup | 執行 npm install 並確認主程式可載入 | 不下載 OS image 或 client software |
| Web launch | 啟動本機 Web Console | 不啟動 DHCP、TFTP、HTTP deployment services |

setup 完成後開啟：

```text
http://127.0.0.1:8080
```

若部署主機後續不需要修改 source，可改用：

```text
C:\OSDCloud\HostTools\Open-WebConsole.cmd
```

### 03. 服務如何運作

Winception 的服務分成控制面與資料面：

| 元件 | 作用 |
| --- | --- |
| Web Console | 提供操作介面、API、狀態彙整與確認式變更動作 |
| Runtime Readiness | 檢查 runtime root 是否具備 boot、WinPE、iPXE 與必要支援檔 |
| Endpoint Sync | 將本次服務介面、IP、DHCP pool、HTTP base、SMB endpoint 與 secrets 同步到 live boot files 與 `boot.wim`；WinPE server health probe 的優先 IP 也會一併更新 |
| DHCP responder | 在指定模式下提供 lease 或 PXE boot options |
| TFTP service | 提供 Secure Boot chain 所需的 Microsoft-signed boot files |
| HTTP media service | 提供 iPXE script、WinPE boot files、status API、screenshot API 與 Torrent control API |
| SMB share | 提供 WinPE 讀取 selected OS WIM、Apps、Scripts 與 manifests |
| Torrent tracker/seeder | 使用 repo-local HTTP tracker 與 host seeder，在多台 client 同時部署時分散 OS WIM 傳輸壓力 |
| Windows finalizer | 在第一次登入後執行 profile 內的 software/custom script sequence 並回報完成 |

正常部署資料流：

1. 技術人員在 Web Console 選定服務介面與 DHCP/boot mode。
2. Endpoint Sync 發布 live `boot.ipxe`、TFTP boot files、SMB firewall 與 WinPE 內嵌 endpoint。
3. 技術人員準備 OS Image Cache，將來源 ISO/ESD/WIM 匯出成單一 deployable WIM。
4. 技術人員發布 active deployment profile，產生 `selected-os.json` 與 `selected-profile.json`。
5. `Run preflight` 檢查 runtime、endpoint、OS image、profile payload、SMB、ports 與服務設定。
6. 技術人員明確啟動 HTTP、TFTP、DHCP services。
7. 目標電腦從 UEFI IPv4 PXE 開機並進入 WinPE。
8. WinPE 掛載 SMB share，讀取 selected manifests，套用 Windows image。
9. Windows 第一次開機後自動完成 SetupComplete、apps/scripts、desktop-ready marker 與回報。

### 04. Runtime/State/Secrets 邊界

Winception 使用三個不同責任邊界：

| 路徑 | 用途 | 管理方式 |
| --- | --- | --- |
| `<repo-root>` | Source、docs、config defaults、scripts | 由 Git 管理 |
| `C:\OSDCloud\HostTools\App` | 已安裝的 Web Console 與 helper scripts | 由 setup/reload 安裝 |
| `C:\OSDCloud\HostTools\State` | 本機 overlay、secrets、staging、host-only state | 由 Web Console 與 helper scripts 管理 |
| `<deployment-root>` | Web 選定的部署 runtime，預設 `C:\OSDCloud` | 由 product workflow 產生與更新 |

不要手動 patch、copy 或直接修改 `<deployment-root>` 內的部署檔。部署行為需要修正時，應先改 `<repo-root>` source，再透過既有 publish、reload、Endpoint Sync 或 profile publish 流程讓 runtime 更新。

Deployment secrets 由 Web 初始化流程寫入：

```text
C:\OSDCloud\HostTools\State\config\osdcloud-secrets.json
```

必要欄位：

```json
{
  "windowsUsername": "<local-account-username>",
  "windowsPassword": "<local-account-password>",
  "pxeinstallPassword": "<smb-account-password>"
}
```

規則：

- 不把 plaintext secrets 寫進 repo、文件、logs、commit message 或 status。
- API 和 Web UI 只顯示 present/missing/redacted 狀態。
- Endpoint Sync 會把必要 secret 安全注入 live `boot.wim`，讓 WinPE 可掛載 SMB 並完成 Windows 設定。
- 需要輪替帳號或密碼時，從 Web Console 的 Deployment Secrets 流程更新。
- Web Console API 在 loopback (`localhost` / `127.x` / `::1`) 預設免 token；若 Web host 綁定非 loopback，所有 `/api/*` 除 `/api/auth/status` 需 `X-Winception-Token`。Token 存在 `C:\OSDCloud\HostTools\State\config\web-console-token.json`，不會寫入 repo 或 API response。

### 05. 部署前準備

Web Console 的頂部工作區是 **Deploy** / **Monitor**。`Deploy` 內含 guided setup rail 與 runtime/preflight/services/diagnostics/Offline ISO 操作面；`Monitor` 檢視 Activity fleet 與 evidence。第一次開啟 Web Console 時，在 `Deploy` 內依 Guided Setup 完成：

1. Project root：確認 deployment root，預設可用 `C:\OSDCloud`。
2. Deployment secrets：輸入目標 Windows local account 與 SMB account secret。
3. Prepare runtime：建立 runtime skeleton、SMB account/share、boot artifacts 與 WinPE。
4. Select endpoint：選定要服務目標電腦的主機介面與 IP。
5. OS Image Cache：下載或匯入 Windows 11 source，選 DISM index，匯出 deployable WIM。
6. Deployment Profile：選 OS image、語言/區域/時區、software、custom scripts 與執行順序。
7. Run preflight：確認所有 blocking checks 通過。
8. Start services：由技術人員明確啟動服務。

每次成功部署或 reload HostTools 都會清除舊的 diagnostics summary 與 ZIP，避免新 Console 把前次主機失敗誤顯示為目前狀態。請按 `Run diagnostics` 建立本次主機的新證據包；若既有摘要的 ZIP 已不在本機，Console 會停用下載並要求重新產生。

#### 第一次部署會下載什麼、存到哪裡

第一次部署不會在 `Start services` 那一刻一次抓完所有內容；Winception 依功能邊界分別在 setup、Prepare runtime、OS Image Cache、profile publish 與 client 首次 driver pack 請求時補齊檔案。

| 階段 | 下載或產生的內容 | 最終位置 | 暫存或快取位置 |
| --- | --- | --- | --- |
| Setup | `Node.js LTS`、PowerShell Gallery `NuGet` provider、`OSD` / `OSDCloud` modules（僅在主機缺少時） | 系統安裝路徑與 PowerShell module 路徑 | 依系統安裝程式與 PowerShell Gallery |
| Prepare runtime | `wimboot` | `C:\OSDCloud\PXE-HttpRoot\osdcloud\wimboot` | `C:\OSDCloud\HostTools\State\.downloads\deployment-artifacts\` |
| Prepare runtime | `aria2` 壓縮檔，解出 `aria2c.exe` 供 WinPE Torrent 使用 | `C:\OSDCloud\Tools\aria2c.exe` | `C:\OSDCloud\HostTools\State\.downloads\deployment-artifacts\` |
| Prepare runtime | Windows ADK / Windows PE Add-on（僅在主機缺少時） | Windows ADK 系統安裝路徑 | `C:\OSDCloud\HostTools\State\.downloads\prerequisites\windows-adk\` |
| Prepare runtime | WinPE workspace 產物：`boot.wim`、`bootmgr`、`bootx64.efi`、`BCD`、`boot.sdi` | `C:\OSDCloud\Media\...`、`C:\OSDCloud\PXE-HttpRoot\osdcloud\...`、`C:\OSDCloud\PXE-TFTP\...` | 由 ADK/OSDCloud 直接產生，非 repo 預載 |
| Prepare runtime | `snponly.efi` | `C:\OSDCloud\PXE-TFTP\ipxeboot\x86_64-sb\snponly.efi` | 不在 runtime 現抓；從 repo 內 `osdcloud-assets` 複製 |
| OS Image Cache | Windows 11 source `ISO` / `ESD` / `WIM`（官方下載或本機匯入） | source archive：`C:\OSDCloud\Media\OSDCloud\OS\sources\` | `C:\OSDCloud\Media\OSDCloud\OS\.downloads\` |
| OS Image Cache | 匯出的 deployable `WIM` 與 `selected-os.json` | `C:\OSDCloud\Media\OSDCloud\OS\` | 匯出 staging：`C:\OSDCloud\Media\OSDCloud\OS\.downloads\` |
| OS Image Cache | Web upload/import 的本機來源檔 | 不直接進 live runtime；匯入後才轉成快取映像 | `C:\OSDCloud\Media\OSDCloud\OS\.downloads\uploads\` |
| Profile publish | active profile 選中的 client software installer | host-side payload store：`C:\OSDCloud\HostTools\State\Softwares\<software>\`；published Apps：`C:\OSDCloud\Media\OSDCloud\Apps\<software>\` | `C:\OSDCloud\HostTools\State\.downloads\software-payloads\<software>\` |
| Client 首次部署到特定機型 | 官方 driver pack（按需） | `C:\OSDCloud\Media\OSDCloud\DriverPacks\` | 直接快取到同一路徑，索引寫入 `driverpack-cache.jsonl` |

規則：

- `Prepare runtime` 只處理 boot/iPXE/WinPE runtime artifacts；不會因為 catalog 內有 software 就預先下載 Apps。
- client software 只有在 active profile publish 時才驗證、下載並發布。
- driver pack 是 host-first、model-aware；只有某台 client 回報需要該官方套件時才下載。
- `C:\winception` Git clone 不承載這些 live runtime downloads；真正的 runtime / state 落在 `C:\OSDCloud` 與 `C:\OSDCloud\HostTools\State`。

服務網段決策：

| 模式 | 使用時機 | 注意事項 |
| --- | --- | --- |
| DHCP Server | Winception 管理獨立部署網段的 lease | 同一網段不應有其他 DHCP responder |
| PXE Proxy | 既有網路已提供 DHCP，Winception 只提供 PXE boot options | 需要確認既有 DHCP 與路由設定可讓 client 回到 `<service-ip>` |

Client Internet 拓撲：

| 拓撲 | Host 接法 | Client Internet |
| --- | --- | --- |
| Shared LAN（預設） | Winception 與 client 接同一 switch；router 也接該 LAN | 由既有 router/LAN 決定；依當下 DHCP Server 或 PXE Proxy 模式操作 |
| Dual NIC NAT | WAN NIC 接 Internet；PXE NIC 接 client 專用 switch | Web Console 明確確認後建立 `Winception-PXE` Hyper-V switch 與 `WinceptionNAT`；PXE client gateway 是 host `192.168.100.1` |

Dual NIC NAT 不修改 WAN NIC 的 IP、gateway、DNS 或全域 firewall。它會停止 deployment services、要求 PXE NIC 沒有 default gateway、拒絕既有 ICS/非 Winception NetNat 衝突，並固定使用 DHCP Server；Hyper-V 初次啟用若需要 reboot，會以一次性 SYSTEM task 完成使用者已確認的網路準備。停止 HTTP/TFTP/DHCP 不會停用 NAT，因此已部署 client 的 post-logon software/custom scripts 仍可上網。

Client 網路邊界：

- Deployment 階段只需要連到 Winception server 的 DHCP、TFTP、HTTP、SMB、Torrent 與 status endpoints；client 不需要外部 Internet。
- WinPE / OSDCloud / OOBE injection / SetupComplete staging 會停用 OSDCloud 的 external module update、Microsoft Update Catalog、Windows Update 與 Windows Update driver 分支。
- Dual NIC NAT 讓 client 全程具有外網路徑，但 WinPE 與 OSDCloud 仍不依賴 external Internet；實際 Internet 使用維持在 post-logon finalizer 的 software/custom script sequence。

Boot mode 決策：

| Boot mode | 開機鏈 | Secure Boot |
| --- | --- | --- |
| `secureboot` | Microsoft-signed `bootmgfw.efi` over TFTP，再載入 `boot.wim` | 可保持啟用 |
| `ipxe` | `snponly.efi` over TFTP，再由 iPXE 透過 HTTP 載入 WinPE | 目標電腦需關閉 Secure Boot |

啟動服務前，必須在 Web Console 確認：

- Runtime Readiness 為 ready。
- Endpoint 顯示正確的 service interface、service IP、DHCP pool、router、HTTP base 與 SMB share。
- Active OS Image 已匯出 deployable WIM。
- Active Profile 已發布且 manifests 不是 stale。
- Preflight 沒有 blocking failure。
- 目標網段的 DHCP mode 選擇正確。

### 06. 部署一台電腦

在 Web Console 完成部署前準備後：

1. 按 `Start all services`，或依序啟動 HTTP/status、TFTP、DHCP。
2. 在目標電腦選擇 UEFI IPv4 PXE boot。
3. 不使用外部安裝媒體，不手動點選 OOBE。
4. 在 Web Console 觀察 Client Fleet、Activity、Validation Evidence 與 System Log。
5. 目標電腦完成 WinPE image apply 後會自動重新開機。
6. Windows 第一次開機後會自動登入 `<windowsUsername>`。
7. Windows finalizer 會執行 active profile 的 software/custom script sequence。
8. 成功後 Web Console 會收到 `windows-desktop-ready`。

若需要離線媒體而不是 PXE，可在 `Deploy` 主畫面的 `Offline ISO` 卡片按 `Create ISO`。這會在主機端建立 immutable snapshot ISO，輸出到 `<deployment-root>\Exports`，並在畫面顯示 `Output folder` 與完整 `ISO file` 路徑。這條路徑不提供瀏覽器下載，也不替代 PXE readiness 證據。

常見正常事件順序：

```text
winpe-start
smb-mounted
torrent-download
torrent-verify
osdcloud-start
apply-image
osdcloud-finished
rebooting
windows-setupcomplete-start
windows-apps-start
windows-apps-finished
windows-setupcomplete-finished
windows-logon-start
windows-desktop-ready
```

`Minimal` profile 不安裝額外 client software。其他 profile 會依 `installSequence` 執行 software 與 custom scripts；任一步失敗、缺檔或 timeout，後續步驟不再執行，Web Console 會顯示對應錯誤階段。重開後的 SYSTEM finalizer 會先等待目標使用者桌面，再開始安裝；首次登入的 client 畫面會分別顯示等待登入、finalizer 啟動、目前步驟、是否仍在運作、即時 elapsed、slow warning 與已完成步驟耗時。這些安全狀態每兩秒刷新；完成時 Validation Evidence 只收到每步名稱、類型、status 與實際 duration，不含原始 installer output、命令列或秘密。若 custom script 需要 Internet，請把該依賴放在這個 post-logon sequence 內處理；deployment 階段不應依賴 client 外網。SetupComplete 會在 deployment 完成前停用 Windows Update / BITS 自動活動，因此依賴 BITS 或 Windows Update 的 custom script 必須自行啟動必要服務，或改用直接下載工具。

Software Catalog 的新增精靈分三步：先建立 `Package`（Software ID、顯示名稱與必填 MSI/EXE payload；每個必填欄位都有紅色 `*`，installer type 依副檔名自動判定），再選擇 `Installation`，最後設定 `Requirements & review`。選檔後若重新開啟檔案選擇器再按取消，已選 payload 會保留。`Guided installer` 會由 Winception 產生 MSI/EXE 靜默安裝腳本；`Custom PowerShell` 仍需附帶 payload，並執行受信任管理員提供的 `install.ps1`。可先選擇 payload 後載入 MSI/EXE 參考範本，再依實際安裝器修改。Custom PowerShell 會先做 Windows PowerShell 5.1 語法檢查，因為 client 固定以 Windows 內建的 `powershell.exe`（PowerShell 5.1）在 SYSTEM、非互動環境執行；syntax preflight 只確保語法可被同一個 runtime 解析，不是 sandbox 或實機安裝測試。

Guided installer 的「視為成功的 installer 回傳碼」中，MSI 預設 `0,1641,3010`，EXE 預設 `0`：`0` 為成功、`3010` 為成功但建議重開機、`1641` 會把 sequence 標為 restart pending，重開機與目標使用者登入後從下一步續跑。請填入安裝後檔案驗證取得更可靠的結果；留白時只信任 installer 回傳碼。

Software 可宣告前置 software；profile 儲存時會拒絕缺少或循環相依，並只重排 software slots、保留 custom script 的位置。預設 installer 先在 host publish 時下載／驗證並由 client 離線執行。若軟體確實需要 client Internet，設定 `Client Internet required` 與 DNS probe host；post-logon sequence 會每 10 秒等待 DNS/TCP 443，直到該步 timeout，未就緒不執行安裝器。Shared LAN 由既有 router 提供路由；隔離 PXE 網段應使用 Dual NIC NAT。

需要快速驗證 profile 的 software 時，先一次性用 `Minimal` profile 完整部署專用的第 2 代 Hyper-V VM，關機後手動建立 `Winception-SoftwareTest-Clean` checkpoint。`Software Test VM` 區塊在 Deployment Profiles 預設收合，需要時再展開。到 `Profiles` 的 `Software Test VM` 登記 VM 名稱、checkpoint 與目標使用者；登記只驗證既有 VM/快照，絕不建立或覆寫 VM。VM 必須為第 2 代且完全關機，Saved／Paused 不可接受；介面會以英文說明具體修正動作，不會顯示 PowerShell 原始錯誤。若 test 停在 `payload-ready` 超過 1 分鐘且沒有 runner，先確認 VM 完全關機，再使用「測試 VM 設定 → 登記並驗證」安全結束該未啟動 run。之後每個 profile 的 `測試 software` 都會把等同 publish 的 Apps/Scripts payload 建在 `C:\OSDCloud\HostTools\State\software-test-runs\<runId>`，不會改 active profile、live Apps、services 或 PXE。提升權限的 host runner 會還原快照、啟動 VM、用 PowerShell Direct 複製隔離 payload，並以 SYSTEM 執行同一份 `Install-Apps.ps1`；遇到 `1641` 會重開後續跑，最多為 sequence 步數。測試中可從全域 Console dock 或展開的 Software Test VM 區塊按 `Stop test`；確認後會中斷目前 installer、強制關閉專用 VM 並還原乾淨 checkpoint。Profile、OS Image、Endpoint 可開啟檢視，但測試與 cleanup 期間一律為唯讀；所有修改、publish、服務與 deployment 操作維持鎖定。中止成功會標為 `aborted / succeeded`，不會保留已完成安裝；cleanup 失敗會顯示安全的原因與復原動作，並封鎖後續測試。重建／還原 checkpoint 並完全關機後，使用「測試 VM 設定 → 登記並驗證」才會解除鎖定。`Copy test report` 只複製安全摘要；原始 runner diagnostic 與 client logs 僅留在 HostTools State。本功能不取代完整 PXE 驗收。

### 07. 監控與完成判定

部署期間主要看四個區塊：

| 區塊 | 用途 |
| --- | --- |
| Client Fleet | 顯示每台電腦的 runId、stage、percent、last seen、done/failed/stale 狀態 |
| Activity | 以卡片方式檢視部署流程、事件時間與每台電腦的結果 |
| Validation Evidence | 顯示 selected run 的 target system、image path、profile、app/script summary 與完成證據；時間固定為 host-observed UTC+8，completed/failed 後不再被晚到事件改寫 |
| System Log | 顯示 DHCP、TFTP、HTTP、Endpoint Sync、Preflight、Torrent 與 controller log |

部署完成條件：

```text
Final stage        : windows-desktop-ready
Percent            : 100
ExplorerRunning    : True
DesktopReadyFile   : True
OobeProcesses      : <empty>
LaunchUserOOBE     : 0
SkipUserOOBE       : 1
NoAutoUpdate       : 1
User               : <target-computer>\<windowsUsername>
```

OS image path 應符合 active manifest：

```text
ImageFileUrl                         : <empty>
ImageFileDestination                 : Z:\OSDCloud\OS\<selected-image>.wim
ImageFileDestination.PSDrive.DisplayRoot : \\<service-ip>\OSDCloudiPXE
OSImageIndex                         : 1
```

若使用 Torrent P2P，Tracker card 會顯示 wave、batch、slot、host ratio、active peers、piece coverage、download/upload rates 與 seed wait 摘要。摘要列出 `Base`、client console `E` 的累積 `Client` 延長、Web 的累積 `Web` 延長、總 wait、剩餘時間與 deadline。預設 seed wait 是 15 分鐘；可在 card 設定 0–1440 分鐘，設定只會套用到之後讀取 boot-config 的 WinPE client。每台 fresh waiting client 可個別延長 1–1440 分鐘，下載完成後的總 wait 不可超過 1440 分鐘；WinPE console 也可按 `E` 延長，deadline 後保留 60 秒按 `E` 或 Enter 決策。Torrent telemetry 短暫中斷不等於部署失敗；以 client 本機進度、SHA-256 驗證與最終 status 為準。更新 WinPE 行為後必須 Endpoint Sync 重新注入 `boot.wim`。

### 08. 日常維護與故障排除

常見處置：

| 現象 | 優先檢查 | 動作 |
| --- | --- | --- |
| Runtime blocked | Runtime Readiness detail | 執行 Prepare runtime；不要手動複製檔案到 runtime |
| Preflight blocked | Preflight Summary | 依 failed row 的 `How to fix` 修正後重跑 |
| Client 沒取得 lease | DHCP mode、服務狀態、目標網段 | 確認 DHCP 設定與目標網段沒有 responder 衝突 |
| Secure Boot chain 未進 WinPE | TFTP log、boot mode、published TFTP files | 重跑 Endpoint Sync 或重新發布 Secure Boot TFTP staging |
| iPXE chain 未載入 script | boot mode、Secure Boot、DHCP boot URL | 確認目標電腦允許未簽章 iPXE chain |
| WinPE 無法掛 SMB | SMB share、防火牆、`pxeinstallPassword`、endpoint | 更新 secrets 或重跑 Endpoint Sync |
| OS image 不套用 | `selected-os.json`、deployable WIM、SMB path | 在 OS Image Cache 匯出 WIM 並重新 publish profile |
| Profile stale | Deployment Profiles | 對 active profile 執行 Set active 或 Edit active 後存檔 |
| 停在 awaiting Windows | SetupComplete status URL、Windows network、embedded scripts | 檢查 per-run events 與 client logs |
| Apps/Scripts failed | Validation Evidence app/script summary | 查看 `C:\Windows\Temp\osdcloud-logs` 內的 step log |

變更服務介面時，優先使用 Web Console 的 `Select service interface`。這會停止 running services、更新 local overlay、重算 DHCP pool/router、更新 live boot files、提交 WinPE endpoint、同步 SMB firewall，並刷新必要 metadata。不要只修改 Windows NIC IP 或單一 JSON 檔。

新增 client software 時，使用 `Profiles` > `Software Catalog` > `Add software`。依序完成 Package、Installation、Requirements & review：一般 MSI/EXE 選 `Guided installer`；只有需要完整自訂 `install.ps1` 時才選 `Custom PowerShell`。所有必填欄位均有紅色 `*`；Custom PowerShell 可先載入 MSI/EXE 參考範本，並以 client 實際使用的 Windows PowerShell 5.1 做 syntax preflight。預設使用 host 預載 payload，只有該步真的需要 client 外網才填 DNS probe host。新增成功後可選擇再新增一套或前往 Deployment profile；catalog row 不會自動加入 active profile，也不會立即發布到 live Apps。請在 profile editor 加入 selected install sequence 後再 publish。

### 09. 停止服務與交接

部署窗口結束後：

1. 在 Web Console 停止 DHCP、TFTP、HTTP services。
2. 確認目標網段恢復到預期的日常 DHCP/路由狀態。
3. 在 Activity 或 Validation Evidence 保存必要 runId 與完成狀態摘要。
4. 若有 source 行為變更，先完成文件同步與既有驗證，再透過既有 release/handoff 流程交接。
5. 不提交 generated artifacts、secrets、logs、screenshots 或本機 runtime state。

可交接給下一位技術人員的最小資訊：

```text
Web URL            : http://<web-host>:8080
Deployment root    : <deployment-root>
Service interface  : <interface-alias>
Service IP         : <service-ip>
DHCP mode          : <dhcp-mode>
Boot mode          : <boot-mode>
Active OS image    : <os-image-id>
Active profile     : <profile-id>
Last completed run : <run-id>
```

### 10. 參考文件

- [`docs/winception-operations-manual.html`](docs/winception-operations-manual.html)：中英雙語圖解操作手冊。
- [`docs/diagrams/technical-flow.md`](docs/diagrams/technical-flow.md)：系統架構與資料流圖。
- [`docs/diagrams/user-flow.md`](docs/diagrams/user-flow.md)：Web Console 操作流程圖。
- [`osdcloud-assets/README.md`](osdcloud-assets/README.md)：versioned runtime mirror 的用途與邊界。
- [`AGENTS.md`](AGENTS.md)：agent-only operational contract。

## English

### 01. Product Overview

Winception is a Windows 11 zero-touch deployment toolkit. A technician installs the Web Console on a deployment host, prepares the runtime, Windows image, deployment profile, and service endpoint, then the target computer only needs to boot from UEFI IPv4 PXE. WinPE, OSDCloud, Windows SetupComplete, applications, and custom scripts finish automatically.

Core capabilities:

- Installs a self-contained host management bundle at `C:\OSDCloud\HostTools\App`.
- Stores mutable host state at `C:\OSDCloud\HostTools\State`.
- Lets the Web Console manage the deployment project root, with `C:\OSDCloud` as the default option.
- Serves Windows 11 deployment data through DHCP, TFTP, HTTP, SMB, and Torrent P2P.
- Supports Secure Boot boot mode and an iPXE fallback boot mode.
- Uses deployment profiles to control OS image, display language, regional format, input language, time zone, client software, and custom scripts.
- Tracks each computer through Client Fleet, Activity, Validation Evidence, and System Log.
- Exposes an `Offline ISO` card on Deploy to build a host-side ISO from the active deployment state and show the host output folder plus full file path.

Intended users:

- Technicians who build or maintain the deployment host.
- Operators who start PXE services and deploy Windows 11 computers onsite.
- Support staff who need to determine completion, failure cause, and next action.

Open the illustrated bilingual manual at [`docs/winception-operations-manual.html`](docs/winception-operations-manual.html). After installation, the Web Console also exposes it through **Manual** at `/manual/`.

### 02. Deployment Host Installation

Run from an elevated PowerShell session:

```powershell
git clone <repo-url> <repo-root>
cd '<repo-root>'
.\Setup-DeploymentServer.cmd
```

For an existing clone, update and run the same setup:

```powershell
cd '<repo-root>'
git pull
.\Setup-DeploymentServer.cmd
```

Deployment host requirements:

- Windows 11.
- Elevated PowerShell.
- Git.
- One host interface with network access.
- One service interface connected to the target computers or deployment switch.
- Node.js LTS and npm; setup attempts to install them with `winget` when missing.
- PowerShell Gallery, NuGet provider, and the `OSD` / `OSDCloud` modules; setup prepares the required modules.

`Setup-DeploymentServer.cmd` only makes the Web Console launchable:

| Stage | Does | Does not do |
| --- | --- | --- |
| Prerequisites | Checks Git, Node.js, npm, and PowerShell modules | Does not create deployment runtime |
| Install bundle | Installs `C:\OSDCloud\HostTools\App` and `State` | Does not write deployment secrets |
| Node setup | Runs npm install and confirms the application can load | Does not download OS images or client software |
| Web launch | Starts the local Web Console | Does not start DHCP, TFTP, or HTTP deployment services |

After setup finishes, open:

```text
http://127.0.0.1:8080
```

If the deployment host no longer needs source edits, use:

```text
C:\OSDCloud\HostTools\Open-WebConsole.cmd
```

### 03. How The Services Work

Winception separates control-plane and data-plane services:

| Component | Role |
| --- | --- |
| Web Console | Provides the UI, API, state aggregation, and confirmation-based changes |
| Runtime Readiness | Checks whether the runtime root has boot, WinPE, iPXE, and support files |
| Endpoint Sync | Synchronizes the selected service interface, IP, DHCP pool, HTTP base, SMB endpoint, and secrets into live boot files and `boot.wim`; it also updates WinPE's preferred server health probe IP |
| DHCP responder | Provides leases or PXE boot options according to the selected mode |
| TFTP service | Serves the Microsoft-signed boot files required by the Secure Boot chain |
| HTTP media service | Serves iPXE script, WinPE boot files, status API, screenshot API, and Torrent control API |
| SMB share | Lets WinPE read the selected OS WIM, Apps, Scripts, and manifests |
| Torrent tracker/seeder | Uses the repo-local HTTP tracker plus host seeder to distribute OS WIM transfer load when many clients deploy at once |
| Windows finalizer | Runs the profile software/custom script sequence after first logon and reports completion |

Normal deployment data flow:

1. A technician selects the service interface plus DHCP and boot modes in the Web Console.
2. Endpoint Sync publishes live `boot.ipxe`, TFTP boot files, SMB firewall rules, and the WinPE embedded endpoint.
3. A technician prepares OS Image Cache by exporting a source ISO/ESD/WIM into one deployable WIM.
4. A technician publishes the active deployment profile, producing `selected-os.json` and `selected-profile.json`.
5. `Run preflight` checks runtime, endpoint, OS image, profile payload, SMB, ports, and service settings.
6. A technician explicitly starts HTTP, TFTP, and DHCP services.
7. The target computer boots from UEFI IPv4 PXE and enters WinPE.
8. WinPE mounts the SMB share, reads the selected manifests, and applies the Windows image.
9. On first Windows boot, SetupComplete, apps/scripts, desktop-ready marker, and completion reporting finish automatically.

### 04. Runtime/State/Secrets Boundaries

Winception uses three responsibility boundaries:

| Path | Purpose | Managed by |
| --- | --- | --- |
| `<repo-root>` | Source, docs, config defaults, scripts | Git |
| `C:\OSDCloud\HostTools\App` | Installed Web Console and helper scripts | setup/reload |
| `C:\OSDCloud\HostTools\State` | Local overlay, secrets, staging, host-only state | Web Console and helper scripts |
| `<deployment-root>` | Web-selected deployment runtime, defaulting to `C:\OSDCloud` | product workflows |

Do not manually patch, copy, or directly edit deployment files under `<deployment-root>`. When deployment behavior needs to change, update source under `<repo-root>` first, then let the existing publish, reload, Endpoint Sync, or profile publish flow update runtime state.

Deployment secrets are written by the Web initialization flow:

```text
C:\OSDCloud\HostTools\State\config\osdcloud-secrets.json
```

Required fields:

```json
{
  "windowsUsername": "<local-account-username>",
  "windowsPassword": "<local-account-password>",
  "pxeinstallPassword": "<smb-account-password>"
}
```

Rules:

- Do not write plaintext secrets into the repo, docs, logs, commit messages, or status.
- API and Web UI only show present/missing/redacted state.
- Endpoint Sync securely injects required secrets into live `boot.wim` so WinPE can mount SMB and finish Windows setup.
- When account or password rotation is required, update it through the Web Console Deployment Secrets flow.
- The Web Console API bypasses token auth on loopback (`localhost` / `127.x` / `::1`). If the Web host binds to a non-loopback address, every `/api/*` endpoint except `/api/auth/status` requires `X-Winception-Token`. The token lives at `C:\OSDCloud\HostTools\State\config\web-console-token.json` and is never written to the repo or returned by API responses.

### 05. Pre-Deployment Preparation

The Web Console top bar has **Deploy** / **Monitor**. `Deploy` contains the guided setup rail plus runtime/preflight/services/diagnostics/Offline ISO controls, and `Monitor` shows Activity fleet and evidence. On first launch, complete Guided Setup inside `Deploy`:

1. Project root: confirm the deployment root; `C:\OSDCloud` is the default option.
2. Deployment secrets: enter the target Windows local account and SMB account secret.
3. Prepare runtime: create runtime skeleton, SMB account/share, boot artifacts, and WinPE.
4. Select endpoint: choose the host interface and IP that will serve target computers.
5. OS Image Cache: download or import a Windows 11 source, choose a DISM index, and export a deployable WIM.
6. Deployment Profile: choose OS image, language/region/time zone, software, custom scripts, and execution order.
7. Run preflight: confirm all blocking checks pass.
8. Start services: a technician explicitly starts services.

Each successful HostTools deployment or reload clears the prior diagnostics summary and ZIP so a new Console does not present an earlier host failure as current. Select `Run diagnostics` to create fresh host evidence; if an existing summary's ZIP is no longer local, Console disables its download and asks you to generate diagnostics again.

#### Files Downloaded on First Deployment and Where They Go

Winception does not fetch everything the first time you press `Start services`. Files are resolved at different stages: setup, Prepare runtime, OS Image Cache, profile publish, and the first client-side driver-pack request.

| Stage | Downloaded or generated content | Final location | Staging or cache location |
| --- | --- | --- | --- |
| Setup | `Node.js LTS`, the PowerShell Gallery `NuGet` provider, and the `OSD` / `OSDCloud` modules (only when missing on the host) | System install paths and PowerShell module paths | Determined by the system installer and PowerShell Gallery |
| Prepare runtime | `wimboot` | `C:\OSDCloud\PXE-HttpRoot\osdcloud\wimboot` | `C:\OSDCloud\HostTools\State\.downloads\deployment-artifacts\` |
| Prepare runtime | `aria2` archive, extracted as `aria2c.exe` for WinPE Torrent use | `C:\OSDCloud\Tools\aria2c.exe` | `C:\OSDCloud\HostTools\State\.downloads\deployment-artifacts\` |
| Prepare runtime | Windows ADK / Windows PE Add-on (only when missing on the host) | Windows ADK system install paths | `C:\OSDCloud\HostTools\State\.downloads\prerequisites\windows-adk\` |
| Prepare runtime | WinPE workspace outputs: `boot.wim`, `bootmgr`, `bootx64.efi`, `BCD`, `boot.sdi` | `C:\OSDCloud\Media\...`, `C:\OSDCloud\PXE-HttpRoot\osdcloud\...`, and `C:\OSDCloud\PXE-TFTP\...` | Generated by ADK/OSDCloud, not preloaded in the repo |
| Prepare runtime | `snponly.efi` | `C:\OSDCloud\PXE-TFTP\ipxeboot\x86_64-sb\snponly.efi` | Not downloaded live into runtime; copied from the repo's `osdcloud-assets` |
| OS Image Cache | Windows 11 source `ISO` / `ESD` / `WIM` (official download or local import) | source archive: `C:\OSDCloud\Media\OSDCloud\OS\sources\` | `C:\OSDCloud\Media\OSDCloud\OS\.downloads\` |
| OS Image Cache | Exported deployable `WIM` and `selected-os.json` | `C:\OSDCloud\Media\OSDCloud\OS\` | export staging: `C:\OSDCloud\Media\OSDCloud\OS\.downloads\` |
| OS Image Cache | Locally uploaded/imported source media | Not written directly to live runtime; imported into the image cache first | `C:\OSDCloud\Media\OSDCloud\OS\.downloads\uploads\` |
| Profile publish | Client software installers selected by the active profile | host-side payload store: `C:\OSDCloud\HostTools\State\Softwares\<software>\`; published Apps: `C:\OSDCloud\Media\OSDCloud\Apps\<software>\` | `C:\OSDCloud\HostTools\State\.downloads\software-payloads\<software>\` |
| First deployment for a specific hardware model | Official driver pack (on demand) | `C:\OSDCloud\Media\OSDCloud\DriverPacks\` | Cached directly in the same path; indexed in `driverpack-cache.jsonl` |

Rules:

- `Prepare runtime` handles only boot/iPXE/WinPE runtime artifacts; it does not pre-download Apps just because software exists in the catalog.
- Client software is validated, downloaded, and published only during active profile publish.
- Driver packs are host-first and model-aware; they download only when a client reports that a specific official package is needed.
- The `C:\winception` Git clone does not hold these live runtime downloads; live runtime and state live under `C:\OSDCloud` and `C:\OSDCloud\HostTools\State`.

Service network decision:

| Mode | Use when | Notes |
| --- | --- | --- |
| DHCP Server | Winception owns leases on an isolated deployment network | No other DHCP responder should answer on the same segment |
| PXE Proxy | Existing network DHCP is already present and Winception only supplies PXE boot options | Confirm existing DHCP and routing let clients reach `<service-ip>` |

Client Internet topologies:

| Topology | Host wiring | Client Internet |
| --- | --- | --- |
| Shared LAN (default) | Winception and clients use the same switch, which is also connected to the router | Owned by the existing router/LAN; select DHCP Server or PXE Proxy for that segment |
| Dual NIC NAT | WAN NIC reaches the Internet; PXE NIC reaches a client-only switch | After explicit Web confirmation, Winception creates the `Winception-PXE` Hyper-V switch and `WinceptionNAT`; PXE clients use host `192.168.100.1` as their gateway |

Dual NIC NAT does not change the WAN NIC IP, gateway, DNS, or global firewall. It stops deployment services, requires the PXE NIC to have no default gateway, rejects ICS/non-Winception NetNat conflicts, and always uses DHCP Server mode. If the first Hyper-V enablement needs a reboot, a one-time SYSTEM task completes the already-confirmed network preparation. Stopping HTTP/TFTP/DHCP does not stop NAT, so deployed clients retain Internet access for post-logon software/custom scripts.

Client network boundary:

- The deployment phase only needs access to Winception server DHCP, TFTP, HTTP, SMB, Torrent, and status endpoints; the client does not need external Internet.
- WinPE / OSDCloud / OOBE injection / SetupComplete staging disables OSDCloud external module update, Microsoft Update Catalog, Windows Update, and Windows Update driver branches.
- Dual NIC NAT gives clients a route throughout deployment, but WinPE and OSDCloud still have no external Internet dependency; intended Internet use remains the post-logon finalizer software/custom script sequence.

Boot mode decision:

| Boot mode | Boot chain | Secure Boot |
| --- | --- | --- |
| `secureboot` | Microsoft-signed `bootmgfw.efi` over TFTP, then `boot.wim` | Can stay enabled |
| `ipxe` | `snponly.efi` over TFTP, then iPXE loads WinPE over HTTP | Target computer must disable Secure Boot |

Before starting services, confirm in the Web Console:

- Runtime Readiness is ready.
- Endpoint shows the correct service interface, service IP, DHCP pool, router, HTTP base, and SMB share.
- Active OS Image has an exported deployable WIM.
- Active Profile is published and manifests are not stale.
- Preflight has no blocking failure.
- The DHCP mode is correct for the target network.

### 06. Deploy One Computer

After preparation is complete in the Web Console:

1. Click `Start all services`, or start HTTP/status, TFTP, and DHCP in order.
2. Select UEFI IPv4 PXE boot on the target computer.
3. Do not use external installation media and do not click through OOBE manually.
4. Watch Client Fleet, Activity, Validation Evidence, and System Log in the Web Console.
5. The target computer automatically reboots after WinPE image apply finishes.
6. Windows automatically signs in as `<windowsUsername>` on first boot.
7. The Windows finalizer runs the active profile software/custom script sequence.
8. The Web Console receives `windows-desktop-ready` on success.

If you need offline media instead of PXE, use the `Offline ISO` card on the `Deploy` dashboard. `Create ISO` builds an immutable host-side ISO snapshot under `<deployment-root>\Exports` and shows the `Output folder` plus full `ISO file` path in the UI. This path does not offer browser download and does not replace PXE readiness evidence.

Common normal event sequence:

```text
winpe-start
smb-mounted
torrent-download
torrent-verify
osdcloud-start
apply-image
osdcloud-finished
rebooting
windows-setupcomplete-start
windows-apps-start
windows-apps-finished
windows-setupcomplete-finished
windows-logon-start
windows-desktop-ready
```

The `Minimal` profile installs no extra client software. Other profiles run software and custom scripts according to `installSequence`; if any step fails, is missing, or times out, later steps do not run and the Web Console shows the matching error stage. After reboot, the SYSTEM finalizer waits for the target user's desktop before installation starts; the first-logon client screen separately shows the sign-in wait, finalizer start, active step, liveness, live elapsed time, slow warning, and completed-step durations. These safe fields refresh every two seconds; on completion, Validation Evidence receives only each step's name, type, status, and actual duration, never raw installer output, command lines, or secrets. If a custom script needs Internet, put that dependency inside this post-logon sequence; the deployment phase must not depend on client external Internet. SetupComplete disables automatic Windows Update / BITS activity before deployment completion, so custom scripts that depend on BITS or Windows Update must start the required services themselves or use a direct download tool.

The Software Catalog add wizard has three steps: `Package` collects the Software ID, display name, and required MSI/EXE payload (each required field has a red `*`, and the installer type is inferred from its extension); `Installation` selects the install method; `Requirements & review` records dependencies and client-network conditions. Reopening the file picker and cancelling preserves an already selected payload. `Guided installer` generates an MSI/EXE silent install script. `Custom PowerShell` still includes a payload and runs a trusted administrator-provided `install.ps1`. After choosing a payload, an MSI/EXE reference template can be loaded and adapted. Custom PowerShell receives Windows PowerShell 5.1 syntax validation because the client runs the inbox `powershell.exe` (PowerShell 5.1) as non-interactive SYSTEM. The preflight confirms that this same runtime can parse the syntax; it is neither a sandbox nor an installation test.

Guided installer accepted return codes default to `0,1641,3010` for MSI and `0` for EXE: `0` is success, `3010` is success with a restart recommendation, and `1641` creates a restart-pending checkpoint that resumes with the next step after reboot and target-user sign-in. Add installed-file verification for stronger confirmation; leaving it blank trusts installer return codes only.

Software can declare prerequisite software. Saving a profile rejects missing or cyclic dependencies and reorders only the software slots, preserving custom-script positions. The default path prefetches and validates installers during host publish so clients install offline. For software that truly needs client Internet, select `Client Internet required` and provide a DNS probe host; the post-logon sequence waits for DNS/TCP 443 every 10 seconds until that step times out and does not start the installer before the probe passes. Shared LAN relies on the existing router; an isolated PXE segment needs Dual NIC NAT.

For fast profile-software verification, deploy a dedicated Generation 2 Hyper-V VM once with the `Minimal` profile, power it off, then manually create `Winception-SoftwareTest-Clean`. The `Software Test VM` section is collapsed by default in Deployment Profiles and can be expanded when needed. In `Profiles` > `Software Test VM`, register its VM name, checkpoint, and target user; registration only verifies the existing VM/checkpoint and never creates or overwrites one. The VM must be Generation 2 and completely powered off; Saved and Paused are not accepted. The UI provides an English corrective action without exposing raw PowerShell errors. If a test remains at `payload-ready` for more than one minute with no runner, confirm the VM is powered off, then use `Test VM settings` > `Register and verify` to safely end that unstarted run. Each profile's `Test software` action materializes the publish-equivalent Apps/Scripts payload under `C:\OSDCloud\HostTools\State\software-test-runs\<runId>` without changing the active profile, live Apps, services, or PXE. An elevated host runner restores the checkpoint, starts the VM, uses PowerShell Direct to copy the isolated payload, and runs the same `Install-Apps.ps1` as SYSTEM. It reboots and resumes after `1641`, up to the sequence step count. During a test, choose `Stop test` from the global Console dock or the expanded Software Test VM section; after confirmation it interrupts the current installer, forces off the dedicated VM, and restores the clean checkpoint. Profile, OS Image, and Endpoint remain available for inspection but are read-only while the test and cleanup are active; all changes, publish, service, and deployment actions stay locked. A successful stop is reported as `aborted / succeeded` and retains no installed software. Cleanup failure reports a safe reason and recovery action, then blocks later tests. After rebuilding or restoring the checkpoint and powering off the VM, use `Test VM settings` > `Register and verify` to unlock testing. `Copy test report` copies only the safe summary; raw runner diagnostics and client logs remain in HostTools State. This feature does not replace full PXE acceptance.

### 07. Monitoring And Completion Criteria

During deployment, use four primary areas:

| Area | Purpose |
| --- | --- |
| Client Fleet | Shows each computer's runId, stage, percent, last seen, and done/failed/stale state |
| Activity | Shows deployment flow, event timing, and each computer's result as cards |
| Validation Evidence | Shows selected run target system, image path, profile, app/script summary, and completion evidence; times are host-observed UTC+8 and completed/failed snapshots do not change when late events arrive |
| System Log | Shows DHCP, TFTP, HTTP, Endpoint Sync, Preflight, Torrent, and controller logs |

Completion criteria:

```text
Final stage        : windows-desktop-ready
Percent            : 100
ExplorerRunning    : True
DesktopReadyFile   : True
OobeProcesses      : <empty>
LaunchUserOOBE     : 0
SkipUserOOBE       : 1
NoAutoUpdate       : 1
User               : <target-computer>\<windowsUsername>
```

The OS image path should match the active manifest:

```text
ImageFileUrl                         : <empty>
ImageFileDestination                 : Z:\OSDCloud\OS\<selected-image>.wim
ImageFileDestination.PSDrive.DisplayRoot : \\<service-ip>\OSDCloudiPXE
OSImageIndex                         : 1
```

When Torrent P2P is enabled, the Tracker card shows wave, batch, slot, host ratio, active peers, piece coverage, download/upload rates, and a seed-wait summary. It lists the Base wait, the cumulative Client extension entered with WinPE console `E`, the cumulative Web extension, total wait, remaining time, and deadline. The default seed wait is 15 minutes; the card accepts 0–1440 minutes and affects only WinPE clients that read boot-config afterwards. Each fresh waiting client can be extended by 1–1440 minutes, with a maximum total wait of 1440 minutes after download completion. The WinPE console also accepts `E` to extend and gives a 60-second `E`/Enter decision window after the deadline. Short observation API interruptions do not mean deployment failure; rely on local client progress, SHA-256 verification, and final status. Run Endpoint Sync after a WinPE behavior update so `boot.wim` receives it.

### 08. Routine Maintenance And Troubleshooting

Common actions:

| Symptom | First check | Action |
| --- | --- | --- |
| Runtime blocked | Runtime Readiness detail | Run Prepare runtime; do not copy files manually into runtime |
| Preflight blocked | Preflight Summary | Follow the failed row `How to fix`, then rerun |
| Client gets no lease | DHCP mode, service state, target network | Confirm DHCP settings and no responder conflict on the target network |
| Secure Boot chain does not enter WinPE | TFTP log, boot mode, published TFTP files | Rerun Endpoint Sync or republish Secure Boot TFTP staging |
| iPXE chain does not load the script | boot mode, Secure Boot, DHCP boot URL | Confirm the target computer allows the unsigned iPXE chain |
| WinPE cannot mount SMB | SMB share, firewall, `pxeinstallPassword`, endpoint | Update secrets or rerun Endpoint Sync |
| OS image does not apply | `selected-os.json`, deployable WIM, SMB path | Export the WIM in OS Image Cache and republish the profile |
| Need offline ISO media | Deploy `Offline ISO` card, active profile, deployable WIM | Build the ISO on the host, then use the `Output folder` / `ISO file` paths shown in the UI |
| Profile stale | Deployment Profiles | Set active again, or edit active profile and save |
| Awaiting Windows | SetupComplete status URL, Windows network, embedded scripts | Inspect per-run events and client logs |
| Apps/Scripts failed | Validation Evidence app/script summary | Review step logs under `C:\Windows\Temp\osdcloud-logs` |

When changing the service interface, prefer Web Console `Select service interface`. It stops running services, updates local overlay, recalculates DHCP pool/router, updates live boot files, commits the WinPE endpoint, syncs SMB firewall, and refreshes required metadata. Do not only change the Windows NIC IP or a single JSON file.

When adding client software, use `Profiles` > `Software Catalog` > `Add software`. Complete Package, Installation, and Requirements & review in order: use `Guided installer` for normal MSI/EXE payloads and `Custom PowerShell` only when a complete custom `install.ps1` is required. Required fields have a red `*`; Custom PowerShell can load an MSI/EXE reference template and uses a Windows PowerShell 5.1 syntax preflight that matches the client runtime. Host-prefetched payload is the default; enter a DNS probe host only when that client step truly requires external Internet. After creation, choose either Add another or Go to Deployment profile. The catalog row is not automatically added to the active profile or published to live Apps; add it to the selected install sequence in the profile editor, then publish.

### 09. Stop Services And Handoff

At the end of a deployment window:

1. Stop DHCP, TFTP, and HTTP services in the Web Console.
2. Confirm the target network has returned to the expected day-to-day DHCP/routing state.
3. Preserve the required runId and completion summary from Activity or Validation Evidence.
4. If source behavior changed, complete documentation sync and existing verification before the established release/handoff flow.
5. Do not commit generated artifacts, secrets, logs, screenshots, or local runtime state.

Minimum handoff information for the next technician:

```text
Web URL            : http://<web-host>:8080
Deployment root    : <deployment-root>
Service interface  : <interface-alias>
Service IP         : <service-ip>
DHCP mode          : <dhcp-mode>
Boot mode          : <boot-mode>
Active OS image    : <os-image-id>
Active profile     : <profile-id>
Last completed run : <run-id>
```

### 10. Reference Documents

- [`docs/winception-operations-manual.html`](docs/winception-operations-manual.html): illustrated bilingual operations manual.
- [`docs/diagrams/technical-flow.md`](docs/diagrams/technical-flow.md): system architecture and data-flow diagram.
- [`docs/diagrams/user-flow.md`](docs/diagrams/user-flow.md): Web Console operator-flow diagram.
- [`osdcloud-assets/README.md`](osdcloud-assets/README.md): purpose and boundaries of the versioned runtime mirror.
- [`AGENTS.md`](AGENTS.md): agent-only operational contract.
