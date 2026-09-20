# Agent handoff — 2026-09-20 (SecureBoot four-VM)

## Active task — wait for operator before a new SecureBoot evidence root

Do **not** rerun `-Mode All -NetworkAcceptance`. Do **not** bootstrap the router. Do **not** start a second Lab while reporting this freeze. Physical ExistingDhcp stays Blocked (no Ethernet).

Operator chose Hyper-V `-Mode SecureBoot` only. `secureboot-20260920a` is **Failed / cleanup Failed** and must not be called green. Four VMs reached WinPE `apply-image` with SMB mapped and torrent peers; Fleet then false fail-closed on torrent progress telemetry (`TerminatingError(Invoke-RestMethod)` + “download continues”). Boot-session nonce 403 did **not** recur.

Cleanup left test profile `HI67E59T` active because the Web Console was already down. Manual restore reactivated `IZVZO7PU` and deleted `HI67E59T`. Mutex is free; six AutoLab VMs Off.

Source now ignores that telemetry noise in `Test-ClientTerminalFailureText` while still fail-closing real `TerminatingError(` (focused tests 23/23). **Zero automatic retry.** A later `-Mode SecureBoot` must use a **new** evidence root (suggested `secureboot-20260920b`) only after the operator names it. Lab orchestrator runs from the clone, so the detector fix does not need HostTools reload.

### Exact continuation

1. Re-read Git, this file, live overlay/profile, mutex, VMs. Do not reuse `secureboot-20260920a`.
2. Stop unless the operator authorizes one new `-Mode SecureBoot` (no `-NetworkAcceptance`).
3. If authorized: elevated `Initialize-WinceptionLab.ps1 -ValidateOnly`, then one `Invoke-WinceptionLabRegression.ps1 -Mode SecureBoot` with a unique evidence root. Fail-closed; no retry.

# Agent handoff — 2026-09-20

## Active task — NetworkAcceptance is frozen; wait for the operator before the next track

Do **not** rerun `-Mode All -NetworkAcceptance`. Do **not** bootstrap the router again. Do **not** start DHCP, Endpoint Sync, Preflight mutation, or any Lab runner unless the operator explicitly names that track.

The 2026-09-14 through 2026-09-17 Codex continuation burned a nested-Hyper-V router ladder (39 evidence roots; bootstrap letters through `20260917x`; one Failed network matrix) without moving physical or human acceptance. Operator chose plan A: freeze that gate, keep the product fixes, and decide the next track after this freeze is in Git.

`.ai/` remains untracked. Do not push `master`, create a Release/package, or treat AutoLab green as physical proof.

### Exact continuation

1. Re-read Git, this file, live Web/API/config, adapter/DHCP/NAT, and Hyper-V before any later track. The 2026-09-17 “rerun the matrix” steps below are historical and must not be followed.
2. Stop. Report current freeze status. Wait for the operator to pick one of: Source/UI re-verify (plan B), physical ExistingDhcp `ValidateOnly` after site prerequisites (plan C), or a later unattended NetworkAcceptance (plan D).
3. If the operator has not picked a track, do not invent work in Lab scripts, router guest NAT, or another evidence root.

### Live host snapshot (2026-09-20, re-verify before acting)

| Item | Value |
| --- | --- |
| Clone HEAD | `e27192f` on `codex/easier-onboarding` (docs freeze commit follows this snapshot) |
| Tracked tree | Clean except untracked `.ai/` |
| `master` | Local `bdbe5ce`, one commit ahead of `origin/master` `847b79f`; preserve it |
| Installed App | `httpServer.js` and `tools/lib/LabRouter.ps1` SHA-256 match source; last elevated reload backup `HostTools-State-20260917-092952-275` |
| Console | **Not listening** on `127.0.0.1:8080`; Lab mutex free |
| Endpoint snapshot | State overlay AutoLab `vEthernet (Winception-AutoLab)` / `192.168.177.1/24`, Server `.200–.250`, router `.1`, DNS `1.1.1.1,8.8.8.8`, `dhcpMode=server` |
| Boot-mode drift | Overlay `dhcp.bootMode=secureboot` and `secureBootFile=bootmgfw.efi`, but live `dhcp.bootFile` is still `ipxeboot/x86_64-sb/snponly.efi`. Do not start PXE from this snapshot. Re-read and Endpoint Sync only after the operator selects a live endpoint. |
| Active profile | `IZVZO7PU` (All in One, Windows 11 25H2) |
| AutoLab VMs | All six Off. `01..04` Secure Boot On + `MicrosoftWindows` + TPM On; iPXE Secure Boot Off + TPM Off |
| Router | Off; checkpoints `Winception-Clean` and `Winception-Router-Ready`; 2 vCPU; nested virtualization On; TPM On; Secure Boot On / `MicrosoftWindows`; LAN on `Winception-AutoLab`; WAN still on Default Switch |
| Physical NICs | Wi-Fi Up only. No present Ethernet / USB Ethernet. A disconnected Bluetooth PAN is not a client NIC. |
| Foreign network | `SharedAccess` Running; `PXE-Lab-NAT` `192.168.77.0/24`; `OSDCloud-PhysicalClient-NAT` `192.168.88.0/24`. LaptopNat is Blocked. Do not auto-repair ICS/NAT. |
| Last matrix | `acceptance-mode-all-network-20260917y`: `status=Failed`, `cleanup=Failed`. Keep that evidence root. |

Treat `config\osdcloud-console.json` in State as a last-synced snapshot, not guaranteed production truth.

### Layer freeze

| Layer | Status | Rule |
| --- | --- | --- |
| Source / UI | Last recorded Passed (9/14 plus later Lab-era tests; 9/17 source run 500 tests / 497 passed / 3 skipped) | Optional re-verify only if the operator asks (plan B) |
| AutoLab firmware Mode All | Historical green: `mode-all-20260913e` (seven deployments, cleanup Passed) | Do not discard this evidence; do not rerun to “make NetworkAcceptance count” |
| Router Ready | Present (`20260917x`); nested guest NAT is lab-only | Do not rebuild unless the operator later authorizes plan D |
| AutoLab NetworkAcceptance | **Paused / Failed** (`20260917y`) | Not a product ship gate. A later green still would not prove physical or human acceptance. |
| Physical / human | NotRun / Blocked | Actual remaining product work; ExistingDhcp is first if the operator picks plan C |

### Product fixes to keep vs lab-only harness

Keep as product (physical PXE can hit these):

- `0e4d55d` Base64URL boot nonce may start with `-` or `_` (`safeClientValue`)
- `fabdfee` / `745dcb4` OOBE `Test-Path` grouping and WinPE metadata-after-apply
- `14e0f82` / `1a9fb85` published Apps / `selected-profile.json` copy order; missing Winlogon `reg.exe` must not Stop
- `9dcc164` cleanup waits for Console idle and uses `Get-ConsoleTimeoutSec`
- Onboarding wizard, pairing, site/DHCP/NAT guards (`084a1f0` and follow-ups)

Lab-only unless a physical failure reproduces them:

- Router nested Hyper-V / WinNAT / `Wait-Job` / deployed-disk boot source / TPM `SecureBootTemplate` rewrite (`42cd4d0`, `bf9db48`, `04a1177`, and the 9/15–9/17 router ladder)
- AutoLab static MAC rebind after checkpoint (`5b183b2`) is lab firmware, not a laptop BIOS setting

### Physical ExistingDhcp checklist (plan C, not started)

Do not run `-Execute` or start DHCP from this freeze. `ValidateOnly` stays blocked until the operator supplies site facts.

Required before ExistingDhcp `ValidateOnly`:

1. A present, connected Ethernet or USB Ethernet on the **existing client LAN** (this host currently has Wi-Fi only).
2. Ignored `config\acceptance.local.json` copied from `config\acceptance.example.json`, with host service interface/IP, client MAC, SMBIOS UUID, expected subnet/gateway/DHCP/DNS.
3. `client.disposableConfirmed=true` for a machine that may be wiped. No disk rollback is promised.
4. Web-selected live endpoint switched **off** AutoLab `192.168.177.1` onto that physical interface. Re-read `bootMode` and `bootFile` after sync; do not boot while they disagree.
5. Existing LAN DHCP stays up (PXE Proxy). Do not start Winception DHCP Server on that segment.
6. Console running; Preflight green; deployment services stopped until the operator starts them.
7. AutoLab VMs remain Off. Do not use VM evidence as physical evidence.

Expected Blocked cases (operator decides; agent does not repair):

- Missing Ethernet / missing `acceptance.local.json` / disposable not confirmed
- Foreign ICS (`SharedAccess`) or leftover `PXE-Lab-NAT` / `OSDCloud-PhysicalClient-NAT` if the physical entry treats them as conflicts
- LaptopNat: needs two distinct physical NICs and no foreign ICS/NAT; out of scope until the operator handles those objects

WinceptionDhcp needs a separate confirmed DHCP-free window. Human usability needs an unfamiliar-PXE operator and is independent of agent browser checks.

### Optional later tracks (operator must name one)

- **B** — Source/UI re-verify in the clone only (`npm run acceptance:source` / `acceptance:ui`). No `C:\OSDCloud` writes.
- **C** — ExistingDhcp `ValidateOnly`, then explicit `-Execute -ConfirmDisposableClient <MAC>` after the checklist is true.
- **D** — One unattended `-Mode All -NetworkAcceptance` on a **new** evidence root, fail-closed, no agent-watched retry. Not a substitute for C.

### Historical 2026-09-17 matrix (do not continue)

HEAD at that handoff was `04a1177`; docs commit `e27192f` followed. PID 4160 was already gone. Router Ready existed. `acceptance-mode-all-network-20260917y` failed: WinPE `POST /osdcloud/boot-session 403 rejected=nonce is invalid` on `winception-autolab-03` / `192.168.177.202` because a valid Base64URL nonce began with `-` or `_`. Cleanup then failed restoring Router Ready (Hyper-V refuses rewriting `SecureBootTemplate` after TPM key-protector init). Source fixes `0e4d55d` and `04a1177` are committed and present in the installed App hashes. The matrix was **not** rerun.

Evidence to keep:

- Router bootstrap success: `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260917x`
- Router cleanup proof: `.ai/acceptance-router-ready-cleanup-proof-20260917y.json`
- Failed matrix: `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-mode-all-network-20260917y` and `.ai/acceptance-mode-all-network-20260917y-runner.log`
- VM03 screenshot: `.ai/vm03-thumb.bmp` (ignored evidence only)

---
# Agent handoff — 2026-09-16 21:49

## Active task — old Router runner is stuck; source fix committed, cleanup and rerun required

Current HEAD is `bf9db48` on `codex/easier-onboarding`; `.ai/` remains untracked. Bootstrap `acceptance-router-bootstrap-20260916s` reached Fleet `windows-desktop-ready`, PowerShell Direct, enabled nested Hyper-V, configured active WinNAT `192.168.177.0/24`, and assigned LAN `192.168.177.254/24`. The old installed runner then hung inside Windows PowerShell 5.1 `Wait-Job` after the remote configuration had completed. PID **4160** is still alive and holds the Lab lock; do not start another Lab run. Router Ready is absent and the full network matrix has not run.

`a4ec225` adds VM-configuration settling before Router checkpoint cleanup and preserves NAT errors. `bf9db48` replaces `Wait-Job -Timeout` with explicit parent/child state polling so a `Blocked` remote job fails closed and reaches finally. Parser and `acceptancePowerShell.test.js` pass **23/23**. The installed App still has `a4ec225`; reload `bf9db48` only after the stuck runner is gone and cleanup is verified.

### Immediate continuation

1. Do not kill PID 4160 without explicit authorization: earlier automatic review rejected forced termination. Safe interruption attempts (guest VM stop, Ctrl+C, Ctrl+Break, console input and host attach) did not release `Wait-Job`.
2. Once PID 4160 is gone, perform scoped cleanup before any reload or run: Router Off; remove owned WAN; restore `Winception-Clean`; restore Router processor to 1 vCPU/nested Off; restore profile `IZVZO7PU`; delete test profile `2FOKHT8K`; verify services stopped, endpoint AutoLab `.1/24`, six VMs Off and mutex free.
3. Reload HostTools from source `bf9db48` through `tools/Reload-Console.ps1`, then verify source/installed `tools/lib/LabRouter.ps1` hashes match.
4. Run elevated `Initialize-WinceptionLab.ps1 -ValidateOnly` with a new evidence root (next suggested `acceptance-router-bootstrap-20260916t`), then exactly one actively monitored `-BootstrapRouter`. Do not reuse `20260916s`, use `-Create`, or auto-retry.
5. Require `windows-desktop-ready`, PowerShell Direct, 2 vCPU/nested On, Hyper-V/`MSFT_NetNat`, active WinNAT, LAN `.254`, Default Switch WAN, test DHCP, `Winception-Router-Ready`, original profile/endpoint restoration and `cleanup=Passed`.
6. Only after Router Ready: elevated `-ValidateOnly -RequireRouter`, then a separate new root for `-Mode All -NetworkAcceptance`. No master push, Release/package, or physical/human claim.

### Latest evidence and fixes

- `acceptance-router-bootstrap-20260916s`: **incomplete/stuck**, no `result.json`. Deployment passed Fleet `windows-desktop-ready` and PowerShell Direct. Read-only guest diagnosis at 21:36 recorded active `WinceptionLabRouterNAT`, LAN `.254/24` and WAN DHCP. The old runner remained in `Wait-Job`; owned Router was stopped to unblock the guest session, but host wait remained stuck. Current live state at 21:49: PID 4160 alive; services stopped; active test profile `2FOKHT8K`; Router Off with LAN+WAN, 2 vCPU/nested On, dirty differencing disk, only `Winception-Clean`; monitor PID 14612 stopped. Evidence root: `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260916s`.
- `a4ec225`: waits for stable Router VM configuration before checkpoint restoration and writes explicit NAT-error evidence. Manual recovery of `20260916r` proved a settled `Winception-Clean` restore succeeds.
- `bf9db48`: removes the unreliable `Wait-Job` call and polls job/child states with a hard deadline; a Blocked job now reports its non-interactive reason and enters finally. Source parser and 23 focused tests pass. This commit is not installed or live-proven yet.
- `20260916r`: reached desktop-ready and active guest networking, then `Wait-Job` reported blocked interaction and cleanup failed after a transient VMMS restore error. Manual checkpoint restore succeeded after settling; original profile and services were restored before `20260916s`.

- `acceptance-router-bootstrap-20260916l`: `Failed`, `cleanup=Failed`. The original test profile publish no longer timed out, but status evidence was collected from the wrong path and cleanup profile restore raced Console activity. `706949c` waits for idle before profile restore and captures `PXE-HttpRoot\\status`; manual cleanup restored `IZVZO7PU` and deleted the test profile.
- `acceptance-router-bootstrap-20260916m`: `Failed`, `cleanup=Passed`. Evidence now retains `runtime\\PXE-HttpRoot\\status\\...latest.json`, which proves the real `windows-metadata-error` rather than a detector false positive. The profile, endpoint, services and all six VMs were restored.
- `706949c` is the evidence/cleanup repair. `745dcb4` is the current WinPE metadata-order repair. `2a7218c` remains installed in HostTools for torrent reuse; no HostTools reload is required for the two newer clone-runner/WinPE template changes because endpoint sync publishes the source template during the next Lab run.
- `acceptance-router-bootstrap-20260916n`: `Failed`, `cleanup=Failed`; status evidence proves `PS>TerminatingError(Test-Path): A parameter cannot be found that matches parameter name 'and'.` from OOBE customization after Windows image application. `fabdfee` fixes that condition and mirrors it into WinPE. Host was manually restored: `IZVZO7PU`, no test profile, services stopped, six VMs Off.

## Historical continuation — Router guest setup must switch from PXE to deployed disk; network matrix blocked

### Git / workspace

- Branch `codex/easier-onboarding`. `42cd4d0` is the latest restorable source commit; it switches only the owned Router to the deployed hard disk before guest setup. `1ba36eb` was used by `20260915g` and adds guarded nested Hyper-V/WinNAT prerequisites. The boot-source correction has 30 focused Router/Lab tests and full Source acceptance pass, but no live proof. Keep `.ai/` untracked.
- Local `master` `bdbe5ce` is one commit ahead of `origin/master` `847b79f`. Preserve it. Do not push master.
- Baseline: `codex/baseline-acceptance-20260914` / onboarding baseline `bdbe5ce`. Lab orchestrator runs from the **clone**, not HostTools App.

### Live host (re-read immediately before any Lab)

Verified after `20260915g` cleanup at 2026-09-15 20:13 +08. Elevated `Initialize-WinceptionLab.ps1 -ValidateOnly` passed. Mutex **free**. Console is idle. Profile **IZVZO7PU**. All four deployment services stopped. `bootMode=secureboot`. Endpoint `192.168.177.1/24` Server `.200–.250`.
- Six VMs Off. Resting firmware: `01..04` SB On + TPM On; iPXE SB Off + TPM Off; router SB On + TPM On.
- Checkpoints: **Winception-Clean only**. `Winception-Router-Ready` is still missing. `ValidateOnly -RequireRouter` will fail until bootstrap creates it.
- Installed App last reload **`14e0f82`** (backup `HostTools-State-20260915-020746-801`). That load has the OOBE Apps/`selected-profile.json` fix in `boot.wim`. Current Router changes are Lab-script only (`tools/lib/LabRouter.ps1`); do not reload HostTools for them.
- `C:\OSDCloud\logs\host-services.log` last write 2026-09-14 23:26. DHCP/TFTP lines from later runs are missing. Do not treat an empty log as proof PXE never ran.

### Exact next steps

1. Do not run `-RequireRouter` or the network matrix: `Winception-Router-Ready` is absent. Preserve `acceptance-router-bootstrap-20260915g` as failed evidence (`status=Failed`, `cleanup=Passed`).
2. The deployed-disk boot-source correction is committed at `42cd4d0`; preserve `.ai/` untracked.
3. A future explicitly authorized bootstrap must use a new evidence root. It must first prove the owned Router booted the deployed disk, then prove guest feature Enabled, `MSFT_NetNat`, LAN `.254`, WAN Default Switch, WinNAT/DHCP, Router Ready, and cleanup. Zero automatic retry.
4. After Router Ready exists: elevated `Initialize-WinceptionLab.ps1 -ValidateOnly -RequireRouter`, then a new unique evidence root for `-Mode All -NetworkAcceptance` (original seven firmware deployments + Proxy/Server two + rejection; zero retries). Physical/human stay NotRun/Blocked.

### Paid-for pitfalls (do not regress)

- Cleanup `POST /api/endpoint` must use `Get-ConsoleTimeoutSec` and `Wait-ConsoleIdle` before boot-mode/status (`9dcc164`). The 20260914 23:05/`00:11` `cleanup=Failed` was a 30s vs ~81s `boot.wim` remount race; live host was restored.
- After checkpoint restore, assign collision-checked static MAC then **re-apply Network FirstBootDevice** even if Network is already first (`5b183b2`). Otherwise firmware path stays `MAC(000000000000)` and PXE can miss WinPE (20260915b).
- WinPE `Invoke-OobeCustomization.ps1`: copy Apps **before** `Get-TestAutoLogonCount`; missing Winlogon `reg.exe delete` must not terminate under Stop (`1a9fb85`). Prefer an Apps tree that contains **`selected-profile.json`** over `X:\OSDCloud\Apps` (`14e0f82`). 20260915a died on `reg.exe`; 20260915c applied Windows then sat at logon for an hour.
- Router guest NAT: `34ede0c` proved that ignoring `Get-NetNat Invalid class` is insufficient. `20260915g` proved guest setup cannot start with the deployment round's Network-first firmware; it must switch only the owned Router to its deployed disk before PowerShell Direct. Future runs must record the controlled boot source, restart and NAT diagnostics before cleanup. Do not alter any foreign VM or host networking.
- Lab mutex `Global\Winception-AutoLab`. Do not start a second Lab while it is held. Do not kill elevated runners to make a gate pass. Grok/Codex shells are usually unelevated; Hyper-V TPM / `npm run reload` / ValidateOnly need `Start-Process -Verb RunAs`. Do not use a 10-minute wrapper timeout around `Start-Process -Wait` (it can kill the job object).
- `.ai/` helpers and evidence configs stay untracked. Secrets stay out of Git.

### BootstrapRouter ladder (evidence under `C:\OSDCloud\HostTools\State\lab\evidence\`)

| Run | HEAD in play | Outcome | Why |
| --- | --- | --- | --- |
| 20260914 night | loaded `dae06b2` | PXE 403 stale MAC `00155D6C6580`; cleanup recorded Failed (30s race) | MAC/cancel-wait not in loaded App; cleanup timeout |
| 20260915a | `9dcc164` cleanup wait | WinPE+DISM; `reg.exe` Stop; **cleanup Passed** | Auto-logon delete of missing Winlogon values |
| 20260915b | `1a9fb85` in wim | Fleet 0 for 60 min | PXE never reached WinPE; firmware MAC zeros |
| 20260915c | `5b183b2` clone | PXE+apply; awaiting-logon; Fleet timeout | Copied `X:\OSDCloud\Apps` without `selected-profile.json` |
| 20260915d | `14e0f82` wim | **desktop-ready** 344s; guest NAT `Invalid class`; cleanup Passed | Get-NetNat under Stop. Run `20260915-101359`. Profile `X4FO83YV`. |
| 20260915e | `6937f23` worktree / `34ede0c` NAT code | **desktop-ready**; guest `New-NetNat Invalid class`; **cleanup Passed** | Run `20260915-115114`; profile `HDTYAZI0`; Router Ready absent. |
| 20260915f | `efa9052` | **desktop-ready**; nested On; guest Hyper-V restart left VM Off; **cleanup Passed** | Run `20260915-161816`; PowerShell Direct restart timeout; Router Ready absent. |
| 20260915g | `1ba36eb` | **desktop-ready**; guest setup re-entered PXE; **cleanup Passed** | Run `20260915-193921`; PowerShell Direct timeout before feature/CIM setup; Router Ready absent. |

Current evidence: `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260915g`. The result is `Failed`, `cleanup=Passed`; it failed before the feature/CIM probe and NAT configuration. Do not reuse this evidence root.

## Previous completed milestone — One laptop, anywhere onboarding

User-approved onboarding implementation uses `codex/easier-onboarding`. Restorable source baseline is `bdbe5ceac22032edcf8c04b6532fe3c9785c9db2` on `codex/baseline-onboarding-20260914`; master and its existing unpushed handoff commit are preserved. `.ai/` stays untracked. Changes belong in Unreleased, with no Release/package/tag or master push.

Source implements three scenes (existing DHCP Proxy + pairing, shared LAN Winception DHCP, laptop NAT), Chinese step-by-step onboarding, bounded Console-authenticated boot approval, network inventory/overlap/drift guards and bilingual diagrams/manuals. Source verification and commit precede preview/installed/runtime checks. Physical three-scene acceptance and an unfamiliar-PXE human usability run remain independent requirements; do not infer them from source or historical AutoLab evidence.

Final daily-stop regression includes WinPE, awaiting Windows login and post-logon Windows installation in the active count. Services cannot be stopped from guided Home during those phases. Focused beginner/UI tests passed 22/22, `check` passed, and isolated UI displayed one active client with the stop button disabled in both Windows phases. Installed App source is `4b9fb36`; fresh Preflight passed 29 checks without warnings, with services stopped and no active host operation or client.

Source implementation and isolated browser checks are complete. `check`, full tests (462 passed / 3 skipped), smoke and changed PowerShell parser checks passed; focused UI tests/check passed after preview fixes. Preview verified pairing approve/reject, host/client progress separation, site/Preflight repair, restored steps, manual links, bilingual SVGs and 390/1024/1366/1920 px. The raw preview and helpers stay in ignored/untracked workspace files; annotated screenshots are embedded in product SVGs.

Installed App was updated through the elevated State-backup reload flow in an idle window. Initial State backup is `C:\OSDCloud\HostTools\Backups\HostTools-State-20260914-081434-402`. Existing Endpoint Sync retained AutoLab `192.168.177.1/24`, Server `.200–.250`, router `.1`, DNS `1.1.1.1,8.8.8.8`, SMB `OSDCloudiPXE`, cached 25H2 image, profile `IZVZO7PU` and secureboot. WinPE marker schema 2 matches the new source template and contains no preloaded secrets. Preflight passed 29 checks with no warnings; deployment services remain stopped. See TEST-RESULT.md for current evidence and the final App source/backup refresh.

Next acceptance requires a disposable physical client, available Ethernet/USB Ethernet client NIC, suitable LAN/DHCP test window and an unfamiliar-PXE operator. Current host has Wi-Fi but no present Ethernet NIC; foreign ICS and two other NATs were retained. Do not repair them automatically or infer physical networking/Internet readiness from AutoLab. Re-read live state before any action. Never patch runtime manually or treat a source commit as State/network rollback.

## Historical continuation — physical PXE after Mode All green

Mode All e (source `71fee78`) is green on Internal AutoLab `192.168.177.1`. Four rounds / seven deployments reached `windows-desktop-ready` with profile `IZVZO7PU`, `windowsFamily=Windows 11` build `26200` / `25H2`, matching guest Secure Boot/TPM pairs, separate round `hostFirmware`, and successful cleanup. Registry `productName` stayed `Windows 10 Pro` and is accepted by build. Evidence: `C:\OSDCloud\HostTools\State\lab\evidence\mode-all-20260913e`. Five VMs are Off with resting firmware (`01..04` SB On + TPM On; iPXE SB Off + TPM Off). Deployment services are stopped; host `bootMode=secureboot`. ICS/Default Switch was not touched. This is not physical-laptop or production DHCP evidence.

`origin/master` is at `847b79f` (diagrams/docs: host PXE chain stays separate from client Secure Boot / TPM). The Mode All repair commits are on origin. Another push to master may start `.github/workflows/lab-deploy.yml`. Next product work is physical UEFI IPv4 PXE on the Web-selected live endpoint after confirming LAN DHCP is disabled for the test window. Re-read `http://127.0.0.1:8080/api/state` and Hyper-V firmware before any PXE or service action.

Historical summary: `origin/master` was `847b79f`; local master also has unpushed `bdbe5ce`. Mode All e is historical AutoLab green. Current work proceeds on the onboarding branch; physical acceptance remains pending.

## Workspace

| Item | Value |
| --- | --- |
| Clone (edit here) | `C:\winception` |
| Installed Web console | `C:\OSDCloud\HostTools\App` — live `:8080` |
| Host-only state | `C:\OSDCloud\HostTools\State` |
| Runtime | `C:\OSDCloud` (never patch by hand) |
| Branch | Active `codex/easier-onboarding`; master retains `bdbe5ce` ahead of origin/master by one; preserve untracked `.ai/` |
| Product version | `1.1.0` tagged on origin; AutoLab firmware work is on master and still unreleased as a product tag |

Recent origin commits, newest first:

```text
847b79f docs: keep host PXE chain separate from client firmware in diagrams
a88ca4a docs: record AutoLab Mode All e four-round green
71fee78 fix: guard Lab firmware BootType reads and require Windows 11 by build
0c96975 docs: hand off Mode All cleanup failure
b04c6e8 fix: bound client progress lock retries and reject incomplete finalization
```

A later push to master may start `.github/workflows/lab-deploy.yml` on a `self-hosted, windows, hyperv, winception-lab` runner.

## What is done

### Web console (local, HostTools may already have it)

- Persistent 引導 / 控制台 toggle (`localStorage.winception-operator-mode`). Not a third workspace.
- `npm run reload` must be **elevated** (secrets ACL) and must `npm install` in App after `-Force` replace.

### AutoLab firmware matrix

Three independent axes. Do not collapse them into one boot mode.

1. **Host PXE chain** — `dhcp.bootMode` via `POST /api/boot-mode`: `secureboot` (`bootmgfw.efi`) or `ipxe` (`snponly.efi`).
2. **Client Secure Boot** — Hyper-V firmware. iPXE **requires** Off. Signed chain works with On (and historically Off into WinPE).
3. **Client TPM** — Hyper-V `Enable-VMTPM` / `Disable-VMTPM`. Simulates a laptop with or without a TPM chip on the **same** Gen2 VM. Do not invent extra VMs for TPM On/Off. Do not add TPM to `/api/boot-mode` (the host cannot set a physical laptop's TPM).

`Winception-Clean` does not keep Hyper-V TPM. Restore must apply `-SecureBoot` and `-Tpm` independently (`Set-VmFirmwareMode` / `Set-LabVmTpmEnabled`). Dummy key protector after restore is a 4-byte blob; treat length `< 32` as missing and `Set-VMKeyProtector -NewLocalKeyProtector` before `Enable-VMTPM`. Do not read `KpsAvailable` under StrictMode.

Lab `Mode All` = four SB+TPM On VMs in one batch, then iPXE SB Off+TPM Off, then corners:

| Round | VM | Host mode | Client SB | Client TPM | Live green |
| --- | --- | --- | --- | --- | --- |
| Default fleet | `winception-autolab-01..04` | `secureboot` | On | On | 2026-09-14 Mode All e four-wide |
| iPXE | `winception-autolab-ipxe-01` | `ipxe` | Off | Off | 2026-09-14 Mode All e |
| Corner | `winception-autolab-01` | `secureboot` | On | Off | 2026-09-14 Mode All e |
| Corner | `winception-autolab-ipxe-01` | `ipxe` | Off | On | 2026-09-14 Mode All e |

Guest asserts follow the **round's expected pair**, not “secureboot round ⇒ TPM required”.

Evidence: `TEST-RESULT.md` (2026-09-14 Mode All e). Lab JSON: `C:\OSDCloud\HostTools\State\lab\evidence\mode-all-20260913e\`.

### Lab host isolation (fixed 2026-09-13, `7e11247`)

- Secrets: HostTools State `config\osdcloud-secrets.json` or env (`OSDCLOUD_PXEINSTALL_PASSWORD`, …). **Never** the Git clone `config\osdcloud-secrets.json`.
- Endpoint sync writes State `osdcloud-console.json`, **not** the clone file.
- Lab `appRoot` is `C:\OSDCloud\HostTools\App` (installed console). Initialize/Restore still run from the **clone** with `-StateRoot`.
- Cache hashes **only** `cache.requiredPaths` (base VHDX, `wimboot`, `snponly.efi`). Ignore leftover `boot.wim`/`boot.ipxe` records in an old manifest.

## Pitfalls already paid for

- **Secure Boot PXE fail** was live `bootMode=ipxe` plus VM template `MicrosoftUEFICertificateAuthority`. Need `secureboot` + template `MicrosoftWindows`.
- **WinPE `selected-os.json` / `Test-Path` null** was often **SMB System error 86** (wrong `pxeinstall` password) after clone-run restore set the local account from the wrong secrets file. Fleet stayed `running`; Lab used to wait the full 60 minutes.
- **Fail-closed now:** `Wait-FleetCompletion` reads `C:\OSDCloud\PXE-HttpRoot\status\latest.json` every 5s and throws on terminal WinPE text (`selected-os.json`, `SMB map to Z:`, `System error 86`, `TerminatingError(`).
- **Do not wait on Fleet `running`.** If the VM console or `latest.json` logTail shows a throw, stop and diagnose.
- Hyper-V Default Switch ICS `172.25.144.1:67` is **not** Lab occupancy. Do not kill it.
- Historical `winception-client-01..04` are vSwitch regression VMs. AutoLab names are `winception-autolab-01..04` and `winception-autolab-ipxe-01` only.
- OSDCloud applies a WIM in WinPE. No `BypassTPMCheck` in this repo. TPM-off already reached desktop-ready; do not add registry bypasses unless a future image dies in Setup.

## Live host snapshot (re-verify before acting)

After Mode All e cleanup on 2026-09-14 ~00:15 +08:

- VMs Off. Resting firmware: `01..04` Secure Boot On + TPM On; iPXE Secure Boot Off + TPM Off.
- Lab DHCP/TFTP/HTTP/Torrent on `192.168.177.1` were stopped. ICS on Default Switch was left running.
- Host `bootMode` restored to **`secureboot`**. Still re-read live Web/API config before acting.
- Grok/agent shells are often **unelevated**. Hyper-V TPM, secrets ACL, and HostTools reload need `Start-Process -Verb RunAs`. Never print secret values.

## Open work (priority)

1. **Physical UEFI IPv4 PXE** on the Web-selected live endpoint. VM green is not physical evidence. Confirm LAN DHCP is disabled for the test window before starting DHCP.
2. Optional later: signed `bootmgfw.efi` + client Secure Boot **Off** to desktop-ready (WinPE-only evidence exists from 2026-06-12).

## How to run Lab

Config: `config\lab-regression.example.json` (or ignored `config\lab-regression.json`).

```powershell
# elevated
tools\Invoke-WinceptionLabRegression.ps1 -ConfigPath C:\winception\config\lab-regression.example.json -Mode FirmwareCorners
tools\Invoke-WinceptionLabRegression.ps1 -ConfigPath C:\winception\config\lab-regression.example.json -Mode All
```

Watch `C:\OSDCloud\PXE-HttpRoot\status\latest.json` and TFTP/DHCP logs, not just the wrapper stdout.

## Files to open first

| Area | Path |
| --- | --- |
| Lab orchestrator | `tools/Invoke-WinceptionLabRegression.ps1` |
| Lab VM create | `tools/Initialize-WinceptionLab.ps1` |
| Secrets / SMB / endpoint | `tools/Initialize-DeploymentServer.ps1`, `tools/Restore-DeploymentArtifacts.ps1`, `tools/Set-OsdCloudIpxeEndpoint.ps1` |
| WinPE selected-os / SMB Z: | `osdcloud-assets/OSDCloud/WinPE/OSDCloud/Start-OSDCloud-iPXE.ps1` |
| Lab contracts | `tools/osdcloud-console/test/labAutomation.test.js` |
| Evidence | `TEST-RESULT.md` |
| Always-on rules | `AGENTS.md` |
| Paths / validation | `docs/agent-reference/deployment-paths.md`, `docs/agent-reference/validation-scenarios.md` |

## Safety (do not skip)

- Clone is not a PXE runtime. Do not copy into or edit `C:\OSDCloud` by hand.
- Do not commit `osdcloud-secrets.json`, WIMs, logs, screenshots, or `.ai/`.
- Do not start DHCP until the real LAN DHCP server is confirmed disabled for the test window. AutoLab Internal `192.168.177.1` is the only network used for the 2026-09-13 VM work.
- Web mutating APIs change live deployment state. Read-only checks must not.
- Never use AutoLab success as proof that production DHCP or a physical laptop is ready.
