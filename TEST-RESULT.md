# Current acceptance status — 2026-09-20

AutoLab `-Mode All -NetworkAcceptance` is **paused as a product gate**. Operator then authorized Hyper-V `-Mode SecureBoot` only. Run `secureboot-20260920a` is **Failed / cleanup Failed**: four VMs reached WinPE `apply-image` (SMB mapped, torrent peers; nonce 403 did not recur), then Fleet false fail-closed on torrent progress telemetry timeouts logged as `TerminatingError(Invoke-RestMethod)` while the client warned that download continues. Console was down during cleanup; leftover test profile `HI67E59T` was later restored to `IZVZO7PU`. Detector fix is in source (23 focused PowerShell tests). No automatic retry. Not physical evidence.

Firmware Mode All e (2026-09-13/14) remains the last green AutoLab fleet evidence. Router Ready exists from `acceptance-router-bootstrap-20260917x`. The only network-matrix attempt, `acceptance-mode-all-network-20260917y`, is Failed (`cleanup=Failed`) and must not be called green.

Product-facing boot-session nonce (`0e4d55d`) and Router Ready firmware restore (`04a1177`) are in source and match the installed HostTools App hashes. They were not re-proven by a second matrix. Physical three-scenario and unfamiliar-PXE human acceptance remain NotRun/Blocked. The host currently has Wi-Fi only (no Ethernet / USB Ethernet). Foreign ICS and two leftover NATs are present and must not be auto-repaired.

| Layer | Status | Current evidence |
| --- | --- | --- |
| Source / UI | Last Passed (re-verify only if requested) | 2026-09-14 Source/UI plus later Lab-era 2026-09-17 run: 500 tests / 497 passed / 3 skipped, check, smoke |
| AutoLab firmware Mode All | Historical Passed | `mode-all-20260913e`: four rounds / seven deployments to `windows-desktop-ready`, cleanup Passed. Internal `192.168.177.1` only |
| Router Ready | Present; lab-only | `Winception-Router-Ready` checkpoint; evidence `acceptance-router-bootstrap-20260917x` |
| AutoLab NetworkAcceptance | Paused / Failed | `acceptance-mode-all-network-20260917y`: nonce 403 on autolab-03 then Router cleanup Failed. Frozen 2026-09-20 |
| AutoLab SecureBoot four-VM | Failed / cleanup Failed | `secureboot-20260920a`: four clients at apply-image; torrent telemetry false fail-closed. Profile restored to `IZVZO7PU`. Detector fix not live-proven |
| Installed App | Source hashes match; Console listening after restore | Last Lab State backup `HostTools-State-20260920-131653-986`. Overlay AutoLab `.1/24`, profile `IZVZO7PU`. `bootMode=secureboot` but `bootFile` remains `snponly.efi` — do not start PXE from this snapshot |
| Physical / human | NotRun / Blocked | No present Ethernet; no `acceptance.local.json` onsite run; ICS/`PXE-Lab-NAT`/`OSDCloud-PhysicalClient-NAT` retained. ExistingDhcp is the first physical candidate after the operator supplies NIC, disposable client, and site file |

Operator next tracks (named explicitly; none started by this freeze): Source/UI re-verify in the clone; ExistingDhcp `ValidateOnly` after the physical checklist in `handoff.md`; or a later unattended NetworkAcceptance that still cannot prove physical/human. No Release, package, or master push.

Historical 2026-09-17 morning note below is superseded: Router Ready **does** exist after `20260917x`; `20260917u`/`v` were earlier Blocked-job failures, not the final router state.

---
# Deployment Test Result

## Layered automated acceptance — Source milestone 2026-09-14

Branch codex/easier-onboarding; restorable acceptance baseline codex/baseline-acceptance-20260914 at f092edc91136e5cef118338743705378f1b7a4ec. No Release, package or master push. Operational entries and separate layer rules: [docs/acceptance.md](docs/acceptance.md).

| Layer | Status | Current evidence |
| --- | --- | --- |
| Source | Passed | Latest `npm run acceptance:source`: check, 486 tests / 483 passed / 3 skipped, smoke; Router deployed-disk boot correction is committed at `42cd4d0` |
| UI | Passed | 9 cases at 390/1024/1366/1920 px, one worker/no retries, owned State cleanup Passed; local Chrome, not downloaded Chromium; test-results/acceptance-ui-report/result.json and HTML |
| Windows PowerShell / safety | Passed | Changed scripts parse; limited auto-login; actual WinPE/server pairing vectors; exact DHCP packets; unsafe site/pool/WAN guards; router VHD ownership; no mutation on early guard; partial stop fails cleanup |
| Installed App / WinPE | Passed | Source dae06b2 installed via guarded reload; HTTP hash matches; State backup HostTools-State-20260914-145854-135; Endpoint Sync and 29 Preflight checks passed; WinPE published SHA256 EFE3AFE948B177BC8624A4EA7B8E20D66015F3F021DF2FA1ECA3BB0AC8BF7CE4; services stopped |
| Expanded AutoLab | Firmware Passed; NetworkAcceptance paused / Failed | Firmware Mode All e remains green. Router Ready later existed (`20260917x`). Network matrix `20260917y` Failed and is frozen; see the 2026-09-20 status above. |
| Physical / human | NotRun | Three physical scenes and unfamiliar-PXE usability remain independent; missing-site readonly entry reports Blocked with deployment/network/cleanup NotRun |

Final draft review added authenticated Console calls, shared router-create mutex, live workspace runtimeRoot lookup and strict service-stop checks. Focused validation follows those edits; no live service/network mutation occurred in this Source milestone. Ordinary profiles now require target-account login; only bounded TEST ONLY profiles allow auto-login. No disk rollback is promised for physical reinstallation.

## Router bootstrap `20260915e` — Failed, cleanup Passed

2026-09-15 11:46–12:10 +08，以 `6937f23` 工作樹及 `34ede0c` 的 guest NAT 修正執行唯一一次 `-BootstrapRouter`。前置 `Initialize-WinceptionLab.ps1 -ValidateOnly` 通過。Router 取得 `192.168.177.200`，Fleet run `20260915-115114-3833-6458-5439-4386-0617-9856-93` 到達 `windows-desktop-ready`；PowerShell Direct 證據顯示 profile `HDTYAZI0`、Windows 11 build 26200 / 25H2、Secure Boot On / `MicrosoftWindows`、TPM On、Explorer、desktop marker，以及四個安裝步驟全部 succeeded。

之後 `Initialize-LabRouterGuest` 建立 WinNAT 時仍收到 `Router New-NetNat failed: Invalid class`。`Winception-Router-Ready` 未建立，因此未執行 `-ValidateOnly -RequireRouter` 或 `-Mode All -NetworkAcceptance`。runner 報告 `status=Failed`、`cleanup=Passed`；證據位於 `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260915e`。這一輪在還原 Router 前尚無 guest NAT 診斷收集，故無法事後證明 WinNat service、`MSFT_NetNat` CIM class 或 Windows feature 狀態。後續 Source 改為在 owned Router VM 關機時設定兩顆 vCPU／nested virtualization，啟用 guest Hyper-V、受控重開機並要求 `MSFT_NetNat`；失敗會還原原 processor 設定及保存 `router-nat-diagnostics.json`。此修正尚未再部署驗證。

12:11 +08 的提升權限 post-cleanup `ValidateOnly` 通過：mutex free；profile `IZVZO7PU`；endpoint `vEthernet (Winception-AutoLab)` / `192.168.177.1/24`；Server DHCP `.200–.250`；六台 VM 全 Off，resting Secure Boot／TPM 正確且只有 `Winception-Clean`；四個部署服務停止、Fleet 0、29 項 Preflight 全部通過。依本輪零重試規則停止。實體三場景與真人上手仍為 NotRun。

2026-09-15 16:13–16:47 +08，以 `efa9052` 執行新的唯一一次 `acceptance-router-bootstrap-20260915f`。前置 ValidateOnly 通過；Fleet run `20260915-161816-3833-6458-5439-4386-0617-9856-93` 成功到達 `windows-desktop-ready`，nested virtualization 也已在 Router 關機時設為兩顆 vCPU／On。Guest Hyper-V feature servicing 後 VM 停在 Off，PowerShell Direct 等待十分鐘後以 `Router PowerShell Direct timed out after guest restart.` 失敗，未進入 `MSFT_NetNat`／WinNAT 建立，`Winception-Router-Ready` 仍不存在。報告為 `status=Failed`、`cleanup=Passed`，證據位於 `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260915f`。16:48 +08 的提升權限 post-cleanup ValidateOnly 再次通過：原 profile `IZVZO7PU` 與 endpoint 已還原、服務停止、mutex free、六台 VM 全 Off，Router processor 亦回復一顆 vCPU／nested Off。依零自動重試規則未執行完整網路矩陣；Source 後續補上 feature servicing 留在 Off 時只啟動 owned Router VM 並保存 `router-hyperv-restart.json`。30 個相關 Router／Lab tests、`npm run acceptance:source`（486 tests，483 passed／3 skipped）與 smoke 通過；此後續尚未再次部署驗證。

2026-09-15 19:34–20:08 +08，以 `1ba36eb` 執行新的唯一一次 `acceptance-router-bootstrap-20260915g`。前置 ValidateOnly 通過；Fleet run `20260915-193921-3833-6458-5439-4386-0617-9856-93` 與 PowerShell Direct 均到達 `windows-desktop-ready`，profile `YZ6XQK8R`、Windows 11 build 26200、Secure Boot On／`MicrosoftWindows`、TPM On、四個安裝步驟均有當次證據。Router guest setup 隨後停機並設定 2 vCPU／nested On；因部署輪保留 Network-first，重新啟動後再次進入 PXE 而無法取得 PowerShell Direct，逾時後 `status=Failed`、`cleanup=Passed`。未建立 Router Ready，未執行網路矩陣。證據位於 `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260915g`；20:13 +08 的提升權限 post-cleanup ValidateOnly 通過，服務停止、mutex free、profile／endpoint／processor 與六台 VM 全部還原。Source 已改為 guest setup 前驗證並切換 owned Router 的 FirstBootDevice 至部署硬碟；30 個相關 tests、486 tests（483 passed／3 skipped）與 smoke 通過，修正尚未 live-proven。

## One laptop, anywhere acceptance — 2026-09-14

Implementation is on `codex/easier-onboarding`, based on `bdbe5ce`; baseline branch is `codex/baseline-onboarding-20260914`. Source, isolated preview, installed service, physical network and human usability evidence are separate. No new physical deployment or human usability pass is claimed by this implementation record.

| Evidence layer | Required observation | Status |
| --- | --- | --- |
| Source | Three scenes, disconnected NIC inventory, overlap-before-side-effects, site drift, Preflight/partial-start guards, pairing auth/pending/approve/reject/expiry/replay/identity/terminal rules | `npm run check`, `npm test` (462 passed / 3 skipped), `npm run smoke` and changed PowerShell parser checks passed |
| Isolated UI | Chinese wizard, refresh-derived steps, three diagrams, pairing controls, manual links and responsive widths | Passed with preview-only data; 390 / 1024 / 1366 / 1920 px, including the tall NAT form |
| Installed service | Elevated App update with State backup, WinPE/endpoint sync and current Preflight | App updated; AutoLab endpoint/WinPE sync passed, 29 checks / 0 failures / 0 warnings; deployment services stopped |
| Physical existing DHCP | Same client subnet; existing DHCP/gateway/DNS; PXE, pairing approval, post-logon DNS/HTTPS and this run's desktop-ready | Pending onsite client/network |
| Physical Winception LAN DHCP | No other DHCP; confirmed available pool; existing gateway/DNS; PXE, DNS/HTTPS and desktop-ready | Pending onsite DHCP test window |
| Physical laptop NAT | Distinct WAN/client NICs; isolated client subnet; Winception gateway/DNS, PXE, post-logon DNS/HTTPS and desktop-ready; Internet remains after service stop | Pending onsite NIC/client |
| Human usability | Unfamiliar-PXE user independently completes first setup and daily deployment, identifying wiring, pairing, failure recovery and completion | Pending designated operator |

Operator checks after logon: use `ipconfig /all` to record DHCP server, IP, subnet mask, gateway and DNS; `Resolve-DnsName www.microsoft.com` and `Invoke-WebRequest https://www.microsoft.com -UseBasicParsing` to verify DNS and HTTPS. Record the actual run ID and `windows-desktop-ready` in Activity. Do not reuse an old success. In Proxy retain existing DHCP; in Server confirm no other DHCP on the client segment. Do not modify foreign ICS/NAT. Stop deployment services only after all clients finish; NAT removal is a separate explicit action.

Source test environment: inherited Codex runtime `PSModulePath` selected an incomplete PackageManagement module for Windows PowerShell, failing four setup tests. Re-running with only that runtime path removed from the test process environment passed; no machine/user module path was changed. NAT CIDR calculation was also executed as an isolated extracted pure function under Windows PowerShell for /8, /24 and /30. These checks do not configure a NIC or create NAT.

Isolated browser checks used a development-only loopback preview, with mocked services/network inventory and its own workspace State. No preview action started DHCP, assigned a Windows NIC or wrote live runtime. The real UI displayed three scenarios, accepted a disconnected USB Ethernet without IPv4, restored incomplete steps from server state, invalidated the endpoint step after scenario changes and presented Preflight failure/site-drift recovery. Pairing approval and rejection removed the simulated pending request through the actual Console API handlers. Host progress opened the Console dock; client activity remained separate. Current-step instructions stay expanded, technical disclosure survives refresh, and interface refresh does not duplicate wizard navigation. Waiting for Windows login and post-logon installation each display one active client and disable guided service stop. At 390 px the document width was 390 px and the NAT form's next button ended at y=818 within the 844 px viewport. Chinese/English manual anchors and six wiring SVGs were checked; the portable manual had no external image references or broken loaded images. Actual preview screenshots are embedded in editable annotated SVGs; preview helpers and raw captures stay outside commits.

Installed validation used the elevated `npm run reload` flow with protected State backup, retaining the existing cached Windows 11 25H2 image and published profile `IZVZO7PU`. Initial backup: `C:\OSDCloud\HostTools\Backups\HostTools-State-20260914-081434-402`. Endpoint Sync deliberately retained `vEthernet (Winception-AutoLab)` / `192.168.177.1/24`, Server DHCP pool `.200–.250`, router `.1`, DNS `1.1.1.1,8.8.8.8`, SMB `\\192.168.177.1\OSDCloudiPXE` and `secureboot`; services were not restarted. The published boot.wim sync marker has schema 2, its Start-OSDCloud-iPXE template hash matches source, and `secrets.present=false` / `ephemeral-boot-session`. Published SHA-256: `84C3A2F30A321792E1F2D60CF7B3CF92033010E975115DFAC5AB3FEBAC5B931B`. Preview fixes and the Windows-finalization stop guard received focused beginner/UI tests (22 passed) and `check` after the full suite (465 total: 462 passed / 3 skipped).

The host currently exposes Wi-Fi and two absent Wi-Fi adapters, with no present Ethernet client NIC. Existing ICS and foreign `PXE-Lab-NAT` / `OSDCloud-PhysicalClient-NAT` were read only and retained. No Winception NAT was created or removed. This AutoLab Preflight result does not establish client Internet access or any of the three physical acceptance paths. Physical clients, a suitable client NIC/LAN DHCP window and an unfamiliar-PXE operator remain required.

Final installed App code is source `4b9fb36`; its latest State backup is `C:\OSDCloud\HostTools\Backups\HostTools-State-20260914-083141-596`. Initial backup above preserves the pre-implementation State. Source restoration uses the onboarding changes on top of baseline `bdbe5ce`; a source revert does not restore App, State, boot.wim or Windows networking. No master push, Release, tag or deployment package was created.

2026-09-14 00:14 +08 — Mode All e (source `71fee78`) green on Internal AutoLab `192.168.177.1`. Four rounds / seven deployments all reached `windows-desktop-ready` with profile `IZVZO7PU`, four succeeded install steps (Chrome, 7-Zip, desktop script, Notepad++), Explorer, desktop marker, no OOBE, `windowsFamily=Windows 11` build `26200` / `25H2`. Registry `productName` remained `Windows 10 Pro` and was accepted by build. Cleanup restored resting firmware and stopped services; host `bootMode=secureboot`. This is AutoLab evidence, not physical-laptop or production DHCP proof. Evidence: `C:\OSDCloud\HostTools\State\lab\evidence\mode-all-20260913e` and `result.json`.

| Round | Host | Client SB | Client TPM | Fleet elapsed | Guest |
| --- | --- | --- | --- | --- | --- |
| `secureboot-tpm-on` `01..04` | `secureboot` | On | On | 495–503 s | Confirm-SecureBootUEFI true; TPM Present/Ready/Enabled/Activated; hostFirmware MicrosoftWindows On + TPM On |
| `ipxe-tpm-off` `ipxe-01` | `ipxe` | Off | Off | 326 s | Confirm-SecureBootUEFI false; TPM all false; host SB Off + TPM Off |
| `secureboot-tpm-off` `01` | `secureboot` | On | Off | 324 s | Confirm-SecureBootUEFI true; TPM all false; host SB On + TPM Off |
| `ipxe-tpm-on` `ipxe-01` | `ipxe` | Off | On | 328 s | Confirm-SecureBootUEFI false; TPM Present/Ready/Enabled/Activated; host SB Off + TPM On |

2026-09-13 21:11 +08 — Mode All d (source `b04c6e8`) first Secure Boot On + TPM On round reached 4/4 `windows-desktop-ready` (profile `IZVZO7PU`, four succeeded install steps, Explorer, no OOBE, build `26200` / `25H2`). Cleanup then failed on all four checkpoint restores: StrictMode `BootType` missing on a `Get-VMFirmware.BootOrder` entry. Guest `productName` was `Windows 10 Pro` while build/displayVersion were Windows 11 25H2; that registry value is stale and is not a Windows 10 result. Source now guards BootOrder property existence, records round `hostFirmware`, and fail-closes Windows 11 on `CurrentBuild` >= 22000. Five VMs Off and deployment services stopped. Fresh Mode All after reload is still required. Evidence: `C:\OSDCloud\HostTools\State\lab\evidence\mode-all-20260913d`.

2026-09-13 20:27 +08 — Mode All c (source b68f554) cancelled after active guest checks found autolab-02 progress failed while Fleet showed setupcomplete-finished. Chrome succeeded; File.Replace of deployment-progress.json failed because another process held the file, leaving runner_error and no sequence summary. Three other clients reached desktop-ready, not a complete Mode All pass. Source/App/WinPE marker fingerprints matched before boot; WinPE network preparation completed on all four. Five VMs Off and deployment services stopped after cancellation. Bounded sharing-violation retry and fail-closed finalizer verification require a fresh full regression.

## Mode All 整合驗證過程（2026-09-13，後由 Mode All e 綠燈）

19:40 +08 唯讀檢查確認 run b 已停止，部署服務皆停止，但 autolab-04 仍 Running；其餘四台 Off。還原的 `Set-VMFirmware -FirstBootDevice` 仍報 ObjectNotFound。VMMS 同時報 Lab VHDX `0x80070005`；目前 VHDX 非唯讀、無 deny ACL，已有 VM/SYSTEM 權限，因果關係未證實。新版 WinPE template 尚未同步到 App 或 boot.wim。後續已單獨停止 autolab-04，五台全 Off；source 清理分離 stop/restore，逐台彙總失敗，等待穩定且 adapter 匹配的 Network firmware source 並讀回角色。新增 behavioral tests 後 Lab tests 14/14 通過；完整 npm test 為 447 passed、3 skipped、0 failed。實際修正版清理與完整 Mode All 待驗證。

18:57 +08 以 source fix 重跑 Mode All（evidence `State\lab\evidence\mode-all-20260913b`）。四台成功載入 WinPE，但 autolab-01 在取得 Torrent metadata（19:03:22 HTTP 200）後、網路準備回報前停住；其餘三台正常下載並套用。WinPE 畫面與 callback 交叉確認停點，未等待 60 分鐘 timeout。Source 已加入 CIM / wpeutil / netsh 15 秒限制與逐步回報；限時與 native exit/output behavioral tests 通過，19:11 +08 Windows PowerShell 的 npm test、check、smoke exit 0。完整修正版 Mode All 仍待執行。

18:15 +08 啟動本機 `Mode All`（Internal AutoLab `192.168.177.0/24`）。首輪四台 Secure Boot On + TPM On 全數到 `windows-desktop-ready`，Chrome、7-Zip、desktop script、Notepad++ 均 succeeded。尚不能宣告 Mode All 綠燈。

主動檢查發現 checkpoint restore 後再次設定 `FirstBootDevice` 偶發 Hyper-V `ObjectNotFound`，round cleanup 中途退出並留下後續 VM。既有 runner 吞掉此錯誤；guest profile ID 為空仍被接受，且 host firmware 的 Add-Member 欄位在 dictionary JSON 中遺失。

Source 已改為保留既有 Network-first boot entry、cleanup fail-closed、成功清理後才輸出綠燈；guest 讀取已發布的 `Apps\selected-profile.json`、強制匹配 profile ID 並以 PSCustomObject 保存 host 韌體欄位。Lab behavioral/contract tests 12/12 通過；18:54 +08 Windows PowerShell 執行 npm test：444 passed、3 skipped、0 failed，check 與 smoke 通過。原 Codex shell 的 bundled PackageManagement/fullclr module path 曾導致四個 setup tests 失敗；正確 Windows PowerShell 環境重跑全數通過。修正版本完整 Mode All 待重新執行。本段僅為 AutoLab 證據，非實體筆電驗證。

## Secure Boot + TPM Hyper-V PXE 綠燈（2026-09-13）

本機 AutoLab Internal `vEthernet (Winception-AutoLab)` / `192.168.177.1`，`dhcp.bootMode=secureboot`。先前 PXE 失敗是因為 live boot mode 停在 `ipxe`（Secure Boot 會拒收 `snponly.efi`），且 `winception-autolab-01` 的 Secure Boot 範本是 `MicrosoftUEFICertificateAuthority` 而不是 `MicrosoftWindows`。

修正後單台 `winception-autolab-01`（Gen2、Secure Boot On、template `MicrosoftWindows`、TPM On）從 UEFI IPv4 PXE 送到 `windows-desktop-ready`：

- DHCP：`ACK 192.168.177.201` `boot=bootmgfw.efi`。
- TFTP：`SENT bootmgfw.efi`（2,772,912 bytes）、`BCD`、`boot.sdi`、`SENT boot.wim`（733,536,617 bytes）到 `192.168.177.201`。`SiPolicy.p7b` 等 MISS 為正常探測。
- Fleet run `20260913-004530-9115-1512-6263-2753-5174-0981-98`：`status=completed`、`latestStage=windows-desktop-ready`、100%、`Windows desktop is ready for LabAdmin`。約 00:45–01:00 +08（Fleet `elapsedSeconds=268` 不含映像套用）。
- Apps/script：Chrome、7-Zip、desktop script、Notepad++ 皆 `succeeded`，SetupComplete exit `0`。
- PowerShell Direct：`Confirm-SecureBootUEFI=True`；TPM Present/Ready/Enabled/Activated；Explorer running；`C:\Users\LabAdmin\Desktop\OSDCloud-Desktop-Ready.txt`；OOBE 程序未見；Windows 11 25H2 build 26200 Professional。
- 證據收集後已將 VM 還原 `Winception-Clean`。Hyper-V checkpoint 不含 TPM；Lab 還原依該輪 `-SecureBoot` / `-Tpm` 重套韌體（預設 SB VM 為 TPM On）。這仍不能當成實體筆電或生產 DHCP 證據。

## AutoLab firmware corners 綠燈（2026-09-13）

`Invoke-WinceptionLabRegression.ps1 -Mode FirmwareCorners` on Internal `192.168.177.1` only. Host `/api/boot-mode` stayed `secureboot` then `ipxe`. Default Switch ICS UDP/67 was not stopped.

| Round | Host chain | Client SB | Client TPM | Fleet | Guest |
| --- | --- | --- | --- | --- | --- |
| `secureboot-tpm-off` `winception-autolab-01` | `secureboot` / `bootmgfw.efi` | On | Off | `20260913-121119-...` `windows-desktop-ready` 100% `elapsedSeconds=321` | `Confirm-SecureBootUEFI=True`; TPM Present/Ready/Enabled/Activated all false; Explorer; desktop marker; 25H2 26200 |
| `ipxe-tpm-on` `winception-autolab-ipxe-01` | `ipxe` / `snponly.efi` | Off | On | `20260913-123029-...` `windows-desktop-ready` 100% `elapsedSeconds=318` | `Confirm-SecureBootUEFI=False`; TPM Present/Ready/Enabled/Activated; Explorer; desktop marker; 25H2 26200 |

Apps/script on both rounds: Chrome, 7-Zip, desktop script, Notepad++ `succeeded`. Cleanup restored resting firmware: `01..04` Secure Boot On + TPM On, iPXE Secure Boot Off + TPM Off. This is not physical-laptop or production DHCP evidence.

Earlier the same day, two FirmwareCorners attempts failed before green: WinPE `selected-os.json` / `net use Z:` **System error 86** because clone-run `Restore-DeploymentArtifacts` reset `pxeinstall` from the wrong secrets file, and Lab waited the full timeout while Fleet stayed `running`. Fixed by passing HostTools State into cache restore, not hashing generated `boot.wim`/`boot.ipxe`, and failing closed on `latest.json` terminal WinPE text.

## v1.1.0 候選修補（2026-09-11 source-only）

在 2026-08-18 候選之上補了出貨前該修的 source/docs，沒有建立 AutoLab、沒有停現有 vSwitch VM、沒有啟動 DHCP/TFTP/HTTP/Torrent：

- Desktop-ready reporter 的 `Clear-AutoLogonSecrets` 改與 SetupComplete 相同的 `{ ok, failures }` 結果，並在 cleanup 失敗時扣住 `windows-desktop-ready`。
- AutoLab example VM 改為 `winception-autolab-01..04` 與 `winception-autolab-ipxe-01`，不再徵用歷史 `winception-client-01..04`。
- `Initialize-WinceptionLab.ps1` 建立 Internal switch 時不再帶 `-AllowManagementOS`（該參數只適用於 external switch）。
- CHANGELOG 把已在候選內的 beginner 工作台、AutoLab CI、project-root validation 從 Unreleased 移入 v1.1.0；`debugging-todo.md` 改寫為「首次登入不要自動登入」仍屬 v1.1.0 之後。

2026-09-12 本機 `Invoke-WinceptionLabRegression.ps1 -Mode All` 通過（candidate `6f49bba`）。四台 Secure Boot（`winception-autolab-01..04`）與一台 iPXE（`winception-autolab-ipxe-01`）都送到 `windows-desktop-ready`（LabAdmin、Explorer、desktop marker、Chrome / 7-Zip / Notepad++ / desktop script）。Preflight CLI+API 通過；DHCP 只綁 `192.168.177.1`。過程中修了 boot-session RSA/OAEP、lease range、WinPE byte[] unroll，以及 desktop-ready 必須在清掉 in-memory token 之前送出。ICS / Default Switch 未停。歷史 `winception-client-01..04` 仍在 `vSwitch`。跑完已還原 vSwitch endpoint overlay。這仍不能當成實體筆電或生產 DHCP 證據。尚未簽署、尚未實體 UEFI IPv4 PXE、尚未打 tag。

## v1.1.0 商品化候選驗證（2026-08-18 current run）

本次候選已實作 Release 零預載／Development fixture 雙軌、State-preserving upgrade/migration、短效 boot-session credential envelope 與 auto-logon cleanup gate。另修正 HostTools 安裝器誤排除產品手冊 PNG、兩份 PXE SetupComplete 換行不一致問題，以及 Development bundle verifier 誤拒合法 fixture tree 的 channel 判斷。

最後一輪 clean checkout 使用本地候選 commit `2d18561889c6de1257f2ccc5ce0b4df6347a25c4`：`node --check`、PowerShell parser、`npm ci --no-audit --no-fund`、`npm run check`、完整測試、`npm run smoke` 與 `git diff --check` 全部通過；完整 `npm test` 為 439 PASS、3 SKIP、0 FAIL，並新增 Release 空白狀態不可啟動服務的回歸測試。

Release bundle 驗證通過 145 個 manifest artifacts，`channel=Release`、`dataPolicy=zero-preload`、`fixturePresence=false`；unsigned RC 的 ZIP、SHA-256 checksum 與 metadata 均在 Git 外部產生，並以該 clean checkout 的 commit/version 寫入 manifest。Development bundle 驗證通過 153 個 artifacts，`dataPolicy=development-fixture`、`fixturePresence=true`，且 fixture 只能由明確 seed 指令載入。Release ZIP 解壓、fresh App/State install 與 fresh-state `serverPreflight` 均通過：`unconfigured`、active profile/image 為 null、profiles 為空，preflight 以 exit code 1 阻擋未設定 endpoint。

完整 `npm test` 在排除目前 Codex runtime 注入的不完整 PackageManagement 路徑後通過：439 PASS、3 SKIP、0 FAIL。可重複的 runner 前置設定如下：

```powershell
$env:PSModulePath = (($env:PSModulePath -split ';') | Where-Object { $_ -and ($_ -notmatch 'codex-primary-runtime') }) -join ';'
npm test
```

這是目前執行環境的 runner 隔離條件，不是產品 runtime 修補。Hyper-V 商品化驗收在 Computer Use 觀察 Hyper-V Manager 後，因目前 PowerShell 未提升權限而停止於 `Initialize-WinceptionLab.ps1 -ValidateOnly` 前；本輪沒有建立 AutoLab、修改 VM/switch、停止 ICS/Docker 或啟動 DHCP/TFTP/HTTP/Torrent。2026-08-18 尚未重新執行隔離 AutoLab 或實體 UEFI IPv4 PXE，因此本候選尚未達正式 Release gate；下方既有部署紀錄均為歷史 evidence。

Authoritative evidence and no-AI operator runbook for a completed from-zero deployment setup test.

**Date validated**: 2026-06-24
**Boot mode**: `secureboot` (default) — Microsoft-signed `bootmgfw.efi` → network BCD → TFTP windowed `boot.wim` → WinPE
**Hardware validated**: Dell physical laptop (Latitude series); Hyper-V Gen2 with Secure Boot ON and TPM ON (AutoLab)

## Validated Paths

| Path | Result | Date |
| --- | --- | --- |
| secureboot mode — Dell physical laptop (Latitude), Secure Boot ON | ✔ Deployed to `windows-desktop-ready` | 2026-06-12 |
| secureboot mode — Hyper-V Gen2 (`MicrosoftWindows` SB template, `winception-client-sb-01`), Secure Boot ON | ✔ Deployed to `windows-desktop-ready` | 2026-06-12 |
| secureboot mode — Hyper-V Gen2 AutoLab (`winception-autolab-01`), Secure Boot ON + TPM ON | ✔ Deployed to `windows-desktop-ready`; guest `Confirm-SecureBootUEFI=True`, TPM Present/Ready/Enabled/Activated | 2026-09-13 |
| secureboot mode — Hyper-V Gen2 AutoLab (`winception-autolab-01`), Secure Boot ON + TPM OFF | ✔ `FirmwareCorners` `windows-desktop-ready`; guest SB True, TPM all false | 2026-09-13 |
| ipxe mode — Hyper-V Gen2 AutoLab (`winception-autolab-ipxe-01`), Secure Boot OFF + TPM ON | ✔ `FirmwareCorners` `windows-desktop-ready`; guest SB False, TPM Present/Ready/Enabled/Activated | 2026-09-13 |
| secureboot mode — two concurrent Hyper-V clients, striped Torrent P2P offload | ✔ Both clients uploaded while incomplete and reached `windows-desktop-ready` | 2026-06-19 |
| secureboot mode — four concurrent Hyper-V clients, two consecutive rounds | ✔ 8/8 reached `windows-desktop-ready`; every app/script sequence completed 4/4 with exit code 0 | 2026-06-20 |
| USB/ISO offline installer — Hyper-V Gen2 ISO boot, Secure Boot ON, no NIC | ✔ Rebuilt ISO deployed offline to `windows-desktop-ready` | 2026-06-24 |
| secureboot mode — SB OFF (fallback; boot chain still MS-signed, boots without SB enforcement) | ✔ Reached WinPE and apply-image | 2026-06-12 |
| ipxe mode regression — `snponly.efi` → `boot.ipxe` → wimboot → WinPE | ✔ WinPE callback confirmed | 2026-06-12 |

## Torrent P2P Offload Evidence — 2026-06-19

Two concurrent Secure Boot clients downloaded the 6,368,481,430-byte WIM through one striped host batch:

- `192.168.77.202:7202` received host slot `0/2`; `192.168.77.201:7201` received slot `1/2`. Each host bitfield contained only its interleaved half of the pieces.
- Before completion, tracker counters increased on both clients. Final client uploads were 3,185,004,694 bytes (`.202`) and 3,183,476,736 bytes (`.201`). Each completion event identified the other client as both a Peer source and receiver.
- The active download batch served 3,185,004,694 bytes to `.202` and 3,183,476,736 bytes to `.201`: 6,368,481,430 bytes total, exactly `1.000x` WIM size rather than `2.000x`. Batch `0` did not enter `PEER-FALLBACK`.
- Both clients passed SHA-256 verification. Runs `20260619-221504-9139-9236-4890-0748-8921-6350-41` and `20260619-221511-3714-2415-4875-1592-7324-5531-21` finished at `windows-desktop-ready` 100%.
- Each run wrote two `torrent-download` events and one completion-only `torrent-peers` event; five-second RPC polling did not create periodic host status events.

## Four-Client Regression Evidence — 2026-06-20

Two consecutive Secure Boot rounds used four concurrent Hyper-V Gen2 clients with fixed 4 GiB startup memory:

- Round 1: runs `20260620-103733-3165-2914-1943-0908-5094-0852-36`, `20260620-103742-0885-8703-1155-6903-2654-8648-29`, `20260620-103745-3714-2415-4875-1592-7324-5531-21`, and `20260620-103747-9139-9236-4890-0748-8921-6350-41`.
- Round 2: runs `20260620-113452-0885-8703-1155-6903-2654-8648-29`, `20260620-113452-3165-2914-1943-0908-5094-0852-36`, `20260620-113455-3714-2415-4875-1592-7324-5531-21`, and `20260620-113457-9139-9236-4890-0748-8921-6350-41`.
- All 8 runs reached `windows-desktop-ready`. Each `windows-setupcomplete-finished` event reported app installer exit code `0`, empty stderr, and successful completion of Chrome, 7-Zip, custom script `SC-J5GF07Y2`, and Notepad++ (`SW-4UT7PDID`). No run contained an `error` or `timeout` terminal stage.
- The regression covers the Hyper-V WinPE memory reservation and monotonic client timers used across Hyper-V clock corrections.

## USB/ISO Add-On PXE Regression Evidence — 2026-06-23

After adding the independent USB/ISO offline installer, the existing Secure Boot PXE path was revalidated with four concurrent Hyper-V Gen2 clients on `vEthernet (vSwitch)` / `192.168.77.1/24`.

- Preflight passed 29/29 checks, including published `boot.wim` sync, Secure Boot TFTP tree, SMB image access, OS image, and active profile payload.
- Runs `20260623-090613-3165-2914-1943-0908-5094-0852-36`, `20260623-090613-9139-9236-4890-0748-8921-6350-41`, `20260623-090616-0885-8703-1155-6903-2654-8648-29`, and `20260623-090619-3714-2415-4875-1592-7324-5531-21` all reached `windows-desktop-ready` at 100%.
- The PXE no-redownload evidence remained unchanged: each `osdcloud-finished` event reported empty `ImageFileUrl`, `ImageFileDestination.PSDrive.DisplayRoot` as `\\192.168.77.1\OSDCloudiPXE`, and `OSImageIndex = 1`.
- Torrent seed wait was released manually through the Web API after image apply. Services were stopped after completion.

## USB/ISO Offline ISO Validation Evidence — 2026-06-24

The rebuilt offline ISO was validated with a fresh Hyper-V Generation 2 VM and no network adapter:

- ISO: `C:\OSDCloud\Exports\Winception-USB-20260623-143046.iso`
- ISO SHA-256: `B9C0F461CFA51C5823A2D922C8122DA154B24658D70D4B0D3E7F3EC8DE0F2EE8`
- VM: `winception-usb-iso-final-01`
- Firmware: Generation 2, Secure Boot `On`, template `MicrosoftWindows`
- Network: `0` VM network adapters
- Boot order: empty dynamic VHDX first, rebuilt ISO second; first boot fell through to ISO, post-install reboot used the installed Windows disk

PowerShell Direct evidence from the deployed Windows guest:

```text
Computer             : DESKTOP-8PMJK68
User                 : LabAdmin
ExplorerRunning      : True
DesktopReadyFile     : True
DesktopReadyPath     : C:\Users\LabAdmin\Desktop\OSDCloud-Desktop-Ready.txt
ProgressStatus       : succeeded
DeploymentStatusFile : True
SecureBoot           : True
OobeProcesses        : <empty>
```

The run reached `windows-desktop-ready` without a NIC, SMB, torrent, DHCP lease, or host telemetry.

## Unattended PR And Isolated Hyper-V Lab Contract

The source automation added on 2026-08-08 defines the repeatable validation lane; this source-only change did not execute the dedicated runner, create/restore its VMs, start services, run Endpoint Sync, or enable DHCP.

PR pull requests run only in an isolated checkout with Node 24.x, npm ci, JavaScript syntax checks, Windows PowerShell parser checks, npm run check, npm test, npm run smoke, and targeted Web/Lab contract tests. The PR workflow has no service, endpoint, profile publish, or DHCP step.

After a master push, the dedicated Windows self-hosted Hyper-V runner:

1. Acquires the Winception-AutoLab concurrency lock and validates the exact Internal switch, vEthernet adapter, isolated subnet, DHCP binding, five powered-off Gen2 VMs, default Secure Boot/TPM roles, fixed memory, and Winception-Clean checkpoints.
2. Exports a commit/versioned tracked HostTools bundle with per-file length and SHA-256 manifest; secrets, runtime state, generated media, logs, screenshots, .ai, and untracked files are excluded.
3. Installs the bundle in HostTools App, runs npm ci, restores/prepares the product-managed runtime through existing helpers, synchronizes endpoint/profile/OS image through existing APIs, and runs server:preflight.
4. Runs four Secure Boot + TPM On VMs in parallel, then iPXE Secure Boot Off + TPM Off, then firmware corners (Secure Boot On + TPM Off, iPXE Secure Boot Off + TPM On). Each run needs Fleet status completed at windows-desktop-ready plus PowerShell Direct evidence for desktop marker, Explorer, OOBE, Windows version, profile, app/script sequence, and the expected Secure Boot/TPM pair. iPXE also needs snponly.efi, boot.ipxe, wimboot, and callback evidence.
5. Stops known Lab services, powers off VMs, restores checkpoints, reapplies `-SecureBoot`/`-Tpm` for the resting firmware (Winception-Clean drops Hyper-V TPM), clears temporary status/operation state, and uploads only redacted evidence on both success and failure. There is no automatic retry.

Required failure tests include preflight blocking without DHCP start, stale/running VM, missing checkpoint, foreign switch/adapter/DHCP binding, occupied port, invalid cache hash, PowerShell Direct timeout, cleanup failure, Ctrl+C, job cancellation, and concurrency collision. A passing isolated Lab run is not production/WAN/LAN DHCP or physical-laptop evidence.

## Rebuild From Zero (No-AI Runbook)

Steps to bring a fresh Windows host from a clean clone to PXE-ready state.

### 1. Clone and run setup wizard

```powershell
git clone <repo-url> <repo-root>
cd '<repo-root>'
.\Setup-DeploymentServer.cmd
```

Setup installs Node.js LTS if missing, installs the host management bundle to `C:\OSDCloud\HostTools`, runs `npm install` and smoke tests, and starts the Web console at `http://127.0.0.1:8080`.

### 2. Guided Setup in Web console

Open `http://127.0.0.1:8080` and run **Guided Setup** (Initialization Wizard):

1. **Project root** — confirm `C:\OSDCloud` (or choose a different root)
2. **Deployment secrets** — set `windowsUsername`, `windowsPassword`, `pxeinstallPassword` via Web form; written to ignored `config\osdcloud-secrets.json`
3. **Prepare runtime** — downloads and verifies all `config\runtime-artifacts.json` entries, builds WinPE `boot.wim`, stages the Secure Boot TFTP tree (`PXE-TFTP\bootmgfw.efi`, `Boot\BCD`, `Boot\boot.sdi`, `Boot\Fonts`, `sources\boot.wim` hardlink)
4. **Select endpoint** — choose service NIC (e.g., `LAN 192.168.88.1/24`); syncs `boot.ipxe`, WinPE endpoint, SMB firewall, and publishes `boot.wim`
5. **OS Image Cache** — download or import Windows ISO/ESD; select DISM index; export deployable WIM
6. **Publish profile** — set active profile (`Default` / `All in One` / `Minimal`) to bind OS image and publish `selected-os.json`
7. **Run preflight** — all checks must pass before starting services

### 3. Confirm boot mode

Default boot mode is `secureboot`. Check in Web console under **Endpoint Settings → Client Boot Mode** or read `config\osdcloud-console.json` → `dhcp.bootMode`.

- **secureboot**: leave client Secure Boot ON (Dell: F2 → Secure Boot Enabled, Microsoft Windows mode; UEFI-only boot; Integrated NIC with PXE). No BIOS changes needed for Dell Latitude or Dell Pro 14.
- **ipxe**: client Secure Boot must be disabled (BIOS F2 → Secure Boot = Disabled) before PXE boot.

### 4. Pre-deployment checks

- Confirm `PXE-TFTP\bootmgfw.efi`, `Boot\BCD`, `Boot\boot.sdi`, `sources\boot.wim` exist (secureboot mode)
- Confirm real LAN DHCP server is disabled
- Run preflight — all items green before starting services

### 5. Start services and boot

```text
Web console → Start all services
Client → F12 → UEFI IPv4 PXE (no USB, no ISO)
```

### 6. Expected deployment evidence

TFTP log (`pxe-tftp.log`) must show:

```text
RRQ bootmgfw.efi
SENT bootmgfw.efi
RRQ Boot/BCD
SENT Boot/BCD
RRQ Boot/boot.sdi
SENT Boot/boot.sdi
RRQ sources/boot.wim
SENT sources/boot.wim  windowSize=16
```

`MISS` lines for `SiPolicy.p7b`, `SecureBootPolicy.p7b`, `boot.stl`, locale fonts are normal — bootmgr probes these as optional.

Web console `Client Fleet` must reach `windows-desktop-ready`. Final state on deployed Windows:

```text
User             : <computer>\<windowsUsername>
ExplorerRunning  : True
DesktopReadyFile : True
DesktopReadyPath : C:\Users\<windowsUsername>\Desktop\OSDCloud-Desktop-Ready.txt
OobeProcesses    :
LaunchUserOOBE   : 0
SkipUserOOBE     : 1
NoAutoUpdate     : 1
DisplayVersion   : 25H2
CurrentBuild     : 26200
EditionID        : Professional
Culture          : zh-TW
TimeZone         : Taipei Standard Time
FinalStatusStage : windows-desktop-ready
```

Run on deployed client to confirm Secure Boot state:

```powershell
Confirm-SecureBootUEFI   # should return True
```

### 7. Post-deployment

- Stop DHCP/TFTP/HTTP in Web console
- Restore real LAN DHCP server if it was disabled for testing
- Run `.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts` and commit if any tracked files changed

## Configuration at Time of Validation

```json
{
  "dhcp": {
    "bootMode": "secureboot",
    "secureBootFile": "bootmgfw.efi",
    "bootFile": "ipxeboot/x86_64-sb/snponly.efi",
    "ipxeBootUrl": "http://<service-ip>/osdcloud/boot.ipxe"
  }
}
```

TFTP BCD parameters (in `PXE-TFTP\Boot\BCD`):

```text
ramdisktftpblocksize : 1456
ramdisktftpwindowsize: 16
```

boot.wim transfer time at windowsize=16: ~11–15 seconds (~39 MB/s for 577 MB).
