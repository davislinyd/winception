# 操作流程圖 (User Flow)

操作者在 Web Console 上從主機準備到 `windows-desktop-ready` 的完整操作路徑，
含兩道安全閘門：preflight 必須全綠、部署網段 DHCP mode 必須確認正確才啟動服務。

![操作流程圖：Web Console Guided Setup 路徑](user-flow.svg)

## 說明

- **Guided Setup** 會依序顯示每一步的「用途、完成條件、安全提醒」。前 7 步準備環境，第 8 步把關，第 9–10 步才真正啟動部署。
- **第一道閘門（步驟 8）**：`Run preflight` 只要有 blocking failure，就不要啟動 DHCP，也不要讓 client PXE 開機 —— 回頭修正後重跑。
- **第二道閘門（步驟 9 前）**：必須先確認部署網段的 DHCP mode 選擇正確，才按 `Start services` / `Start all services`。
- 目標電腦從 `UEFI IPv4 PXE` 開機，不使用 USB/ISO、不手動點 OOBE；最終狀態應到 `windows-desktop-ready`。
- 詳細的子系統架構與資料流見 [technical-flow.md](technical-flow.md)。
