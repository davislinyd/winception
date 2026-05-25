# Agent Reference: Runtime And Web Console

Read this file when a task touches Runtime Readiness, Prepare runtime, endpoint sync, Web console behavior, service controls, OS Image Cache, deployment profile publish, WinPE, SetupComplete, or desktop-ready behavior.

## Runtime Readiness

- A Git clone alone is not a deployable PXE runtime. Live deployment runs from `C:\OSDCloud`, prepared by Web Runtime Readiness / Prepare runtime and related Web actions.
- New-host setup is lightweight: clone, run `Setup-DeploymentServer.cmd`, choose only the Web management listen IP, then continue in Web.
- Setup must not create deployment secrets, write PXE endpoint overlay state, create the `C:\OSDCloud` runtime skeleton, download/rebuild ADK or WinPE, restore artifacts, run preflight, or start HTTP/TFTP/DHCP services.
- Web first-run initialization owns secrets, Runtime Readiness / Prepare runtime, PXE/service endpoint sync, OS Image Cache, profile publish, preflight, and service controls.
- During testing, agents may use the Web/API initialization flow to save or refresh deployment secrets without extra confirmation when usable values are already available from ignored local files, approved environment variables, or prior user input. Never print, commit, or record plaintext secret values.
- Prepare runtime must treat both `C:\OSDCloud\Media\sources\boot.wim` and `C:\OSDCloud\PXE-HttpRoot\osdcloud\boot.wim` as required boot artifacts.
- Prepare runtime is only for boot/iPXE/WinPE runtime artifacts. It must not download client software merely because software exists in the catalog.
- Do not pin exact size/hash for the generated WinPE `boot.wim` in the runtime catalog. It is host- and endpoint-specific after ADK/OSDCloud generation and endpoint sync; readiness should require the source and published paths to exist, while stable downloaded artifacts and boot binaries keep size/SHA validation.
- A `size-mismatch` readiness result means the artifact is incomplete or out of sync, not that deployment services are running.

## Endpoint Sync

- Runtime restore and OS image helpers must merge committed base config with ignored local overlay. Do not pass a partial `.local.json` overlay as a full config.
- Bootstrap/setup must not silently change Windows NIC IP settings. If preflight reports that the service IP is not assigned or cannot bind, tell the operator to identify/configure the PXE/client NIC or use `tools\Set-IpxePhysicalNic.ps1` explicitly.
- Before physical-laptop validation, select the intended service interface in the Web console or deliberately run `tools\Set-OsdCloudIpxeEndpoint.ps1` with `-CommitWinPe -SyncAssets -HashLargeArtifacts`.
- After changing deployment behavior that affects live runtime or WinPE, sync `osdcloud-assets` through the project workflow before committing.

## Web Console

- Use the Web console for the active physical-laptop path unless the user explicitly requests lower-level helper scripts.
- Web owns DHCP, TFTP, HTTP media/status serving, live status display, log tailing, endpoint sync progress, fleet state, and validation summary.
- The checked-in Web code and local operator usability are the source of truth. Historical design references may inform work, but they are not mandatory design authority.
- Start the Web console from elevated PowerShell when it will control services.
- Starting `npm run web`, opening the UI, and reading state/status/logs/validation must not modify `C:\OSDCloud`.
- Web mutating actions can modify live deployment state: endpoint sync, OS image cache, profile publish, clear status, and service start/stop.
- Do not run Web console and headless services at the same time to control services. They can conflict on ports 67, 69, and 80.
- Run preflight before starting services.
- Do not start DHCP until the real LAN DHCP server is confirmed disabled for the test window.
- Do not add a Web `Configure physical NIC` action; keep Windows adapter IP assignment as an explicit script/manual step.
- Keep confirmation gates for DHCP/PXE service start/stop toggles and status-file deletion.
- Stopped service cards are neutral, not failures. Use red only for actual blocked/error states.
- Read-only Web checks may fetch `/`, `styles.css`, `app.js`, `/api/state`, `/api/interfaces`, and `/api/profiles`; they must not click service start/stop, endpoint sync, profile publish/delete, or clear-status actions unless the user explicitly authorizes live mutation.

## OS Image And Profile Publish

- Fresh clones may have no active OS image, profile OS image, or `selected-os.json`. Web must show a clear no-OS-image state.
- Profile publish and preflight must fail clearly until a deployable WIM and `selected-os.json` exist.
- OS image acquisition is host/Admin Console only.
- Web OS Image Cache downloads or imports ISO/ESD/WIM sources, inspects DISM indexes, exports one selected index to a deployable WIM, and publishes `selected-os.json` with deploy index `1`.
- Client app and custom script payloads are selected by deployment profiles and live Web/API/config state. Do not hard-code a current software list; read the active profile and catalog.
- Profile publish is responsible for selected client software payloads. Before clearing live `Apps`, it must verify each selected software installer from `config\software-catalog.json`; if the installer is missing and `downloadUrl` is configured, download to repo-local staging, verify size/SHA-256, then publish only selected folders. Missing or mismatched selected installers without a usable download must fail closed.
- Minimal/no-software profiles should still publish `Install-Apps.ps1` and `selected-profile.json` without downloading any client software. Preflight validates published `Apps` plus `selected-profile.json`, not unselected catalog software.

## Deployment Behavior

- Do not put OOBE injection in `Config\Scripts\StartNet`; OOBE injection belongs in `Config\Scripts\Shutdown`, after Windows is applied and before WinPE shuts down.
- Keep the Web-exported Windows WIM under `Media\OSDCloud\OS`; deployment should use the no-redownload SMB path.
- For iPXE no-redownload deployment, do not use `-ImageFileUrl`. WinPE must map `\\<service-ip>\OSDCloudiPXE` as `Z:`, read `Z:\OSDCloud\OS\selected-os.json`, set `$Global:StartOSDCloud.ImageFileDestination` to the exported WIM `FileInfo`, then call `Invoke-OSDCloud`.
- For iPXE custom image deployment, do not mix custom image parameters with catalog OS parameters such as `-OSName`, `-OSLanguage`, `-OSEdition`, or `-OSActivation`.
- For isolated or restricted networks, remove or bypass external startup update behavior that stalls before `Start-OSDCloud`.
- When changing iPXE `SetupComplete`, update live runtime files and the embedded copy inside `boot.wim`.
- Screenshot progress evidence is best-effort only. JSON deployment status and logs are the source of truth.
- Do not install a desktop screenshot Startup helper from `SetupComplete`; the previous approach caused Defender/AMSI blocking.
- The desktop-ready scheduled task must use an any-user logon trigger with a SYSTEM principal and must keep retrying until `windows-desktop-ready` is successfully POSTed.
- The desktop-ready marker must prove the interactive user is `davis`; do not use `C:\Users\Public\Desktop\OSDCloud-Desktop-Ready.txt` as proof.
