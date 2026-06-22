# Agent Reference: Module Map

Read this file first when you need to change console code. It maps each feature to the
**single small file** that owns it, so you can open one focused module (~150–500 lines)
instead of reading a multi-thousand-line monolith. Grep the symbol, open the listed file, edit it.

> Conventions: native ES modules, named exports, JSDoc on public functions, one test area per module,
> no re-export barrels — import from the specific owning file. The web UI loads `js/main.js` as
> `<script type="module">` and `<link>`s `css/01..07` in cascade order; there is no bundler/build step.

## Front end — `tools/osdcloud-console/web/`

| Need to change… | File |
|---|---|
| Global UI state shape, constants | `web/js/state.js` |
| DOM element refs, `$`/`$$` selectors | `web/js/dom.js` |
| Formatting (text/percent/bytes/time/labels) | `web/js/format.js` |
| Server calls, polling `refresh()`, interface/catalog loaders | `web/js/api.js` |
| Shared UI builders (pills, icons, definition lists, console dock, copy) | `web/js/ui.js` |
| Dialog open/close/backdrop + every `show*Dialog` builder | `web/js/dialogs.js` |
| **Deploy** (dashboard): services, tiles, preflight, runtime readiness, OS/profile/interface/payload/sync/validation render | `web/js/deploy.js` |
| **Setup** (guided init): steps, secrets form, project-root form, init handlers | `web/js/setup.js` |
| **Activity** (fleet): cards, detail, search/filter, `STALE_DONE_STAGES` | `web/js/fleet.js` |
| Action dispatch (`handleAction`) + async button handlers, `switchToView` | `web/js/actions.js` |
| The `render()` orchestrator (fan-out to view renderers) | `web/js/render.js` |
| Event listeners, bootstrap, 2.5s refresh interval | `web/js/main.js` |
| Styles | `web/css/01-base · 02-cards-forms · 03-layout · 04-tables · 05-components · 06-shell · 07-views` |

## Back end — `tools/osdcloud-console/src/`

Entry points (run by `package.json` scripts) stay at `src/` root: `webServer.js`, `serverPreflight.js`,
`smoke.js`, `headless.js`, `osImageDownloadCli.js`.

| Need to change… | File |
|---|---|
| Deployment profile CRUD, options, payload eval, install-sequence | `src/profiles/profiles.js` |
| Software catalog load/format/upload/create/delete, install scripts | `src/profiles/software.js` |
| Custom script catalog + upload/create/delete/read | `src/profiles/scripts.js` |
| Profile publish + manifest | `src/profiles/publish.js` |
| Profile/software/script ID gen, validation, path/json helpers, options | `src/profiles/shared.js` |
| OS image catalog/sources/resolve/scan/evaluate/label/publish | `src/osimages/catalog.js` |
| OS image DISM inspection, ISO mount, metadata inference, index validation | `src/osimages/inspect.js` |
| OS image upload/import (local + uploaded) | `src/osimages/transfer.js` |
| OS image catalog list + download | `src/osimages/download.js` |
| OS image delete | `src/osimages/maintenance.js` |
| OS image shared helpers (consts, normalizers, hashing, cache log) | `src/osimages/shared.js` |
| PowerShell exec + elevation | `src/windows/powershell.js` |
| Network interfaces, DHCP subnet, SMB, service IPs | `src/windows/network.js` |
| iPXE endpoint sync, boot.wim sync inputs/hash | `src/windows/bootArtifacts.js` |
| boot.wim customization + secure boot validation | `src/windows/bootValidation.js` |
| Preflight, port checks, SMB image, runtime staging, status cleanup | `src/windows/preflight.js` |
| PowerShell exec/elevation shared helpers, pass/fail/warn | `src/windows/shared.js` |
| ServiceController class (DI/wiring, service ops, all methods) | `src/controller/index.js` |
| Controller standalone helpers (errors, logging, secrets, status helpers) | `src/controller/helpers.js` |
| Controller init-state + summary projection (`buildInitializationState`, summaries) | `src/controller/state.js` |
| Config load/merge/save, derived paths, service configs | `src/config.js` |
| Web management API routing | `src/webServer.js` |
| Media/status HTTP server | `src/httpServer.js` |
| DHCP / TFTP responders | `src/dhcp.js` / `src/tftp.js` |
| Torrent create/tracker/seeder | `src/torrent.js` |
| Torrent wave/batch coordination, telemetry, budget, release persistence | `src/torrentCoordinator.js` |
| Fleet status + run queries | `src/status.js` |
| Runtime artifact readiness | `src/runtimeArtifacts.js` |
| Driver pack cache | `src/driverPackCache.js` |
| Logging / time / process output / run summary | `src/logger.js` / `src/timeFormat.js` / `src/processOutput.js` / `src/runSummary.js` |

> `httpServer.js` and `torrent.js` were left whole (moderate size); split them by handler/class if they grow.

## PowerShell — `tools/`

Large operational scripts (`Restore-DeploymentArtifacts.ps1`, `Set-OsdCloudIpxeEndpoint.ps1`,
`Setup-DeploymentServer.ps1`, `Initialize-DeploymentServer.ps1`, …) are self-contained and invoked directly.
`New-WinceptionUsbInstaller.ps1` owns the additive active-snapshot USB/ISO export; its root `.cmd` wrapper is included in the installed HostTools bundle.
Pure shared helpers — `Get-FullPath`, `Assert-ChildPath`, `Join-ChildPath`, `Get-Sha256Hash`,
`Test-IsAdministrator`, `Write-Step` — live in **`tools/lib/Common.ps1`**, dot-sourced right after each
script's param block via `. (Join-Path $PSScriptRoot 'lib\Common.ps1')`. The host bundle
(`Install-HostManagementBundle.ps1`) mirrors `tools/` recursively, so `lib/Common.ps1` travels with the scripts.
`Invoke-ExternalCommand` is intentionally NOT shared (its default working dir binds to a script-scoped variable).
