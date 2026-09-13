# Agent handoff — 2026-09-13

## Active continuation — Mode All repair

Mode All d (commit `b04c6e8`) ran after the bounded progress-lock/finalizer repair, formal reload, published WinPE hash sync, and ValidateOnly all passed. The first Secure Boot On + TPM On round deployed all four VMs to `windows-desktop-ready`; each guest had profile `IZVZO7PU`, four succeeded install steps, Explorer, no OOBE, Windows build `26200` / `25H2`, and matching guest Secure Boot/TPM. The run still failed during cleanup: all four checkpoint restores reported `在此物件上找不到屬性 'BootType'` and the round did not save host firmware evidence as a separate object. The likely source defect is strict property access while reading a transient/malformed `Get-VMFirmware.BootOrder` entry after snapshot restore; inspect and normalize property existence before reading `BootType` (do not weaken ACLs). Evidence: `C:\OSDCloud\HostTools\State\lab\evidence\mode-all-20260913d\round-secureboot-tpm-on.json` and `result.json`. Five VMs are now Off, deployment services are stopped, host boot mode is `secureboot`, and ICS/Default Switch was not touched. This is not a green Mode All result.

The d-round guest records report `productName` as `Windows 10 Pro` while build/displayVersion are `26200`/`25H2`; treat this as an additional acceptance-data discrepancy to explain or fail closed before claiming the required Windows 11 result.

Run b was cancelled at 19:14 +08 after autolab-01 stalled between torrent metadata and networking telemetry. Cleanup still failed at FirstBootDevice and left autolab-04 Running. The remaining VM has now been stopped; all five are Off. VMMS also logged VHDX Access denied, but current ACLs already contain VM/SYSTEM grants and no denies; do not assume causation or loosen State ACLs. Source now separates all stops from per-VM restore, aggregates failures, waits for stable matching firmware Network sources, and verifies restored roles. Lab behavioral tests 14/14 pass; full checks, commit, live cleanup, formal reload, and a fresh complete Mode All remain required.

The user explicitly approved the repair plan and Mode All until green with active per-client inspection. Commits 81b01c7 and 4cd44fb fix guest profile/firmware evidence and bound WinPE network commands; b04c6e8 fixes progress-file sharing races and finalizer fail-closed behavior. Source/App/published WinPE template hash was verified as `8129E5E2A656B4AE9998B0A8FCE94F28F32D6B8F05DE0AAE1F98867B340E4377` before d. No direct runtime edits, push, release, rebuild, or global ACL repair. Physical PXE remains separate.

Read this after `AGENTS.md` startup checks. It is the continuation brief for the 2026-09-12/13 work on Web operator modes, HostTools reload, and AutoLab Secure Boot × TPM. Do not treat it as live production truth; re-read `http://127.0.0.1:8080/api/state` and Hyper-V firmware before any PXE or service action.

Chinese summary: 本機 `master` 相對 `origin/master` 超前 15 個 commit，最新修復 commit 為 `b04c6e8`，**不要 push**。Mode All d 的四台首輪 guest 部署成功，但 cleanup 因 `BootType` property error 失敗；五台目前全 Off、部署服務停止，完整 4 輪 / 7 部署仍未通過。下一步先修復並測試 firmware BootOrder property guard，再用新 evidence 目錄正式 reload、Endpoint Sync、ValidateOnly，重跑四輪。`/api/boot-mode` 仍只有 `secureboot`/`ipxe`；TPM 是客戶端韌體。實體 PXE 不在本輪驗收內。

## Workspace

| Item | Value |
| --- | --- |
| Clone (edit here) | `C:\winception` |
| Installed Web console | `C:\OSDCloud\HostTools\App` — live `:8080` |
| Host-only state | `C:\OSDCloud\HostTools\State` |
| Runtime | `C:\OSDCloud` (never patch by hand) |
| Branch | `master`, ahead 15; latest repair commit `b04c6e8`; preserve untracked `.ai/` |
| Product version | `1.1.0` on origin; local commits are unreleased |

Unpushed commits, newest first:

```text
b04c6e8 fix: bound client progress lock retries and reject incomplete finalization
b68f554 fix: restore all Lab VMs using current firmware boot sources
4cd44fb fix: bound WinPE torrent network preparation commands
81b01c7 fix: fail Lab green on cleanup and incomplete guest evidence
8d45223 docs: add agent continuation handoff for firmware matrix work
7e11247 fix: keep Lab secrets and endpoint config in HostTools State
8746d99 docs: record AutoLab Secure Boot x TPM firmware-corner green lights
1da7e71 fix: keep Lab cache restore on HostTools secrets, skip hashing generated boot files
a8efdab fix: fail Lab PXE wait on WinPE selected-os/SMB errors
c1d7d2f fix: treat Hyper-V dummy key protector as missing
f49a674 fix: look up Hyper-V key protector without KpsAvailable
2f64c44 feat: prove AutoLab Secure Boot and TPM as independent firmware axes
deaf92e fix: re-enable Hyper-V TPM after AutoLab checkpoint restore
a5a9a84 fix: require elevation and restore npm modules during HostTools reload
3ec1f53 feat: add Guided and Console operator modes to the Web UI
```

Do not push unless the user asks. A push to master may start `.github/workflows/lab-deploy.yml` on a `self-hosted, windows, hyperv, winception-lab` runner.

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
| Default fleet | `winception-autolab-01..04` | `secureboot` | On | On | 2026-09-13 single VM `autolab-01`; 2026-09-12 four-wide (TPM was not Lab-managed then) |
| iPXE | `winception-autolab-ipxe-01` | `ipxe` | Off | Off | 2026-09-12 Mode All |
| Corner | `winception-autolab-01` | `secureboot` | On | Off | 2026-09-13 FirmwareCorners |
| Corner | `winception-autolab-ipxe-01` | `ipxe` | Off | On | 2026-09-13 FirmwareCorners |

Guest asserts follow the **round's expected pair**, not “secureboot round ⇒ TPM required”.

Evidence: `TEST-RESULT.md` (2026-09-13 sections). Lab JSON: `C:\OSDCloud\HostTools\State\lab\evidence\result.json`, `round-secureboot-tpm-off.json`, `round-ipxe-tpm-on.json`.

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

After FirmwareCorners cleanup on 2026-09-13 ~12:47 +08:

- VMs Off. Resting firmware: `01..04` Secure Boot On + TPM On; iPXE Secure Boot Off + TPM Off.
- Lab DHCP/TFTP/HTTP on `192.168.177.1` were stopped. ICS on Default Switch was left running.
- Last Lab round set host `bootMode` to **`ipxe`**. Do not assume `secureboot`. Read live Web/API config.
- Grok/agent shells are often **unelevated**. Hyper-V TPM, secrets ACL, and HostTools reload need `Start-Process -Verb RunAs`. Never print secret values.

## Open work (priority)

1. **Do not push** until the user asks.
2. Finish current cleanup-source checks/commit, verify all five restore, formally reload App and sync WinPE fingerprints.
3. **One `Mode All` job** on Internal AutoLab only — four SB+TPM On in parallel, iPXE both off, then both corners — if the user wants a single-run contract. Wall clock is longer; stay on `192.168.177.0/24`; timeout 180 minutes in `lab-deploy.yml`.
4. **Physical UEFI IPv4 PXE** on the Web-selected live endpoint. VM green is not physical evidence. Confirm LAN DHCP is disabled for the test window before starting DHCP.
5. Optional later: signed `bootmgfw.efi` + client Secure Boot **Off** to desktop-ready (WinPE-only evidence exists from 2026-06-12).

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
