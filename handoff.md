# Agent handoff — 2026-09-21 (Grok Build next)

Please read this first, then `AGENTS.md`. Do **not** resume 9/16–9/17 “finish NetworkAcceptance” instructions; those steps are obsolete.

**One line:** Hyper-V SecureBoot four-VM is **Passed** on `secureboot-20260920e` (source `9960aad`). `codex/easier-onboarding` is on origin as backup (not merged to `master`). NetworkAcceptance stays **frozen**. Physical ExistingDhcp stays **Blocked**. Wait for the operator to name the next track — do not invent Lab work.

---

## Active task

Wait for the operator to name the next track. Default is **stop and report** if unnamed.

Done this session (2026-09-21 branch hygiene; not a Lab track): local leftover branches deleted; `codex/easier-onboarding` pushed to origin; `origin/codex/release-v1.1.0` deleted (already in `origin/master`). Do **not** merge or push `master` until named.

Reasonable tracks **if named**:

- Optional Source/UI re-verify in the clone (no `C:\OSDCloud` writes).
- Physical ExistingDhcp only after the checklist below is already true.
- Product/source work the operator describes (prefer Grok Build / scoped commits).
- Do **not** reopen NetworkAcceptance / `-BootstrapRouter` / Mode All unless the operator explicitly unfreezes that gate.

Operator preference so far: Hyper-V-only testing over physical ExistingDhcp. That does **not** authorize NetworkAcceptance.

---

## Hard no

- Do **not** run `-Mode All -NetworkAcceptance` or `-BootstrapRouter`.
- Do **not** reuse evidence roots `secureboot-20260920a`..`d` or `acceptance-mode-all-network-20260917y`.
- Do **not** auto-retry. Zero retries after any Failed round or cleanup Failed.
- Do **not** push `master`, create a Release/package/tag, or start `.github/workflows/lab-deploy.yml`. Pushing `codex/easier-onboarding` is allowed.
- Do **not** patch `C:\OSDCloud` by hand. Clone is `C:\winception`; runtime is product-managed.
- Do **not** commit `.ai/`, secrets, WIMs, logs, screenshots.
- Do **not** kill an elevated Lab PID to make a gate pass.
- Do **not** auto-repair ICS (`SharedAccess`) or leftover `PXE-Lab-NAT` / `OSDCloud-PhysicalClient-NAT`.
- Do **not** treat AutoLab green as physical-laptop or production-DHCP proof.
- Do **not** start PXE from the current overlay while `bootMode=secureboot` and `bootFile=snponly.efi` disagree, except inside the Lab runner which must Endpoint Sync / set boot mode itself.
- Grok/agent shells are usually **unelevated**. Hyper-V TPM, ValidateOnly, Lab, and `npm run reload` need `Start-Process -Verb RunAs`. Do not wrap `Start-Process -Wait` in a ~10 minute job-object timeout.
- If stuck (disk full / PausedCritical / UAC / idle gate): **ask the operator promptly** — do not wait endlessly.

`.ai/` stays untracked. Local `master` `bdbe5ce` is one commit ahead of `origin/master` `847b79f`; preserve it. Do **not** push that stale handoff commit.

---

## Exact continuation

1. Re-read Git, this file, live overlay (`C:\OSDCloud\HostTools\State\config\osdcloud-console.local.json`), `http://127.0.0.1:8080/api/state` if Console is up, mutex `Global\Winception-AutoLab`, and the six AutoLab VMs. Alert if `.ai/status.json` disagrees with live Git.
2. If the operator has **not** named a track: report status and **stop**.
3. If the operator names **another SecureBoot Lab**: new unique evidence root only; elevated ValidateOnly then one `-Mode SecureBoot`; keep C: free space high (PausedCritical killed `20260920d`); consider `timeouts.deploymentMinutes` ≥ 90. No `-NetworkAcceptance`.
4. If the operator names **physical ExistingDhcp**: checklist below must already be true. `ValidateOnly` first. Do not invent MAC/UUID/NIC.
5. If the operator names **full Source/UI**: clone only, strip Codex `PSModulePath`, no `C:\OSDCloud` writes.

### Lab command shape (when authorized)

```powershell
# elevated Windows PowerShell 5.1, unique evidenceRoot, from C:\winception
# copy config\lab-regression.example.json -> untracked .ai\<name>-config.json
# set evidenceRoot under C:\OSDCloud\HostTools\State\lab\evidence\<unique>
.\tools\Initialize-WinceptionLab.ps1 -ConfigPath <untracked unique json> -ValidateOnly
.\tools\Invoke-WinceptionLabRegression.ps1 -ConfigPath <untracked unique json> -Mode SecureBoot
```

Require: mutex free, six VMs Off, Console healthy before mutation (`/api/state.ok=true`). Archive stale fleet runs (`POST /api/status/runs/archive` with `runIds`) if idle gate fails with `Installed host must be idle before acceptance mutation.`

Success: four VMs `windows-desktop-ready`, Fleet + PowerShell Direct, `cleanup=Passed`, profile back to `IZVZO7PU`, services stopped. Then update `TEST-RESULT.md`, this file, `.ai/status.json`, commit scoped source/docs. No master push.

Failure: keep redacted JSON/HTML, diagnose, **stop**. Do not start the next lettered root yourself.

---

## Development log — Grok Bot session 2026-09-20 → 2026-09-21

Operator asked Grok Bot to take over calling Grok Build for `C:\winception`. Session focus: Hyper-V SecureBoot four-VM live proof.

### Commits produced

| Commit | Summary |
| --- | --- |
| `f4628e1` | (pre-session) ignore torrent telemetry `TerminatingError(Invoke-RestMethod)` when warning phrase present |
| `9960aad` | **Grok Build:** also strip that TerminatingError when joined fleet text has peer `Uploading to:` / `Downloading from:` `[Peer]` progress; naked Invoke-RestMethod still terminal; `acceptancePowerShell` 23/23 |
| `9cdcfd7` | docs: SecureBoot four-VM Passed on `secureboot-20260920e` |

Branch: `codex/easier-onboarding` (tracks `origin/codex/easier-onboarding`). Not merged or pushed to `master`.

### Lab rounds

| Root | Result | Cause / note |
| --- | --- | --- |
| `secureboot-20260920a` | Failed / cleanup Failed | Telemetry false positive; cleanup left Console/profile messy; later restored `IZVZO7PU` |
| `secureboot-20260920b` | Blocked | Stale fleet runs still `running` → idle gate stage 2009. Archived via `POST /api/status/runs/archive` |
| `secureboot-20260920c` | Failed / cleanup Passed | Joined `latestMessage` still matched `TerminatingError(` without warning phrase; throw substring showed peer lines |
| `9960aad` fix | tests Passed | Broadened `Test-ClientTerminalFailureText` |
| `secureboot-20260920d` | Failed / cleanup Passed | Detector OK; C: hit ~0.01GB → four VMs `PausedCritical`; after resume nearly done (1× desktop-ready) but **fleet timeout** (60m) |
| `secureboot-20260920e` | **Passed / cleanup Passed** | `deploymentMinutes=90`; C: kept large free; four × `windows-desktop-ready`; profile `IZVZO7PU` |

### Operational lessons (do not regress)

- Unelevated shells cannot always Import-Module Hyper-V (alias collisions); elevate Lab/ValidateOnly/Resume-VM.
- Stale Console fleet `running` rows block mutation even when VMs are Off — archive them.
- Keep tens–hundreds of GB free on C: during four-wide apply-image (AVHDX growth). `PausedCritical` = ask operator immediately.
- Loopback Console auth often not required; mutating APIs use `x-winception-token` when required. Fleet archive: `POST http://127.0.0.1:8080/api/status/runs/archive` body `{ "runIds": [...] }`.
- Detector lives in clone `tools\Invoke-WinceptionLabRegression.ps1` (Lab runs from clone); App reload not required for that fix alone.
- Grok CLI on this host: `C:\Users\Davis\.grok\bin\grok.exe`. Headless: `grok -p "..." --output-format plain` (not `text`).

### Billing note (operator already aware)

Calling Grok Build from Grok Bot typically spends **both** Grok Bot weekly usage and Grok Build / SuperGrok product usage.

---

## Git leftover (2026-09-21 hygiene)

Repo default is `master`, not `main`. Open PRs: none.

**Keep:** `codex/easier-onboarding` (current, on origin, 84 commits not in `origin/master`); local `master` `bdbe5ce` (do not push); `codex/v1-v2-reference-hardening` (local-only v1e `1.0.4-enhanced.2` — do not merge into 1.1.0 unless named).

**Left on origin, not merged as unique work:** `codex/v1-pages` (Pages was merged then reverted); `release/v1` (v1.0.1 patch already on master); `codex/v2-rewrite` and `codex/v2-familiar-ux-alpha15` (abandoned v2). Delete only if the operator names them.

**Deleted this session:** local leftovers (`console-motion-polish`, `master-v1.0.1-release`, `master-v2-alpha5-link`, `release-v1.1.0`, `feature/torrent-p2p-deployment`, `refactor/module-structure`, two 20260914 baseline snapshots); prunable worktree `winception-v110-phaseA`; `origin/codex/release-v1.1.0`.

---

## Live host snapshot (re-verify before acting)

| Item | Value |
| --- | --- |
| Clone | `C:\winception` on `codex/easier-onboarding` tracking `origin/codex/easier-onboarding` (detector `9960aad`; use `git log -1`) |
| Tracked tree | Clean except untracked `.ai/` |
| `master` | Local `bdbe5ce`, ahead of `origin/master` `847b79f` by one — **do not push** |
| Installed App | `C:\OSDCloud\HostTools\App` — Lab `20260920e` recorded installed/WinPE hashes in `result.json` |
| Lab script | Clone `tools\Invoke-WinceptionLabRegression.ps1` (includes `9960aad` detector) |
| Console | Listening `127.0.0.1:8080`; profile **`IZVZO7PU`**; Lab mutex **free** (as of handoff write — re-check) |
| Endpoint overlay | AutoLab `192.168.177.1/24`, Server DHCP `.200–.250`, `dhcpMode=server` |
| Boot-mode drift | Overlay may still show `bootMode=secureboot` / `secureBootFile=bootmgfw.efi` while `bootFile` is `snponly.efi` — Lab Endpoint Sync owns correction during runs |
| AutoLab VMs | Expect all Off after Passed cleanup; `01..04` SB On + TPM On + `Winception-Clean`; iPXE SB Off / TPM Off; router Off with Clean + Router-Ready |
| Physical NICs | Wi-Fi only historically — re-check before ExistingDhcp |
| Foreign network | ICS / `PXE-Lab-NAT` / `OSDCloud-PhysicalClient-NAT` may still exist — do not auto-repair |
| Disk | Keep C: spacious before any four-VM Lab |

Treat State JSON as last-synced snapshot, not guaranteed production truth — re-read live.

---

## Layer status

| Layer | Status | Evidence / rule |
| --- | --- | --- |
| Source / UI | Last Passed | 9/14 Source/UI; 9/17 full source; 9/20 B-lite. Re-run only if asked |
| AutoLab firmware Mode All | Historical Passed | `mode-all-20260913e`. Do not rerun to “make NetworkAcceptance count” |
| AutoLab SecureBoot four-VM | **Passed** | `...\lab\evidence\secureboot-20260920e` on `9960aad`. Live-proven |
| Router Ready | Present; lab-only | `acceptance-router-bootstrap-20260917x`. Do not rebuild |
| AutoLab NetworkAcceptance | **Paused / Failed / frozen** | `acceptance-mode-all-network-20260917y`. **Not a ship gate** |
| Physical / human | NotRun / **Blocked** | No Ethernet / no `acceptance.local.json`. VM green ≠ physical proof |

### What “frozen” and “Blocked” mean

- **NetworkAcceptance frozen:** policy — do not run that gate or treat it as shipping proof until the operator explicitly unfreezes it.
- **Physical ExistingDhcp Blocked:** prerequisites missing — cannot start (even ValidateOnly) until Ethernet/site file/disposable confirmation/etc. exist.

---

## Product fixes to keep vs lab-only

Keep (physical PXE can hit these):

- `0e4d55d` Base64URL boot nonce may start with `-` or `_`
- `fabdfee` / `745dcb4` OOBE `Test-Path` grouping; WinPE metadata after apply
- `14e0f82` / `1a9fb85` published Apps / `selected-profile.json` copy order; missing Winlogon `reg.exe` must not Stop
- `9dcc164` cleanup waits for Console idle; `Get-ConsoleTimeoutSec`
- Onboarding wizard, pairing, site/DHCP/NAT guards (`084a1f0` and follow-ups)
- `f4628e1` / **`9960aad`** Fleet wait ignores torrent telemetry / peer-transfer Invoke-RestMethod timeouts

Lab-only unless a physical failure reproduces them:

- Router nested Hyper-V / WinNAT / Wait-Job / deployed-disk boot / TPM SecureBootTemplate rewrite ladder
- AutoLab static MAC rebind after checkpoint (`5b183b2`)

---

## Physical ExistingDhcp (Blocked until operator kit exists)

Not started. Do not `-Execute`. `ValidateOnly` stays blocked until:

1. Present, connected Ethernet or USB Ethernet on the existing client LAN (host has often been Wi-Fi only).
2. Ignored `config\acceptance.local.json` from `config\acceptance.example.json` with interface/IP, client MAC, SMBIOS UUID, expected subnet/gateway/DHCP/DNS.
3. `client.disposableConfirmed=true`. No disk rollback.
4. Live endpoint switched **off** AutoLab `192.168.177.1`. `bootMode` and `bootFile` must agree after sync.
5. Existing LAN DHCP stays up (PXE Proxy). Do not start Winception DHCP Server on that segment.
6. AutoLab VMs stay Off. VM evidence is not physical evidence.

---

## Workspace

| Item | Value |
| --- | --- |
| Clone (edit here) | `C:\winception` |
| Installed Web console | `C:\OSDCloud\HostTools\App` — `:8080` |
| Host-only state | `C:\OSDCloud\HostTools\State` |
| Runtime | `C:\OSDCloud` |
| Branch | `codex/easier-onboarding` tracking origin (code peak `9960aad`; 84 commits ahead of `origin/master`) |
| Product version | `package.json` `1.1.0`; **no** `v1.1.0` tag on origin. Formal tags: `v1.0.1`, `v1.0.3`, `v2.0.0-alpha.1..5` |
| Grok CLI | `C:\Users\Davis\.grok\bin\grok.exe` |

Untracked helpers under `.ai/` (do not commit): configs/logs/diagnoses for `20260920b`–`e`, Grok prompts, etc.

---

## Files to open first

| Area | Path |
| --- | --- |
| Always-on rules | `AGENTS.md` |
| This brief | `handoff.md` |
| Evidence record | `TEST-RESULT.md` |
| Lab orchestrator | `tools/Invoke-WinceptionLabRegression.ps1` |
| Lab VM validate | `tools/Initialize-WinceptionLab.ps1` |
| Fleet detector | `Test-ClientTerminalFailureText` in the orchestrator |
| Detector tests | `tools/osdcloud-console/test/acceptancePowerShell.test.js` |
| Layered acceptance | `docs/acceptance.md` |

## Safety

- Clone is not a PXE runtime.
- Do not commit `osdcloud-secrets.json` or plaintext secrets.
- AutoLab Internal `192.168.177.1` is the only network for current VM work unless the operator opens physical.
- Web mutating APIs change live deployment state.
