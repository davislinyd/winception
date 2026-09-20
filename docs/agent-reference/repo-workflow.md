# Agent Reference: Repo Workflow

Read this file when a task touches documentation updates, Git file selection, generated artifact handling, handoff, push, or deployment-clone workflow details.

## Documentation Roles

- `AGENTS.md` is the always-on global hardening contract for future agents.
- `TEST-RESULT.md` is the detailed evidence-oriented 0-to-1 deployment record and no-AI operator runbook.
- `docs\agent-reference\...` contains conditional task references that agents should read only when relevant.
- `README.md` is the concise bilingual product technician guide.
- `handoff.md` is the current AI-agent continuation brief (Git state, live host snapshot, open work). It is not the technician product guide.
- `CHANGELOG.md` is the concise history of tracked product/documentation changes when the workflow calls for it.

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

## GitHub Pages republish (plan only)

Public site: https://davislinyd.github.io/winception/

Current state:

- Last successful deploy: 2026-07-17, commit `040bc57`, labeled **Operations Manual · v1.0.3**.
- GitHub Pages `build_type` is `workflow`; the live site is a frozen artifact.
- `tools/Build-GitHubPages.ps1` and `.github/workflows/publish-v1-pages.yml` were added in `040bc57` and reverted in `903c3da`. They are not on `HEAD`.
- The old workflow published only stable `v1.*` tags and required `package.json` version to match the tag. There is no `v1.1.0` tag, so the public page never moved past v1.0.3.
- Current product manual is `docs/winception-operations-manual.html` plus `docs/manual-assets/`. Installed Web Console already serves it at `/manual/`.

Do **not** republish until the operator names this track. Do **not** create a Git tag or GitHub Release just to refresh Pages.

When authorized, recommended steps (no tag, no Release, no `lab-deploy.yml`):

1. Restore and adapt `tools/Build-GitHubPages.ps1` so it copies `docs/winception-operations-manual.html` to `index.html`, copies `docs/manual-assets/`, writes `.nojekyll`, and rewrites reference links to `https://github.com/davislinyd/winception/blob/master/...`. Stop requiring `package.json` version to match a release tag. Keep the manual version markers (`Operations Manual · v1.1.0` / `Web v1.1.0`).
2. Add a **workflow_dispatch-only** Pages workflow on `ubuntu-latest` using `actions/upload-pages-artifact` and `actions/deploy-pages`. Do not bind it to `v1.*` tags and do not run it on every `master` push (`lab-deploy.yml` already fires on master).
3. Confirm the GitHub Pages source remains GitHub Actions. Dispatch once. Verify the live page shows v1.1.0, pairing, boot-session, Guided mode, and first-boot AutoLogon as current SetupComplete behavior.
4. After the first successful deploy, point README references at the live URL.

Until then, technicians should use the in-repo HTML or Console `/manual/`, not the public GitHub.io snapshot.

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

Keep `.ai/status.json`, preview fixtures and validation logs local and out of commits. Onboarding wiring/flow SVGs and the existing bilingual/portable manual are product documentation. Actual annotated manual screenshots must contain only isolated preview data; runtime evidence remains uncommitted.

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

## Automation Bundle And Evidence

- The PR workflow operates in the GitHub runner checkout and must never use C:\OSDCloud as its working directory. Its job is limited to source/Web/API/PowerShell checks and local smoke tests.
- The master Lab workflow first exports a versioned HostTools bundle from tracked allowlisted files only. The exporter rejects output inside the source root, rejects path traversal, excludes secrets, runtime state, logs, screenshots, WIM/ISO/VHD files, .ai, and untracked files, and writes bundle-manifest.json with commit, version, length, and SHA-256.
- The installed bundle is copied to C:\OSDCloud\HostTools\App and receives npm ci there. The live deployment root remains product-managed by Initialize-DeploymentServer.ps1, runtime restore, Endpoint Sync, and the existing Web/API contracts; agents must not patch it directly.
- Lab evidence belongs under HostTools State lab evidence and is uploaded only after de-secretization. Expected evidence includes runner guard, cache manifest, bundle manifest, server/API preflight, Fleet runs, sanitized HTTP/TFTP/DHCP logs, iPXE artifacts, and PowerShell Direct VM results.
- GitHub Actions artifacts are disposable evidence, not source files. Never upload the local secret store, environment values, raw credentials, unredacted command lines, WIM/ISO/VHD artifacts, or production runtime snapshots.
