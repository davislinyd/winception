# Code Review 報告

產出日期：2026-05-14
工作目錄：`C:\Users\Davis\Documents\New project`
報告範圍：本報告整理本次 read-only code review 的結果。檢查過程允許驗證，但未修改任何既有 code、docs、config 或 deployment runtime。

## Executive Summary

本次 review 沒有發現會直接阻止測試通過的語法錯誤或已知 npm dependency vulnerability。`npm test`、`npm run smoke`、JavaScript syntax check、PowerShell parser check、`git diff --check` 與 `npm audit` 均通過或無阻斷問題。

主要風險集中在 Web console / service controller 的 operation lifecycle：`Start all services` 在局部失敗時不會回滾已啟動服務，以及 OS image background download 沒有納入 controller 的 operation lock。這兩項都可能讓 operator 在部署控制台執行 mutating action 時遇到不一致或交錯狀態。另有一項 Web UI 測試覆蓋不足，屬於回歸測試風險。

## Findings

### [P2] Start all 失敗時未回滾已啟動服務

- 位置：`tools/osdcloud-console/src/serviceController.js:462`
- 相關邏輯：`startAll()` 依序啟動 HTTP、TFTP、DHCP，但任一後續服務啟動失敗時，前面已啟動的服務不會自動停止。
- 影響：operator 看到批次啟動失敗後，仍可能留下部分 responder 或 process running。對 PXE lab 來說，這會造成服務狀態與 UI 操作結果不一致，也可能讓後續 preflight / service start / endpoint sync 判斷變得混亂。
- 驗證：用 fake services 讓 TFTP 啟動失敗時，HTTP 仍保持 `running: true`。
- 建議修復：在 `startAll()` 的啟動流程加上 try/catch；若任何服務啟動失敗，呼叫 `stopAllServices()` 清理已啟動服務後再 rethrow。補測試覆蓋第二個或第三個服務失敗時會清理前面服務。

### [P2] OS image 背景下載未納入 controller operation lock

- 位置：
  - `tools/osdcloud-console/src/serviceController.js:262`
  - `tools/osdcloud-console/src/serviceController.js:588`
  - `tools/osdcloud-console/web/app.js:1867`
- 相關邏輯：一般 mutating operation 會透過 `runOperation()` 做互斥，但 `startOsDownload()` 只檢查 `osDownloadStatus.running`，沒有佔用 controller operation lock。前端 download action 也直接呼叫 `/api/os-download`，未使用一般 `mutate()` busy gate。
- 影響：OS image download running 時，其他 mutating actions 仍可能同時執行，例如 endpoint sync、profile publish、OS upload/import、service start/stop。這些操作可能與 OS cache、catalog、runtime endpoint 或 service state 寫入交錯，造成狀態不一致或 operator 難以判斷實際完成順序。
- 驗證：用 fake controller 啟動 download running 狀態後，仍可執行其他 controller operation。
- 建議修復：將 OS download/import 納入同一個 operation gate，或在所有會寫 runtime/config/cache/service state 的 mutating action 中明確阻擋 `osDownloadStatus.running` / `osImportStatus.running`。補測試確認 active download 期間 endpoint/profile/OS publish/upload/import/service mutating action 被拒絕或排隊。

### [P3] Web UI 測試主要是 source regex，互動行為覆蓋不足

- 位置：`tools/osdcloud-console/test/webUi.test.js:177`
- 相關邏輯：目前 Web UI 測試大多檢查 HTML/CSS/JS source string、字串存在與順序。新的 interface drawer loading/error/backdrop 行為也主要靠 source-shape assertion。
- 影響：測試能抓到文字或結構被移除，但無法確認實際 DOM 行為，例如 drawer 是否先打開、`/api/interfaces` 是否非同步載入、loading/error row 是否真的渲染、backdrop click 是否正確 cancel、dialog 內點擊是否不會穿透關閉。
- 驗證：review 現有測試型態後，未看到真正執行 DOM 行為的測試 harness。
- 建議修復：新增輕量 DOM 或 browser smoke 測試。至少覆蓋 interface drawer 先開再載入、API failure 顯示 inline error、backdrop cancel 關閉 confirm dialog、dialog 內 click 不關閉。

## Verification Results

| 檢查項目 | 結果 | 備註 |
| --- | --- | --- |
| JavaScript / MJS syntax check | Pass | `node --check` 全部 `.js` / `.mjs` 通過 |
| PowerShell parser check | Pass | 全部 `.ps1` parser check 通過 |
| Unit / integration tests | Pass | `npm test` 通過，108/108 tests passed |
| Smoke test | Pass | `npm run smoke` 通過，使用 temp root |
| Whitespace check | Pass with warnings | `git diff --check` 無 whitespace error，只有 CRLF warning |
| npm audit | Pass | `npm audit --omit=dev --audit-level=moderate` 回報 0 vulnerabilities |
| PSScriptAnalyzer | Not run | `Invoke-ScriptAnalyzer` 未安裝 |
| Targeted reproduction | Confirmed | 已用非破壞性 fake services / fake controller 驗證前兩項 findings |

## Scope And Repository State

- 本次 review 涵蓋 Node backend、Web frontend、Web tests、PowerShell deployment scripts、config/profile/manifest diffs 與 docs alignment。
- 沒有啟動 live Web console、沒有執行 live preflight、沒有修改 `C:\OSDCloud` deployment runtime。
- review 完成時 repo 原本已有 9 個 modified files；本報告產出前沒有改動那些既有檔案。
- 這份報告檔本身是後續依要求新增的輸出 artifact。

## Additional Observations

- 目前 repo snapshot / live config 仍顯示 endpoint 為 `Ethernet` / `192.168.100.1`。依 AGENTS 規則，這不是單獨 code defect；但在下一次 physical-laptop validation 前，必須透過 Web console 或 endpoint sync 明確切回目標 physical LAN endpoint 並重新驗證。
- `config/osdcloud-console.json` 與 `osdcloud-assets/manifest.json` 有大量格式、timestamp 或 manifest churn。若不是刻意保存 runtime snapshot，建議後續提交時與功能變更分開處理，降低 review 雜訊。
- repo 內 lab credentials 與 `pxeinstall` / `davis` 設定符合目前私有 lab 文件假設；本次不列為意外漏洞，但仍應維持 repo private 與部署網段限制。

## Recommended Next Steps

1. 先修 `startAll()` 失敗回滾，因為它直接影響 service lifecycle 與 operator 信任。
2. 再統一 OS download/import 與其他 mutating action 的 operation lock policy。
3. 補 Web UI interaction smoke 測試，讓後續 layout / drawer / dialog 行為改動有更可靠的回歸保護。
