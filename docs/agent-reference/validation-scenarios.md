# Agent Reference: Validation Scenarios

Read this file when selecting verification for subsystem-specific changes.

## General

- Layered entries/statuses/router bootstrap/physical safety: docs/acceptance.md. acceptance:source combines check/test/smoke; acceptance:ui uses an owned Chromium preview and simulated network/services.
- Mode All -NetworkAcceptance adds Proxy/shared-LAN Server to seven firmware deployments. Require owned ready router, Fleet+PowerShell Direct, exact DHCP/network and valid HTTPS before/after service stop. Physical NIC/NAT and unfamiliar-PXE usability remain independent.

- `npm run check` must pass for Web/static/front-end changes.
- `npm test` must pass for host console code changes.
- `npm run smoke` must pass before handoff; it uses temporary roots/test ports and must not touch the live LAN or live `C:\OSDCloud`.
- A live deployment remains the final hardware validation when host-console networking, endpoint sync, WinPE, SetupComplete, or deployment behavior changes.

## Unattended PR And Hyper-V Lab

- PR validation runs on the labelled self-hosted Windows runner and is source-only: enumerate tracked JavaScript with node --check, parse tracked PowerShell with the Windows PowerShell parser, then run npm run check, npm test, npm run smoke, and the targeted Web/Lab contract tests. Do not run server:preflight, Endpoint Sync, profile publish, service controls, or DHCP from the PR workflow.
- A push to master runs only on the dedicated hyperv/winception-lab runner. The guard must validate the Internal Winception-AutoLab switch, vEthernet adapter 192.168.177.1/24, DHCP pool 192.168.177.200-250, four Secure Boot Gen2 VMs (`winception-autolab-01..04`), one Secure Boot-off iPXE VM (`winception-autolab-ipxe-01`), fixed 4 GiB memory, powered-off state, and Winception-Clean checkpoints. After checkpoint restore, firmware is applied per round: default Secure Boot VMs get TPM On and `MicrosoftWindows`; iPXE gets Secure Boot Off and TPM Off; firmware-corner rounds then prove Secure Boot On + TPM Off and iPXE Secure Boot Off + TPM On. Historical `winception-client-01..04` vSwitch VMs are not valid AutoLab targets.
- The merge workflow validates the runner-local base VHDX/runtime/OS image/driver cache manifest before service start. A missing or stale cache may invoke the existing restore/download flow once; a remaining mismatch fails before DHCP. The HostTools bundle is limited to tracked allowlisted files and records length plus SHA-256 for every file.
- The acceptance matrix is four Secure Boot + TPM On VMs started in one batch, one iPXE VM with Secure Boot Off + TPM Off, then firmware corners (Secure Boot On + TPM Off and iPXE Secure Boot Off + TPM On). Each round requires API Fleet status completed at windows-desktop-ready and PowerShell Direct evidence for desktop marker, Explorer, no OOBE, Windows version, profile ID, and install sequence result. Guest Secure Boot and TPM asserts follow the round expected pair. iPXE rounds additionally require snponly.efi, boot.ipxe, wimboot, and the WinPE callback.
- Guest profile ID must be non-empty and match the expected profile, using the published guest `Apps\selected-profile.json` when status/progress omit it. Persist host firmware fields on each guest record and as a separate round `hostFirmware` object. Guest Windows 11 is `CurrentBuild` >= 22000 / `windowsFamily=Windows 11`; do not treat registry `ProductName` `Windows 10 Pro` as a Windows 10 result when the build is 22000 or later. Round checkpoint cleanup failures fail closed; emit green only after final service/VM/status cleanup succeeds. An already-first Network boot entry is preserved after restore.
- Verify that all VM stops precede checkpoint restore, a restore failure still attempts later VMs and remains red, delayed firmware reads settle within 15 seconds, and a non-first Network firmware source matches the current adapter before use. After the round static MAC is assigned, re-apply FirstBootDevice even when Network is already first so the firmware path is not left at `MAC(000000000000)`. Firmware restore must skip BootOrder entries that lack `BootType` instead of throwing under StrictMode. Read back the restored firmware role; preserve VM/stage/boot IDs and VMMS events on failure. Live restore acceptance is required beyond mocks.
- Preflight failure, stale/running VM, missing checkpoint, foreign Windows DHCP Server binding, a Lab service port bound on the Lab service IP or `0.0.0.0`, cache mismatch, or PowerShell Direct timeout is a fail-closed job failure. Occupancy on another adapter (including ICS on Default Switch UDP/67) is not a Lab failure and must not be repaired. No automatic retry is allowed. The finally path stops known Lab services, stops/restores all target VMs, restores the original profile/endpoint using the preflight timeout, waits for the console operation to go idle, then restores `secureboot` and clears temporary status, and preserves only redacted evidence. Workflow concurrency prevents two Lab runs from mutating the same runner.

## Web Console

- Onboarding source acceptance covers existing-DHCP Proxy, same-LAN DHCP Server and laptop NAT; no-IPv4 NIC inventory; upstream/VPN overlap before side effects; site drift; failed/warning Preflight; and partial service start. Pairing tests cover pending without credentials, approve, reject, expiry, replay, identity mismatch, terminal revocation and Console auth.
- Preview must use isolated temporary state, never installed runtime. Check Chinese five-stage wizard, refresh-derived incomplete steps, all three wiring diagrams, pairing controls/manual links and common desktop/mobile widths.
- Physical acceptance is three independent runs: record DHCP source, client IP/prefix/gateway/DNS, PXE path, post-logon DNS and HTTPS, and this run's `windows-desktop-ready`. NAT must retain Internet after deployment services stop. Existing AutoLab green is a separate result.
- Usability acceptance requires a person unfamiliar with PXE to complete first setup and daily deployment from the UI/manual and identify wiring, next action, pairing, failure recovery and completion. Agent browser checks do not satisfy this human acceptance.

- Web layout or visual changes must run `npm run check`, relevant Web UI tests such as `node --test tools/osdcloud-console/test/webUi.test.js`, and a read-only browser or HTTP verification of `http://127.0.0.1:8080/` when appropriate.
- Web console code changes must include controller/API tests that prove read-only state calls do not create or modify live status roots.
- Diagnostics changes must test the Windows npm probe, missing-ZIP download rejection, disabled download affordance, and that a successful HostTools deployment clears the prior diagnostics State while `-DryRun` preserves it.
- Web API auth changes must test loopback bypass, non-loopback 401 without `X-Winception-Token`, success with a valid token, `/api/auth/status` without secrets, and static/manual routes remaining readable.
- Read-only verification must not click service start/stop, endpoint sync, profile publish/delete, or clear-status actions unless the user explicitly authorizes live mutation.

## Torrent Transport

- WinPE network preparation must report its current step and bound CIM discovery plus native firewall commands. Verify native output/exit preservation and termination of a synthetic hung command without running firewall mutations on the host.
- Tracker/seeder changes must test local tracker announce, compact peer list, host seeder registration, stopped peer removal, stale peer cleanup, and `TorrentDistributionCoordinator` compatibility.
- Because torrent transport changes affect deployment data movement, do not claim PXE deployment path readiness from unit tests alone. Final confidence requires torrent integration tests plus at least one live PXE regression round.

## Multi-Client And Status

- For multi-client host-console changes, include synthetic tests for interleaved runs.
- Verify one client does not overwrite another client's summary.
- Screenshot behavior must preserve the status contract: `/osdcloud/status` stays JSON-only, `/osdcloud/screenshot` accepts PNG-only uploads capped at 5 MB, and PNG files remain local evidence rather than Git artifacts.

## Profiles, Software, And Custom Scripts

- Software catalog changes must test human-entered lowercase/hyphen/numeric software id validation, duplicate rejection, plain MSI/EXE filenames, upload staging cleanup, `Guided installer` versus `Custom PowerShell` field behavior, raw PowerShell syntax rejection before filesystem/catalog writes, dependency unknown/self/duplicate/cycle rejection, client-Internet probe-host validation, and that adding catalog software does not mutate active profile or publish live Apps.
- Custom script changes must test human-entered lowercase/hyphen/numeric script id validation, `.ps1` upload validation, duplicate rejection, profile rejection of unknown script ids and invalid phases, publish copying to safe script roots, per-script logs, summary generation, missing-script behavior, and delete-blocked-when-referenced behavior.
- Deployment profile changes must test catalog/profile validation, unique profile names, add/edit/delete validation, missing prerequisite rejection, stable dependency ordering that preserves custom-script slots, safe publish roots, selected-only ordered payload publishing, empty profiles, selected-only app install behavior, OS image publish integration, and inactive-profile edits that do not stop services or republish live payloads.
- Client installer changes must test offline payload execution, client-network waiting without starting an unavailable installer, `3010` restart recommendation, `1641` reboot-pending checkpoint and next-boot continuation, and that an unrelated interrupted `running` state remains fail-closed.
- Software Test VM changes must test structured configuration rejection for missing VM, wrong Generation, Saved/Paused/running VM, or missing checkpoint; active deployment, concurrent run, invalid profile/payload, PowerShell Direct failure, and checkpoint-restore failure. Verify that its temporary payload is publish-equivalent but isolated from active profile/live Apps/services; verify safe status redaction, SYSTEM execution, client-network wait, non-success exit, `3010`, repeated `1641` continuation, timeout, and cleanup-on-success/failure. Abort must reject no active run, a stale/mismatched run ID, and repeat requests; it must interrupt an installer, PowerShell Direct wait, or reboot wait without starting another step, force the VM off, restore the clean checkpoint, and finish as `aborted / succeeded`. During an active test, the global Console dock Stop test control must remain usable, while Profile, OS Image, and Endpoint open only in read-only mode and direct mutation API calls remain rejected. Abort cleanup failure must remain fail-closed with the existing safe recovery action. A `payload-ready` run older than one minute must remain blocked until successful re-registration validates the powered-off VM and checkpoint, then become `runner-not-started` without cleanup. A cleanup failure must classify a safe reason/action, block tests until a successful re-registration verifies the rebuilt/restored checkpoint, and preserve only local raw diagnostics; Copy test report must exclude raw diagnostics, paths, command lines, URLs, scripts, and secrets. API/UI errors must include only safe English message/code/action fields and never raw PowerShell stderr, paths, command lines, or stacks. A complete PXE deployment remains a separate acceptance case.
- International profile changes must test independent `displayLanguage` / `locale` / `inputLanguage` / `timeZone` persistence, omitted values inherited when creating a profile, legacy backfill only from the active profile with the same OS image, WIM-language mismatch rejection, unresolved-time-zone rejection before live Apps changes, and API/UI field propagation.

## OS Image Source/Cache

- OS image source/cache changes must test official/custom catalog merging, custom host allowlist and required SHA256, browser-uploaded ISO/ESD/WIM inspect/import, staging cleanup, cache-hit hash validation, removed host-path API behavior, delete guards, and stale manifest handling.
- OS images no longer carry a separate active flag; active OS selection is derived from the active profile's `osImage` field.

## Driver Pack Cache

- Driver pack cache changes must test validation failures, disallowed hosts, cache hits, download success/failure, and persistence of status events when cache backfill fails.
- Client Windows should report driver pack metadata only; do not add a client-side custom downloader and do not grant deployed Windows write access to the SMB share.

## WinPE And SetupComplete

- WinPE or SetupComplete changes must be tested with the relevant scripts and, when behavior changes inside `C:\OSDCloud` or WinPE, followed by live file update, `boot.wim` mount/commit when needed, and `osdcloud-assets` sync. Shutdown OOBE customization must copy published Apps before reading `selected-profile.json`, and `reg.exe delete` of absent Winlogon values must not terminate the deployment.
- For language changes, parse the PowerShell scripts, assert OOBE maps `InputLocale` only from `inputLanguage`, assert SetupComplete builds the user language list only from `TargetInputLanguage`, and verify a fresh client reports the expected display language, culture, time zone, input languages, and input methods at `windows-desktop-ready`.
- Deployment progress should include explicit lifecycle records: `run-start`, `winpe-end`, `windows-start`, and final `run-end` on `windows-desktop-ready`.
- Client app installation should report `windows-apps-start` and `windows-apps-finished`; installer or custom-script failures should report `windows-apps-error` and leave detailed logs under `C:\Windows\Temp\osdcloud-logs`.
- Post-logon finalization changes must test success, empty profile, missing/failed/timed-out steps, interrupted reboot, legacy manifest name fallback, atomic safe progress JSON, a delayed step heartbeat with live elapsed time, slow-message/viewer mapping, outer finalizer child-exit detection within five seconds, outer-scope progress helpers outside generated reporter here-strings, and the rule that `windows-desktop-ready` is gated on progress `succeeded`.

## USB/ISO Offline Installer

- Automated tests must cover PowerShell syntax, CLI parameter sets, active-only snapshot inclusion, runtime/cache exclusions, manifest secret/path hygiene, size/headroom calculations, FAT32 file limits, disk identity guards, staging cleanup, local status gating, and Rufus arguments.
- Hash the live config, runtime `Media`, and source/published `boot.wim` before and after creation; any mutation is a failure.
- ISO validation must create and mount the ISO, verify every manifest file, and boot a Generation 2 VM with Secure Boot ON and NIC disabled through `windows-desktop-ready`.
- USB validation must re-read every manifest size/hash from the completed device, then boot one physical UEFI x64 client with Secure Boot ON and no network through `windows-desktop-ready`.
- PXE regression must run the existing four-client round and confirm network deployment plus HTTP telemetry remain unchanged. Do not record ISO, USB, VM, or PXE success until the corresponding live evidence exists.
