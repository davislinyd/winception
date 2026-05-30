# Agent Reference: Repo Workflow

Read this file when a task touches documentation updates, Git file selection, generated artifact handling, handoff, push, or deployment-clone workflow details.

## Documentation Roles

- `AGENTS.md` is the always-on global hardening contract for future agents.
- `TEST-LOOP.md` is the bounded test, validation, and debug loop.
- `docs\agent-reference\...` contains conditional task references that agents should read only when relevant.
- `README.md` is the concise human operator runbook.
- `OSDCloud-Win11-Automated-Deployment-Test-Report.md` is the detailed historical evidence and result-interpretation record.

When behavior changes, update the relevant docs in the same workflow:

```text
README.md
OSDCloud-Win11-Automated-Deployment-Test-Report.md
AGENTS.md
TEST-LOOP.md
docs\agent-reference\...
osdcloud-assets
```

For deployment flow, Web console behavior, service-interface selection, endpoint synchronization, network topology, validation criteria, or failure triage changes, update the README user manual sections so a human operator can run the workflow without reading agent-only files.

For portability/setup changes, update the README handoff/fresh-clone flow, `osdcloud-assets\README.md`, and the report's fresh-clone readiness note, especially when the installed host-management bundle or repo-deletion boundary changes.

Git clone directories are installation and configuration sources only. Deployment runtime files must be created under the fixed project root (`C:\OSDCloud`), never written back into the clone. After `Setup-DeploymentServer.cmd` installs `C:\OSDCloud\HostTools\App` and `C:\OSDCloud\HostTools\State`, the deployment host may delete the original clone and keep operating from the installed bundle.

## Development And Handoff

Use Git to track docs and process definitions in the development workspace.

After code changes, finish by updating related documentation and Git state in the same workflow unless the user explicitly scoped the task differently. For documentation-only or process-only updates, push only when the user requests it, the task is a handoff/release, or another repo rule requires it.

After pushing from the development workspace:

1. Switch to `C:\osdcloud-win11-deployment-lab`.
2. Verify it is clean.
3. Run `git pull --ff-only origin master`.
4. Confirm its HEAD matches the pushed development commit before any Web/runtime/PXE/deployment test.

Deployment-facing tests must start from the deployment clone, not from `C:\Users\davis\Documents\Codex\osdcloud-project`.

## Files To Track When Relevant

Track these files by default when relevant:

```text
README.md
AGENTS.md
TEST-LOOP.md
docs\agent-reference\...
.ai/status.json
OSDCloud-Win11-Automated-Deployment-Test-Report.md
Setup-DeploymentServer.cmd
Deploy-DeploymentServer.cmd
package.json
package-lock.json
config\...
Softwares\...
Scripts\...
tools\...
docs\...
osdcloud-assets\README.md
osdcloud-assets\manifest.json
osdcloud-assets\OSDCloud\...
.gitignore
```

For OSDCloud behavior changes, the intended commit set must include synchronized `osdcloud-assets` files. The sync mirror must not contain real deployment secrets; use ignored local secret files or environment variables for account and SMB passwords.

## Generated Artifacts

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

Generated runtime outputs and local development data must remain excluded from version control.
