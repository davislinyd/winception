# 技術流程圖 (Technical Flow)

OSDCloud + iPXE 零接觸部署的系統架構與資料流。從部署主機安裝、服務編排，到目標電腦
PXE 開機、套用影像、回報狀態的完整路徑。

```mermaid
flowchart TD
    subgraph HOST["部署主機 Deployment Host (Windows)"]
        SETUP["Setup-DeploymentServer.cmd<br/>安裝 host bundle"]
        BUNDLE["HostTools: App + State"]
        WEB["Web Console (Node.js)<br/>127.0.0.1:8080"]
        CTRL["ServiceController<br/>服務編排 / DI"]
        RT["Runtime root (C:/OSDCloud)<br/>boot.wim / OS WIM 快取 / Apps / Scripts"]
        subgraph SVC["部署服務 Deployment Services"]
            DHCP["DHCP responder<br/>boot mode: secureboot / iPXE"]
            TFTP["TFTP<br/>signed bootmgr / iPXE 開機檔"]
            HTTP["HTTP media + status<br/>WinPE / OS WIM / Apps / Scripts / driver pack"]
            TOR["BitTorrent tracker + seeder<br/>OS image P2P (預設開啟)"]
            SMB["SMB share<br/>pxeinstall 唯讀，套用 Windows ESD/WIM"]
        end
        SETUP --> BUNDLE --> WEB --> CTRL
        CTRL --> SVC
        CTRL --> RT
    end

    subgraph CLIENT["目標電腦 Target Client"]
        PXE["UEFI IPv4 PXE 開機"]
        WINPE["WinPE 啟動<br/>OSDCloud iPXE"]
        APPLY["套用 Windows 11 影像<br/>+ driver pack + 軟體/腳本"]
        OOBE["SetupComplete + OOBE 客製化"]
        READY["windows-desktop-ready"]
        PXE --> WINPE --> APPLY --> OOBE --> READY
    end

    PXE -.->|"1 DHCP / boot mode"| DHCP
    PXE -.->|"2 取得開機檔"| TFTP
    WINPE -.->|"3 boot.wim / OS 影像 HTTP"| HTTP
    WINPE -.->|"3 OS image P2P"| TOR
    APPLY -.->|"4 影像 / 驅動 / 軟體"| HTTP
    APPLY -.->|"4 Windows ESD/WIM via SMB"| SMB
    READY ==>|"5 狀態回報 JSONL /osdcloud/status"| HTTP
    HTTP --> ACT["Web Console<br/>Activity / Client Fleet"]
```

## 說明

| 元件 | 角色 |
| --- | --- |
| `Setup-DeploymentServer.cmd` | 安裝 host management bundle 到 `C:\OSDCloud\HostTools\App` 與 `…\State`，並啟動 Web console。 |
| Web Console (Node.js) | 管理 UI 與 API；唯讀檢視 + 明確授權的變更動作。 |
| `ServiceController` | 編排 DHCP / TFTP / HTTP(media) / Torrent，並管理 runtime 狀態。 |
| Runtime root | Web 選定的部署根目錄（預設 `C:\OSDCloud`），存放 `boot.wim`、OS WIM 快取、Apps、Scripts。 |
| Boot mode | 預設 `secureboot`（微軟簽章 Windows Boot Manager 走 TFTP）；`iPXE` 為替代路徑。 |
| 狀態回報 | client 以 JSONL POST 到 `/osdcloud/status`；生命週期：`run-start → winpe-end → windows-start → windows-apps-finished → windows-setupcomplete-finished → windows-desktop-ready`。 |

> 安全閘門：`Run preflight` 必須全綠、且確認測試 LAN 無其他 DHCP，才可 `Start services`。
