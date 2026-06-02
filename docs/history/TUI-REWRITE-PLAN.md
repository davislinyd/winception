# Node TUI 重寫計畫

> Current status as of 2026-05-14: this is a historical implementation plan. The primary and only interactive operator console is now the Web/GUI console started with `npm run web`; the old blessed Node TUI CLI was retired in version `0.3.0`. Fresh-host setup and active deployment instructions live in `README.md` under `新主機 Clone 後啟動流程` and `使用手冊`.

## 目前狀態

TUI 後續曾演進到 `0.2.x`，後來由 Web/GUI console 取代。實體筆電 iPXE path 的互動入口是 Web/GUI console；`serviceController.js` 保留為 Web 服務控制層，負責 DHCP/TFTP/HTTP/status/preflight/endpoint sync/profile publish。除原本 DHCP/TFTP/HTTP/status/live log/validation 外，現在也包含 `/osdcloud/screenshot` PNG endpoint、screenshot metadata 顯示、status cleanup 的 screenshot 清理、fleet/run lifecycle summary、deployment profile publish、OS image cache 互動與 endpoint sync progress。

Windows completion 仍以 JSON status 為準。`OSDCloudDesktopReadyReport` 在登入後每 5 秒重試，最多 30 分鐘；成功 POST `windows-desktop-ready` 後必須 unregister 自己。Windows desktop screenshot Startup helper 目前不啟用，因為先前的 hidden PowerShell + screenshot + upload 行為被 Defender/AMSI 擋成 `ScriptContainedMaliciousContent`，會讓 SetupComplete 完全不執行。

## 摘要

這個計畫當時的目標是把 OSDCloud / iPXE 實體筆電部署流程改成 host 端 Node TUI 操作台。此目標已完成並被後續 Web/GUI console 取代；現在日常部署應使用 Web console，TUI 入口與 blessed UI 程式碼已移除。WinPE 內已驗證的 OSDCloud、SMB no-redownload、OOBE 注入與 SetupComplete 部署核心仍不應為 UI 工作任意重寫。

目前主要啟動方式：

```powershell
npm run web
```

TUI 沒有備援啟動方式；不要再嘗試執行 retired TUI。任何會影響真實 LAN 的動作都要在 Web console 內二次確認，尤其是選 service interface、啟動 DHCP、啟動 PXE services、切換 deployment profile、清除 status files。新 host clone 後必須先依 README 還原 `C:\OSDCloud` 大型 runtime artifacts、啟動 Web console、`Select service interface`、通過 preflight。

## 實作步驟

1. Git commit 基準點
   - 先執行 `git status --short --branch`。
   - 若目前已有未提交的文件或流程變更，先只提交既有變更。
   - 若工作樹乾淨，建立 baseline commit：`chore: record current OSDCloud lab baseline`。

2. 新增 Node 專案骨架
   - 新增 `package.json`、`package-lock.json`。
   - 當時加入 scripts：TUI 啟動、`npm test`、`npm run smoke`；目前僅保留 Web / test / smoke scripts。
   - 更新 `.gitignore`，忽略 `node_modules/` 與本機 TUI runtime 暫存。

3. 建立 TUI 與設定檔
   - 在 `tools/osdcloud-tui/` 建立 ESM Node app。
   - 當時使用 terminal UI library 建立文字操作介面；目前該介面已退役。
   - 新增 `config/osdcloud-tui.json`，保存 host IP、實體網卡、DHCP range、gateway、DNS、TFTP root、HTTP root、SMB share 與 status path。

4. 重寫 host 端服務
   - Node DHCP responder 保留 iPXE 偵測、lease 分配、UEFI first-stage boot file 與 iPXE HTTP boot URL 行為。
   - Node TFTP responder 保留 root 限制、路徑防穿越、block-size/OACK 行為。
   - Node HTTP media/status server 保留 `/osdcloud/status`、`/osdcloud/status/events` 與 range request 支援。
   - 舊 PowerShell/Node helper 先保留作 fallback，不在 v1 刪除。

5. TUI 畫面
   - Preflight：檢查管理員權限、服務綁定 IP 是否存在於任一張啟用中的 IPv4 介面、必要 boot files、SMB image、port 67/69/80、status 目錄。
   - Services：啟停 DHCP/TFTP/HTTP，顯示 socket 狀態。
   - Deployment：顯示 runId、clientId、stage、percent、elapsed、最新訊息。
   - Logs：即時顯示 DHCP/TFTP/HTTP/status events。
   - Validation：檢查 `boot.ipxe`、`wimboot`、`boot.wim` 有被請求，且 zh-TW ESD 沒有 HTTP `HEAD` / `GET`。

## 測試計畫

- `npm test`：測 DHCP packet parsing、iPXE detection、lease allocation、TFTP path resolution、HTTP range/status API、config validation。
- `npm run smoke`：用暫存 root 與高位測試 port，不碰真實 LAN。
- 歷史實機驗收：當時用 elevated PowerShell 執行 TUI，通過 preflight，啟動 services，讓實體筆電 PXE boot，確認 no-redownload、status events、最後進入 `davis` desktop。現在同等驗收應從 Web console 執行。
- 若改到 `C:\OSDCloud` 內的部署腳本或 WinPE 內容，才執行 `.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts` 同步 repo mirror。

## 假設

- v1 只服務實體筆電 iPXE 路徑；VM timing run 不做主流程。
- WinPE 內部署腳本先不改，降低破壞已驗證 zero-touch 流程的風險。
- 使用 npm，因為目前環境有 npm，沒有 pnpm/yarn。
- 文件需更新 `README.md`、`AGENTS.md`。
