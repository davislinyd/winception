# Changelog

## Unreleased

### v2 productization rewrite

- Removed unmanaged target-host prerequisites from `Prepare runtime`. The installed product now uses its bundled Node 24 executable, does not require npm on the deployment host, and ships hash-pinned OSD 26.4.23.1 plus OSDCloud 26.4.17.1 modules with their GPL notices and SBOM entries. Registered the IPv4 contract format inside Agent IPC, prepended the packaged module root to every Agent child process, reconciles missing download metadata for bundled software after v1 migration without replacing user-defined values, and creates interface/subnet-scoped inbound rules for DHCP, TFTP, HTTP and torrent data-plane traffic. The DHCP receiver binds to `0.0.0.0` so Windows can receive initial broadcasts; a second socket bound to the selected PXE IP sends one limited-broadcast reply, preventing a multi-NIC host from using its management adapter while remaining compatible with pre-address UEFI clients. Server-mode replies identify the co-located PXE service with DHCP Option 60 and omit ProxyPXE menu Option 43. Starting deployment ingress now requires a completed preflight with zero blocking failures. The v2 OS image response contract includes runtime cache annotations, preventing installed cached images from failing response validation. Full uninstall removes product-owned firewall rules, while major upgrades preserve them. Alpha 5 uses monotonically higher MSI `ProductVersion 2.0.15`, so Windows Installer performs a real major upgrade from all earlier test packages. The replacement test candidate is `v2.0.0-alpha.5`.
- Fixed the fresh-install WiX custom-action path for `ProvisionServiceSettings`: the directory-valued `APPFOLDER` property now uses a dot path segment so its trailing separator cannot escape the quoted `-AppRoot` argument. Loopback provisioning and the MSI health probe now guard optional TLS settings before reading them under PowerShell `StrictMode`. Added packaging regression gates. The immutable replacement test release is `v2.0.0-alpha.4`.
- Fixed fresh-Windows self-signed trust when the machine-level `TrustedPublisher` registry store key does not yet exist. Trust is now resumable after a partial Root import, both exact-thumbprint stores are verified, and failure reports identify the stage. The immutable replacement test release is `v2.0.0-alpha.3`.
- Fixed clean-host bootstrap validation for the expected self-signed signer: exact-hash payloads with only an untrusted root may proceed to explicit trust, while signer mismatch, invalid chains and `HashMismatch` remain blocking. The immutable replacement test release is `v2.0.0-alpha.2`.

- Preserved the clean v1 source at annotated tag `v0.6.7` and branch `release/v1`; v2 development is isolated on `codex/v2-rewrite` without including the existing `tools/Restart-HyperVms.ps1` worktree change.
- Added Node 24 TypeScript/Fastify/React applications with versioned JSON Schema/OpenAPI contracts, zero-cycle dependency enforcement, feature boundaries, and a low-privilege Web/high-privilege allow-list Agent split over an authenticated named pipe.
- Added resource-aware operation coordination, Software Test ingress/Fleet rechecks under lock, operation crash recovery, standardized safe API errors, SSE snapshot recovery, atomic file writes, SQLite migrations, DPAPI secrets, controlled upload staging, retention/quota primitives, and a dry-run/idempotent v1 importer.
- Made SQLite authoritative for product configuration/catalogs and evidence metadata, with generated legacy projections; deployment secrets remain DPAPI ciphertext and are materialized only inside the coordinated privileged action.
- Completed domain-specific v2 request/response/IPC contracts and generated clients plus management UI workflows for runtime, services, network, profiles, OS cache/catalog, software/scripts, diagnostics, evidence and live Deploy/Monitor state.
- Added dual Windows service WiX sources, fixed-runtime package staging, hash manifest, service provisioning ACLs, code-signing helper, transaction-style upgrade/health-probe/DB rollback, and fail-closed HTTPS LAN provisioning.
- Added fail-closed service-SID pipe DACL readback, safe setup-code retrieval, transaction-style LAN endpoint reconfiguration, and self-signed Authenticode/TLS certificates with exported trust certificates until public certificates are supplied.
- Replaced invalid direct `node.exe` service registration with pinned, hash-verified WinSW 2.12 wrappers; limited LocalService write access to staging and Web logs instead of the complete State tree.
- Added Windows CI gates for legacy/v2 tests, aria2 integration, coverage, dependency cycles, OpenAPI drift, PowerShell parsing, audit, secret scan, SBOM, Playwright accessibility/recovery workflows, and MSI fresh-install/repair/uninstall smoke.
- Added reproducible local Gitleaks 8.30.1 history/working-tree scanning with pinned checksum, embedded CycloneDX SBOM, bundled Node/WinSW licenses, and critical coverage enforcement for contracts, coordination, persistence, migration and IPC.
- Licensed Winception under `AGPL-3.0-only`, embedded the complete license in source/MSI/SBOM, and exposed license, no-warranty and source-code notices before and after Web authentication.
- Fixed v1 operation-lock gaps for OS download/re-export and torrent settings, required Software Test deployment ingress to be stopped, bounded log tail reads, and corrected documentation to treat warnings as non-blocking.
- Reduced always-on agent documentation, standardized `.ai/status.json` to four local handoff fields, established one official manual, and separated historical evidence from per-version release readiness.
- Added the safe `Install-Winception.ps1` bootstrap with read-only checks, release-manifest/hash/signer validation, explicit self-signed trust, `/norestart` lifecycle actions, redacted JSON reports and installed service/ACL/pipe/SQLite/health verification.
- Added bilingual Docusaurus 3.10.2 documentation with a schema-validated localStorage installation planner, JSON import/export, local search, controllable canonical flow animations, reduced-motion/accessibility coverage, GitHub Pages output and an unauthenticated offline `/manual/` protected by generated CSP hashes.
- Added a manual Pages workflow that accepts only an exact commit SHA and builds documentation without running remote product CI; prerelease and Pages publication remain gated on elevated fresh-VM, single-client PXE and Software Test acceptance.

## v0.6.7 — 2026-07-13

- Software Test VM now keeps `Stop test` reachable from the global Console dock as well as Deployment Profiles. During its active run, Profile, OS Image, and Endpoint are inspection-only; all mutation and deployment controls remain locked.
- Software Test VM now offers `Stop test` for the current in-memory test run. It writes a controlled cancellation request, stops the SYSTEM installer task when reachable, forces off the dedicated VM, restores its clean checkpoint, and records safe `aborted / succeeded` status without changing live Apps, profiles, services, or PXE.
- A Software Test VM run that remains at `payload-ready` for over one minute is now treated as an unstarted runner after successful powered-off VM/checkpoint re-verification, rather than permanently blocking profile tests.
- Software Test VM cleanup failures now identify a safe checkpoint/VM/restore cause and recovery action, retain the raw runner diagnostic only in local HostTools State, and remain locked until the rebuilt or restored checkpoint is successfully re-registered. Deployment Profiles adds `Copy test report`, which copies only the safe test summary.
- Web Console operation failures now use a shared English error dialog instead of browser alerts. API errors retain the compatible `error` text and add safe `errorCode` / `errorAction` fields; unexpected backend failures no longer expose raw PowerShell output. Software Test VM registration now reports actionable VM, Generation 2, powered-off, and checkpoint validation results in-place.
- Legacy Deployment Profiles that were created before international settings existed now inherit only missing language, locale, input-language, and time-zone values from the current active profile when both use the same OS image. The values are persisted before publishing; profiles without that safe source remain blocked instead of guessing a time zone.

## v0.6.6 — 2026-07-12

- Software Catalog now distinguishes `Guided installer` from `Custom PowerShell` while preserving the existing persisted modes. Guided installer explains and records installer success codes; Custom PowerShell is syntax-checked with the Windows PowerShell 5.1 parser before it can write a package.
- Add software is now a Traditional-Chinese three-step wizard. It separates package payload, Guided installer/Custom PowerShell behavior, dependencies, client-network conditions, and review; hidden mode fields cannot be focused or submitted. Catalog creation ends with explicit add-another/profile guidance without selecting or publishing Apps.
- Required Add software fields now have red `*` markers. The Custom PowerShell view provides payload-specific MSI/EXE reference templates with execution guidance, explains why its syntax preflight matches the client Windows PowerShell 5.1 runtime, and retains an already selected payload if a later file-picker attempt is cancelled. Guided installer now explicitly distinguishes MSI's `0,1641,3010` default from EXE's vendor-safe `0` default.
- Catalog software supports validated prerequisite dependencies and optional post-logon client-Internet probes. Profile saves reject missing/cyclic prerequisites and stably reorder software without moving custom-script slots; default host-prefetched payload publishing remains offline-first.
- Post-logon installation now exposes waiting-network and reboot-pending progress. A Guided installer `1641` creates an explicit checkpoint, stops later steps, and resumes from the next step after reboot; `3010` remains successful and reports a restart recommendation. Unrelated interrupted runs remain fail-closed.
- Profiles now support a dedicated `Software Test VM`: it materializes an isolated State payload, restores a manually prepared clean Hyper-V checkpoint, runs the production `Install-Apps.ps1` as SYSTEM through PowerShell Direct, handles reboot-pending continuation, collects safe summaries, and restores the checkpoint again without publishing or changing live Apps. Cleanup failure blocks another run; raw logs remain host-local.
- The optional Software Test VM section is collapsed by default in Deployment Profiles and can be expanded only when its setup, status, or results are needed.

## v0.6.5-3 — 2026-07-11

- Client post-logon finalization now runs as a SYSTEM startup task that waits for the configured user's interactive Explorer session before serial app/script installation. The first-logon viewer shows safe waiting/finalizer phases and elapsed time before the first installer starts; `windows-apps-finished` adds only completed step name/type/status/duration for host Evidence.
- Validation Evidence now uses host-observed `Asia/Taipei (UTC+8)` timestamps. Completed/failed runs are immutable snapshots; late events are retained in an audit stream without changing Evidence, summary, latest pointers, status, or completion time.
- Web state refresh is single-flight and evidence-on-demand. Fleet uses its written index snapshot, runtime readiness is short-term cached with mutation invalidation, and state health reports snapshot duration/event-loop lag so slow host observation is visible separately from deployment status.

## v0.6.5-2 — 2026-07-11

- WinPE 進入 torrent seed wait 前停止 hidden progress reporter，避免舊的 `apply-image` 回報覆蓋等待狀態；client console 會顯示持續可見的 seed-wait banner、`E` 延長／Enter reboot 提示與專用 screenshot
- torrent client 以 aria2 `completedLength` 監控實際進度；180 秒無進度時回落 SMB-direct apply，避免最後一台在 peer 離開後卡到 30 分鐘總 timeout
- Tracker 的 Seed wait 摘要現在拆分 Base、Client 本機 `E` 累積延長、Web 累積延長、總 wait、剩餘時間與 deadline；Web 延長提交後立即反映，不等待下一輪 client telemetry

## v0.6.5-1 — 2026-07-11

### 修正：WinPE HTTP 相容性與 Torrent 啟動

- Windows PowerShell WinPE 對 host 的 health、boot-config、status、screenshot、torrent telemetry、control 與 `.torrent` 請求改用 `-DisableKeepAlive`；不再設定會立即拋出例外的 `Connection: close` header
- boot-config 可正常載入 `torrentEnabled`、torrent URL 與 SHA-256，新的 client 不再因 HTTP fallback 而改走 SMB-direct apply
- Tracker 分鐘輸入框在輪詢重繪時保留 focused text selection，避免 operator 框選內容後立即消失

## v0.6.5 — 2026-07-10

### 新功能：Client Internet topology 與雙 NIC NAT

- 新增 `shared-lan`（預設）與 `dual-nic-nat` topology；shared LAN 保持既有 DHCP Server / PXE Proxy 行為
- 新增明確確認的 Hyper-V `Winception-PXE` external switch 與 `WinceptionNAT` lifecycle，WAN NIC 設定與全域 firewall 不會被修改
- 新增 NAT readiness/preflight、API、Endpoint drawer 控制與安全衝突防護；雙 NIC mode 固定 DHCP Server，停止 deployment services 不會停掉 client Internet NAT
- Endpoint drawer 加入單 NIC Hyper-V 與 dual NIC NAT NIC 角色的 hover 說明，避免將 vSwitch 誤選為 PXE physical NIC
- WinPE server 偵測改用無敏感資料的 `/osdcloud/health`；優先 probe Endpoint Sync 寫入的 service IP，不再因尚無 status 或 HEAD method 而產生假性 DHCP retry
- HTTP media server keep-alive 提升為 30 秒；WinPE status、screenshot、torrent telemetry、control 與 SetupComplete 回報改用明確關閉連線，避免 5 秒 telemetry 週期重用已逾期 socket
- Torrent seed wait 預設改為 15 分鐘；Tracker card 可設定後續 WinPE client 的預設值、顯示每台 waiting client deadline，並可逐台延長（總 wait 上限 1440 分鐘）；WinPE console 支援 `E` 本機延長與到期後 60 秒決策寬限

## v0.6.4 — 2026-07-10

### 修正：Embedded config panel 收合與開啟狀態

- Deploy view 的 `Profile`、`OS Image`、`Endpoint` embedded panel 現在可直接點標題收合，不必只依賴 `Close`
- 打開中的 embedded panel 改為較粗外框，並同步強化對應 summary segment 的 open state

### 新功能：Deploy 主畫面 Offline ISO 匯出

- Deploy 主畫面新增 `Offline ISO` 卡片，直接呼叫 host-side `New-WinceptionUsbInstaller.ps1 -Iso` 建立 immutable active snapshot ISO
- Web API 新增 `POST /api/offline-iso/create`，沿用現有 operation log 與背景 job 模式，不提供瀏覽器下載
- 成功後畫面會顯示主機 `Output folder` 與完整 `ISO file` 路徑，方便 operator 從主機直接取用敏感媒體

## v0.6.3-6 — 2026-07-10

### 修正：OS download catalog 載入時間

- `Load download catalog` 先在 PowerShell 端套用 OS family / language / release / activation / edition 篩選，並在同 edition 的重複 index rows 間先收斂，避免先展開大量 OSD rows 再回傳超大 JSON
- 在實機量測下，`Windows 11 Pro Retail zh-tw 25H2` 的 catalog 載入從約 28 秒降到約 3 秒

### 修正：Guided Setup console attention

- Guided Setup 長操作提示從 header 改為整個 console section outline/aura 閃爍，避免只讓標題列發亮
## v0.6.3-5 — 2026-07-09

### 修正：Service cards desktop layout

- Deploy view 的 HTTP / TFTP / DHCP 服務卡片在桌面寬度改為三欄同列顯示，降低空白浪費

## v0.6.3-4 — 2026-07-09

### 修正：Deploy hover info 可停留

- Deploy summary 的 Profile / OS Image tooltip 現在可用滑鼠移入閱讀，離開 segment 與 tooltip 卡片後才消失

## v0.6.3-3 — 2026-07-09

### 修正：Guided Setup Console 提示

- Profile hover tooltip now includes selected custom scripts in a separate section next to selected software
- HTTP / DHCP service cards now use explicit local SVG service icons instead of the fallback square marker, avoiding checkbox-like visual ambiguity
- Guided Setup 觸發 long operation 時不再自動展開 bottom Console dock
- Console 提示改為帶光暈的整條黑色標題列閃爍三秒，保留 reduced-motion fallback
- 頂部主工作區收斂為 `Deploy` / `Monitor`；Guided Setup 改由 Deploy 右側 rail 的 chevron/strip 展開收合，不再保留重複的 `Prepare` nav 按鈕
- 移除 Deploy summary 內重複的 `Run preflight` 按鈕，preflight 入口保留在 Guided Setup
- 移除 Deploy summary 右側整個 preflight 狀態格，不再顯示 `Preflight not run`

## v0.6.3 — 2026-07-09

### 新功能：Web Console 離線 UI、API token gate、local torrent tracker

- Web Console 移除 Google Fonts、Material Symbols 與 Tailwind CDN runtime 依賴，改用本機 CSS utility layer、system font fallback 與 repo-local SVG icon helper
- 頂部工作區改為 `Prepare` / `Deploy` / `Monitor`；`Prepare` 展開 guided setup rail，`Deploy` 保留 runtime/preflight/services/diagnostics 操作面，`Monitor` 聚焦 Activity fleet/evidence
- Web management API 新增 `/api/auth/status`；loopback 預設免 token，非 loopback host 的 `/api/*` 需 `X-Winception-Token`，token 存在 HostTools State `config\web-console-token.json` 且不進 API response
- `bittorrent-tracker` dependency 已移除，改為 repo-local minimal HTTP tracker，支援 aria2/host seeder 需要的 announce、compact peers 與 stale peer eviction；`npm audit --omit=dev` 已無 production vulnerabilities
- 新增 `npm run check`，串接前端 ES module syntax、外部 runtime asset scan、CSS/design invariant scan 與 dependency surface scan
- diagnostics 前端 render 拆成 feature module，並保留 `/api/diagnostics/latest|run|download` 既有行為

### 修正：Deploy summary 可讀性

- `Profile` 與 `OS Image` summary 改為短摘要，完整 profile、software、OS image 與 cache file 資訊改由本機 hover/focus tooltip 呈現
- `Deploy` tab 會明確收起 Prepare rail，並保留 `Profile`、`OS Image`、`Endpoint` 的原本點擊入口

### 修正：client deployment 階段不再依賴外部 Internet

- PXE WinPE `Startnet.cmd` 不再呼叫上游 `Initialize-OSDCloudStartnet`，避免部署啟動前先碰 PowerShell Gallery 或自動更新 OSD module
- PXE `Start-OSDCloud-iPXE.ps1` 明確關閉 OSDCloud 的 Microsoft Update Catalog、Windows Update、Windows Update driver 與 driver pack download 分支，並維持 OS WIM 只從 Winception server SMB/Torrent 取得
- WinPE deployment server detection 加入 DHCP renew + retry，只探測 Winception server 候選端點，不需要外部 Internet
- 文件補清楚 client 網路邊界：deployment 階段只依賴 Winception server；外部 Internet 只允許 post-logon software/custom script sequence 使用

## v0.6.2 — 2026-07-06

### 修正：Web Console tray 重複 icon 與 stale instance

- `Start-WebConsoleTray.ps1` 改為每個 installed `AppRoot` 使用 named mutex，避免同一套 HostTools 啟動第二個 tray instance
- tray 會寫入 `C:\OSDCloud\HostTools\State\run\web-console-tray.json`，記錄目前 tray/node PID，並透過 `web-console-tray.stop.json` 接受 graceful shutdown request
- `Start-InstalledWebConsole.ps1` 改為先檢查 `/api/state` 健康度與 tray state；若 server healthy 但沒有 tray state，會視為 orphan server，先清掉再重建 tray wrapper
- `Reload-Console.ps1` 改為先請 tray 自行 dispose `NotifyIcon`，只有 graceful stop 失敗時才 fallback 停止 recorded PID / 8080 port owner，降低 Explorer 留下舊 tray icon 的機率
- 新增 regression assertions，涵蓋 single-instance mutex、tray state、stop request、reload fallback 與 orphan server recovery；live 驗證確認連續開啟 launcher 不會多開 instance，連續 reload 只保留單一 8080 listener

## v0.6.1 — 2026-06-24

### 新功能：USB/ISO 離線 zero-touch installer

- 新增 `New-WinceptionUsbInstaller.cmd`，支援 destructive-confirmed GPT USB、no-prompt UDF ISO、唯讀 `-CheckOnly` 與選用 Rufus UI preload
- 從 merged live config 建立 immutable active snapshot，只納入 selected WIM、active profile Apps/Scripts、目前存在的 driver packs、最小必要 driver metadata 與本機 deployment secrets；排除 driver run/client/download history，且不修改既有 PXE services、endpoint 或 live `Media\sources\boot.wim`
- USB WinPE 會跨 FAT32 boot 與 NTFS data volumes 驗證所有 manifest size/SHA-256，只允許單一 internal target disk，套用相符的離線 driver pack，並以 media marker 防止同一 media 重複清除
- `deploymentMode: usb-offline` 將最後 stage 原子寫入 `DeploymentStatus.json.localStatus`；既有 PXE HTTP telemetry 在未設定該模式時維持原行為
- 修正 USB/ISO WinPE Startnet 不再呼叫 PXE/OSDCloud network bootstrap，離線媒體開機後不再等待 DHCP lease，直接進入 USB offline installer
- 修正沒有相符離線 driver pack 時，USB WinPE 在 OSDCloud 完成後因 `$null` `DriverPack` 參數繫結錯誤而停止
- 新增正式驗收證據：重建後的 ISO 已以 Hyper-V Gen2、Secure Boot ON、無 NIC 路徑部署到 `windows-desktop-ready`

### 修正：USB/ISO exporter 的 EFI 簽章檢查在部分 PowerShell session 失敗

- `New-WinceptionUsbInstaller.ps1` 不再直接在目前 runspace 呼叫 `Get-AuthenticodeSignature`
- 改為使用 Windows PowerShell child process，並從 child `$PSHOME\Modules\Microsoft.PowerShell.Security` 明確載入模組後再驗證 `bootx64.efi`
- 避免目前 session 的 module/type state 或 inherited `PSModulePath` 讓 `-Iso` / `-Usb` 前置檢查在 EFI 簽章驗證階段提前中止

### 新功能：Web Console 手冊入口

- 頂部列新增全域 `Manual` utility link；寬螢幕顯示文字與書本圖示，窄螢幕保留具 tooltip / ARIA label 的圖示，並在新分頁開啟手冊而不改變 Deploy / Activity 狀態
- Web management server 只讀發布 `/manual/` 與 `/manual/manual-assets/*`；fresh-host bundle 與 reload 只複製手冊及七個外部資產，不公開整個 `docs` 目錄
- 手冊中／英文切換會保留目前閱讀章節及 viewport 位置，並同步對應語言的章節 hash，不再跳回頁首

## v0.6.0 — 2026-06-22

### 文件：單頁 Winception 部署操作手冊

- 新增 `docs/winception-operations-manual.html`，整合技術架構、Secure Boot / iPXE、DHCP Server / PXE Proxy、Guided Setup 點選流程、client deployment、Torrent P2P、監控、完成判定、證據分層、故障排除與 Hyper-V regression
- 新增可縮放的中／英文 SVG 架構與 operator 流程圖，以及外部連結的 live Web Console PNG；HTML 不內嵌 base64，並支援右上角完整語言切換、雙語導覽／搜尋／lightbox、responsive、print 與 reduced-motion
- `.gitignore` 只例外允許 `docs/manual-assets/*.png` 的 curated 手冊截圖；一般 troubleshooting screenshots 仍維持忽略

### 修正：四台 Hyper-V 並行部署時 WinPE 記憶體不足

- `Restart-HyperVms.ps1` 在每次 PXE 測試前強制至少 4 GB fixed memory，避免 Dynamic Memory 將 WinPE 壓縮至 1–2 GB 後於 OSD module 載入或 DISM `Expand-WindowsImage` 發生 `System.OutOfMemoryException`
- restart helper 仍保留 Generation 2、network first boot、四台逐一重啟與 `PassThru` 行為，並回報實際配置的 memory bytes

### 修正：Hyper-V 時間同步造成 desktop-ready 誤判 timeout

- app installer heartbeat、step duration、viewer elapsed 與 desktop-ready 30 分鐘 timeout 改用 monotonic `Stopwatch`，避免 host/guest wall clock 校正向前跳後將正常 app sequence 誤報為 `windows-desktop-timeout`
- desktop-ready scheduled task 改為 `MultipleInstances IgnoreNew`，避免多次 logon 同時啟動重複 reporter

### 修正：SetupComplete 重開機競態中斷 app 安裝

- post-logon finalizer 現在記錄註冊時的 boot identity；同一 boot 提前出現的自動登入只等待既定重開機，不再開始 app/custom script sequence
- 重開後的新 boot 才允許執行安裝；真正於安裝中斷後再次觸發時仍維持 `interrupted`、不自動重跑非 idempotent step

### 新功能：Torrent 持續 wave、可中斷 seeding 與 Web 即時監控

- 同批收集窗由 12 秒改為固定 24 秒；origin batch 使用互斥 `i mod n` pieces，晚到 batch 在前批仍在線時採 `peer-only`，reconnect 以 `infoHash + peerId` 沿用 assignment
- 每個 wave 正常 host budget 固定為 `1.15x WIM`；3 分鐘無下載進展時進入可見的 emergency host fallback，30 秒無 non-host heartbeat 才建立新 wave
- WinPE 下載後於套用 Windows 期間繼續 seeding；reboot 前等待至 torrent 完成時間加 `seedMinutes`，可用 client Enter、Web 單台或 Web 全部等待中 client 提前結束
- 新增安全的 5 秒 telemetry、torrent control/release API、HostTools State 原子持久化及 Web wave/client 明細；週期性 telemetry 不寫入 status JSONL
- Fleet 新增 seed wait/release/emergency stage mapping；endpoint sync 同步注入 `Report-TorrentTelemetry.ps1`

### 修正：Torrent client 未互傳 piece

- tracker announce interval 由 10 分鐘縮短為 5 秒，WinPE aria2 啟用 peer exchange、固定 listen port 與明確 external IP，並以 `wpeutil` 關閉 firewall，讓同批 client 能在下載期間建立 inbound peer 連線
- host seeder 改為等待 12 秒收集同批 client，再按實際連線數提供互斥 striped bitfield；正常路徑只供應約一份 WIM，peer path 失效 3 分鐘後才放寬成完整 host fallback
- client 完成摘要與 `torrent-peers` evidence 改用 aria2 RPC 的實際 endpoints 和累計 `uploadLength`，不再從 log 掃描可能誤判 self IP 的位址
- 新增雙 aria2 integration test：兩台必須完成、各自上傳 bytes，且 host 供應量不得超過 1.15 份測試映像
- Secure Boot live 驗證：兩台 client 在未完成時各自上傳約 2.96 GiB；host 對 5.93 GiB WIM 合計供應正好 `1.000x`，兩台皆完成 SHA-256 並到達 `windows-desktop-ready` 100%

### 新功能：WinPE Torrent 即時傳輸資訊

- WinPE client 在 torrent 下載期間顯示完成百分比、容量、下載/上傳速率與 ETA
- active peer 集合改變時列出下載來源與上傳對象的 IP:port 及 Seeder/Peer 身分，完成後保留本次傳輸摘要
- aria2 JSON-RPC 僅監聽 loopback 並使用每次部署隨機 token；RPC 顯示故障不影響既有 torrent、SHA-256 或 SMB fallback 判定

### 新功能：Client 登入後部署進度畫面

- App/custom script sequence 改由第一次自動登入後的 `OSDCloudPostLogonFinalize` SYSTEM task 執行，保留既有順序、timeout、fail-fast、logs 與 host status events
- 新增 English 全螢幕置頂 viewer，顯示目前 app/script、步驟與完成項目；執行中不可關閉，成功後自動離開，失敗時需技術人員確認
- 新增 `C:\ProgramData\OSDCloud\deployment-progress.json` 安全狀態檔；不包含 stdout/stderr、raw exception、命令列或 secrets
- `selected-profile.json.installSequence[]` 增加 additive `name`，所有 profile（含 Minimal）都發布 `Show-DeploymentProgress.ps1`
- Desktop-ready reporter 只在 client finalization 成功後回報 `windows-desktop-ready`；意外重開機會標記 `interrupted`，不自動重跑非 idempotent step

### 修正：SetupComplete 無法初始化部署進度

- 將 progress JSON helpers 從 Desktop Ready reporter 的產生碼 here-string 移回 `SetupComplete.ps1` 外層作用域，避免四台 client 在 `Initialize-DeploymentProgress` 直接失敗
- 新增回歸檢查，確保 progress helpers 不會再次落入 reporter here-string
- 完成事件到達後固定 Validation Evidence 的 terminal stage 與 100%，避免稍晚送達的 SetupComplete finalizer 事件將顯示倒退至 96%
- 修正 Hyper-V restart helper 的預設 VM prefix，避免把 `winception-client-01` 組成不存在的 `winception-client-001`
- 將 restart helper 的 console/error 訊息改為 ASCII，避免 Windows PowerShell 5.1 將 UTF-8 no-BOM 中文誤解碼成 parse error

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
