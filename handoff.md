# Agent handoff — 2026-09-15 10:40

## Active task — 20260915d desktop-ready then guest NAT Invalid class; cleanup Passed

User-approved reload of `1a9fb85` + Endpoint Sync + one `-BootstrapRouter` finished. PXE/WinPE never posted status. Cleanup **Passed**. Do not Create the router. Zero retries. No master push, Release or package. Physical/human remain independent.

One corrected `-BootstrapRouter` ran after the cleanup timeout fix. PXE/boot-session/MAC 403 did **not** recur. WinPE, SMB, torrent 100%, and DISM apply started. Fleet then failed in shutdown `Invoke-OobeCustomization.ps1`: `reg.exe delete` of missing Winlogon values under `$ErrorActionPreference = 'Stop'`. Lab cleanup **Passed**. No automatic retry. Do not Create the router. No master push, Release or package. Physical/human remain independent.

User approved the cleanup timeout fix, then continuation. Source now waits out a long endpoint restore instead of marking cleanup Failed at 30 seconds. No automatic retry, master push, Release or deployment package. Physical and human acceptance remain independent.

### Source fix

- `Invoke-LabCleanup` profile and endpoint restore pass `Get-ConsoleTimeoutSec` (preflight minutes, at least 60s).
- New `Wait-ConsoleIdle` polls `/api/state` operation.running after those restores. Boot-mode and status cleanup run only after the console is idle, so a `boot.wim` remount cannot race them.
- Contract tests: `labAutomation.test.js` (17) and `acceptancePowerShell.test.js` (11) Passed, including the new cleanup timeout/idle-wait case. Windows PowerShell parser accepted `Invoke-WinceptionLabRegression.ps1`.
- Docs: CHANGELOG Unreleased, AGENTS.md, `docs/agent-reference/validation-scenarios.md`, `docs/agent-reference/deployment-paths.md`.

### Live host after reload

- Installed App reloaded from **`9dcc164`**. State backup `HostTools-State-20260914-171845-710` (UTC name; LastWriteTime 2026-09-15 01:18 +08).
- Endpoint Sync + Preflight **29/29** passed. Profile **IZVZO7PU**; endpoint `192.168.177.1/24` Server `.200–.250` gateway `.1` DNS `1.1.1.1,8.8.8.8`; `bootMode=secureboot`; services stopped; Fleet 0.
- `Initialize-WinceptionLab -ValidateOnly` passed: five client VMs Off with resting firmware and Winception-Clean.
- `Initialize-WinceptionLab -ValidateOnly -RequireRouter` failed: **Router ready checkpoint is missing.** Expected before the first successful bootstrap. Do **not** Create. Router VM already exists (Clean + SB/TPM).
- Elevated `Invoke-WinceptionLabRegression.ps1 -BootstrapRouter` started with ignored config `.ai/acceptance-router-bootstrap-20260915-config.json` and evidence `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260915a`.

### BootstrapRouter 20260915a result

- Evidence: `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260915a`. `ok=false`, `status=Failed`, **`cleanup=Passed`**. Mutex free. Profile IZVZO7PU. Services stopped. Six VMs Off, resting firmware, still only Winception-Clean (no Ready).
- Run `20260915-013215-3833-6458-5439-4386-0617-9856-93`. Client `192.168.177.200`. Diagnostics `C:\OSDCloud\HostTools\State\diagnostics\2026-09-14-173800Z-run-failed-fail.zip`.
- `osdcloud-error`: `ERROR: The system was unable to find the specified registry key or value.` Native `TerminatingError(reg.exe)` during `[1] Shutdown Scripts` / `Invoke-OobeCustomization.ps1`. Screenshot shows Apps copy and zh-TW OOBE fallback; it does **not** show the TEST ONLY auto-logon warning.
- Cause: `Get-TestAutoLogonCount` ran before published Apps were copied onto the Windows volume, so count was 0; the else-path `reg.exe delete` of absent Winlogon values is fatal under Stop. Mode All e never hit this easier-onboarding path.
- Source fix (uncommitted until this handoff lands with it): copy Apps first, then read `selected-profile.json`; wrap missing Winlogon deletes with Continue. `acceptancePowerShell.test.js` 12 Passed.

### 20260915b result

- Reload `1a9fb85` ok (backup `HostTools-State-20260914-181800-375`). Endpoint Preflight and ValidateOnly passed. Test profile during the run: `KR26H1RW` test-only autoLogonCount=3.
- Evidence `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260915b`. `ok=false`, `status=Failed`, **`cleanup=Passed`**. `detail=Fleet did not reach windows-desktop-ready for 1 VM(s) within the timeout.` failedAt 03:25. Mutex free. Profile IZVZO7PU. Services stopped. Six VMs Off, Clean only (no Ready).
- Services started 02:23; router was Running at 03:19; Fleet 0 the whole hour. No new `PXE-HttpRoot\status` run, no `logs\runs` after 20260915a, torrent tracker only saw host seeder `192.168.177.1`. Contrast 20260915a, which reached WinPE/SMB/torrent/DISM.
- Published OOBE script hash `7836E35F63FCD4379A4BA08F7E1AD4C4E9B2974925405D949EA069D9CE173B1D` matches `1a9fb85`. DHCP config was `bootMode=secureboot` / `secureBootFile=bootmgfw.efi`.
- During the run the router adapter was static `00155DC243AA`; firmware Network path stayed `MAC(000000000000)`. After cleanup the adapter is dynamic `000000000000` again. `C:\OSDCloud\logs\host-services.log` last write is 2026-09-14 23:26, so this run left no DHCP/TFTP lines there.
- Leading reading: client never entered WinPE (PXE/firmware identity or disk fallback). Not the previous 403, and not the Winlogon `reg.exe delete`.

### 20260915c result

- `5b183b2` Network-firmware-after-MAC ran from the clone. PXE worked. Run `20260915-083404-3833-6458-5439-4386-0617-9856-93`.
- WinPE started 08:34. `Invoke-OSDCloud` **succeeded** (`osdcloud-finished` 08:43) — the Winlogon `reg.exe delete` crash is gone. SetupComplete `windows-setupcomplete-awaiting-logon` 08:46. No later `windows-start` / `windows-desktop-ready`.
- Result: `ok=false`, `status=Failed`, **`cleanup=Passed`**, Fleet timeout 09:49. Mutex free. Profile IZVZO7PU. Services stopped. Router still only Clean (cleanup does not restore the router VM; next round start will).
- Cause: shutdown Apps copy preferred `X:\OSDCloud\Apps` (has `Install-Apps.ps1`, no `selected-profile.json`) over `Z:\OSDCloud\Apps`. `Get-TestAutoLogonCount` stayed 0, so no AutoLogon; guest sat at the logon screen for the rest of the hour.

### 20260915d result

- Reload `14e0f82` + Endpoint Sync + ValidateOnly passed. Run `20260915-101359`. **Fleet `windows-desktop-ready`** at 10:31 (344s). Guest: Explorer, profile `X4FO83YV`, Chrome/7-Zip/script/Notepad++ succeeded, TPM, build 26200, Windows 11. Auto-logon/PXE/OOBE fixes held.
- Then `Initialize-LabRouterGuest` failed: `detail=Invalid class` at LabRouter.ps1:43 (guest `Get-NetNat`/`New-NetNat` under Stop). No Ready checkpoint. Cleanup **Passed**. Mutex free. IZVZO7PU. Router Clean only.
- Source: wait for real LAN/WAN MACs, start WinNat, catch `Invalid class` on Get-NetNat, rethrow New-NetNat with a prefix. No HostTools reload needed for this Lab-script fix.

### Exact next steps

1. One unique-root `-BootstrapRouter` after the NAT fix. Do not Create the router. Zero retries. Lab runs from the clone.
2. After cleanupPassed and Ready exists: `Initialize-WinceptionLab -ValidateOnly -RequireRouter`, then `-Mode All -NetworkAcceptance`.
3. Physical/human remain NotRun/Blocked. No Release/package/master push.

### Step 1 inspection (kept)

- Fresh evidence: `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260914\result.json`. `ok=false`, `status=Failed`, `cleanup=Failed`, `detail=Fleet did not reach windows-desktop-ready for 1 VM(s) within the timeout.` `cleanupErrors`: Endpoint restoration failed; secureboot default restore failed; status cleanup failed.
- Cause: cleanup `POST /api/endpoint` used default TimeoutSec=30; live restore took ~81s. Do not treat those three errors as live dirt, and do not treat recorded Failed as `cleanupPassed`.

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
