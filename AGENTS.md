# Agent Instructions

This repository documents and validates a Windows 11 zero-touch deployment lab using OSDCloud and iPXE. Keep this file as the always-on operational contract for future agents. Use conditional reference files for task-specific details.

## Current Goal

The working target is a repeatable Web-console-first OSDCloud deployment flow that deploys Windows 11 Pro 25H2 zh-TW and boots directly to the `davis` desktop with no human interaction inside OOBE.

## 0-to-1 Test Evidence

`TEST-RESULT.md` is the authoritative evidence and no-AI operator runbook for a completed from-zero deployment setup test. If `TEST-RESULT.md` does not exist, treat this repository as having no documented completed 0-to-1 deployment test.

For restored VMs or other deployment computers, use `TEST-RESULT.md` to rebuild from GitHub clone to PXE-ready state without AI assistance. Still read live Web/API/config state before acting; the test result is evidence and a runbook, not a substitute for live state.

## Startup Checks

At the start of any new session or context switch in this repository:

1. Run `git rev-parse --is-inside-work-tree`.
2. If inside a Git repository, run `git status --short --branch` and `git remote -v`.
3. If `.ai/status.json` exists, inspect it together with live Git state. If it does not exist, report that no status file exists and do not create one during a read-only status check.
4. Immediately alert the user if `.ai/status.json` is outdated compared to current working tree state, branch/upstream state, remote state, or recent commits.

## Autonomous Test Loop

For any request to test, verify, validate, debug a failing test, run preflight, validate runtime readiness, validate deployment, or exercise the physical-laptop/iPXE path, read and follow `TEST-LOOP.md` before executing the work.

Follow `TEST-LOOP.md` as a bounded autonomous loop: test, collect evidence, classify failures, find root cause, make the smallest safe fix, run focused verification, and continue testing until the completion definition is met or a documented human intervention gate blocks progress.

Do not treat a single failed test, failed preflight, failed deployment phase, or unclear runtime state as the final result unless root cause analysis has been completed and the next step is blocked by a human intervention gate.

## Reference Files

Read these files only when the task touches the relevant area:

- Deployment path, physical laptop, VM, VM regression, vSwitch, timing run, ISO, or path evidence questions: `docs/agent-reference/deployment-paths.md`.
- Runtime Readiness, Prepare runtime, endpoint sync, Web console, service controls, OS Image Cache, deployment profile publish, WinPE, SetupComplete, or desktop-ready behavior: `docs/agent-reference/runtime-web-console.md`.
- Choosing verification for Web, OS image, profile/software/custom script, driver pack, multi-client, WinPE/SetupComplete, or other subsystem changes: `docs/agent-reference/validation-scenarios.md`.
- Documentation updates, Git file selection, generated artifact handling, handoff, push, or deployment-clone workflow questions: `docs/agent-reference/repo-workflow.md`.
- Completed 0-to-1 deployment setup evidence, restored-VM rebuild steps, or no-AI operator runbook questions: `TEST-RESULT.md`.
- Human operator instructions: `README.md`.
- Historical evidence and result interpretation: `OSDCloud-Win11-Automated-Deployment-Test-Report.md`.

## Live State Rules

Do not treat committed endpoint settings, historical run evidence, or host snapshots as the current deployment state.

Before starting services, endpoint sync, preflight, runtime validation, or deployment validation:

- Read the active deployment project root / working directory, service interface, service IP, DHCP lease range, router, HTTP base, SMB share, active OS image, driver cache summary, and active deployment profile from live Web/API/config state.
- Inspect `config\osdcloud-console.json`, any ignored local overlay, live `boot.ipxe`, host adapter state, and relevant Web state immediately before acting.
- Treat `config\osdcloud-console.json` as the last synced lab snapshot, not guaranteed production truth.
- If the repo or runtime appears to be on a VM/vSwitch endpoint, switch deliberately before physical-laptop validation.

## Path Guardrails

- For deployment path, physical laptop, VM, VM regression, vSwitch, timing, ISO, or path evidence tasks, read `docs/agent-reference/deployment-paths.md`.
- Physical-laptop work must use the Web-selected live endpoint.
- VM/VM/vSwitch/headless evidence must not be used as proof that the physical-laptop path is ready.
- The retired ISO path must not be restored as the active deployment path.

## Workspace Isolation

- Development workspace: `C:\Users\davis\Documents\Codex\osdcloud-project`. Edit code, docs, tests, Git history, and `.ai/status.json` here.
- Deployment clone: `C:\osdcloud-win11-deployment-lab`. Use only after a pushed development commit is pulled with `git pull --ff-only origin master`; do not edit or hotfix code there.
- Installed host management bundle: `C:\OSDCloud\HostTools\App`. This is the post-setup execution root for the deployment host Web console and helper scripts.
- Installed host state: `C:\OSDCloud\HostTools\State`. This holds mutable local config, local overlay, deployment secrets, upload staging, and other host-only state.
- Runtime root: the Web-selected deployment project root, with `C:\OSDCloud` as the proven default. This is product-managed runtime state. Do not manually patch, copy into, or directly edit files there. Never place this root inside the Git clone.
- If deployment testing fails, return to the development workspace, fix there, commit and push, update the deployment clone, then retest from the deployment clone.

## Secrets

- Do not commit real account, SMB, token, cookie, OTP, or deployment secret values.
- Keep `config\osdcloud-secrets.json` local and ignored by Git; use `config\osdcloud-secrets.example.json` only as the committed schema.
- Expected local secret keys are `davisPassword` and `pxeinstallPassword`.
- During testing and validation, if deployment secret values are already present in an ignored local file, approved environment variables, or have been provided by the user, agents may save or update the ignored local deployment secrets directly without asking for another confirmation. If usable values are missing, ask the user for them.
- API responses, logs, docs, tests, commits, PR text, `.ai/status.json`, and final reports must never include plaintext secret values.
- Environment fallbacks are `OSDCLOUD_DAVIS_PASSWORD` and `OSDCLOUD_PXEINSTALL_PASSWORD`.

## Runtime Guardrails

- For Runtime Readiness, endpoint sync, Web console, OS image, profile publish, WinPE, SetupComplete, or desktop-ready tasks, read `docs/agent-reference/runtime-web-console.md`.
- A Git clone alone is not a deployable PXE runtime and must remain an installation/configuration source only. After setup installs `C:\OSDCloud\HostTools`, the original clone may be deleted if no further source edits are needed on that host.
- Do not manually patch, copy into, or directly edit the Web-selected deployment project root.
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
OSDCloud-Win11-Automated-Deployment-Test-Report.md
AGENTS.md
TEST-LOOP.md
docs\agent-reference\...
osdcloud-assets
```

Keep `README.md` concise and user-facing. Keep the report detailed and evidence-oriented. Keep `AGENTS.md` focused on always-on operational rules. Keep `TEST-LOOP.md` focused on testing/debug iteration. Keep `docs\agent-reference` focused on conditional task references.

## Git And Status Workflow

Use Git to track docs and process definitions in this workspace.

For read-only review, planning, or status checks, do not pull by default. Pull only when the worktree is clean and the task requires current remote state, the user requests it, or an existing workflow specifically requires it.

Before editing, check for unexpected uncommitted changes. If unrelated changes exist, do not revert them. If they affect the task, work with them or stop and report the conflict.

After modifying code, docs, config, tests, tracked project behavior, verification state, commit/push state, or when the user asks for a status refresh, update `.ai/status.json` if the repository uses it.

`.ai/status.json` dirty semantics:

- `git.dirty` means uncommitted repo-tracked changes excluding `.ai/status.json` itself.
- Use `git status --porcelain -- ':!.ai/status.json'` to determine dirty state.
- If only `.ai/status.json` is modified, keep `git.dirty` as `false` and mention that the status file itself is uncommitted.
- Maintain `recent_changes` as at most 5 newest entries, newest first, with concise structured entries and no secrets or long logs.

After code changes, finish by updating related documentation and Git state in the same workflow unless the user explicitly scoped the task differently. For documentation-only or process-only updates, push only when the user requests it, the task is a handoff/release, or another repo rule requires it.

After pushing from the development workspace, update the deployment clone before any Web/runtime/PXE/deployment test. See `docs/agent-reference/repo-workflow.md` for the detailed handoff workflow.

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
