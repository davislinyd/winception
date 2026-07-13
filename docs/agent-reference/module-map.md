# Agent Reference: Module Map

Use [v2-architecture.md](v2-architecture.md) for all v2 work. This file maps the frozen v1 adapter retained for compatibility and migration. v1 is split by domain but not fully decoupled: `controller/index.js`, `webServer.js`, `web/js/deploy.js`, and `web/js/dialogs.js` remain large integration modules. Do not assume a 150–500 line ownership limit.

## v1 Web

| Area | Owner |
|---|---|
| State, DOM, formatting, shared UI | `web/js/state.js`, `dom.js`, `format.js`, `ui.js` |
| API/polling | `web/js/api.js` |
| Deploy/runtime/preflight | `web/js/deploy.js`; diagnostics in `web/js/deploy/diagnostics.js` |
| Dialogs | `web/js/dialogs.js` |
| Guided setup | `web/js/setup.js` |
| Fleet/evidence | `web/js/fleet.js` |
| Actions and navigation | `web/js/actions.js`, `actionRegistry.js`, `render.js`, `main.js` |
| Styles | `web/css/01-base.css` through `07-views.css` |

## v1 Server

| Area | Owner |
|---|---|
| Controller wiring/global operation compatibility | `src/controller/index.js` |
| Safe errors, log/status helpers, projections | `src/controller/helpers.js`, `state.js` |
| Management routes/auth | `src/webServer.js`, `src/webAuth.js` |
| Profiles/software/scripts | `src/profiles/*` |
| OS image inspect/download/import/delete/publish | `src/osimages/*` |
| Windows/PowerShell/network/preflight/boot sync | `src/windows/*` |
| DHCP/TFTP/media/torrent | `src/dhcp.js`, `tftp.js`, `httpServer.js`, `torrent.js`, `torrentCoordinator.js` |
| Fleet/status/evidence | `src/status.js` |
| Runtime, diagnostics, driver cache, Software Test | `src/runtimeArtifacts.js`, `diagnostics/*`, `driverPackCache.js`, `softwareTest.js` |
| Config and bounded logging | `src/config.js`, `logger.js` |

PowerShell entry points remain under `tools/`; shared pure helpers are in `tools/lib/Common.ps1`. Search the called script from the owning JS adapter before editing. v1 hotfixes must remain isolated and must not create new dependency cycles.
