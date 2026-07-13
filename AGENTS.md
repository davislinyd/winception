# Agent Instructions

Winception deploys Windows 11 through OSDCloud. Prefer precise, minimal changes and evidence-based handoffs.

## Start

Run `git status --short --branch`, `git remote -v`, and inspect `.ai/status.json` when present. Compare status with live Git; report drift before using it. Read `package.json` before selecting commands. Never pull during a read-only review unless current remote state is required.

`.ai/status.json` is ignored local handoff memory and has exactly four string fields: `project_scope`, `active_milestone`, `pending_handoff`, `critical_context`. Git branch, dirty state, diffs, history, and static configuration must be obtained live, never copied into status.

## Route before reading code

- v2 TypeScript/Fastify/React, contracts, IPC, persistence, operations: `docs/agent-reference/v2-architecture.md`
- v1 console ownership: `docs/agent-reference/module-map.md`
- Runtime, endpoint, services, preflight, OS/profile publish: `docs/agent-reference/runtime-web-console.md`
- Software Test VM: `docs/agent-reference/software-test.md`
- Deployment paths, physical laptop, VM, timing, USB/ISO: `docs/agent-reference/deployment-paths.md`
- Verification selection: `docs/agent-reference/validation-scenarios.md`
- Docs, generated files, Git, handoff: `docs/agent-reference/repo-workflow.md`
- Operator evidence/runbook: `TEST-RESULT.md`

Open only the reference required by the task. Search symbols before opening large files.

## Boundaries

- Workspace code is the only editable source. Do not manually patch the installed bundle, Web-selected deployment root, or product runtime.
- `C:\OSDCloud\HostTools\App` is installed code; `...\State` is mutable host state; the Web-selected root (default `C:\OSDCloud`) is deployment state.
- Committed endpoint/config values and historical evidence are not live truth. Before runtime mutation, read the active Web/API/config, NIC, boot mode, services, image, profile, and Fleet state.
- Run preflight before services. Warnings do not block; any blocking failure does. Never start DHCP until the LAN DHCP arrangement is explicitly safe. Never silently change NIC settings.
- Physical-laptop evidence must use the live endpoint. VM evidence cannot prove physical readiness. USB/ISO work stays additive and outside the active PXE Media tree.
- Web read-only checks must not mutate. Verify and commit source before live deployment testing.

## Security and changes

- Never expose or commit credentials, tokens, cookies, OTPs, command lines containing secrets, or plaintext deployment secrets. Keep local secret/config overlays ignored.
- v2 Web must not accept arbitrary commands or paths; privileged work uses versioned allow-list Agent commands. LAN management requires HTTPS and fails closed.
- Preserve unrelated dirty changes. Change only requested scope. Stop after three materially identical failures and report evidence.
- After behavior changes, update the relevant code tests, official manual/docs, diagrams, `CHANGELOG.md`, and local status. Do not commit generated deployment artifacts, logs, screenshots, images, WIM/ISO/VHD files, or `.ai/status.json`.
- Source tests do not prove installed bundle, VM, PXE, or physical-laptop readiness; report each evidence layer separately.
