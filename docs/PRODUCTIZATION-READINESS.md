# Winception v2 Productization Readiness

## Implemented source baseline

- Frozen v1 restore points: annotated `v0.6.7`, `release/v1`; v2 isolated on `codex/v2-rewrite`.
- TypeScript/Fastify/React workspace with contracts/domain/application/infrastructure layering and zero production cycles.
- Low-privilege Web and privileged allow-list Agent services; authenticated named pipe, schema validation, redacted errors and loopback default.
- Resource-aware operation locks, Software Test isolation recheck, persisted operation recovery, SQLite live product state/migrations, action-lifetime DPAPI deployment secrets, atomic writes, bounded log tails, retention/quota/evidence indexing and controlled upload staging.
- `/api/v2`, domain-specific request/response/IPC schemas, OpenAPI drift check, generated client types, operation IDs, SSE refresh recovery, full management controls and Chromium accessibility/recovery E2E.
- v1 dry-run/idempotent importer with backup and report; transient runtime state is not imported and runtime rebuild is required.
- Fixed Node 24.15.0 package staging, WiX service definitions, State/legacy ACL provisioning, service-SID pipe DACL readback, transaction-style LAN endpoint configuration and upgrade rollback.
- Self-signed Authenticode/TLS baseline with exported trust certificates; public/organization certificate thumbprints can replace it later without code changes.
- `AGPL-3.0-only` product license, complete license text in source/MSI/SBOM, and unauthenticated Web links to the license and corresponding source repository.
- Local gates for fixed aria2 integration, coverage, PowerShell parse, dependency audit, pinned Gitleaks history/working-tree scan, embedded SBOM, browser E2E and MSI/package smoke. Remote CI is intentionally not required in the current phase.
- Single official manual, generated flowchart policy, per-version evidence matrix, Security/Support/third-party policies and reduced agent-context budget.

Local 2026-07-13 evidence: v1 405/405 and v2 40/40 with no skips; global coverage 93.48%/85.44%, critical coverage 99.28%/92.23%; Playwright 2/2; Gitleaks 0 findings. The final self-signed MSI built with 0 warnings/errors, matched 6,650 manifest files after extraction, contained 66 valid signed payloads, the complete product license and a `winception` / `2.0.0-alpha.1` / `AGPL-3.0-only` SBOM; its extracted Agent/Web passed health, authentication, profile read, SQLite and Node 24.15.0 smoke.

## Remaining external release acceptance

| Blocker | Required evidence |
|---|---|
| Current shell is not elevated | On an approved Windows 11 test host, prove actual per-machine fresh install, LocalService-to-Agent pipe access, rejection of unapproved identities, repair, failed-health rollback and uninstall-preserves-data |
| Current certificate baseline is self-signed | Acceptable for approved internal test hosts after explicit CER trust; replace with the future public/organization code-signing and TLS certificates for formal distribution |
| v2 live runtime not deployment-accepted | Prove installed Agent/Web health, ACL, DPAPI, named pipe and v1 migration against the exact MSI |
| Feature parity not deployment-accepted | One client, two consecutive four-VM rounds, physical laptop, Software Test, torrent, Offline ISO, diagnostics/evidence export |
| LAN management not live-tested | Loopback default plus certificate-store HTTPS opt-in and invalid-certificate fail-closed tests |
| Upstream redistribution review incomplete | Confirm OSDCloud/ADK/WinPE, aria2 and every bundled client payload against the release SBOM; the Winception product license is already `AGPL-3.0-only` |

Do not merge v2 to `master` or label it production-ready until every row is closed in `TEST-RESULT.md` for the exact release build.
