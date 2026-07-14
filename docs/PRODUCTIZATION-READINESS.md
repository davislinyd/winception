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
- Canonical bilingual Docusaurus MDX, generated flow/search/CSP assets, interactive install-plan schema, offline `/manual/`, manual exact-SHA Pages workflow, per-version evidence matrix, Security/Support/third-party policies and reduced agent-context budget. The legacy HTML manual is v1 history only.

Local 2026-07-14 evidence: v1 405/405 and v2 41/41 with no skips; global coverage 93.88%/84.77%, critical coverage 99.28%/92.23%; Web Playwright 3/3, Docs Playwright 2/2 and Gitleaks 0 findings across 373 commits plus the working tree. The self-signed candidate MSI SHA-256 is `E2EFCEE6EE3E9B1191C27E5DDA814EE7B714B59F7D316BA7432FECCE527D0E27`; its signed bootstrap SHA-256 is `0D19F91B3DADA25DC1698A36D42F84D269FC74D10B1374BC6C382828B0FD2A69`. Administrative extraction matched 6,842/6,842 manifest files and 68/68 applicable signatures. The package contains the complete license, SBOM, offline manual and generated CSP hashes; extracted Agent/Web passed Agent ready, health, authentication, profile read, `/manual/` and SQLite smoke. Bootstrap `Check` passed 20/20 and emitted no secret-named report fields.

Alpha.2 local evidence: global coverage 93.88%/84.77% and critical coverage 99.28%/92.23%; audit and Gitleaks reported 0 findings. An untrusted temporary code-signing certificate reproduced clean-host `UnknownError`; the expected self-signed root was accepted, while a modified signed payload was blocked as `HashMismatch`. MSI SHA-256 is `1E37967389D92771596C004306851AB268388B93B56C776D29D9C2AC872CCD57`; bootstrap SHA-256 is `E97A35B2831FA63546C395678A8141A713B593449F4B75702D6C53C693F93D03`. Extraction matched 6,842/6,842 manifest files and 68/68 applicable signatures. Packaged Agent/Web passed version `2.0.0-alpha.2`, health, authentication, profile read, `/manual/` and SQLite smoke. Alpha 1 remains immutable but is superseded for installation acceptance.

Alpha.3 local evidence: v1 405/405 including the three real aria2 integrations and v2 41/41 with no skips; global coverage 93.88%/84.77% and critical coverage 99.28%/92.23%; Web Playwright 3/3, Docs Playwright 2/2 and production audit 0 vulnerabilities. The bootstrap regression initializes a missing TrustedPublisher registry store key idempotently, accepts only the expected untrusted self-signed chain and blocks `HashMismatch`. MSI SHA-256 is `50D14CE030760CBA269E74BF74E3BA2C81A058766C2EB319D570063E994F6DEB`; bootstrap SHA-256 is `DCEFDED110B9D1339CBE1CD2D65354F2BDB0855506F31EEFA5A12A386F09AD09`. Extraction matched 6,842/6,842 manifest files and 68/68 applicable signatures. Bootstrap `Check` passed 20/20, and a deliberate missing-asset probe produced a stage-qualified failure report. Alpha 1 and alpha 2 remain immutable but are superseded for installation acceptance.

Alpha.4 installed-VM evidence: exact candidate `b1b9974ff799961cb31a187395993d21afbeb9c9`; MSI SHA-256 `9A288103053F2ED56F912473906B08B0E3E0E570DADB4912CBECA552E9ACB509`; bootstrap SHA-256 `103C9D5774C06635CE42C40D4D7DA573A92203BAF28C16D68894EECD98D9234B`. Extraction matched 6,842/6,842 manifest files and 68/68 applicable signatures. On fresh Windows 11 Pro VM `OSD Server`, Check passed 20/20; install, repair and reinstall each passed 34/34; Agent LocalSystem, Web LocalService, State ACL, service SID, pipe DACL, SQLite, health/login/profile/manual and profile persistence passed. Uninstall removed binaries/services while preserving State and SQLite. Alpha 1 through alpha 3 remain immutable and are superseded for installation acceptance.

## Remaining external release acceptance

| Blocker | Required evidence |
|---|---|
| Current certificate baseline is self-signed | Acceptable for approved internal test hosts after explicit CER trust; replace with the future public/organization code-signing and TLS certificates for formal distribution |
| v2 live runtime not deployment-accepted | Installed Agent/Web health, ACL, DPAPI and named pipe are proven; installed v1 migration remains open against the exact MSI |
| Internal prerelease deployment gate open | On the exact MSI, prove one Generation 2 Secure Boot client to `windows-desktop-ready`, then ingress stopped + Fleet empty and one Software Test with checkpoint restore |
| Final production feature parity open | Two consecutive four-VM rounds, physical laptop, torrent, Offline ISO and diagnostics/evidence export remain later production evidence and are not replaced by this prerelease VM run |
| LAN management not live-tested | Loopback default plus certificate-store HTTPS opt-in and invalid-certificate fail-closed tests |
| Upstream redistribution review incomplete | Confirm OSDCloud/ADK/WinPE, aria2 and every bundled client payload against the release SBOM; the Winception product license is already `AGPL-3.0-only` |

The v2 prerelease may be published only as an internal test download for fresh-VM acceptance. Do not publish Pages until the internal prerelease deployment gate is closed for the exact release build. Do not merge v2 to `master` or label it production-ready until every final-production row is closed in `TEST-RESULT.md`.
