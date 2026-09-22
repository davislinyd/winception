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

## GitHub Pages

Public site: https://davislinyd.github.io/winception/

Live site is **Operations Manual · v1.1.0**, published from `master` by `workflow_dispatch` of `.github/workflows/publish-pages.yml` (run https://github.com/davislinyd/winception/actions/runs/35532334721). It is not bound to a Git tag.

Builder and workflow on `master`:

- `tools/Build-GitHubPages.ps1` copies `docs/winception-operations-manual.html` to `index.html`, copies `docs/manual-assets/`, copies `docs/winception_torrent_deck/` to `torrent/` (so https://davislinyd.github.io/winception/torrent/ does not replace the root manual), writes `.nojekyll`, and rewrites reference links to `https://github.com/davislinyd/winception/blob/master/...`.
- It reads `package.json` version and requires the manual markers `Operations Manual · v{version}` and `Web v{version}`. It does **not** require a Git tag.
- `.github/workflows/publish-pages.yml` is **workflow_dispatch-only** on `ubuntu-latest`. It must not run on `push` to `master` (`lab-deploy.yml` already does) and must not bind to `v1.*` tags.
- Do **not** create a Git tag or GitHub Release just to refresh Pages.

To refresh the public site, dispatch `.github/workflows/publish-pages.yml` after the operator reviews the builder and workflow. Do not bind it to `push` on `master`. After deploy, confirm the live page still shows the current `package.json` version, pairing, boot-session, Guided mode, and first-boot AutoLogon as current SetupComplete behavior.

Technicians can also use the in-repo HTML or Console `/manual/`.

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
