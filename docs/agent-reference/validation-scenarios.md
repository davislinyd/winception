# Agent Reference: Validation Scenarios

Read this file when selecting verification for subsystem-specific changes.

## General

- `npm test` must pass for host console code changes.
- `npm run smoke` must pass before handoff; it uses temporary roots/test ports and must not touch the live LAN or live `C:\OSDCloud`.
- A live deployment remains the final hardware validation when host-console networking, endpoint sync, WinPE, SetupComplete, or deployment behavior changes.

## Web Console

- Web layout or visual changes must syntax-check every front-end module (the UI is split into ES modules under `tools/osdcloud-console/web/js/`), for example on PowerShell `Get-ChildItem tools/osdcloud-console/web/js -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }`, run relevant Web UI tests such as `node --test tools/osdcloud-console/test/webUi.test.js`, and a read-only browser or HTTP verification of `http://127.0.0.1:8080/` when appropriate.
- Web console code changes must include controller/API tests that prove read-only state calls do not create or modify live status roots.
- Read-only verification must not click service start/stop, endpoint sync, profile publish/delete, or clear-status actions unless the user explicitly authorizes live mutation.

## Multi-Client And Status

- For multi-client host-console changes, include synthetic tests for interleaved runs.
- Verify one client does not overwrite another client's summary.
- Screenshot behavior must preserve the status contract: `/osdcloud/status` stays JSON-only, `/osdcloud/screenshot` accepts PNG-only uploads capped at 5 MB, and PNG files remain local evidence rather than Git artifacts.

## Profiles, Software, And Custom Scripts

- Software catalog changes must test human-entered lowercase/hyphen/numeric software id validation, duplicate rejection, plain MSI/EXE filenames, upload staging cleanup, and that adding catalog software does not mutate active profile or publish live Apps.
- Custom script changes must test human-entered lowercase/hyphen/numeric script id validation, `.ps1` upload validation, duplicate rejection, profile rejection of unknown script ids and invalid phases, publish copying to safe script roots, per-script logs, summary generation, missing-script behavior, and delete-blocked-when-referenced behavior.
- Deployment profile changes must test catalog/profile validation, unique profile names, add/edit/delete validation, safe publish roots, selected-only ordered payload publishing, empty profiles, selected-only app install behavior, OS image publish integration, and inactive-profile edits that do not stop services or republish live payloads.
- International profile changes must test independent `displayLanguage` / `locale` / `inputLanguage` / `timeZone` persistence, legacy inheritance, WIM-language mismatch rejection, unresolved-time-zone rejection before live Apps changes, and API/UI field propagation.

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
- Post-logon finalization changes must test success, empty profile, missing/failed/timed-out steps, interrupted reboot, legacy manifest name fallback, atomic safe progress JSON, full-screen viewer state mapping, outer-scope progress helpers outside generated reporter here-strings, and the rule that `windows-desktop-ready` is gated on progress `succeeded`.

## USB/ISO Offline Installer

- Automated tests must cover PowerShell syntax, CLI parameter sets, active-only snapshot inclusion, runtime/cache exclusions, manifest secret/path hygiene, size/headroom calculations, FAT32 file limits, disk identity guards, staging cleanup, local status gating, and Rufus arguments.
- Hash the live config, runtime `Media`, and source/published `boot.wim` before and after creation; any mutation is a failure.
- ISO validation must create and mount the ISO, verify every manifest file, and boot a Generation 2 VM with Secure Boot ON and NIC disabled through `windows-desktop-ready`.
- USB validation must re-read every manifest size/hash from the completed device, then boot one physical UEFI x64 client with Secure Boot ON and no network through `windows-desktop-ready`.
- PXE regression must run the existing four-client round and confirm network deployment plus HTTP telemetry remain unchanged. Do not record ISO, USB, VM, or PXE success until the corresponding live evidence exists.
