# Agent handoff — 2026-09-14

## Active continuation — Layered automated acceptance

User explicitly resumed the Loop Breaker pause. Negative DHCP no-output assertions are fixed without relaxing packet checks. Continue the approved plan; do not infer physical/human readiness from Source or VM evidence. Before usage reaches the limit, update this file with exact active run/process/evidence/cleanup state. Latest usage query: five-hour used22%, weekly66%; refresh at milestones.

### Git/source milestone

- Branch codex/easier-onboarding; acceptance baseline codex/baseline-acceptance-20260914 at f092edc91136e5cef118338743705378f1b7a4ec. Original bdbe5ce/master/unpushed work preserved. No push, Release, tag or package.
- Acceptance implementation/detailed bilingual operator contract is docs/acceptance.md. Source/UI drafts, collector/client/report-only ticket, test-only profile gate/MAC-scoped boot credentials, router DHCP/ownership/bootstrap/network rounds, CI matrix and manuals are complete for Source review. All edits still unstaged/uncommitted at this handoff edit; commit before installed/runtime/PXE.
- Latest acceptance:source passed check /480 tests (477 pass,3 skip)/smoke, .ai/acceptance-source-final.log and test-results/acceptance-source JSON+HTML. Subsequent focused tests cover final guards. UI9 pass, owned State cleanupPassed, local Chrome (Chromium CDN download failed; do not retry unchanged download). Logs .ai/acceptance-ui-final.log; layered UI JSON+HTML test-results/acceptance-ui-report. YAML parsed with installed Playwright-core utilsBundle yaml, no new dependency. WinPE Shutdown mirror/three changed manifest hashes synchronized.
- Final Source edits: Console-auth token handling in Lab; router Create shares mutex; physical uses live config.workspace.runtimeRoot; partial stop never counts cleanupPassed; next round blocked on cleanup failure; router firewall accepts LAN broadcast only on LAN interface. Run focused scripts/parser before scoped commit. Source report hash is observed tree at run time; later evidence/doc-only edits are separate.

### Next execution

1. Finish final focused validation, scoped stage/commit Source/tests/docs. Preserve untracked .ai; never stage ignored config/collector tickets or generated outputs.
2. Refresh installed host idle/API/NIC/VM state. Current read-only snapshot: operationfalse/fleet0/services0; AutoLab192.168.177.1, activeIZVZO7PU/image25H2, installed workspace runtimeC:\OSDCloud; auth.requiredfalse. Previous installed4b9fb36/29-check Preflight below is historical. No acceptance reload/sync/router creation/deployment yet.
3. Existing elevated .ai/onboarding-installed-update.ps1 performs guarded npmreload + protected State backup (process-only CodexPSModulePath removal). Reuse only AFTER sourcecommit. Then verify exact installed hashes, sync WinPE/endpoint through existing API, fresh Preflight. Do not patch runtime manually.
4. Readonly elevated Initialize-WinceptionLab -ValidateOnly and required clean baseVHDX/caches. Explicit Initialize-WinceptionLabRouter -Create, then main -BootstrapRouter: one existing-image test-only deployment, PSDirect LAN/WAN/independent DHCP/guestNAT, Winception-Router-Ready checkpoint. All assetsState-owned; DefaultSwitch WAN only, foreign hostICS/NAT untouched.
5. Run main -ModeAll -NetworkAcceptance (nine positives + rejection) under existing mutex, no automatic retry. Require Fleet+PSDirect+exact network+post-stopDNS/validHTTPS+cleanup. Missing/blocked prerequisite never green. Monitor long runs; never leave background deployment unattended when handing off. On failure fix source, validate/commit/reload before fresh deployment; capture exact diagnostics and no-retry boundary.
6. Physical/human remainNotRun/Blocked: no present physicalEthernet clientNIC, foreignICS and unrelated77/88 NATs retained. Physical entry defaultValidateOnly missing-site creates BlockedJSON/HTML in ignored test-results; no physical DHCP/NAT/wipe without ignored exact onsite/disposable confirmation.

### Known review boundaries

Source validation is not installed/WinPE proof. Router/UDP/Hyper-V/Internet real behavior still needs bootstrap/network rounds; physical NIC/hardware/actualNAT and human comprehension are not covered by VM. Limited auto-login requires explicit test-only selected profile; ordinary profile does not inherit opt-in. Collector holds only report permission, ties UUID/MAC/source/run/boot, stays alive post-stop, and cleanup acknowledgement requires removed ticket/task/login. State/network rollback is not a Git guarantee.

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
