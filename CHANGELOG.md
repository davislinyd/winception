# Changelog

## Unreleased

### 新功能：Client 登入後部署進度畫面

- App/custom script sequence 改由第一次自動登入後的 `OSDCloudPostLogonFinalize` SYSTEM task 執行，保留既有順序、timeout、fail-fast、logs 與 host status events
- 新增 English 全螢幕置頂 viewer，顯示目前 app/script、步驟與完成項目；執行中不可關閉，成功後自動離開，失敗時需技術人員確認
- 新增 `C:\ProgramData\OSDCloud\deployment-progress.json` 安全狀態檔；不包含 stdout/stderr、raw exception、命令列或 secrets
- `selected-profile.json.installSequence[]` 增加 additive `name`，所有 profile（含 Minimal）都發布 `Show-DeploymentProgress.ps1`
- Desktop-ready reporter 只在 client finalization 成功後回報 `windows-desktop-ready`；意外重開機會標記 `interrupted`，不自動重跑非 idempotent step

### 修正：SetupComplete 無法初始化部署進度

- 將 progress JSON helpers 從 Desktop Ready reporter 的產生碼 here-string 移回 `SetupComplete.ps1` 外層作用域，避免四台 client 在 `Initialize-DeploymentProgress` 直接失敗
- 新增回歸檢查，確保 progress helpers 不會再次落入 reporter here-string
- 修正 Hyper-V restart helper 的預設 VM prefix，避免把 `winception-client-01` 組成不存在的 `winception-client-001`

### 修正：Client 重開機時進度環回退

- 將預期的 WinPE `reporter-stop` 對映至 `rebooting` flow step，避免等待 Windows 啟動期間進度環從 57% 回退至 5%

### 修正：Client 顯示語言、地區格式、輸入法與時區解耦

- Profile 新增獨立的 `displayLanguage` 與 `inputLanguage`；既有 `locale` 明確只代表 regional format，`timeZone` 只代表時區
- 發布時解析並驗證四項設定；display language 必須符合所選單語言 WIM，且 time zone 不可留空
- OOBE 分別寫入 `UILanguage`、`UserLocale`、`InputLocale`、`SystemLocale` 與 `TimeZone`
- SetupComplete 以 `inputLanguage` 建立單一 user language list，再重新套用獨立的 UI language/culture，並複製至 Welcome screen 與新使用者
- Desktop-ready evidence 從 target user registry 讀取 display language、culture、input languages/input methods，避免誤報 SYSTEM 設定
- Tracked `All in One` profile 使用 en-US WIM，設定 en-US UI/format/input 與 `Taipei Standard Time`

---

## v0.5.23 — 2026-06-18

### 變更

- **Web UI — 全英文化補齊**：清除 Console 內剩餘的使用者可見中文字串
  - Guided setup 的 `Objective` / `Done when` / `Safety note` 標籤改為英文
  - Deployment secrets 區塊的提示、按鈕與 `Windows username` / `Windows password` 欄位改為英文
  - Initialization step 的 `objective` / `doneWhen` / `safetyNote` / `nextActionText` 全部改為英文文案
  - Profile 的 locale 下拉選單保留 `zh-TW`、`zh-CN`、`ja-JP` 等 locale code，但顯示名稱統一改為英文
  - 只改 UI 可見文案；中文 Windows 相容 regex、測試 fixture、註解與設計文件不在此版變更範圍
- **Publish-SecureBootTftp — Security 模組 autoload 失敗**：修復 endpoint sync 內 child `powershell.exe` 可能因繼承到污染過的 `PSModulePath` 而無法載入 `Microsoft.PowerShell.Security`
  - 原因：`Get-AuthenticodeSignatureIsolated` 雖然已隔離 parent runspace，但仍依賴 autoload；若 Web console 由含 PowerShell 7 路徑的環境啟動，Windows PowerShell 5.1 子進程仍可能在 autoload 時失敗
  - 解法：在 isolated child 內先以 child `$PSHOME\Modules\Microsoft.PowerShell.Security` 顯式 `Import-Module`，完全繞過繼承的 `PSModulePath`

---

## v0.5.22 — 2026-06-17

### 新功能：Activity 多選刪除、封存與 Stale 篩選

- **多選刪除**：Activity（Fleet）卡片支援批次選取與刪除，不再只能單選後刪一筆
  - `Shift+點選`：先點頭、再 `Shift` 點尾，依當前顯示順序選取整個範圍
  - `Ctrl/Cmd+點選` 或卡片右上角 checkbox：單張加減選；一般點擊則單選並聚焦
  - 選取後出現批次工具列（`N selected` ＋ Select all／Delete／Clear），切換篩選會自動清空選取
- **封存（Archive）**：新增封存機制，把 run 搬到 `statusRoot\archive\`，自 Activity 隱藏但保留全部證據
  - active 視圖工具列與卡片詳情新增 `Archive`（單筆／批次）
  - 新增 `Archived` 篩選可瀏覽已封存記錄，提供 `Restore`（還原回 active）與 `Delete permanently`（永久刪除）
  - 批次操作逐筆隔離錯誤：選取中若有不存在的 run，其餘照常處理並回報略過項目，不會整批失敗
- **Stale 篩選**：篩選列新增獨立的 `Stale`；`Failed` 不再混入 stale，兩者各自獨立
  - 統計列與 Dashboard tile 也加上獨立的 `Stale` 計數，保持一致
- **後端**：`src/status.js` 新增 `archiveStatusRun(s)`／`restoreStatusRun(s)`／`deleteArchivedRun(s)`／批次 `deleteStatusRuns`／`readArchivedFleet`；新增 API endpoint `/api/status/runs/{delete,archive,restore}` 與 `/api/status/archive/delete`；`getState` 加入 `archivedFleet`
- 新增單元測試（封存／還原／批次／endpoint）

---

## v0.5.21 — 2026-06-17

### 修正

- **SetupComplete — App 安裝逾時與心跳**：修復 `Invoke-ClientAppInstallers` 呼叫 Install-Apps.ps1 時可能無限期阻塞（實測曾卡 779 分鐘）的問題
  - 新增 90 分鐘外層逾時保護（`AppInstallerTimeoutSeconds`）；超時後以 `taskkill /T /F` 終止整棵進程樹，送出 `windows-apps-error` 事件
  - 每 30 秒送一次 `windows-apps-progress` 心跳事件（`AppInstallerHeartbeatSeconds`），防止伺服器 15 分鐘無事件後將正在安裝的機台誤標為 stale
- **SetupComplete — ExitCode null 回退**：修復 PowerShell 5.1 中 `Start-Process -PassThru` 在 `WaitForExit()` 後 `ExitCode` 仍為 `$null` 的 bug，導致成功部署被誤報為 `windows-setupcomplete-error`
  - 當 `ExitCode` 為 `$null` 時，改讀取 `install-sequence-summary.json` 的 `failedStep` 欄位作為判斷依據
- **Publish-SecureBootTftp — TypeData 衝突**：修復 endpoint 同步時 `AuditToString 成員已經存在` 的 terminating error
  - 原因：共用 runspace 已由系統 `types.ps1xml` 載入 TypeData，再次 `Import-Module Microsoft.PowerShell.Security` 造成衝突
  - 解法：以獨立 `powershell.exe` 子進程（`Get-AuthenticodeSignatureIsolated`）執行 Authenticode 驗證，傳 JSON 回傳結果，完全隔離 TypeData 環境
- **Fleet 進度環 — 步驟比例對齊**：修復進度環百分比與執行流程勾選項目嚴重不符的問題（例：3/7 步驟完成顯示 18%）
  - 提取純邏輯模組 `fleetProgress.js`（無 DOM 依賴，可在 Node.js 單元測試中引用）
  - 進度環改為按步驟平均切分（7 步 × ~14.3%），`latestPercent` 在當前步驟的切片內縮放
  - `STAGE_ALIASES` 對映所有中間 stage（torrent-download/verify、drivers、post-apply-scripts 等），確保環進度單調遞增，不會倒退
  - 新增 4 個單元測試，含完整 torrent 部署序列的單調性驗證

---

## v0.5.20 — 2026-06-16

### 新功能：部署 Profile 語系與時區覆寫

- **Profile 設定**：`locale`（BCP-47）與 `timeZone`（Windows TZ ID）欄位支援在 Profile 層級覆寫 OS 映像預設值
- **WinPE**：`Start-OSDCloud-iPXE.ps1` 從 `selected-profile.json` 讀取 locale/timeZone，合併至 SelectedOs 後寫入 `DeploymentStatus.json`
- **OOBE**：`Invoke-OobeCustomization.ps1` 拆分 UILanguage（鎖定 WIM 語言包）與 InputLocale/SystemLocale/UserLocale（可由 Profile 覆寫）
- **Web UI**：Add profile 與 Edit active profile 對話框新增語系與時區選單

---

## v0.5.19 — 2026-06-16

### 變更

- **Web UI — Guided setup 佈局重新規劃**：大幅壓縮 setup rail 右側 detail 面板的垂直空間佔用
  - **用途／完成條件／安全提醒**：三個獨立卡片框改為單一緊湊 2 欄內嵌表格（標籤 chip ＋ 文字），高度由 ~120px 縮至 ~48px
  - **Detail 項目（READY／MISSING／BLOCKED）**：title／meta／path 三列改為兩列（title 一行 ＋ meta · path 合併一行），使用 flex sub-container
  - **面板 padding／gap**：detail panel padding 18px → 10px；section 間 gap 14px → 8px；item 間 gap 回調至 4px
  - **輸入框**：覆寫 Tailwind forms plugin 全域重置，font-size 16px → 12px、padding 8px 12px → 5px 8px、高度 42px → ~29px
  - **按鈕**：移除步驟動作按鈕的 Tailwind `px-lg py-md` utility（16px／12px），回落統一基礎樣式（26px）；`.btn-primary` padding 9px 18px → 7px 14px；全域 `button` min-height 28px → 24px

---

## v0.5.18 — 2026-06-16

### 變更

- **Web UI**：品牌 logo 更換為 `logo_W_512x512.png`（PNG 圖示取代內嵌 SVG）

---

## v0.5.17 — 2026-06-16

### 新功能：DHCP Proxy 模式（ProxyDHCP）

**問題**：當部署環境的內網已有一台 DHCP 伺服器（如家用路由器或公司 DHCP），啟動 winception 原有的 DHCP 服務會造成雙 DHCP 衝突，Client 無法預測從哪一台取得 IP，PXE 開機資訊也可能遺失。

**解決方案**：新增 `dhcp.dhcpMode` 設定欄位，支援 **`proxy`** 模式（ProxyDHCP）。

#### 運作原理

Proxy 模式下，winception 繼續監聽 UDP 67 埠，但僅回應帶有 `Option 60 = "PXEClient"` 的封包，對一般 DHCP 流量完全靜默。回覆的 OFFER 中 `yiaddr = 0.0.0.0`（不分配 IP），只注入 PXE 開機選項（Option 60、66、67）：

```
Client DISCOVER → 路由器 DHCP：OFFER 含真實 IP
               → winception：  OFFER yiaddr=0.0.0.0，含 Option 66/67
Client 依 PXE Spec 2.1 Collection Phase 等待所有 OFFER 後合併使用
→ 以路由器 IP 上網，以 winception boot file 開機
```

PXE Spec 2.1 Section 2.2.1 Collection Phase 保證 Client 等待所有 OFFER 後才繼續，因此不存在「先拿到 IP 就開機」的 race condition。

#### 設定方式

| 模式 | `dhcp.dhcpMode` | 說明 |
|------|-----------------|------|
| DHCP 伺服器（預設） | `"server"` 或省略 | 完整 DHCP，自行分配 IP（隔離網路） |
| PXE Proxy 中繼 | `"proxy"` | 只注入 PXE 選項，不分配 IP（共用內網） |

proxy 模式下，`leaseStartIp`/`leaseEndIp`/`subnetMask`/`router` 欄位為選填。

#### 使用方式

**Web UI**：Endpoint Settings → DHCP Mode → 選擇 **PXE Proxy (relay)**

**config.json 手動設定**：
```json
{
  "dhcp": {
    "dhcpMode": "proxy"
  }
}
```

#### 注意事項

- Proxy 模式適用現代 UEFI 機器（Hyper-V Gen2、Dell 等）；部分舊款韌體 PXE 實作不完整可能無法識別 ProxyDHCP OFFER。
- 切換模式前，服務會自動停止並重新啟動。

### 其他變更

- **Web UI**：DHCP 服務卡標籤於 proxy 模式顯示「DHCP Proxy」而非「DHCP Server」
- **Web UI**：DHCP Pool 欄位於 proxy 模式顯示「PXE proxy (no IP allocation)」
- **Preflight**：proxy 模式跳過 DHCP subnet 範圍驗證
- **README**：第一次部署步驟 8 新增 DHCP 模式選擇說明

---

## v0.5.16 及之前

請參閱 git log。
