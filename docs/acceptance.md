# 分層自動驗收 / Layered acceptance

各層分別記錄 Passed、Failed、Blocked、NotRun。Source／VM 通過不能代替實體網路或真人上手；外網、設備或清理未通過，不能算完整驗收。

| 層 | 入口 | 範圍 |
| --- | --- | --- |
| Source | npm run acceptance:source | check → test → smoke；隔離暫存 State |
| UI | npm run acceptance:ui | 專用 Chromium preview、單 worker、零重試、390/1024/1366/1920 px；模擬服務 |
| AutoLab | Invoke-WinceptionLabRegression.ps1 -Mode All -NetworkAcceptance | 七次韌體部署＋Proxy／共享 LAN Server 各一次；Fleet 與 PowerShell Direct 均必要 |
| Physical | Invoke-WinceptionAcceptance.ps1 -Scenario … -ValidateOnly | 預設只檢查；明確 Execute 與可重灌 MAC 才部署 |
| Human | 不熟 PXE 的操作員照精靈完成兩條流程 | 接線、下一步、配對、失敗處理與完成判準，獨立人工記錄 |

## Source 與 UI

在 clone 執行 npm ci；CI 用 npx playwright install chromium 安裝瀏覽器。UI 使用自己的 4173 listener，reuseExistingServer=false，結束先清除本輪建立的暫存 State，再由 Playwright 關閉自身程序。Source 報告含 commit／內容 SHA-256，JSON／HTML／UI trace／screenshots 只存忽略的 test-results/ 和 playwright-report/。

本機若只有 Chrome，可 process-only 設 PLAYWRIGHT_CHANNEL=chrome，須明列 Chrome 證據。Source/UI 不讀 installed State、不做 Endpoint Sync 或實際 DHCP。

## Router／AutoLab（系統管理員）

先驗證並提交 Source、更新 installed App、確認主機閒置及 Lab VM 全關機，再明確 bootstrap：

    .\tools\Initialize-WinceptionLab.ps1 -ValidateOnly
    .\tools\Initialize-WinceptionLabRouter.ps1 -Create
    .\tools\Invoke-WinceptionLabRegression.ps1 -BootstrapRouter
    .\tools\Initialize-WinceptionLab.ps1 -ValidateOnly -RequireRouter
    .\tools\Invoke-WinceptionLabRegression.ps1 -Mode All -NetworkAcceptance

建立時以唯一的 AutoLab 網卡物件設定 LAN，不依賴本地化名稱。若建立中斷且 VM 仍關機、無 checkpoint、唯一 NIC／base disk／ownership 完全吻合，可明確 -Create -ResumeCreate 完成韌體與 clean checkpoint；其他狀態阻擋。

每輪還原 checkpoint 後，依 owned VM GUID 設定固定 MAC，檢查其他 VM 衝突後才發布部署憑證限制。等待 Fleet 時停止 HTTP／TFTP／DHCP 會使本輪失敗並進入 finally 清理，不重試。

master 不自動建立 router，缺少 ready checkpoint 則 Blocked。專用 runner 工作上限 240 分鐘、單次部署 60 分鐘、零自動重試；共享既有 Global\Winception-AutoLab mutex，禁止並行實體／VM 部署。

winception-autolab-router 為 Gen2、固定 4 GiB、Secure Boot／TPM On；LAN 接 Internal Winception-AutoLab、192.168.177.254/24，WAN 只接 Default Switch 作上游。明確 bootstrap 會在 owned VM 關機時設定兩顆 vCPU 與 nested virtualization，將 firmware 暫時改為部署後硬碟後才進入 guest setup，於 guest 啟用 Hyper-V 並受控重開機；若 feature servicing 讓 VM 停在 Off，runner 只啟動這台 owned VM 並保存 restart 證據。`MSFT_NetNat` 存在後才可建立 WinNAT／Ready checkpoint。ownership 綁定 VM GUID、State-owned VHD parent chain、介面、DHCP 工具 hash、Winception-Clean／Winception-Router-Ready。未知 VM、外来 DHCP、錯誤 endpoint、缺 checkpoint 阻擋，不修復 foreign 網路。

首次使用既有映像、test-only profile 部署 router，PowerShell Direct 安裝獨立 DHCP／guest NAT 並建立 ready checkpoint。guest NAT 失敗時，在還原 VM 前保存 WinNat service、`MSFT_NetNat` CIM class、相關 Windows feature、網卡／IPv4 與 System events。獨立 DHCP 不提供 PXE 選項，分配 .100–.149；Proxy 核准限本輪指定 VM 的 MAC、新 boot request 與來源 IP。另測拒絕後無憑證／開始安裝。Server 輪必須停止獨立 DHCP，由 Winception 分配 .200–.250。兩輪 gateway .254、DNS 1.1.1.1/8.8.8.8，停止部署服務後仍須 DNS／有效憑證 HTTPS 成功。

Router 資產在 Lab State，不包含 Release；VM NAT 成功不代表實體 NIC／筆電 NAT 通過。

## 三種實體入口

複製 config/acceptance.example.json 為忽略的 config/acceptance.local.json，記錄部署主機、client MAC／SMBIOS UUID、介面與預期 DHCP／subnet／gateway／DNS。client.name 僅作標籤。確認可重灌後設 disposableConfirmed true；自管 DHCP 需人工確認無其他 DHCP 的測試時段與未過期 testWindowExpiresAt，入口另做 DHCP Offer 探測。

    .\tools\Invoke-WinceptionAcceptance.ps1 -Scenario ExistingDhcp -ValidateOnly
    # 接線與現場設定確認後，系統管理員明確重灌指定 client：
    .\tools\Invoke-WinceptionAcceptance.ps1 -Scenario ExistingDhcp -Execute -ConfirmDisposableClient AA-BB-CC-DD-EE-FF

Scenario：ExistingDhcp、WinceptionDhcp、LaptopNat。預設唯讀產出 JSON/HTML；缺設定或設備為 Blocked。Proxy 確認唯一預期 DHCP；自管位址池排除主機／gateway。LaptopNat 須兩張不同且存在的實體 NIC；既有 Winception NAT 子網／介面須相同。Foreign ICS／NAT 衝突為 Blocked，不自動修復。

沿用 Console-auth API、Endpoint Sync、Preflight、服務控制，不手動修補 runtime。只有指定 MAC 可取得部署憑證。重灌覆寫 client Windows／磁碟，不承諾磁碟還原。

一般 profile 預設不自動登入，登入目標帳號後才完成 Windows finalizer。獨立 TEST ONLY profile 明確 opt-in acceptance.testOnly true、autoLogonCount 1–3；结束或失敗移除測試 script/task/自動登入並還原原 profile。Client 沒有清理回報不能算清理通過。

獨立 collector 的短效 report-only ticket 綁定 MAC、SMBIOS UUID、來源 IP、驗收 run／部署 run／boot；不授予部署或 Console 權限。票據只透過本輪 test-only profile 發布，禁止 Git、Release、一般日誌。Collector 留到停止部署服務後第二次網路及清理回報結束。DNS／HTTPS 預設 www.microsoft.com，HTTPS 單次 30 秒並保留憑證驗證。

## 證據與復原

JSON/HTML 包含各層狀態、source／installed／WinPE hash、client／boot／run、預期與實際網路、部署、兩次探測與清理結果；排除密碼、ticket、token、envelope。開始前沿用 protected State 備份流程，保存 endpoint/profile/services/firmware／本輪資源。

依序停止測試服務、停止 VM、還原 checkpoint／設定並檢查；清理失敗令該層 Failed，保留診斷，禁止下一輪／自動重試。實體 client 保留新 Windows；測完停止服務後 NAT 能力，才清理本輪建立的 Winception 資源，既有資源保持原設定。Git commit 不能還原 State／主機網路。無新 Release／部署包／master push。

## English

Each layer reports Passed/Failed/Blocked/NotRun independently. Source/UI use isolated temporary State and inert services; neither accesses installed State or deployment networking. UI runs owned Chromium preview with one worker/no retries and owned State/process cleanup; identify local Chrome evidence separately.

On master, Source/UI precede installed changes and the locked AutoLab matrix. Router bootstrap is explicit: owned Gen2 4 GiB Secure Boot/TPM VM, Internal LAN .254, Default Switch WAN only. Independent DHCP .100–.149 has no PXE options for Proxy and must stop for Winception Server .200–.250. Both require current Fleet desktop-ready, PowerShell Direct, exact network and certificate-validated DNS/HTTPS before and after service stop.

Physical defaults to validation only. An ignored site manifest, disposable MAC/SMBIOS UUID, confirmed DHCP-free window where required and explicit Execute authorize reinstallation; no disk rollback is promised. LaptopNat requires distinct physical NICs and no foreign ICS/NAT conflict. Normal profiles require target-account sign-in; bounded auto-login is explicitly test-only. Report tickets bind client/source/run/boot and grant no deployment/Console access. Require client cleanup and post-stop Internet, restore original profile/endpoint and remove only owned test resources. Physical/human acceptance remains independent.
