# Agent Reference: Runtime and Web Console

Read this only for runtime, endpoint, service, preflight, image/profile publish, WinPE or desktop-ready work. Software Test details are in [software-test.md](software-test.md); architecture and IPC are in [v2-architecture.md](v2-architecture.md).

## Truth and paths

- The Git clone is source, not deployment runtime. Edit source only.
- Installed code: `C:\OSDCloud\HostTools\App`; mutable v1 state: `...\State`; v2 state: `C:\ProgramData\Winception\State`.
- Runtime is the Web-selected absolute deployment root, default `C:\OSDCloud`, outside the clone and HostTools. Never patch it manually.
- Before mutation, read live Web/API/config, project root, service NIC/IP, DHCP range/router/mode, boot mode, HTTP/SMB endpoints, active image/profile, services and Fleet. Committed config is only a last-synced snapshot.

## Mutation gates

- Prepare runtime and endpoint sync do not imply service start.
- Preflight results are pass, non-blocking warning (`ok: true`, `warn: true`), or blocking failure (`ok: false`). Only blocking failures disable Start services.
- Confirm LAN DHCP safety before DHCP starts. Do not silently modify NICs.
- v2 mutations use `OperationCoordinator`; overlapping resources return `409 OPERATION_CONFLICT`. Reads, logs and evidence snapshots do not take mutation locks.
- Web changes reload only the browser; server/Agent changes require service restart before validation. Source success is not installed-runtime evidence.

## Deployment lifecycle

Prepare runtime → select live endpoint/DHCP/boot mode → prepare deployable WIM → publish profile payload → run preflight → clear blocking failures → confirm DHCP arrangement → start ingress → PXE boot → monitor `run-start` through `windows-desktop-ready` → stop services.

Secure Boot uses Microsoft-signed boot manager/TFTP; iPXE is an explicit alternative. Offline ISO is additive, built from an immutable active snapshot, and does not prove PXE readiness. Physical-laptop acceptance must use the live endpoint and cannot be inferred from VM results.

## Evidence

Report source, installed bundle, host runtime, VM/client and physical-laptop evidence separately. Status/log responses must be bounded and redact secrets/raw privileged command details. v2 applies explicit retention/quota to product logs, screenshots, archives and staging; legacy evidence is not deleted implicitly during migration.
