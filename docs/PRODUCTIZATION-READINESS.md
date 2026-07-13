# Winception v2 Productization Readiness

## Implemented source baseline

- Frozen v1 restore points: annotated `v0.6.7`, `release/v1`; v2 isolated on `codex/v2-rewrite`.
- TypeScript/Fastify/React workspace with contracts/domain/application/infrastructure layering and zero production cycles.
- Low-privilege Web and privileged allow-list Agent services; authenticated named pipe, schema validation, redacted errors and loopback default.
- Resource-aware operation locks, Software Test isolation recheck, persisted operation recovery, SQLite migrations, DPAPI secrets, atomic writes, bounded log tails, retention/quota primitives and controlled upload staging.
- `/api/v2`, OpenAPI drift check, operation IDs, SSE refresh recovery, product control UI and Chromium accessibility/recovery E2E.
- v1 dry-run/idempotent importer with backup and report; transient runtime state is not imported and runtime rebuild is required.
- Fixed Node 24 package staging, WiX service definitions, State ACL provisioning, LAN certificate validation, signing helper and upgrade rollback script.
- Windows CI definitions for tests, fixed aria2 integration, coverage, PowerShell parse, audit, secret scan, SBOM, browser E2E and MSI smoke.
- Single official manual, generated flowchart policy, per-version evidence matrix, Security/Support/third-party policies and reduced agent-context budget.

## Open release blockers

| Blocker | Required evidence |
|---|---|
| Some parity commands still use bounded generic JSON payloads | Replace them with domain-specific request/response schemas and generated client types |
| Full v1 management UI parity is incomplete | Implement remaining profile/package/script CRUD and prove each workflow in Playwright |
| Named-pipe token/schema exists but installed service-SID DACL is not enforced or proven | Provision an explicit pipe DACL, then verify LocalService Web access and rejection of unapproved identities |
| Legacy parity adapter retains v1 Controller's inner global operation lock | Move privileged actions to native adapters so independent coordinator resources can run without false conflicts |
| Running configuration/catalog paths still delegate to legacy JSON Controller state | Make SQLite repositories the live source of truth and keep filesystem only for large payloads and indexed evidence |
| Retention helper and evidence tables are not wired to production roots | Apply versioned policies to logs/JSONL/screenshots/archives and maintain hash/size/retention index transactionally |
| Local MSI build unavailable | Windows CI compiles WiX and passes fresh install, repair, rollback and uninstall-preserves-data |
| No organization code-signing certificate in this workspace | Authenticode MSI/binaries/scripts with trusted timestamp |
| v2 live runtime not installed | Installed Agent/Web health, ACL, DPAPI, named pipe and migration verification |
| Feature parity not deployment-accepted | One client, two consecutive four-VM rounds, physical laptop, Software Test, torrent, Offline ISO, diagnostics/evidence export |
| LAN management not live-tested | Loopback default plus certificate-store HTTPS opt-in and invalid-certificate fail-closed tests |
| Legal notices incomplete | Product license and upstream redistribution review using release SBOM |

Do not merge v2 to `master` or label it production-ready until every row is closed in `TEST-RESULT.md` for the exact release build.
