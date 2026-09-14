# Agent handoff — 2026-09-14 23:38

## Active task — cleanup, corrected router bootstrap, expanded AutoLab

User approved waiting for old runner natural timeout/cleanup, then latest installed update and one corrected bootstrap, then the full matrix. No automatic retry, master push, Release or deployment package. Physical and human acceptance remain independent. Update this brief before quota is exhausted. Latest usage five-hour86% used (14% remaining), weekly76% used. Pausing for quota handoff per user requirement; no active installation or services.

### Source / installed evidence

- Branch codex/easier-onboarding; baseline codex/baseline-acceptance-20260914 at f092edc91136e5cef118338743705378f1b7a4ec; original bdbe5ce/master and unpushed work preserved. Acceptance implementation dae06b2, fixes5605cf1/7d089f7/694f01e/5f9355d/fc48f36 committed. Only .ai remains untracked.
- Latest Source gate Passed: check,483 tests/480 passed/3 skipped,smoke; .ai/acceptance-source-network-review.log and test-results/acceptance-source JSON/HTML. Focused27/27 .ai/acceptance-network-review-tests.log. UI9/9 local Chrome, cleanupPassed, test-results/acceptance-ui-report JSON/HTML; Chromium CDN unavailable, do not retry unchanged download.
- Latest source uses localized NIC object plus guarded ResumeCreate, Resolve-Path config, initialized Console URI before idle guard, fixed collision-checked owned VM MAC after checkpoint restore shared by positive/negative rounds, service-stop aborts Fleet wait, port-qualified Proxy denial evidence, retained router-bootstrap round in aggregate report. These edits do NOT change the old loaded runner.
- Installed App last reload from dae06b2: HTTP hash matched; State backup HostTools-State-20260914-145854-135. Endpoint Sync/29 Preflight checks passed. WinPE published SHA256 EFE3AFE948B177BC8624A4EA7B8E20D66015F3F021DF2FA1ECA3BB0AC8BF7CE4, schema2, ephemeral-boot-session/no embedded secrets. Must refresh latest installed only AFTER old cleanup passes and host idle.

### Active failed runner — do not start another deployment

- Elevated PID16072 remains active (verified elevated .ai/acceptance-bootstrap-snapshot.json at23:38). Ordinary Get-Process/CIM cannot see this elevated process. Six owned VMs Off. Services0/Fleet0/operationfalse at23:38; active test profile SE50433G proves cleanup still Pending.
- Bootstrap began23:06, PXE23:10: routerMAC00155D6C6580 obtained192.168.177.200; POST boot-session403 outside acceptance scope due stale pre-restore dynamic MAC. No envelope, Fleet run or installation. Services stopped via API23:11; owned router stopped Off23:12 (.ai/acceptance-router-stopped.json). Old runner waits its 60-minute Fleet deadline around9/15 00:10 then finally cleanup/sync. Keep monitoring in <=60-second waits. Do not launch another Lab or installed reload while mutex is held.
- Approval review rejected forced process termination command with no detailed reason; do not bypass. User now explicitly chose natural timeout/cleanup. The rejected cleanup helper did not execute/create its file. Only router-stop helper ran. No further termination confirmation needed when following natural timeout.
- Evidence: C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260914; .ai/acceptance-router-bootstrap.log/process.json. Existing result.json and process.json are STALE23:05 URI guard Blocked; do not treat them as current run evidence. Current runner files show later activity. Current State backup HostTools-State-20260914-150620-016.
- Original state is state-after-start.json DIRECT state object, not .state. OriginalprofileIZVZO7PU; testprofileSE50433G. Restore original profile/remove test profile, endpoint177.1 Server200-250/gateway1/DNS1.1.1.1,8.8.8.8, secureboot host default, Clear Fleet, router Clean+SB/TPM and all five Clean/default firmware. Require fresh endpoint Preflight and stopped services. Cleanup failures => stop and diagnose, no next round.

### Quota pause — exact continuation

At23:38 elevated snapshot confirms PID16072 still active and all six VMs Off. Public API operationfalse/services0/Fleet0/profileSE50433G. The AI is no longer actively monitoring after this handoff; old runner only waits its natural timeout and finally cleanup. No forced termination/new deployment/installed mutation was attempted this turn. Corrected bootstrap and full matrix are NOT run. Next AI must first inspect new result timestamps and elevated process/VM state, never assume timeout cleanup passed. Latest Source report is commitfc48f36f1ef84da6ca611fc272a1e1112811dd1f/hashE2538248CCAF1D7EFB8512A210CD8562DA083DB3AE58D807877278D380DD1E49; subsequent changes are evidence/docs only.

### Exact next steps after natural timeout

1. Confirm fresh failed-run result JSON/HTML, cleanupPassed and elevated runner absent. Verify six VMs/checkpoints/firmware, restored profile and endpoint; no automatic retry. If cleanup fails stop, preserve diagnostic/handoff.
2. Reuse elevated .ai/onboarding-installed-update.ps1 for guarded latest npm reload/protected State backup; no direct runtime copy/patch. Refresh live adapter/State overlay/boot.ipxe/image/profile, then Endpoint Sync/Preflight and Initialize-WinceptionLab -ValidateOnly.
3. Router already exists, owned Gen2 fixed4GiB/LAN/SB+TPM/Clean. Do not Create again. Use NEW unique ignored config/evidence root and corrected Invoke-WinceptionLabRegression -BootstrapRouter once. Require Fleet desktop-ready+PSDirect and router guest LAN254/24, WAN DefaultSwitch, independent DHCP tools/NAT plus Ready checkpoint and cleanup.
4. Initialize-WinceptionLab -ValidateOnly -RequireRouter, then ModeAll -NetworkAcceptance with unique evidence root: original7 positives + Proxy/Server2 + rejection; zero retries, exact DHCP/IP/subnet/gateway/DNS, Fleet+PSDirect, DNS/validHTTPS before/after service stop and cleanup required. Known Lab mutex only; no foreign DHCP/ICS/NAT repairs.
5. Update JSON/HTML, TEST-RESULT, manuals if behavior changes, handoff/.ai and scoped commits. Physical/human remainNotRun/Blocked: no present Ethernet/USB Ethernet NIC/site/disposable client window. Foreign host ICS and NAT77/88 retained. No formal Release/package/master push.

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
