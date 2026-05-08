# Node TUI 重寫計畫

## 摘要

這個計畫把目前的 OSDCloud / iPXE 實體筆電部署流程改成 host 端 Node TUI 操作台。TUI 接管 host 端的 DHCP、TFTP、HTTP media server、status API、log 監看與部署流程控制。v1 不改 WinPE 內已驗證的 OSDCloud、SMB no-redownload、OOBE 注入與 SetupComplete 部署核心。

啟動方式：

```powershell
npm run tui
```

任何會影響真實 LAN 的動作都要在 TUI 內二次確認，尤其是設定實體網卡、啟動 DHCP、啟動 PXE services、清除 status files。

## 實作步驟

1. Git commit 基準點
   - 先執行 `git status --short --branch`。
   - 若目前已有未提交的文件或流程變更，先只提交既有變更。
   - 若工作樹乾淨，建立 baseline commit：`chore: record current OSDCloud lab baseline`。

2. 新增 Node 專案骨架
   - 新增 `package.json`、`package-lock.json`。
   - 加入 scripts：`npm run tui`、`npm test`、`npm run smoke`。
   - 更新 `.gitignore`，忽略 `node_modules/` 與本機 TUI runtime 暫存。

3. 建立 TUI 與設定檔
   - 在 `tools/osdcloud-tui/` 建立 ESM Node app。
   - 使用 `blessed` 建立文字操作介面。
   - 新增 `config/osdcloud-tui.json`，保存 host IP、實體網卡、DHCP range、gateway、DNS、TFTP root、HTTP root、SMB share 與 status path。

4. 重寫 host 端服務
   - Node DHCP responder 保留 iPXE 偵測、lease 分配、UEFI first-stage boot file 與 iPXE HTTP boot URL 行為。
   - Node TFTP responder 保留 root 限制、路徑防穿越、block-size/OACK 行為。
   - Node HTTP media/status server 保留 `/osdcloud/status`、`/osdcloud/status/events` 與 range request 支援。
   - 舊 PowerShell/Node helper 先保留作 fallback，不在 v1 刪除。

5. TUI 畫面
   - Preflight：檢查管理員權限、網卡 IP、必要 boot files、SMB image、port 67/69/80、status 目錄。
   - Services：啟停 DHCP/TFTP/HTTP，顯示 socket 狀態。
   - Deployment：顯示 runId、clientId、stage、percent、elapsed、最新訊息。
   - Logs：即時顯示 DHCP/TFTP/HTTP/status events。
   - Validation：檢查 `boot.ipxe`、`wimboot`、`boot.wim` 有被請求，且 zh-TW ESD 沒有 HTTP `HEAD` / `GET`。

## 測試計畫

- `npm test`：測 DHCP packet parsing、iPXE detection、lease allocation、TFTP path resolution、HTTP range/status API、config validation。
- `npm run smoke`：用暫存 root 與高位測試 port，不碰真實 LAN。
- 實機驗收：用 elevated PowerShell 執行 `npm run tui`，通過 preflight，啟動 services，讓實體筆電 PXE boot，確認 no-redownload、status events、最後進入 `davis` desktop。
- 若改到 `C:\OSDCloud` 內的部署腳本或 WinPE 內容，才執行 `.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts` 同步 repo mirror。

## 假設

- v1 只服務實體筆電 iPXE 路徑；VM timing run 不做主流程。
- WinPE 內部署腳本先不改，降低破壞已驗證 zero-touch 流程的風險。
- 使用 npm，因為目前環境有 npm，沒有 pnpm/yarn。
- 文件需更新 `README.md`、`OSDCloud-Win11-Automated-Deployment-Test-Report.md`、`AGENTS.md`。
