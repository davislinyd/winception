# 用戶流程圖 (User Flow)

操作者（operator）在 Web console 上從零到 `windows-desktop-ready` 的完整操作路徑，
含兩道安全閘門：preflight 必須全綠、確認 LAN 無其他 DHCP 才啟動服務。

```mermaid
flowchart TD
    A["執行 Setup-DeploymentServer.cmd"] --> B["開啟 Web Console<br/>127.0.0.1:8080"]
    B --> C["引導設定 Guided Setup"]
    C --> S1["1 Project root"]
    S1 --> S2["2 Web service IP"]
    S2 --> S3["3 Deployment secrets"]
    S3 --> S4["4 Prepare runtime"]
    S4 --> S5["5 PXE / service endpoint"]
    S5 --> S6["6 OS Image Cache"]
    S6 --> S7["7 Publish profile"]
    S7 --> S8["8 Run preflight"]
    S8 --> D{"Preflight 全部通過?"}
    D -- "否 / blocking" --> FIX["修正問題<br/>不要啟動 DHCP / 不要 PXE 開機"]
    FIX --> S8
    D -- "是" --> G{"確認 LAN 無其他 DHCP server?"}
    G -- "否" --> WAIT["先關閉外部 DHCP"]
    WAIT --> G
    G -- "是" --> S9["9 Start services<br/>HTTP / TFTP / DHCP"]
    S9 --> S10["10 目標電腦 UEFI IPv4 PXE 開機"]
    S10 --> MON["回 Dashboard 監看<br/>Client Fleet / Validation Evidence / System Log"]
    MON --> READY["windows-desktop-ready ✓"]
```

## 說明

- **Guided Setup** 會依序顯示每一步的「用途、完成條件、安全提醒」。前 7 步準備環境，第 8 步把關，第 9–10 步才真正啟動部署。
- **第一道閘門（步驟 8）**：`Run preflight` 只要有 blocking failure，就不要啟動 DHCP，也不要讓 client PXE 開機 —— 回頭修正後重跑。
- **第二道閘門（步驟 9 前）**：必須先確認測試 LAN 沒有其他 DHCP server，才按 `Start services` / `Start all services`。
- 目標電腦從 `UEFI IPv4 PXE` 開機，不使用 USB/ISO、不手動點 OOBE；最終狀態應到 `windows-desktop-ready`。
- 詳細的子系統架構與資料流見 [technical-flow.md](technical-flow.md)。
