# Agent handoff — 2026-09-21 (SecureBoot four-VM Passed)

接手請先讀這份，再讀 `AGENTS.md`。不要跟著 9/16–9/17 的「重跑 NetworkAcceptance」文字走。那些步驟已作廢。

**一句話：** NetworkAcceptance 凍結；實體筆電 Blocked；上一輪 Hyper-V SecureBoot 四台到了 `apply-image` 後被 torrent telemetry 誤判殺掉。偵測器已修在 `f4628e1`，profile 已還原 `IZVZO7PU`。沒有你點名，不要開下一輪 Lab。

---

## Active task

SecureBoot four-VM live proof **Passed** on `secureboot-20260920e` (source `9960aad`, cleanup Passed, profile restored to `IZVZO7PU`).

Wait for the operator to name the next track. Do not invent work. Do not auto-retry Lab.

Reasonable next tracks if named: optional Source/UI re-verify; physical ExistingDhcp only after checklist; NetworkAcceptance stays frozen.

Operator already chose Hyper-V-only testing over physical ExistingDhcp for now. That does not authorize NetworkAcceptance, router bootstrap, Mode All, or a retry of failed roots `secureboot-20260920a`..`d`.


## Hard no

- Do **not** run `-Mode All -NetworkAcceptance` or `-BootstrapRouter`.
- Do **not** reuse evidence root `secureboot-20260920a` or `acceptance-mode-all-network-20260917y`.
- Do **not** auto-retry. Zero retries after any Failed round or cleanup Failed.
- Do **not** push `master`, create a Release/package/tag, or start `.github/workflows/lab-deploy.yml`.
- Do **not** patch `C:\OSDCloud` by hand. Clone is `C:\winception`; runtime is product-managed.
- Do **not** commit `.ai/`, secrets, WIMs, logs, screenshots.
- Do **not** kill an elevated Lab PID to make a gate pass.
- Do **not** auto-repair ICS (`SharedAccess`) or leftover `PXE-Lab-NAT` / `OSDCloud-PhysicalClient-NAT`.
- Do **not** treat AutoLab green as physical-laptop or production-DHCP proof.
- Do **not** start PXE from the current overlay while `bootMode=secureboot` and `bootFile=snponly.efi` disagree, except inside the Lab runner which must Endpoint Sync / set boot mode itself.
- Grok/agent shells are usually **unelevated**. Hyper-V TPM, ValidateOnly, Lab, and `npm run reload` need `Start-Process -Verb RunAs`. Do not wrap `Start-Process -Wait` in a ~10 minute job-object timeout.

`.ai/` stays untracked. Local `master` `bdbe5ce` is one commit ahead of `origin/master` `847b79f`; preserve it.

## Exact continuation

1. Re-read Git, this file, live overlay (`C:\OSDCloud\HostTools\State\config\osdcloud-console.local.json`), `http://127.0.0.1:8080/api/state` if Console is up, mutex `Global\Winception-AutoLab`, and the six AutoLab VMs. Alert if `.ai/status.json` disagrees with live Git.
2. If the operator has **not** named a track: report status and **stop**.
3. If the operator names **SecureBoot retry**: elevated `Initialize-WinceptionLab.ps1 -ValidateOnly` (no `-RequireRouter`), then exactly one `Invoke-WinceptionLabRegression.ps1 -Mode SecureBoot` with a unique evidence root copied from `config\lab-regression.example.json`. No `-NetworkAcceptance`. Lab script runs from the **clone**. Fail-closed. New untracked `.ai/` config/log only.
4. If the operator names **physical ExistingDhcp**: checklist below must already be true. `ValidateOnly` first. Do not invent MAC/UUID/NIC.
5. If the operator names **full Source/UI**: clone only, strip Codex `PSModulePath`, no `C:\OSDCloud` writes.

### If SecureBoot 20260920b is authorized

```powershell
# elevated Windows PowerShell 5.1, unique evidenceRoot, from C:\winception
.\tools\Initialize-WinceptionLab.ps1 -ConfigPath <untracked unique json> -ValidateOnly
.\tools\Invoke-WinceptionLabRegression.ps1 -ConfigPath <untracked unique json> -Mode SecureBoot
```

Require: mutex free, six VMs Off, Console healthy **before** the regression mutation path (`Test-WebConsoleHealthy` needs `/api/state.ok=true`). The Lab script starts the installed Console if you start it first; 20260920a wrapper had to call `Start-InstalledWebConsole.ps1 -NoBrowser` because the mutation gate runs before `Ensure-WebConsole`.

Success: four VMs `windows-desktop-ready`, Fleet + PowerShell Direct, `cleanup=Passed`, profile back to `IZVZO7PU`, services stopped. Then update `TEST-RESULT.md`, this file, `.ai/status.json`, commit scoped source/docs. No master push.

Failure: keep redacted JSON/HTML, diagnose the stage, **stop**. Do not start 20260920c yourself.

Wrapper pitfalls paid for on 20260920a:

- StrictMode cannot read unset `$LASTEXITCODE` after a called `.ps1`.
- A watcher that matches raw `TerminatingError(` will false-fail on torrent telemetry. Source detector is fixed; do not bring back the old watch pattern.
- Round `finally` calls `Stop-LabServices`; if that records `Web Console service stop failed`, it can throw `Lab cleanup failed; no next round is permitted.` and leave a test profile active because Console is already down. Restore `IZVZO7PU` via Console API before another Lab.

## Live host snapshot (re-read 2026-09-20 after restore; re-verify before acting)

| Item | Value |
| --- | --- |
| Clone | `C:\winception` HEAD `f4628e1` on `codex/easier-onboarding` |
| Tracked tree | Clean except untracked `.ai/` |
| `master` | Local `bdbe5ce`, ahead of `origin/master` `847b79f` by one |
| Installed App | `C:\OSDCloud\HostTools\App`. `httpServer.js` and `LabRouter.ps1` SHA-256 match source (`9F2B666D90BC0AED` / `51BE804A142CF7D0`). Last Lab State backup `HostTools-State-20260920-131653-986`; previous reload backup `HostTools-State-20260917-092952-275` |
| Lab script | Runs from clone `tools\Invoke-WinceptionLabRegression.ps1` (detector fix is here, not required in App) |
| Console | **Listening** `127.0.0.1:8080` (pid 27936 when last read). Left up after manual profile restore. Lab mutex **free** |
| Endpoint overlay | `vEthernet (Winception-AutoLab)` / `192.168.177.1/24`, Server `.200–.250`, router `.1`, DNS `1.1.1.1,8.8.8.8`, `dhcpMode=server` |
| Boot-mode drift | Overlay `dhcp.bootMode=secureboot` and `secureBootFile=bootmgfw.efi`, but `dhcp.bootFile` is still `ipxeboot/x86_64-sb/snponly.efi` |
| Active profile | `IZVZO7PU` (All in One, Windows 11 25H2). Test profile `HI67E59T` deleted. Other catalog ids `074RMJU3`, `I20HRVF5` are old and unused |
| AutoLab VMs | All Off. `01..04` Secure Boot On + `MicrosoftWindows` + TPM On, checkpoint `Winception-Clean` only. iPXE Secure Boot Off + TPM Off, `Winception-Clean` |
| Router | Off; checkpoints `Winception-Clean` + `Winception-Router-Ready`; 2 vCPU; nested On; TPM On; SB On / `MicrosoftWindows`; LAN `Winception-AutoLab`; WAN Default Switch |
| Physical NICs | Wi-Fi Up only. No Ethernet / USB Ethernet. Disconnected Bluetooth PAN is not a client NIC. No `config\acceptance.local.json` |
| Foreign network | `SharedAccess` Running; `PXE-Lab-NAT` `192.168.77.0/24`; `OSDCloud-PhysicalClient-NAT` `192.168.88.0/24` |
| Agent shell | Unelevated (`elevated=False`) |

Treat State `osdcloud-console.json` / overlay as last-synced snapshot, not guaranteed production truth.

## Layer status

| Layer | Status | Evidence / rule |
| --- | --- | --- |
| Source / UI | Last Passed | 9/14 Source/UI; 9/17 full source 500/497/3 skipped; 9/20 B-lite check=0, 68 focused tests, smoke=0. Optional full `acceptance:source` / `acceptance:ui` only if asked |
| AutoLab firmware Mode All | Historical Passed | `mode-all-20260913e`, seven deployments, cleanup Passed. Do not discard; do not rerun to “make NetworkAcceptance count” |
| AutoLab SecureBoot four-VM | **Passed** | `C:\OSDCloud\HostTools\State\lab\evidence\secureboot-20260920e` on `9960aad`. Four VMs `windows-desktop-ready`, Fleet + cleanup Passed, profile `IZVZO7PU`. Detector fixes `f4628e1`/`9960aad` live-proven. |
| Router Ready | Present; lab-only | `acceptance-router-bootstrap-20260917x`. Do not rebuild |
| AutoLab NetworkAcceptance | **Paused / Failed** | `acceptance-mode-all-network-20260917y`. Not a ship gate |
| Physical / human | NotRun / Blocked | No Ethernet; no site file. VM results are not physical proof |

## Last Hyper-V run — `secureboot-20260920a`

- Config (untracked): `.ai/secureboot-20260920a-config.json` — evidence root under State `lab\evidence\secureboot-20260920a`.
- ValidateOnly passed (five deployment VMs Off, Clean checkpoints, resting firmware correct).
- Four clients: Fleet `apply-image`, SMB `Z:\OSDCloud\OS\...wim` mapped, torrent peers on `.1` / `.200–.203`.
- Fail: `Wait-FleetCompletion` / `Test-ClientTerminalFailureText` matched `TerminatingError(Invoke-RestMethod)` from torrent progress RPC. WinPE warning: `Torrent progress telemetry unavailable; download continues.`
- Nonce 403 **did not recur** (that was `20260917y` / `0e4d55d`).
- `result.json`: `ok=false`, `status=Failed`, `cleanup=Failed`, `detail=Lab cleanup failed; no next round is permitted.`, errors: Web Console service stop failed; profile restore POST failed (connection refused); endpoint restore failed.
- Manual recovery: started installed Console, `POST /api/profile` `IZVZO7PU`, deleted `HI67E59T`. Do not repeat that Lab root.

Fix in HEAD `f4628e1`: strip `TerminatingError(Invoke-RestMethod)` lines when the same text contains `Torrent progress telemetry unavailable; download continues`. Real `TerminatingError(` (for example `Test-Path -and`) still matches. Focused `acceptancePowerShell.test.js` 23/23.

## Product fixes to keep vs lab-only

Keep (physical PXE can hit these):

- `0e4d55d` Base64URL boot nonce may start with `-` or `_`
- `fabdfee` / `745dcb4` OOBE `Test-Path` grouping; WinPE metadata after apply
- `14e0f82` / `1a9fb85` published Apps / `selected-profile.json` copy order; missing Winlogon `reg.exe` must not Stop
- `9dcc164` cleanup waits for Console idle; `Get-ConsoleTimeoutSec`
- Onboarding wizard, pairing, site/DHCP/NAT guards (`084a1f0` and follow-ups)
- `f4628e1` Fleet wait ignores torrent telemetry timeouts

Lab-only unless a physical failure reproduces them:

- Router nested Hyper-V / WinNAT / `Wait-Job` / deployed-disk boot / TPM `SecureBootTemplate` rewrite (`42cd4d0`, `bf9db48`, `04a1177`, 9/15–9/17 ladder)
- AutoLab static MAC rebind after checkpoint (`5b183b2`)

## Paid-for pitfalls (do not regress)

- Codex 9/14–9/17 burned ~39 evidence roots on nested router + NetworkAcceptance. Source/UI green does not prove that path. **Do not reopen it** without an explicit operator name and an unattended fail-closed run.
- `safeClientValue` used to reject valid Base64URL nonces starting with `-`/`_`. Fixed `0e4d55d`; live-proven only as “did not recur” on 20260920a, not as a green four-wide desktop-ready.
- Cleanup `POST /api/endpoint` must use `Get-ConsoleTimeoutSec` and `Wait-ConsoleIdle` (`9dcc164`). 30s REST vs ~81s `boot.wim` remount races cleanup Failed.
- After checkpoint restore, assign collision-checked static MAC then **re-apply Network FirstBootDevice** even if Network is already first (`5b183b2`), or firmware stays `MAC(000000000000)`.
- WinPE: copy Apps **before** auto-logon registry; missing Winlogon `reg.exe delete` must not Stop; prefer Apps tree with `selected-profile.json`.
- `Winception-Clean` does not keep Hyper-V TPM. Restore `-SecureBoot` and `-Tpm` independently. Dummy key protector length `< 32` needs `-NewLocalKeyProtector` before `Enable-VMTPM`. Do not rewrite `SecureBootTemplate` after TPM key-protector init (`04a1177`).
- Guest Windows 11 is `CurrentBuild` >= 22000; registry `ProductName` may still say Windows 10 Pro.
- Hyper-V Default Switch ICS UDP/67 is **not** Lab occupancy. Do not kill it.
- Historical `winception-client-01..04` are vSwitch regression VMs. AutoLab names only: `winception-autolab-01..04`, `winception-autolab-ipxe-01`, plus owned `winception-autolab-router`.
- Lab secrets and `osdcloud-console.json` live in HostTools State, never the Git clone `config\` as the live store.
- Fail-closed on real WinPE terminal text (`selected-os.json`, SMB 86, `Boot session did not provide`, …). Do **not** fail-closed on torrent telemetry timeouts.
- Mutex `Global\Winception-AutoLab`. One Lab at a time.

## Physical ExistingDhcp (Blocked until operator kit exists)

Not started. Do not `-Execute`. `ValidateOnly` stays blocked until:

1. Present, connected Ethernet or USB Ethernet on the existing client LAN (host has Wi-Fi only).
2. Ignored `config\acceptance.local.json` from `config\acceptance.example.json` with interface/IP, client MAC, SMBIOS UUID, expected subnet/gateway/DHCP/DNS.
3. `client.disposableConfirmed=true`. No disk rollback.
4. Live endpoint switched **off** AutoLab `192.168.177.1`. `bootMode` and `bootFile` must agree after sync.
5. Existing LAN DHCP stays up (PXE Proxy). Do not start Winception DHCP Server on that segment.
6. AutoLab VMs stay Off. VM evidence is not physical evidence.

LaptopNat is Blocked while ICS and the two leftover NATs exist. Agent does not repair them. WinceptionDhcp needs a separate DHCP-free window. Human usability needs an unfamiliar-PXE operator.

## Workspace

| Item | Value |
| --- | --- |
| Clone (edit here) | `C:\winception` |
| Installed Web console | `C:\OSDCloud\HostTools\App` — `:8080` |
| Host-only state | `C:\OSDCloud\HostTools\State` |
| Runtime | `C:\OSDCloud` |
| Branch | `codex/easier-onboarding` @ `f4628e1` |
| Product version | `1.1.0` tagged on origin; this branch is unreleased |

`npm run reload` must be elevated (secrets ACL) and `npm install` in App after replace. Lab does **not** need App reload for `f4628e1` (clone orchestrator).

Untracked helpers from 20260920a (do not commit): `.ai/secureboot-20260920a-*.json/.ps1/.log`, `.ai/restore-profile-20260920a.ps1`. Prefer official scripts over copying those wrappers blindly; they had `$LASTEXITCODE` and watcher bugs.

## How to run Lab (when authorized)

Config: copy `config\lab-regression.example.json` to an **untracked** unique file and set `evidenceRoot` to a new directory under `C:\OSDCloud\HostTools\State\lab\evidence\<unique>`. There is no tracked `config\lab-regression.json`.

Modes: `SecureBoot` (four VMs, what the operator last chose), `Ipxe`, `FirmwareCorners`, `All`. Add `-NetworkAcceptance` only if the operator explicitly unfreezes that gate.

Watch `C:\OSDCloud\PXE-HttpRoot\status\latest.json` and TFTP/DHCP logs, not just wrapper stdout. Do not wait the full 60 minutes if logTail shows a real throw.

## Files to open first

| Area | Path |
| --- | --- |
| Always-on rules | `AGENTS.md` |
| This brief | `handoff.md` |
| Evidence record | `TEST-RESULT.md` |
| Lab orchestrator | `tools/Invoke-WinceptionLabRegression.ps1` |
| Lab VM validate | `tools/Initialize-WinceptionLab.ps1` |
| Fleet detector | `Test-ClientTerminalFailureText` in the orchestrator |
| WinPE torrent warning | `osdcloud-assets/OSDCloud/WinPE/OSDCloud/Start-OSDCloud-iPXE.ps1` |
| Layered acceptance | `docs/acceptance.md` |
| Paths / validation | `docs/agent-reference/deployment-paths.md`, `docs/agent-reference/validation-scenarios.md` |

## Safety

- Clone is not a PXE runtime.
- Do not commit `osdcloud-secrets.json` or plaintext secrets in API output, docs, tests, commits, or this file.
- AutoLab Internal `192.168.177.1` is the only network for the current VM work. Physical LAN DHCP must stay disabled for a Server-mode physical test window; Proxy keeps existing DHCP.
- Web mutating APIs change live deployment state.

## Historical pointers (do not continue as written)

- NetworkAcceptance `20260917y`: WinPE 403 `nonce is invalid` on autolab-03; Router Ready restore then failed on SecureBootTemplate. Fixes `0e4d55d`, `04a1177` are in source/App. Matrix **not** rerun. Evidence: `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-mode-all-network-20260917y`.
- Router Ready: `C:\OSDCloud\HostTools\State\lab\evidence\acceptance-router-bootstrap-20260917x`.
- Mode All e green: `C:\OSDCloud\HostTools\State\lab\evidence\mode-all-20260913e`.
- Older handoff sections (9/16 Wait-Job PID 4160, 9/15 router letters a–g, onboarding Source/UI) are superseded. Details live in `TEST-RESULT.md` and Git history. Do not resurrect PID 4160 instructions; that process is gone.
