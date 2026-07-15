# Agent Reference: v2 Architecture

## Dependency rule

`contracts/domain` imports no Fastify, React, SQLite or PowerShell. Application services depend only on domain ports. Infrastructure implements SQLite, filesystem, DPAPI, IPC and Windows adapters. Apps compose dependencies. React features may import `shared` and contracts, never another feature's internals. `npm run v2:cycles` must report zero production cycles.

| Area | Owner |
|---|---|
| Versioned API/IPC schemas | `packages/contracts/src/index.ts` |
| Errors and ports | `packages/domain/src/*` |
| Resource locks | `packages/application/src/operationCoordinator.ts` |
| SQLite/migrations/recovery | `packages/infrastructure/src/database.ts` |
| SQLite product/evidence state | `productState.ts`, `evidence.ts` |
| Atomic files, uploads, retention | `atomicFile.ts`, `uploadStore.ts`, `retention.ts` |
| DPAPI/service/deployment secrets | `dpapi.ts`, `serviceSettings.ts`, `deploymentSecrets.ts` |
| Named-pipe allow-list IPC/DACL | `ipc.ts`, `pipeAcl.ts`, `Set-WinceptionNamedPipeAcl.ps1` |
| v1 dry-run/backup/import/rebuild | `v1Importer.ts`, `migrationRuntime.ts`, `Invoke-WinceptionV1Migration.ps1`; CLI `apps/agent/src/migrateV1.ts` |
| Privileged Agent composition | `apps/agent/src/runtime.ts`, `legacyParity.ts`, `main.ts` |
| Low-privilege HTTP/auth/SSE | `apps/server/src/app.ts`, `auth.ts`, `agentRoutes.ts`, `events.ts` |
| React shell/features | `apps/web/src/App.tsx`, `features/*`, `shared/api.ts` |
| MSI/package/upgrade | `installer/wix/*`, `tools/v2/*` |

## Security invariants

- Web sends only a declared `AgentCommandName` with a schema-validated payload under 1 MiB. No arbitrary method, command line, PowerShell or caller-provided filesystem path.
- The Agent named pipe is under `ProtectedPrefix\Administrators`, authenticated with an installer token, and fail-closed unless its protected DACL reads back as only SYSTEM, Administrators and the `Winception.Web` service SID. Unexpected privileged errors are redacted.
- Browser sessions are HttpOnly/SameSite=Strict. Cookie mutations require same-origin plus `X-Winception-Requested-With`; direct API tokens use constant-time comparison.
- Uploads enter an opaque-token staging root, are streamed with size limits and SHA-256, then revalidated by Agent before consumption.
- Secrets are DPAPI LocalMachine ciphertext with State ACLs. Deployment secrets are materialized into the privileged legacy projection only for a coordinated action and scrubbed afterward. API, logs, migration reports and diagnostics never contain plaintext.
- v1 secrets contribute to the migration fingerprint and are re-encrypted directly into SQLite, but are excluded from the filesystem backup. Agent cannot become ready while `runtime.rebuildRequired` remains pending; MSI rollback restores the v2 database and compatibility projection without modifying v1 State.
- Management binds loopback HTTP by default. `Set-WinceptionManagementEndpoint.ps1` transactionally enables non-loopback HTTPS, rolls back settings/PFX/CER and service state on failure, and accepts either the current self-signed baseline or a supplied public certificate thumbprint.

The v1 Controller remains behind a compatibility adapter for proven OSDCloud operations. `AsyncLocalStorage` marks calls already owned by the v2 coordinator, so the v1 inner lock does not falsely serialize independent resources. New v2 code must not import Controller internals outside the Agent composition/adapter layer.

## Familiar Deploy / Monitor UI and operation rules

The React shell recreates v1's Deploy / Monitor information hierarchy (configuration summary, service cards, guided rail, Fleet, torrent tracker, evidence drawer and console dock) without importing v1 Controller JavaScript or CSS. It consumes `deployment.snapshot` as a read model; raw command lines, secrets and privileged paths never enter the UI.

Resources have one canonical order: `config`, `deployment-ingress`, `runtime`, `os-cache`, `profile-payload`, `software-test-vm`, `evidence`, `runtime-control`. Acquire atomically; never wait while holding a partial set. Software Test rechecks stopped ingress and empty Fleet while holding the same lock. Persist start and terminal state. On Agent restart, orphaned `running` records become `failed / AGENT_RESTARTED`. Mutations return operation IDs; the UI displays accepted, running and terminal state, and preserves a `409 OPERATION_CONFLICT` response with conflicting operation/resources.

`deployment.changed` is an additive versioned SSE event. The Server fingerprints the evidence-free `deployment.snapshot` every two seconds and publishes `{}` only when its stable content changes. The browser then re-reads the REST snapshot; Fleet/log/evidence payloads are never transported by SSE. Torrent release accepts either a row-supplied `runId` with optional `clientId` or `{ allWaiting: true }`; extend requires that row's `runId`, optional `clientId`, and bounded `additionalMinutes`. Both remain allow-listed `runtime-control` mutations.

## Verification

Run `npm run v2:check`, `v2:test:coverage`, `v2:openapi:check`, PowerShell syntax, build, Playwright and package/MSI smoke as applicable. Required critical coverage is 90% line/85% branch for contracts, coordinator, persistence, migration and IPC. Live acceptance remains separate.
