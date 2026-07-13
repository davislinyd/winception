# Agent Reference: Validation Scenarios

Read this file when selecting verification for subsystem-specific changes.

## General

- `npm run check` must pass for Web/static/front-end changes.
- `npm test` must pass for host console code changes.
- `npm run smoke` must pass before handoff; it uses temporary roots/test ports and must not touch the live LAN or live `C:\OSDCloud`.
- A live deployment remains the final hardware validation when host-console networking, endpoint sync, WinPE, SetupComplete, or deployment behavior changes.

## Web Console

- Web layout or visual changes must run `npm run check`, relevant Web UI tests such as `node --test tools/osdcloud-console/test/webUi.test.js`, and a read-only browser or HTTP verification of `http://127.0.0.1:8080/` when appropriate.
- Web console code changes must include controller/API tests that prove read-only state calls do not create or modify live status roots.
- Web API auth changes must test loopback bypass, non-loopback 401 without `X-Winception-Token`, success with a valid token, `/api/auth/status` without secrets, and static/manual routes remaining readable.
- Read-only verification must not click service start/stop, endpoint sync, profile publish/delete, or clear-status actions unless the user explicitly authorizes live mutation.

## Torrent Transport

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

- WinPE or SetupComplete changes must be tested with the relevant scripts and, when behavior changes inside `C:\OSDCloud` or WinPE, followed by live file update, `boot.wim` mount/commit when needed, and `osdcloud-assets` sync.
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
