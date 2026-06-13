# Agent Reference: Module Map

Read this file first when you need to change console code. It maps each feature to the
**single small file** that owns it, so you can open one focused module (~150–500 lines)
instead of reading a multi-thousand-line monolith. Grep the symbol, open the listed file, edit it.

> Status: the codebase is being split feature-by-feature (see `C:\Users\Davis\.claude\plans\ai-agent-melodic-wombat.md`).
> Files marked _(planned)_ may still live in their pre-split monolith until that phase lands.
> Conventions: native ES modules, named exports, JSDoc on public functions, one `test/<area>` test per module,
> no re-export barrels — import from the specific owning file.

## Front end — `tools/osdcloud-console/web/`

`index.html` loads `js/main.js` as `<script type="module">` and `<link>`s the `css/*` files in cascade order.

| Need to change… | File |
|---|---|
| Global UI state shape, constants | `web/js/state.js` |
| DOM element refs, `$`/`$$` selectors | `web/js/dom.js` |
| Formatting (text/percent/bytes/time/labels) | `web/js/format.js` |
| Server calls, polling `refresh()`, interfaces/catalog loaders | `web/js/api.js` |
| Shared UI builders (pills, icons, definition lists, control enable/disable) | `web/js/ui.js` |
| Dialog open/close/backdrop + `show*Dialog` builders | `web/js/dialogs.js` |
| **Deploy** (dashboard) view: services, tiles, preflight, runtime readiness, OS/profile summaries | `web/js/views/deploy.js` |
| **Setup** (guided init) view: steps, secrets form, project-root form | `web/js/views/setup.js` |
| **Activity** (fleet) view: cards, detail drawer, search/filter | `web/js/views/fleet.js` |
| Action dispatch (`handleAction`) + async button handlers | `web/js/actions.js` |
| The `render()` orchestrator (fan-out to view renderers) | `web/js/render.js` |
| Event listeners, bootstrap, 2.5s refresh interval | `web/js/main.js` |
| Styles | `web/css/*` (core → shell → components → per-view → responsive) |

## Back end — `tools/osdcloud-console/src/`

Entry points (run by `package.json` scripts) stay at `src/` root: `webServer.js`, `serverPreflight.js`,
`smoke.js`, `headless.js`, `osImageDownloadCli.js`.

| Need to change… | File |
|---|---|
| Deployment profile CRUD, options, payload eval | `src/profiles/profiles.js` _(planned)_ |
| Software catalog load/format/upload/create/delete | `src/profiles/softwareCatalog.js` _(planned)_ |
| Custom script catalog + upload/create/delete/read | `src/profiles/customScripts.js` _(planned)_ |
| Profile publish + manifest | `src/profiles/publish.js` _(planned)_ |
| Profile/software/script ID generation + validation | `src/profiles/ids.js` _(planned)_ |
| OS image catalog/sources/resolve/scan/evaluate/label | `src/osimages/catalog.js` _(planned)_ |
| OS image DISM inspection + index validation | `src/osimages/inspect.js` _(planned)_ |
| OS image upload/import (local + uploaded) | `src/osimages/transfer.js` _(planned)_ |
| OS image catalog list + download | `src/osimages/download.js` _(planned)_ |
| OS image delete/cache maintenance | `src/osimages/maintenance.js` _(planned)_ |
| PowerShell exec + elevation | `src/windows/powershell.js` _(planned)_ |
| Network interfaces, DHCP subnet, SMB, service IPs | `src/windows/network.js` _(planned)_ |
| iPXE endpoint sync, boot.wim sync inputs/hash | `src/windows/bootArtifacts.js` _(planned)_ |
| boot.wim customization + secure boot validation | `src/windows/bootValidation.js` _(planned)_ |
| Preflight, port checks, SMB image, runtime staging | `src/windows/preflight.js` _(planned)_ |
| ServiceController class (DI/wiring) | `src/controller/index.js` _(planned)_ |
| Controller state/fleet/readiness queries | `src/controller/queries.js` _(planned)_ |
| Controller long async operations (deploy/update/download/publish) | `src/controller/operations.js` _(planned)_ |
| Config load/merge/save, derived paths, service configs | `src/config.js` |
| Web management API routing | `src/webServer.js` |
| Media/status HTTP server | `src/httpServer.js` |
| DHCP / TFTP responders | `src/dhcp.js` / `src/tftp.js` |
| Torrent create/tracker/seeder | `src/torrent.js` |
| Fleet status + run queries | `src/status.js` |
| Runtime artifact readiness | `src/runtimeArtifacts.js` |
| Driver pack cache | `src/driverPackCache.js` |
| Logging / time formatting / process output / run summary | `src/logger.js` / `src/timeFormat.js` / `src/processOutput.js` / `src/runSummary.js` |

## PowerShell — `tools/`

Large operational scripts (`Restore-DeploymentArtifacts.ps1`, `Set-OsdCloudIpxeEndpoint.ps1`,
`Setup-DeploymentServer.ps1`, `Initialize-DeploymentServer.ps1`, …) are self-contained and invoked directly.
Shared pure helpers (hashing, path normalization) live in `tools/lib/Common.ps1` _(planned)_, dot-sourced via
`. "$PSScriptRoot\lib\Common.ps1"`. The host bundle (`Install-HostManagementBundle.ps1`) copies `tools/` preserving layout.
