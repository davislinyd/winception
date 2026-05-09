# Agent Instructions

This workspace documents and validates a Windows 11 zero-touch deployment lab using OSDCloud and iPXE. The active physical-laptop path does not use VM; VM content is historical regression evidence only.

## Current Goal

The working target is a repeatable OSDCloud deployment flow that deploys Windows 11 Pro 25H2 zh-TW and boots directly to the `davis` desktop with no human interaction inside OOBE.

Previously validated VM paths:

- ISO path: VM VM boots from `C:\OSDCloud\Win11-Lab\OSDCloud_NoPrompt.iso`
- iPXE path: VM VM boots from PXE/iPXE, loads WinPE over HTTP, and applies the Windows ESD directly from a host SMB share
- vSwitch regression path: VM VM `OSDCloud-Win11-vSwitch-04` boots from PXE/iPXE on `vSwitch`, applies the Windows ESD directly from `\\192.168.100.1\OSDCloudiPXE`, and reaches `DESKTOP-BM8R03K\davis` with `windows-desktop-ready`

Current active path:

- Physical laptop boots from UEFI PXE/iPXE on the real wired LAN, loads WinPE over HTTP, and applies the Windows ESD directly from the host SMB share. No VM vSwitch or VM is required for this path.
- Current repo/live endpoint may be left on `Ethernet` / `192.168.100.1` after VM regression. Before physical-laptop validation, switch back with `tools\Set-OsdCloudIpxeEndpoint.ps1 -InterfaceAlias '乙太網路 3' -ServerIp '192.168.100.100' -PrefixLength 24 -CommitWinPe -SyncAssets -HashLargeArtifacts`.

Local account:

```text
Username: davis
Password: password
```

Primary tested ISO:

```text
C:\OSDCloud\Win11-Lab\OSDCloud_NoPrompt.iso
```

Primary report:

```text
C:\Users\Davis\Documents\New project\OSDCloud-Win11-Automated-Deployment-Test-Report.md
```

Versioned asset mirror:

```text
C:\Users\Davis\Documents\New project\osdcloud-assets
```

## Important Paths

OSDCloud workspace:

```text
C:\OSDCloud\Win11-Lab
```

iPXE workspace:

```text
C:\OSDCloud\Win11-iPXE-Lab
```

Cached Windows image:

```text
C:\OSDCloud\Win11-Lab\Media\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd
```

Deployment automation:

```text
C:\OSDCloud\Win11-Lab\Config\Scripts\Shutdown\Invoke-DavisOobe.ps1
C:\OSDCloud\Win11-Lab\Config\Scripts\SetupComplete\SetupComplete.cmd
C:\OSDCloud\Win11-Lab\Config\Scripts\SetupComplete\SetupComplete.ps1
```

iPXE helper files:

```text
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\osdcloud\boot.ipxe
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\osdcloud\boot.wim
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\osdcloud\wimboot
C:\OSDCloud\Win11-iPXE-Lab\Tools\Start-PxeDhcp.ps1
C:\OSDCloud\Win11-iPXE-Lab\Tools\Start-PxeTftp.ps1
C:\OSDCloud\Win11-iPXE-Lab\Tools\Serve-OsdCloudMedia.mjs
C:\Users\Davis\Documents\New project\tools\Set-IpxePhysicalNic.ps1
C:\Users\Davis\Documents\New project\tools\Set-OsdCloudIpxeEndpoint.ps1
C:\Users\Davis\Documents\New project\tools\osdcloud-tui\src\headless.js
```

iPXE SMB image source:

```text
Share: \\192.168.100.100\OSDCloudiPXE
Path : \\192.168.100.100\OSDCloudiPXE\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd
User : pxeinstall
Mode : read-only SMB, firewall limited to 192.168.100.0/24 on local address 192.168.100.100
```

## Critical Lessons

- Do not put OOBE injection in `Config\Scripts\StartNet`. OSDCloud runs StartNet scripts before Windows is deployed. This caused early reboot loops where the VHD stayed near `0.04GB`.
- OOBE injection belongs in `Config\Scripts\Shutdown`, after OSDCloud has applied Windows and before WinPE shuts down.
- Keep the Windows ESD cached under `Media\OSDCloud\OS`; otherwise each deployment downloads Windows from Microsoft again.
- The ISO should set `LaunchUserOOBE=0`, `SkipMachineOOBE=1`, `SkipUserOOBE=1`, and `NoAutoUpdate=1` to avoid the first-boot OOBE update screen.
- `wuauserv` may later show as Running even with `NoAutoUpdate=1`; this is not by itself a failure. Failure is seeing `CloudExperienceHost`, `msoobe`, or an OOBE update screen after the desktop should be ready.
- For iPXE custom image deployment, do not combine `-ImageFileUrl` / `-OSImageIndex` with `-OSName`, `-OSLanguage`, `-OSEdition`, or `-OSActivation`. `Start-OSDCloud` treats custom image as a separate parameter set.
- For iPXE no-redownload deployment, do not use `-ImageFileUrl`. It always triggers OSDCloud's `Download Operating System` step and copies the ESD into WinPE. The current WinPE maps `\\192.168.100.100\OSDCloudiPXE` as `Z:`, sets `$Global:StartOSDCloud.ImageFileDestination` to the ESD `FileInfo`, sets `OSImageIndex=6`, then calls `Invoke-OSDCloud`.
- For isolated or restricted networks, remove or bypass `Initialize-OSDCloudStartnetUpdate` in the iPXE WinPE. It tries external PowerShell Gallery / Microsoft update endpoints and can stall before `Start-OSDCloud`.
- For iPXE WinPE, `Invoke-DavisOobe.ps1` must first look for SetupComplete scripts at `$PSScriptRoot\..\SetupComplete`, then fall back to scanning non-`C:` / non-`X:` drives. iPXE loads only `boot.wim`; it does not provide the ISO media path.
- When changing iPXE `SetupComplete`, update both `C:\OSDCloud\Win11-iPXE-Lab\Config\Scripts\SetupComplete` and the embedded `X:\OSDCloud\Config\Scripts\SetupComplete` inside `boot.wim`. If the embedded copy is stale, the laptop can reach the Windows desktop while the TUI remains at `awaiting-windows` / `rebooting` because no `windows-setupcomplete-*` or `windows-desktop-ready` callback exists.
- The desktop-ready scheduled task must use an any-user `New-ScheduledTaskTrigger -AtLogOn` with a SYSTEM principal. Do not set the trigger user to `$env:COMPUTERNAME\davis`; during SetupComplete the computer name / local account SID mapping can be unstable and fail with `HRESULT 0x80070534`.
- The desktop-ready scheduled task must not unregister until `windows-desktop-ready` is successfully POSTed. Windows networking can lag behind Explorer; if the first POST fails, keep retrying instead of losing the final TUI completion event. The intended retry loop is every 5 seconds for up to 30 minutes from `windows-logon-start`.
- The desktop-ready reporter's `Send-Status` helper must return `$true` after a successful HTTP POST or WebClient fallback and `$false` only after both fail. If it returns `$null`, the host can show `completed` while the client keeps POSTing identical `windows-desktop-ready` events every 5 seconds until the 30-minute reporter deadline. To stop an already-deployed old client immediately, run `Unregister-ScheduledTask -TaskName OSDCloudDesktopReadyReport -Confirm:$false` on that client.
- Screenshot progress evidence is best-effort only. Keep JSON deployment status as the source of truth; screenshot upload failures must not block OSDCloud, SetupComplete, reboot, or desktop-ready reporting.
- Do not install a desktop screenshot Startup helper from `SetupComplete`. The earlier interactive screenshot helper combined screen capture, upload, and hidden PowerShell startup execution, and Defender/AMSI blocked the whole `SetupComplete.ps1` with `ScriptContainedMaliciousContent`. Keep `OSDCloudDesktopReadyReport` as the SYSTEM scheduled task for final status; Windows desktop PNG evidence must remain a separate, explicitly retested best-effort helper if reintroduced later.
- The working iPXE `boot.ipxe` explicitly loads `wimboot`, `bootmgr`, `bootx64.efi`, `BCD`, `boot.sdi`, and `boot.wim` over HTTP.
- The working DHCP path returns addresses from `192.168.100.200` through `192.168.100.250`, gateway `192.168.100.1`, DNS `1.1.1.1` / `8.8.8.8`, `snponly.efi` for UEFI PXE first stage, and `http://192.168.100.100/osdcloud/boot.ipxe` once the client identifies as iPXE. Keep `autoexec.ipxe` disabled unless you intentionally retest the TFTP script path.
- Historical VM note: VM blocks changing the Secure Boot template after vTPM initialization. If a VM was initialized with the PXE template and must hard-boot Windows with `MicrosoftWindows`, preserve the VHDX and recreate the VM configuration before enabling vTPM.
- The live deployment files are under `C:\OSDCloud`, not only in this repo. After changing deployment behavior, run `.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts` so `osdcloud-assets` contains the current scripts, embedded WinPE `Config\Scripts`, WinPE startup files, and large-artifact manifest before committing.

## iPXE Runbook

Use this runbook for the physical-laptop network-install validation path. The goal is to prove that the laptop can deploy without USB or ISO media, with WinPE served over HTTP and the Windows ESD applied directly from the lab SMB share.

Expected host network:

```text
Host wired adapter: 乙太網路 3
Host adapter IP: 192.168.100.100/24
DHCP range: 192.168.100.200-192.168.100.250
Gateway: 192.168.100.1
DNS: 1.1.1.1, 8.8.8.8
HTTP base: http://192.168.100.100/osdcloud
SMB image share: \\192.168.100.100\OSDCloudiPXE
```

Expected HTTP root:

```text
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\osdcloud
```

The HTTP root must include:

```text
boot.ipxe
wimboot
bootmgr
bootx64.efi
BCD
boot.sdi
boot.wim
```

OSDCloud progress status is collected by the same Node HTTP server:

```text
POST/GET: http://192.168.100.100/osdcloud/status
Events : http://192.168.100.100/osdcloud/status/events
Shots  : POST image/png to http://192.168.100.100/osdcloud/screenshot
Files  : C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest.json
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\progress.jsonl
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest-summary.json
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\<runId>.summary.json
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\deployment-runs.jsonl
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest-screenshot.json
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\<runId>.screenshots.jsonl
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\screenshots\<runId>\*.png
Cadence: check logs every 3 seconds; send heartbeat at least every 15 seconds
```

Run sequence:

1. Confirm the real network DHCP server is temporarily disabled.
2. Confirm the host wired adapter `乙太網路 3` has `192.168.100.100/24`; use `.\tools\Set-IpxePhysicalNic.ps1` if it needs to be configured.
3. Start the host-side PXE helpers: DHCP/TFTP for first-stage boot and HTTP for OSDCloud content.
4. Keep the working unsigned PXE path on `snponly.efi` unless the task is specifically to retest signed shim Secure Boot.
5. Boot the physical laptop from UEFI IPv4 PXE, with no USB or ISO media involved.
6. Confirm DHCP returns a `192.168.100.200-250` lease, router `192.168.100.1`, DNS `1.1.1.1` / `8.8.8.8`, `snponly.efi` for UEFI PXE, and `http://192.168.100.100/osdcloud/boot.ipxe` after the client identifies as iPXE.
7. Confirm the iPXE WinPE maps `\\192.168.100.100\OSDCloudiPXE` to `Z:` and sets `$Global:StartOSDCloud.ImageFileDestination` to `Z:\OSDCloud\OS\...zh-tw.esd`.
8. Watch the HTTP access log for `boot.ipxe`, `wimboot`, and `boot.wim`. A valid no-redownload run must not show zh-TW ESD `HEAD` or `GET`.
9. Watch `C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\progress.jsonl` for WinPE status events such as `winpe-start`, `smb-mounted`, `osdcloud-start`, `apply-image`, `osdcloud-finished`, and `rebooting`; use `latest-screenshot.json` / `<runId>.screenshots.jsonl` only as supporting visual evidence.
10. After WinPE finishes, it should post final status and reboot itself with `wpeutil reboot`; the laptop should then boot from the internal disk if PXE was selected through a one-time boot menu.
11. During first Windows boot, SetupComplete should post `windows-setupcomplete-start` and `windows-setupcomplete-finished`; after `davis` logs on, the SYSTEM desktop-ready scheduled task should post `windows-logon-start` and final `windows-desktop-ready`.
12. Verify the final state locally or by remote management, and inspect the OSDCloud log for empty `ImageFileUrl`, `ImageFileDestination = Z:\OSDCloud\OS\...zh-tw.esd`, `ImageFileDestination.PSDrive.DisplayRoot = \\192.168.100.100\OSDCloudiPXE`, and `OSImageIndex : 6`.

Legacy VM timing runs are historical regression tools only; do not use them for the physical-laptop path unless the user explicitly asks for VM validation:

```powershell
.\tools\Invoke-IpxeTimingRun.ps1 -VmName OSDCloud-Win11-iPXE-Timing-XX
```

Timing run contract:

- After the script starts the VM, do not use VMConnect or manually change VM settings.
- The script may record host state, HTTP/DHCP/TFTP logs, VM state, VHDX size, and PowerShell Direct validation.
- The script is responsible for the automated transition from WinPE shutdown to VHD boot with Secure Boot `MicrosoftWindows` and vTPM.
- iPXE timing VMs should use 8GB static memory with Dynamic Memory disabled. 6GB with Dynamic Memory can starve WinPE during DISM apply.
- For normal desktop-validation runs, keep `-PostDeploySwitchName ''` so the installed Windows VM remains on `PXE-Lab`.
- Physical-laptop validation should use the host wired adapter directly, not a VM vSwitch.
- The final timing validation should include internet checks: ping `1.1.1.1`, DNS resolution for `www.microsoft.com`, and HTTP access to `http://www.msftconnecttest.com/connecttest.txt`.
- Only use `-PostDeploySwitchName 'Default Switch'` when the task explicitly asks to compare against VM's default NAT switch.
- Only use `-SkipInternetValidation` when the task explicitly asks for a fully isolated post-deploy test.
- Per-run artifacts belong under `C:\OSDCloud\Win11-iPXE-Lab\TimingRuns\...` and must not be committed.
- A valid timing run ends with `Run : Succeeded`, stopped run helpers, and a populated `summary.md` / `summary.json`. A final `GuestCheck : Pass` may be absent if the visible guest-detail string did not change between pending and ready; in that case trust `Run : Succeeded` plus the final guest summary.

Earlier HTTP ESD timing evidence, superseded by no-redownload mode:

```text
RunId   : 20260507-111415
VM      : OSDCloud-Win11-iPXE-Timing-06
Total   : 1059.2 seconds
Result  : Succeeded
Run root: C:\OSDCloud\Win11-iPXE-Lab\TimingRuns\20260507-111415-OSDCloud-Win11-iPXE-Timing-06
```

Latest no-redownload timing evidence:

```text
RunId   : 20260507-135251
VM      : OSDCloud-Win11-iPXE-Timing-10
Total   : 819.0 seconds
Result  : Succeeded
Run root: C:\OSDCloud\Win11-iPXE-Lab\TimingRuns\20260507-135251-OSDCloud-Win11-iPXE-Timing-10
HTTP ESD matches: 0
ImageFileDestinationDisplayRoot: \\192.168.100.1\OSDCloudiPXE
Final guest: DESKTOP-LTK4NLM\davis, ExplorerRunning=True, DesktopReadyFile=True
```

This timing evidence used the earlier isolated `192.168.100.0/24` lab. Current physical-network defaults use `192.168.100.100` as the PXE/SMB host and `192.168.100.200-250` for DHCP leases.

Post-deploy network lesson:

- If a deployed laptop has no internet and still shows a `192.168.100.x` address, first verify the real gateway `192.168.100.1` is reachable and that the upstream DHCP server is still intentionally disabled only for the test window.
- The deployed system should use `192.168.100.1` as gateway and working DNS such as `1.1.1.1` / `8.8.8.8`.
- If Start menu pins show gray placeholders after the first offline boot, refresh StartMenuExperienceHost / Explorer and rebuild the current user's icon cache after internet is available.

Failure triage:

- No HTTP `boot.ipxe`: debug UEFI PXE, TFTP, or first-stage iPXE.
- `boot.ipxe` / `boot.wim` appears but Windows is not applied to disk: debug WinPE startup, SMB mapping to `\\192.168.100.100\OSDCloudiPXE`, `$Global:StartOSDCloud.ImageFileDestination`, and physical-network addressing.
- `Start-OSDCloud` returns to `X:\>` immediately: check for mixed parameter sets.
- `Expand-WindowsImage failed` with `Insufficient memory`: check physical RAM. Use a laptop with at least 8GB RAM for the first physical validation.
- Disk remains effectively empty or unbootable: Windows was not applied.
- Disk boots but first boot stops in OOBE: inspect `Invoke-DavisOobe.ps1`, SetupComplete injection, `CloudExperienceHost` / `msoobe`, and OOBE registry values.

Secure Boot status:

```text
Network-install deployment path: verified
Final hard-disk boot with MicrosoftWindows Secure Boot + vTPM: verified
PXE-stage signed shim Secure Boot: not yet verified
```

## Rebuild ISO

Use this command pattern to rebuild the current ISO:

```powershell
Import-Module OSD -Force
Set-OSDCloudWorkspace -WorkspacePath 'C:\OSDCloud\Win11-Lab'

$startArgs = "-OSName 'Windows 11 25H2 x64' -OSLanguage zh-tw -OSEdition Pro -OSActivation Retail -ZTI -SkipAutopilot -SkipODT -Shutdown"

Edit-OSDCloudWinPE `
  -WorkspacePath 'C:\OSDCloud\Win11-Lab' `
  -UseDefaultWallpaper `
  -StartOSDCloud $startArgs

New-OSDCloudISO -WorkspacePath 'C:\OSDCloud\Win11-Lab'
```

## Zero-Touch Test Standard

A valid physical-laptop iPXE test must not require USB media, an attached ISO, or clicking through OOBE on the laptop.

Allowed host-side automation:

- Configure the host wired adapter
- Start DHCP/TFTP/HTTP helpers
- Watch DHCP/TFTP/HTTP logs
- Reboot or power-cycle the physical laptop when needed
- Verify locally on the deployed laptop or through remote management

Final validation should include:

```text
User             : <computer>\davis
ExplorerRunning  : True
DesktopReadyFile : True
OobeProcesses    :
LaunchUserOOBE   : 0
SkipUserOOBE     : 1
NoAutoUpdate     : 1
DisplayVersion   : 25H2
CurrentBuild     : 26200
EditionID        : Professional
Culture          : zh-TW
TimeZone         : Taipei Standard Time
FinalStatusStage : windows-desktop-ready
```

Latest physical TUI validation evidence:

```text
RunId            : 20260509-031647-9VDYLD4
Status           : completed
FinalStatusStage : windows-desktop-ready
Percent          : 100
Started          : 2026-05-08T19:16:49.151Z
WinPE End        : 2026-05-08T19:23:39.219Z
Windows Start    : 2026-05-08T19:28:08.202Z
Completed        : 2026-05-08T19:28:19.736Z
ComputerName     : DESKTOP-8AMUG6V
ExplorerRunning  : True
DesktopReadyFile : True
OobeProcesses    :
DisplayVersion   : 25H2
CurrentBuild     : 26200
EditionID        : Professional
Culture          : zh-TW
TimeZone         : Taipei Standard Time
```

Also verify the OSDCloud log from the deployed disk:

```text
ImageFileSource : D:\OSDCloud\OS\...zh-tw.esd
ImageFileUrl    :
```

For the iPXE path, also verify:

```text
ImageFileUrl                    : <empty>
ImageFileDestination            : Z:\OSDCloud\OS\...zh-tw.esd
ImageFileDestinationDisplayRoot : \\192.168.100.100\OSDCloudiPXE
OSImageIndex                    : 6
```

The HTTP access log must show `boot.ipxe`, `wimboot`, and `boot.wim`, and must not show zh-TW ESD `HEAD` or `GET`. The laptop must not use USB or ISO media as the deployment source.

## Node TUI Host Console

The primary host-side entrypoint is now:

```powershell
npm run tui
```

The TUI lives under:

```text
tools\osdcloud-tui
config\osdcloud-tui.json
```

Use the TUI for the active physical-laptop path unless the user explicitly asks to run the legacy helper scripts. It owns the host-side DHCP responder, TFTP responder, HTTP media/status server, live status display, log tailing, and validation summary.

Safety contract:

- Start the TUI from elevated PowerShell.
- Run preflight before starting services. Preflight validates that the service bind IP exists on any enabled IPv4 adapter.
- Use `Select service interface` when the service bind interface/IP must change. It must list only enabled non-APIPA IPv4 interfaces, stop running HTTP/TFTP/DHCP services before applying a new endpoint, persist `config\osdcloud-tui.json`, recalculate DHCP lease pool / subnet mask / router for the selected prefix, update live PXE/WinPE endpoint files through `tools\Set-OsdCloudIpxeEndpoint.ps1`, commit the endpoint into `boot.wim`, verify the published `boot.wim`, and refresh `osdcloud-assets`.
- After changing the selected service interface, preflight must fail if the DHCP lease range or router is outside the selected service IP prefix. Treat this as a stale/manual config guard; the TUI selection path should update DHCP settings automatically.
- Do not start DHCP until the real LAN DHCP server is confirmed disabled for the test window.
- Do not add a TUI `Configure physical NIC` action. If Windows adapter IP assignment must be changed, keep it as an explicit out-of-TUI script step such as `tools\Set-IpxePhysicalNic.ps1`.
- Keep confirmation gates for DHCP/PXE service start/stop toggles and status-file deletion.
- The individual `Start HTTP/status`, `Start TFTP`, and `Start DHCP` actions are service toggles; when a service is running, the same action must become `Stop ...` and shut that service down.
- `Clear status files` must also remove `latest-screenshot.json`, `*.screenshots.jsonl`, and `status\screenshots\`.
- Do not rewrite WinPE OSDCloud/SetupComplete behavior for TUI work unless the user explicitly expands scope.

Validation contract:

- `npm test` must pass for TUI code changes.
- `npm run smoke` must pass before handoff; it uses temporary roots and test ports and must not touch the live LAN.
- A live deployment remains the final hardware validation when TUI networking behavior changes.
- Deployment progress must include explicit run lifecycle records: `run-start`, `winpe-end`, `windows-start`, and final `run-end` on `windows-desktop-ready`.
- Screenshot behavior must preserve the status contract: `/osdcloud/status` stays JSON-only, `/osdcloud/screenshot` accepts PNG-only uploads capped at 5 MB, and PNG files remain local evidence rather than Git artifacts.
- If deployment behavior changes inside `C:\OSDCloud` or WinPE, update the live files first, mount/commit `boot.wim` when needed, then run `.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts`.

## Legacy VM Notes

These notes are historical regression evidence only. Do not use VM for the active physical-laptop iPXE path. If the user explicitly asks for VM regression, use Generation 2 VMs with:

- Secure Boot enabled with `MicrosoftWindows` template
- vTPM enabled
- 4 vCPU
- 6GB startup memory
- 96GB VHDX
- Default Switch
- Automatic checkpoints disabled

The final known-good test VM is:

```text
OSDCloud-Win11-NoTouch-01
```

The final known-good iPXE test VM is:

```text
OSDCloud-Win11-iPXE-01
```

The latest known-good vSwitch regression VM is:

```text
OSDCloud-Win11-vSwitch-04
```

Historical iPXE VM notes:

- Earlier VM validation used `PXE-Lab`; the active physical-laptop path uses the host wired adapter directly.
- Legacy host-side PXE helper scripts used PowerShell DHCP/TFTP plus Node HTTP. The Node TUI is now the primary host-side console; keep the legacy helper scripts as fallback until a real physical deployment has validated the TUI path. The Linux helper VM `PXE-Lab-Server-01` was not required for the successful validation.
- Use static memory for iPXE timing VMs. `Timing-04` failed in WinPE DISM apply when Dynamic Memory assigned only about 1.5GB even though startup memory was configured higher.
- Full iPXE deployment succeeded with PXE-stage Secure Boot temporarily off. Hard-disk boot was verified with Secure Boot `MicrosoftWindows` and vTPM.
- For VM first-stage TFTP, do not disable `.efi` OACK/options handling. VM can send paired RRQs where one transfer logs `OACK not acknowledged` and the other succeeds with `SENT snponly.efi`; success is confirmed by later HTTP `boot.ipxe`. If the VM stays at `Downloading NBP file...`, debug TFTP service state before changing WinPE or OSDCloud.
- After `osdcloud-finished`, do not force power off the VM. Let WinPE run `wpeutil reboot`; premature power-off can leave `Unattend.xml` or `SetupComplete.ps1` NUL-filled and cause Windows Setup unattend parse errors.
- `tools\osdcloud-tui\src\headless.js` starts the same HTTP/status, TFTP, and DHCP services without the blessed UI. Use it only for VM regression or automation, and stop the owning `node.exe` after the test so DHCP does not keep responding.
- Signed shim PXE remains a caveat: `snponly-shim.efi` and `ipxe-shim.efi` were both tested with `MicrosoftUEFICertificateAuthority`, but the probe did not reach HTTP and stopped during TFTP shim transfer.

## Documentation

When behavior changes, update:

```text
README.md
OSDCloud-Win11-Automated-Deployment-Test-Report.md
AGENTS.md
osdcloud-assets
```

Keep `README.md` concise and user-facing. Keep the report detailed and evidence-oriented. Keep `AGENTS.md` as the operational contract for future agents.

## Git Workflow

Use Git to track docs and process definitions in this workspace.

Track these files by default:

```text
README.md
AGENTS.md
OSDCloud-Win11-Automated-Deployment-Test-Report.md
tools\Invoke-IpxeTimingRun.ps1
tools\Set-IpxePhysicalNic.ps1
tools\Set-OsdCloudIpxeEndpoint.ps1
tools\Sync-OsdCloudAssets.ps1
package.json
package-lock.json
config\osdcloud-tui.json
tools\osdcloud-tui\...
TUI-REWRITE-PLAN.md
osdcloud-assets\README.md
osdcloud-assets\manifest.json
osdcloud-assets\Win11-Lab\...
osdcloud-assets\Win11-iPXE-Lab\...
.gitignore
```

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

Before making Git changes, run:

```powershell
git status --short --branch
```

For normal documentation/process updates, commit only the intended text files and leave generated artifacts untracked or ignored.

For OSDCloud behavior changes, the intended commit set must include the synchronized `osdcloud-assets` files. The sync mirror may contain lab-only credentials and must remain in private repositories only.
