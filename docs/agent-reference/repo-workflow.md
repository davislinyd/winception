# Agent Reference: Repo Workflow

Read this file when a task touches documentation updates, Git file selection, generated artifact handling, handoff, push, or deployment-clone workflow details.

## Documentation Roles

- `AGENTS.md` is the always-on global hardening contract for future agents.
- `TEST-RESULT.md` is the detailed evidence-oriented 0-to-1 deployment record and no-AI operator runbook.
- `docs\agent-reference\...` contains conditional task references that agents should read only when relevant.
- `README.md` is the concise bilingual product technician guide.
- `CHANGELOG.md` is the concise history of tracked product/documentation changes when the workflow calls for it.
- `apps/docs/docs` and the English mirror under `apps/docs/i18n/en` are the only v2 manual sources. `docs/winception-operations-manual.html` is retained as v1 history, not maintained in parallel.

When behavior changes, update the relevant docs in the same workflow:

```text
README.md
TEST-RESULT.md
AGENTS.md
CHANGELOG.md
docs\agent-reference\...
osdcloud-assets
```

For deployment flow, Web console behavior, service-interface selection, endpoint synchronization, network topology, validation criteria, or failure triage changes, update the README product guide sections so a technician can run the workflow without reading agent-only files.

For portability/setup changes, update the README handoff/fresh-clone flow, `osdcloud-assets\README.md`, and `TEST-RESULT.md` when the 0-to-1 operator path or fresh-clone readiness evidence changes.

Git clone directories are installation and configuration sources only. Deployment runtime files must be created under the Web-selected runtime root, with `C:\OSDCloud` as the proven default, and never written back into the clone. The runtime root must stay outside the clone and outside `C:\OSDCloud\HostTools`. After `Setup-DeploymentServer.cmd` installs `C:\OSDCloud\HostTools\App` and `C:\OSDCloud\HostTools\State`, the deployment host may delete the original clone and keep operating from the installed bundle.

## Development And Workspace Flow

Use Git to track docs and process definitions in the active repository clone.

After code changes, finish by updating related documentation and Git state in the same workflow unless the user explicitly scoped the task differently. For documentation-only or process-only updates, push only when the user requests it, the task is a handoff/release, or another repo rule requires it.

All development, documentation, and deployment-facing testing must start directly from the active Git repository clone workspace.

## Files To Track When Relevant

Track these files by default when relevant:

```text
README.md
AGENTS.md
TEST-RESULT.md
docs\agent-reference\...
.ai/status.json
CHANGELOG.md
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

Generated documentation source assets under `apps/docs/static/data` and `apps/docs/static/search` are tracked and must match `npm run docs:assets:check`; edit their canonical MDX or `docs/diagrams/flow-source.json`, then regenerate. Built `dist/docs-pages` and `dist/v2/web/manual` outputs remain ignored.

The GitHub Pages workflow is manual-only and must live on the default branch. It accepts a full 40-character v2 commit SHA, checks out exactly that commit, runs only documentation parity/link/build checks, and publishes `dist/docs-pages`. Do not run the remote product workflow as part of documentation publication. Do not publish Pages or a v2 prerelease before exact-MSI VM acceptance is recorded.
