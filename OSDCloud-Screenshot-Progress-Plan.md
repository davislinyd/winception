# OSDCloud 狀態事件 + 關鍵階段截圖規劃

## 摘要

這份規劃定義下一階段的部署可視化能力：保留現有狀態事件機制，不做影片串流，只在關鍵階段由 client 擷取 still screenshot 並回傳 host server。目標是讓 TUI 能看到即時部署進度、明確的開始/結束記錄，以及 WinPE / Windows 重要階段的畫面證據。

這份文件是實作規劃，不代表截圖機制已完成。真正實作時需要改 host HTTP server、TUI、WinPE reporter、Windows SetupComplete / desktop-ready reporter，並同步 live OSDCloud assets。

## 設計原則

- 只做「狀態事件 + 關鍵階段截圖」，不做 VNC、RDP、ffmpeg、WebRTC 或任何影片串流。
- 完全使用 Microsoft / Windows 內建能力：PowerShell、.NET `System.Drawing` / `System.Windows.Forms`、`Invoke-WebRequest`、Scheduled Task。
- `POST /osdcloud/status` 繼續只處理 JSON 狀態事件，不把圖片 base64 塞進 status payload。
- 截圖是 best-effort 證據，不可阻斷部署主流程。
- 不支援 BIOS / PXE / iPXE 畫面截圖，因為那時 Windows / WinPE 尚未啟動。

## Host 端變更

新增 host endpoint：

```text
POST /osdcloud/screenshot
```

行為需求：

- 只接受 `image/png`。
- 單張截圖限制 5 MB。
- `runId`、`clientId`、`stage`、`source`、`timestamp` 透過 query string 或 header 傳入。
- 所有檔名欄位都必須 sanitize，禁止 path traversal。
- 儲存位置：

```text
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\screenshots\<runId>\
```

metadata 位置：

```text
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest-screenshot.json
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\<runId>.screenshots.jsonl
```

metadata 至少包含：

```json
{
  "receivedAt": "2026-05-09T00:00:00.000Z",
  "runId": "20260509-000000-CLIENT",
  "clientId": "CLIENT",
  "stage": "apply-image",
  "source": "winpe",
  "timestamp": "2026-05-09T08:00:00+08:00",
  "filePath": "C:\\OSDCloud\\Win11-iPXE-Lab\\PXE-HttpRoot\\status\\screenshots\\20260509-000000-CLIENT\\20260509-080000-apply-image.png",
  "bytes": 123456
}
```

`Clear status files` 必須同時清除：

- `latest-screenshot.json`
- `*.screenshots.jsonl`
- `status\screenshots\`

## TUI 變更

Deployment 區塊新增最新截圖摘要：

```text
Latest Shot: apply-image 2026-05-09T08:00:00+08:00
Shot File  : C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\screenshots\...\apply-image.png
```

Validation 或 Logs 區塊顯示最近幾筆 screenshot metadata，讓使用者確認 WinPE / Windows 是否仍在回傳畫面證據。

TUI 不需要在 terminal 內直接渲染 PNG。若要加操作項目，建議新增 `Open latest screenshot`，用 Windows 預設圖片檢視器開啟最新檔案。

## Client 端截圖策略

### WinPE

WinPE reporter 在以下階段嘗試截圖：

- `winpe-start`
- `smb-mounted`
- `osdcloud-start`
- `disk`
- `apply-image`
- `post-apply-scripts`
- `osdcloud-finished`
- `rebooting`
- `image-missing`
- `osdcloud-error`
- `reporter-error`
- `reporter-timeout`

`apply-image` 不每 3 秒截圖，只在百分比跨過 `25`、`50`、`75`、`100` 或 stage 變更時截圖，避免大量 PNG。

### Windows

Windows 階段在以下事件截圖：

- `windows-logon-start`
- `windows-desktop-ready`
- `windows-desktop-timeout`
- `windows-setupcomplete-error`

桌面截圖必須在登入使用者互動 session 內執行，避免 SYSTEM session 0 擷取到黑畫面。既有 desktop-ready reporter 可以繼續由 Scheduled Task 觸發，但截圖動作要確認能看到 `davis` 的互動桌面。

## PowerShell 截圖與上傳要求

截圖優先使用內建 .NET 類別：

- `System.Windows.Forms.Screen`
- `System.Drawing.Bitmap`
- `System.Drawing.Graphics.CopyFromScreen`
- `System.Drawing.Imaging.ImageFormat.Png`

上傳使用：

- `Invoke-WebRequest -Method Post -ContentType 'image/png' -InFile <png>`
- fallback 可使用 `System.Net.WebClient.UploadFile`

上傳 timeout 10 秒。失敗時只記錄 warning 或送出 `screenshot-error` 狀態事件，不重試到阻塞部署。

## 實作步驟

1. 新增 host screenshot API 與 metadata writer。
2. 新增 screenshot metadata reader，讓 TUI 能顯示 latest screenshot。
3. 更新 `Clear status files` 清理 screenshot metadata 與目錄。
4. 在 smoke test 加入 1x1 PNG 上傳驗證。
5. 在 WinPE reporter 加入 `Capture-Screenshot` 與 `Send-Screenshot`。
6. 在 Windows desktop-ready reporter 加入登入後截圖。
7. 更新 live `C:\OSDCloud` 腳本與 iPXE `boot.wim`。
8. 執行同步：

```powershell
.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts
```

9. 更新 `README.md`、`OSDCloud-Win11-Automated-Deployment-Test-Report.md`、`AGENTS.md`。
10. 執行測試並建立功能 commit。

## 測試計畫

- Unit test：合法 PNG 上傳成功。
- Unit test：非 `image/png` 被拒絕。
- Unit test：超過 5 MB 的 request 被拒絕。
- Unit test：惡意 `runId` / `stage` 不會造成 path traversal。
- Unit test：`latest-screenshot.json` 與 `<runId>.screenshots.jsonl` 正確更新。
- Smoke test：用 1x1 PNG 模擬 client 上傳，確認檔案與 metadata 都可讀。
- PowerShell syntax check：檢查 WinPE reporter 與 SetupComplete / desktop-ready reporter。
- 實機測試：physical laptop iPXE 部署時至少收到 `winpe-start`、`apply-image`、`rebooting`、`windows-desktop-ready` 截圖。
- 清理測試：TUI `Clear status files` 後，舊截圖與 metadata 不再出現在 TUI。

## 驗收標準

- TUI Deployment 區塊能顯示目前 status event 與最新 screenshot metadata。
- Host status 目錄能按 run 保存截圖與 JSONL metadata。
- WinPE / Windows 截圖失敗不會讓部署失敗。
- 完成部署後，run summary 仍以 `windows-desktop-ready` 作為完成狀態。
- Git 不提交 PNG 截圖；截圖只作為本機 deployment evidence。

