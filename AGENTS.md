# Agent Instructions

This repository documents and validates the Winception Windows 11 zero-touch deployment product using OSDCloud. Keep this file as the always-on operational contract for future agents. Use conditional reference files for task-specific details.


## Startup Checks

At the start of any new session or context switch in this repository:

1. Run `git rev-parse --is-inside-work-tree`.
2. If inside a Git repository, run `git status --short --branch` and `git remote -v`.
3. If `.ai/status.json` exists, inspect it together with live Git state. If it does not exist, report that no status file exists and do not create one during a read-only status check.
4. Immediately alert the user if `.ai/status.json` is outdated compared to current working tree state, branch/upstream state, remote state, or recent commits.


## Reference Files

Read these files only when the task touches the relevant area:

- Changing console code (which file owns a feature, where to make an edit, front-end/back-end module layout): `docs/agent-reference/module-map.md`. Use it to open one focused module instead of reading a whole monolith.
- Deployment path, physical laptop, VM regression, timing run, USB/ISO, or path evidence questions: `docs/agent-reference/deployment-paths.md`.
- Runtime Readiness, Prepare runtime, endpoint sync, Web console, service controls, OS Image Cache, deployment profile publish, WinPE, SetupComplete, or desktop-ready behavior: `docs/agent-reference/runtime-web-console.md`.
- Choosing verification for Web, OS image, profile/software/custom script, driver pack, multi-client, WinPE/SetupComplete, or other subsystem changes: `docs/agent-reference/validation-scenarios.md`.
- Documentation updates, Git file selection, generated artifact handling, handoff, push, or deployment-clone workflow questions: `docs/agent-reference/repo-workflow.md`.
- Completed 0-to-1 deployment setup evidence, restored-VM rebuild steps, or no-AI operator runbook questions: `TEST-RESULT.md`.
- Product technician instructions: `README.md`.

## Live State Rules

Do not treat committed endpoint settings, historical run evidence, or host snapshots as the current deployment state.

Before starting services, endpoint sync, preflight, runtime validation, or deployment validation:

- Read the active deployment project root / working directory, service interface, service IP, DHCP lease range, router, HTTP base, SMB share, active OS image, driver cache summary, and active deployment profile from live Web/API/config state.
- Inspect `config\osdcloud-console.json`, any ignored local overlay, the active client boot mode (`dhcp.bootMode`: `secureboot` or `ipxe`), live `boot.ipxe`, host adapter state, and relevant Web state immediately before acting.
- Treat `config\osdcloud-console.json` as the last synced deployment snapshot, not guaranteed production truth.
- If the repo or runtime appears to be on a non-production endpoint, switch deliberately before physical-laptop validation.

## Path Guardrails

- For deployment path, physical laptop, VM regression, timing, USB/ISO, or path evidence tasks, read `docs/agent-reference/deployment-paths.md`.
- Physical-laptop work must use the Web-selected live endpoint.
- VM regression evidence must not be used as proof that the physical-laptop path is ready.
- The retired ISO path must not be restored as the active deployment path.
- USB/ISO installer work must remain additive: stage outside the runtime Media tree and do not mutate PXE endpoint, services, published boot media, or the retired `Win11-Lab` path.

## Workspace Isolation

- Workspace: The active Git repository clone directory. Edit code, docs, tests, Git history, `.ai/status.json`, and run tests directly in this directory.
- Installed host management bundle: `C:\OSDCloud\HostTools\App`. This is the post-setup execution root for the deployment host Web console and helper scripts.
- Installed host state: `C:\OSDCloud\HostTools\State`. This holds mutable local config, local overlay, deployment secrets, upload staging, and other host-only state.
- Runtime root: the Web-selected deployment project root, with `C:\OSDCloud` as the proven default. Code paths may still allow another absolute path, but it must stay outside the Git clone and outside `C:\OSDCloud\HostTools`. This is product-managed runtime state. Do not manually patch, copy into, or directly edit files there.
- If deployment testing fails, debug and fix the code directly in the active Git repository workspace.

## Secrets

- Do not commit real account, SMB, token, cookie, OTP, or deployment secret values.
- Keep `config\osdcloud-secrets.json` local and ignored by Git; use `config\osdcloud-secrets.example.json` only as the committed schema.
- Expected local secret keys are `windowsUsername`, `windowsPassword`, and `pxeinstallPassword`.
- During testing and validation, if deployment secret values are already present in an ignored local file, approved environment variables, or have been provided by the user, agents may save or update the ignored local deployment secrets directly without asking for another confirmation. If usable values are missing, ask the user for them.
- API responses, logs, docs, tests, commits, PR text, `.ai/status.json`, and final reports must never include plaintext secret values.
- Environment fallbacks are `OSDCLOUD_WINDOWS_USERNAME`, `OSDCLOUD_WINDOWS_PASSWORD`, and `OSDCLOUD_PXEINSTALL_PASSWORD`.

## Runtime Guardrails

- For Runtime Readiness, endpoint sync, Web console, OS image, profile publish, WinPE, SetupComplete, or desktop-ready tasks, read `docs/agent-reference/runtime-web-console.md`.
- A Git clone alone is not a deployable PXE runtime and must remain an installation/configuration source only. After setup installs `C:\OSDCloud\HostTools`, the original clone may be deleted if no further source edits are needed on that host.
- Do not manually patch, copy into, or directly edit the Web-selected deployment project root.
- After changing `tools/osdcloud-console/src/`, reload or restart the Web console before validating behavior. Changes limited to `tools/osdcloud-console/web/js/`, `web/css/`, or `web/index.html` only need a browser reload.
- HostTools version checks may query the public GitHub latest formal Release only after the Web listener is ready. They must use the State cache, remain non-blocking and offline-safe, ignore prerelease/draft tags, and never download, install, overwrite, or restart.
- Web read-only checks must not mutate live runtime state.
- Web mutating actions can modify live deployment state.
- Run preflight before starting services.
- Do not start DHCP until the real LAN DHCP server is confirmed disabled for the test window.
- Do not silently change Windows NIC IP settings.

## Documentation

When behavior changes, update the relevant docs in the same workflow:

```text
README.md
TEST-RESULT.md
AGENTS.md
CHANGELOG.md
docs\agent-reference\...
osdcloud-assets
```

Keep `README.md` concise, bilingual, and product-facing. Keep `TEST-RESULT.md` as the detailed evidence-oriented 0-to-1 record and no-AI operator runbook. Keep `AGENTS.md` focused on always-on operational rules. Keep `docs\agent-reference` focused on conditional task references.

## Git And Status Workflow

Use Git to track docs and process definitions in this workspace.

For read-only review, planning, or status checks, do not pull by default. Pull only when the worktree is clean and the task requires current remote state, the user requests it, or an existing workflow specifically requires it.

Before editing, check for unexpected uncommitted changes. If unrelated changes exist, do not revert them. If they affect the task, work with them or stop and report the conflict.

After modifying code, docs, config, tests, tracked project behavior, verification state, commit/push state, or when the user asks for a status refresh, update `.ai/status.json` if the repository uses it.

`.ai/status.json` minimum sync semantics:

- Keep `workspace_state.git_branch`, `workspace_state.git_dirty`, `workspace_state.pending_todo`, and `recent_changes` aligned with live Git state and the current handoff.
- If `.ai/status.json` says a different branch, upstream state, dirty state, or pending task than the live repo, call that out before acting on the file.
- Maintain `recent_changes` as at most 5 newest entries, newest first, with concise structured entries and no secrets or long logs.

After code changes, finish by updating related documentation and Git state in the same workflow unless the user explicitly scoped the task differently. For documentation-only or process-only updates, push only when the user requests it, the task is a handoff/release, or another repo rule requires it.

Verify and commit changes in the active Git repository clone directory before any Web/runtime/PXE/deployment test.

Do not commit generated deployment artifacts unless the user explicitly asks:

```text
*.iso
*.wim
*.esd
*.vhd
*.vhdx
*.avhdx
downloads/
*.png
*.log
```
