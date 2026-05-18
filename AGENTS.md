# Agent Instructions

This workspace documents and validates a Windows 11 zero-touch deployment lab using OSDCloud and iPXE. The active physical-laptop path does not use VM; VM content is historical regression evidence only.

## Current Goal

The working target is a repeatable OSDCloud deployment flow that deploys Windows 11 Pro 25H2 zh-TW and boots directly to the `davis` desktop with no human interaction inside OOBE.

## Path Separation Rules

There are two live-looking but separate paths. Treat them as mutually exclusive until the user explicitly asks to switch.

Physical-laptop path:

- This is the active production-like validation path.
- Use the Web-console-selected service interface and service IP for the current run. Do not hard-code a physical NIC name or a `192.168.100.x` address as the required production path.
- Read the active service IP, DHCP lease range, router, HTTP base, and SMB share from `config\osdcloud-tui.json`, live `boot.ipxe`, and host adapter state immediately before starting services.
- Use `npm run web` as the host console. The old Node TUI CLI was retired in version `0.3.0`; do not plan or execute the retired TUI command.
- Do not use VM, `vSwitch`, `192.168.100.1`, VMConnect, PowerShell Direct, or `tools\osdcloud-tui\src\headless.js` as evidence for this path.

VM VM regression path:

- Use this only when the user explicitly asks for VM, VM, vSwitch, or regression validation.
- Use `Ethernet`, service IP `192.168.100.1`, DHCP leases `192.168.100.200-250`, and SMB share `\\192.168.100.1\OSDCloudiPXE`.
- `tools\osdcloud-tui\src\headless.js` is allowed for VM regression automation, but it must be stopped after the test so DHCP does not keep responding.
- VM success proves the WinPE/OOBE/status workflow still works in VM. It does not prove the physical-laptop path is ready.
- VM evidence must not overwrite or replace the latest physical validation evidence block.

Endpoint switching:

- Before physical-laptop validation, select the intended service interface in the Web console or switch with `tools\Set-OsdCloudIpxeEndpoint.ps1 -InterfaceAlias '<interface-alias>' -ServerIp '<service-ip>' -PrefixLength <prefix> -CommitWinPe -SyncAssets -HashLargeArtifacts`.
- Before vSwitch VM regression, switch with `tools\Set-OsdCloudIpxeEndpoint.ps1 -InterfaceAlias 'Ethernet' -ServerIp '192.168.100.1' -PrefixLength 24 -CommitWinPe -SyncAssets -HashLargeArtifacts`.
- After either switch, keep `README.md`, `OSDCloud-Win11-Automated-Deployment-Test-Report.md`, `AGENTS.md`, and `osdcloud-assets` aligned with the live endpoint state.
- Document physical results under physical-laptop sections and VM results under VM/VM regression sections. Do not mix VM timings, vSwitch IPs, or PowerShell Direct validation into the physical-laptop evidence block.

Previously validated VM paths:

- ISO path: VM VM boots from `C:\OSDCloud\Win11-Lab\OSDCloud_NoPrompt.iso`
- iPXE path: VM VM boots from PXE/iPXE, loads WinPE over HTTP, and applies the Windows ESD directly from a host SMB share
- vSwitch regression path: VM VM `OSDCloud-Win11-vSwitch-04` boots from PXE/iPXE on `vSwitch`, applies the Windows ESD directly from `\\192.168.100.1\OSDCloudiPXE`, and reaches `DESKTOP-BM8R03K\davis` with `windows-desktop-ready`

Current active path:

- Physical laptop boots from UEFI PXE/iPXE on the real wired LAN, loads WinPE over HTTP, and applies the Windows ESD directly from the host SMB share. No VM vSwitch or VM is required for this path.
- Current repo/live endpoint for the physical-laptop path is whatever service interface/IP the Web console selected and synced most recently. It may be left on `Ethernet` / `192.168.100.1` after VM regression; before physical-laptop validation, switch back to the intended physical service interface/IP and resync `boot.wim` / `osdcloud-assets`.

Current host WAN/LAN topology:

- `WAN` is the host default internet NIC. Current observed host IP is `192.168.100.1/24`, gateway `192.168.100.1`, metric `5`.
- `LAN` is the physical client / PXE lab NIC. Current planned host IP is `192.168.88.1/24`, no gateway, metric `500`, IP forwarding enabled.
- Windows NAT `OSDCloud-PhysicalClient-NAT` maps `192.168.88.0/24` out through the host WAN path.
- The NIC rename and LAN IP/NAT setup do not by themselves update `config\osdcloud-tui.json`, live `boot.ipxe`, embedded WinPE scripts, or `osdcloud-assets`. Before physical-laptop validation on this topology, select `LAN` in the Web console or run `tools\Set-OsdCloudIpxeEndpoint.ps1 -InterfaceAlias 'LAN' -ServerIp '192.168.88.1' -PrefixLength 24 -CommitWinPe -SyncAssets -HashLargeArtifacts`.
- If `config\osdcloud-tui.json` still references `乙太網路 2`, `乙太網路 3`, or `192.168.100.x` after the rename, treat it as a stale endpoint until it is deliberately resynced.

Fresh-clone / new-host rules:

- The repository may be cloned to any folder. Do not reintroduce committed `paths.repoRoot` or `paths.endpointSyncScript` values that point to one operator's clone path.
- Live deployment still runs from `C:\OSDCloud`; a Git clone alone is not a deployable PXE runtime because large artifacts are intentionally excluded from Git.
- A new host must restore or rebuild `C:\OSDCloud\Win11-Lab` and `C:\OSDCloud\Win11-iPXE-Lab`, including `boot.wim`, published HTTP boot files, iPXE binaries, Windows boot binaries, and the active Windows ESD/WIM listed in `osdcloud-assets\manifest.json`.
- Preferred new-host bootstrap is restore-based: export `deployment-server-bundle` with `tools\Export-DeploymentServerBundle.ps1` on a verified host, then run `Deploy-DeploymentServer.cmd` or `tools\Initialize-DeploymentServer.ps1` on the new host. The bootstrap may restore `C:\OSDCloud`, verify artifact hashes, sync endpoint, run preflight, and start the Web console, but it must not auto-start DHCP/TFTP/HTTP deployment services.
- Treat committed `config\osdcloud-tui.json` as the last synced lab snapshot, not as a guaranteed production endpoint. It may be left on `Ethernet` / `192.168.100.1`; before a physical-laptop deployment on a newly cloned host, use the Web console `Select service interface`, rerun endpoint sync, and pass preflight.
- When updating setup or deployment docs, keep the README `新主機 Clone 後啟動流程` current so another operator can clone, restore `C:\OSDCloud`, start `npm run web`, select the service endpoint, run preflight, start services, and validate completion without reading prior chats.

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
<repo-root>\OSDCloud-Win11-Automated-Deployment-Test-Report.md
```

Versioned asset mirror:

```text
<repo-root>\osdcloud-assets
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
<repo-root>\tools\Set-IpxePhysicalNic.ps1
<repo-root>\tools\Set-OsdCloudIpxeEndpoint.ps1
<repo-root>\tools\osdcloud-tui\src\headless.js
```

Physical-laptop iPXE SMB image source:

```text
Share: \\<service-ip>\OSDCloudiPXE
Path : \\<service-ip>\OSDCloudiPXE\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd
User : pxeinstall
Mode : read-only SMB, firewall limited to the selected service subnet on the selected service IP
```

## Critical Lessons

- Do not put OOBE injection in `Config\Scripts\StartNet`. OSDCloud runs StartNet scripts before Windows is deployed. This caused early reboot loops where the VHD stayed near `0.04GB`.
- OOBE injection belongs in `Config\Scripts\Shutdown`, after OSDCloud has applied Windows and before WinPE shuts down.
- Keep the Windows ESD cached under `Media\OSDCloud\OS`; otherwise each deployment downloads Windows from Microsoft again.
- The ISO should set `LaunchUserOOBE=0`, `SkipMachineOOBE=1`, `SkipUserOOBE=1`, and `NoAutoUpdate=1` to avoid the first-boot OOBE update screen.
- `wuauserv` may later show as Running even with `NoAutoUpdate=1`; this is not by itself a failure. Failure is seeing `CloudExperienceHost`, `msoobe`, or an OOBE update screen after the desktop should be ready.
- For iPXE custom image deployment, do not combine `-ImageFileUrl` / `-OSImageIndex` with `-OSName`, `-OSLanguage`, `-OSEdition`, or `-OSActivation`. `Start-OSDCloud` treats custom image as a separate parameter set.
- For iPXE no-redownload deployment, do not use `-ImageFileUrl`. It always triggers OSDCloud's `Download Operating System` step and copies the ESD into WinPE. The current WinPE maps `\\<service-ip>\OSDCloudiPXE` as `Z:`, reads `Z:\OSDCloud\OS\selected-os.json`, sets `$Global:StartOSDCloud.ImageFileDestination` to the selected cached ESD/WIM `FileInfo`, sets the manifest image index / language / edition fields, then calls `Invoke-OSDCloud`.
- OS image acquisition is host/Admin Console only. Web `OS Image Cache` can download from the official OSD module catalog plus repo-controlled custom entries in `config\os-download-sources.json`, or import a browser-uploaded `.iso` / `.esd` / `.wim`. Downloads/imports stage under `Media\OSDCloud\OS\.downloads`, verify hash/DISM index, then update `config\os-image-catalog.json`; they must not auto-switch active image. `Set active` publishes a non-active cached image as active; active-row `Republish` republishes `selected-os.json` and the SMB image path when the active image is already correct but the manifest is stale. The Web console no longer exposes host-path import for arbitrary `C:\...` image paths.
- For isolated or restricted networks, remove or bypass `Initialize-OSDCloudStartnetUpdate` in the iPXE WinPE. It tries external PowerShell Gallery / Microsoft update endpoints and can stall before `Start-OSDCloud`.
- For iPXE WinPE, `Invoke-DavisOobe.ps1` must first look for SetupComplete scripts at `$PSScriptRoot\..\SetupComplete`, then fall back to scanning non-`C:` / non-`X:` drives. iPXE loads only `boot.wim`; it does not provide the ISO media path.
- When changing iPXE `SetupComplete`, update both `C:\OSDCloud\Win11-iPXE-Lab\Config\Scripts\SetupComplete` and the embedded `X:\OSDCloud\Config\Scripts\SetupComplete` inside `boot.wim`. If the embedded copy is stale, the laptop can reach the Windows desktop while the Web console remains at `awaiting-windows` / `rebooting` because no `windows-setupcomplete-*` or `windows-desktop-ready` callback exists.
- Client app payloads are published by Web deployment profile selection into `C:\OSDCloud\Win11-iPXE-Lab\Media\OSDCloud\Apps`. WinPE shutdown copies only the published payload into deployed Windows at `C:\ProgramData\OSDCloud\Apps`; `SetupComplete` then runs `Install-Apps.ps1`, which reads `selected-profile.json` and installs only selected software in `selectedSoftware` order before the desktop-ready marker. Current `Default` profile installs `7zip\7z2601-x64.msi`; `All in One` installs 7-Zip plus `chrome\googlechromestandaloneenterprise64.msi`; `Minimal` installs no client software.
- The desktop-ready scheduled task must use an any-user `New-ScheduledTaskTrigger -AtLogOn` with a SYSTEM principal. Do not set the trigger user to `$env:COMPUTERNAME\davis`; during SetupComplete the computer name / local account SID mapping can be unstable and fail with `HRESULT 0x80070534`.
- The desktop-ready scheduled task must not unregister until `windows-desktop-ready` is successfully POSTed. Windows networking can lag behind Explorer; if the first POST fails, keep retrying instead of losing the final Web completion event. The intended retry loop is every 5 seconds for up to 30 minutes from `windows-logon-start`.
- The desktop-ready reporter's `Send-Status` helper must return `$true` after a successful HTTP POST or WebClient fallback and `$false` only after both fail. If it returns `$null`, the host can show `completed` while the client keeps POSTing identical `windows-desktop-ready` events every 5 seconds until the 30-minute reporter deadline. To stop an already-deployed old client immediately, run `Unregister-ScheduledTask -TaskName OSDCloudDesktopReadyReport -Confirm:$false` on that client.
- Screenshot progress evidence is best-effort only. Keep JSON deployment status as the source of truth; screenshot upload failures must not block OSDCloud, SetupComplete, reboot, or desktop-ready reporting.
- Do not install a desktop screenshot Startup helper from `SetupComplete`. The earlier interactive screenshot helper combined screen capture, upload, and hidden PowerShell startup execution, and Defender/AMSI blocked the whole `SetupComplete.ps1` with `ScriptContainedMaliciousContent`. Keep `OSDCloudDesktopReadyReport` as the SYSTEM scheduled task for final status; Windows desktop PNG evidence must remain a separate, explicitly retested best-effort helper if reintroduced later.
- The working iPXE `boot.ipxe` explicitly loads `wimboot`, `bootmgr`, `bootx64.efi`, `BCD`, `boot.sdi`, and `boot.wim` over HTTP.
- The working DHCP path returns addresses from the current `dhcp.leaseStartIp` through `dhcp.leaseEndIp`, DNS from the current config, `snponly.efi` for UEFI PXE first stage, and `http://<service-ip>/osdcloud/boot.ipxe` once the client identifies as iPXE. Confirm the intended client gateway before final physical validation instead of assuming a fixed router IP.
- Historical VM note: VM blocks changing the Secure Boot template after vTPM initialization. If a VM was initialized with the PXE template and must hard-boot Windows with `MicrosoftWindows`, preserve the VHDX and recreate the VM configuration before enabling vTPM.
- The live deployment files are under `C:\OSDCloud`, not only in this repo. After changing deployment behavior, run `.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts` so `osdcloud-assets` contains the current scripts, embedded WinPE `Config\Scripts`, WinPE startup files, and large-artifact manifest before committing.

## Physical-Laptop iPXE Runbook

Use this runbook for the physical-laptop network-install validation path. The goal is to prove that the laptop can deploy without USB or ISO media, with WinPE served over HTTP and the Windows ESD applied directly from the lab SMB share.

Expected host network:

```text
Host service interface: LAN
Host service IP: 192.168.88.1/24
DHCP range: 192.168.88.200-192.168.88.250
DHCP router: 192.168.88.1
DNS: 1.1.1.1, 8.8.8.8
HTTP base: http://192.168.88.1/osdcloud
SMB image share: \\192.168.88.1\OSDCloudiPXE
```

These are the current planned physical-client LAN values. If the user intentionally selects a different service interface/IP in the Web console, verify and document that live endpoint instead of forcing these values.

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
POST/GET: http://<service-ip>/osdcloud/status
Events : http://<service-ip>/osdcloud/status/events
Shots  : POST image/png to http://<service-ip>/osdcloud/screenshot
Files  : C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest.json
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\progress.jsonl
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest-summary.json
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\<runId>.summary.json
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\runs-index.json
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\deployment-runs.jsonl
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\latest-screenshot.json
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\<runId>.screenshots.jsonl
         C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\screenshots\<runId>\*.png
Cadence: check logs every 3 seconds; send heartbeat at least every 15 seconds
```

Run sequence:

1. Confirm the real network DHCP server is temporarily disabled.
2. Confirm the selected service IP exists on an enabled IPv4 adapter with the intended prefix; use `.\tools\Set-IpxePhysicalNic.ps1 -InterfaceAlias '<interface-alias>' -ServerIp '<service-ip>'` only when Windows adapter IP assignment itself needs to be changed.
3. Start the host-side PXE helpers: DHCP/TFTP for first-stage boot and HTTP for OSDCloud content.
4. Keep the working unsigned PXE path on `snponly.efi` unless the task is specifically to retest signed shim Secure Boot.
5. Boot the physical laptop from UEFI IPv4 PXE, with no USB or ISO media involved.
6. Confirm DHCP returns a lease from the current configured range, the intended router, configured DNS, `snponly.efi` for UEFI PXE, and `http://<service-ip>/osdcloud/boot.ipxe` after the client identifies as iPXE.
7. Confirm the iPXE WinPE maps `\\<service-ip>\OSDCloudiPXE` to `Z:`, reads `Z:\OSDCloud\OS\selected-os.json`, and sets `$Global:StartOSDCloud.ImageFileDestination` to the selected cached image.
8. Watch the HTTP access log for `boot.ipxe`, `wimboot`, and `boot.wim`. A valid no-redownload run must not show active OS ESD/WIM `HEAD` or `GET`.
9. Watch `C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\status\progress.jsonl` for WinPE status events such as `winpe-start`, `smb-mounted`, `osdcloud-start`, `apply-image`, `osdcloud-finished`, and `rebooting`; use `latest-screenshot.json` / `<runId>.screenshots.jsonl` only as supporting visual evidence.
10. After WinPE finishes, it should post final status and reboot itself with `wpeutil reboot`; the laptop should then boot from the internal disk if PXE was selected through a one-time boot menu.
11. During first Windows boot, SetupComplete should post `windows-setupcomplete-start` and `windows-setupcomplete-finished`; after `davis` logs on, the SYSTEM desktop-ready scheduled task should post `windows-logon-start` and final `windows-desktop-ready`.
12. Verify the final state locally or by remote management, and inspect the OSDCloud log for empty `ImageFileUrl`, `ImageFileDestination = Z:\OSDCloud\OS\<selected image>`, `ImageFileDestination.PSDrive.DisplayRoot = \\<service-ip>\OSDCloudiPXE`, and `OSImageIndex` matching `selected-os.json`.

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

This timing evidence used the earlier isolated `192.168.100.0/24` lab. Current physical-network values are selected at runtime by the Web console and must be verified from live config before each physical run.

Post-deploy network lesson:

- If a deployed laptop has no internet and still shows a `192.168.100.x` address, first verify the intended gateway from Web/DHCP config is reachable and that the upstream DHCP server is still intentionally disabled only for the test window.
- Do not assume the client gateway from an older run. Before final physical validation, choose the intended client gateway deliberately and confirm working DNS such as `1.1.1.1` / `8.8.8.8`.
- If Start menu pins show gray placeholders after the first offline boot, refresh StartMenuExperienceHost / Explorer and rebuild the current user's icon cache after internet is available.

Failure triage:

- No HTTP `boot.ipxe`: debug UEFI PXE, TFTP, or first-stage iPXE.
- `boot.ipxe` / `boot.wim` appears but Windows is not applied to disk: debug WinPE startup, SMB mapping to `\\<service-ip>\OSDCloudiPXE`, `$Global:StartOSDCloud.ImageFileDestination`, and physical-network addressing.
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

Latest physical validation evidence:

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
ImageFileDestination            : Z:\OSDCloud\OS\<selected image>.esd
ImageFileDestinationDisplayRoot : \\<service-ip>\OSDCloudiPXE
OSImageIndex                    : <selected-os.json imageIndex>
```

The HTTP access log must show `boot.ipxe`, `wimboot`, and `boot.wim`, and must not show zh-TW ESD `HEAD` or `GET`. The laptop must not use USB or ISO media as the deployment source.

## Host Console Direction

The primary host-side entrypoint is now the Web/GUI console:

```powershell
npm run web
```

By default it listens on:

```text
http://127.0.0.1:8080
```

The host console code lives under:

```text
tools\osdcloud-tui
config\osdcloud-tui.json
```

Use the Web console for the active physical-laptop path unless the user explicitly requests lower-level helper scripts. Web owns the host-side DHCP responder, TFTP responder, HTTP media/status server, live status display, log tailing, and validation summary.

Current Web layout implementation and references:

- As of 2026-05-13, the local Web console layout originated from Google Stitch project `8339077576655082414`, but Stitch is now a historical/reference source only. Do not treat Google Stitch as the mandatory design authority for future Web console changes.
- The Stitch FINAL screen set (`FINAL - Operations Dashboard`, `FINAL - Endpoints & Profiles`, `FINAL - Endpoint Sync Progress`, profile modals, and `FINAL - Client Validation Evidence (Optimized)`) may be used as reference material when helpful, but local operator usability and the checked-in Web code are the source of truth.
- `tools\osdcloud-tui\web\index.html` currently keeps the Stitch-derived HTML/Tailwind utility structure, inline `tailwind-config`, Inter / JetBrains Mono fonts, Material Symbols, top nav, endpoint bar, dense cards, tables, dialogs, and validation evidence grouping. Desktop dashboard placement is finalized in local CSS with named grid areas rather than only the Tailwind 12-column classes. Future layout changes may evolve this structure directly when that produces a simpler or clearer operator workflow.
- `tools\osdcloud-tui\web\styles.css` owns the local fallback and interaction layer for dialog behavior, stateful live-rendered nodes, status badges, switches, no-network visual fallback, and practical layout fixes. Keep the styling consistent with the admin-console direction, but do not force it to remain a thin Stitch-only layer.
- `tools\osdcloud-tui\web\app.js` owns live data binding. It must fill the local DOM from `/api/state`, `/api/interfaces`, `/api/profiles`, and existing mutating API routes without hard-coding Stitch sample runs, fake logs, or fake profile rows.
- The Web console uses Tailwind CDN as a visual enhancement. The console must remain functionally usable if the CDN is unavailable; pixel matching against Stitch is not required.
- Current local Web behavior verified on 2026-05-17: the single Dashboard workbench renders Operations, endpoint summary, Endpoint Sync Progress, active profile, active OS image, service cards, Preflight Summary, Client Fleet, System Log, dialogs/drawers, and selected-run validation evidence from live API state. On desktop, `Preflight Summary` and `Client Fleet` span the Operations column plus the main column below the upper workbench; on narrow viewports, the layout remains stacked.
- Operations color semantics are part of the UI contract: `Run preflight` is a neutral diagnostic action, not a blue primary CTA; endpoint sync, deployment-profile `Set active` / `Edit active`, and OS image download/import are warning actions; DHCP/start-all/clear-status/delete actions are danger actions. OS images no longer have an independent `Set active` / `Republish` control — selection is driven by the active profile's `osImage` field. Use result colors only for state: ready/running green, blocked/error red, review/working yellow, stopped/idle/not-run neutral.
- Dashboard panels must stay usable with long preflight output: `Preflight Summary` should have its own scrollable/clamped content area and must not push Operations or `System Log` out of reach. Failed preflight rows should expose browser-native hover hints with `How to fix:` guidance; `selected manifest stale` should direct the operator to `Deployment Profiles` > re-`Set active` the current profile (or `Edit active` to pick a different OS image), which republishes `selected-os.json` together with the Apps payload. On narrow viewports, service cards should collapse to a single column so service action text does not truncate.
- `System Log` scroll behavior is part of the Web UI contract: if the operator is already at the bottom, new log renders should keep the panel at the bottom; if the operator has scrolled upward, refresh/new log renders must preserve the current scroll position for readability.
- `Select interface` / endpoint settings must open immediately and load `/api/interfaces` asynchronously inside the drawer. Show loading, refreshing, and inline error states in the drawer; do not block the drawer on Windows NIC enumeration.

Future host-console development priority:

- Build new operator-facing functionality in the Web/GUI.
- Put shared service behavior in `serviceController.js` or other shared modules before wiring the Web UI or headless automation.

Safety contract:

- Web layout changes may be planned directly in code, a lightweight local mockup, screenshots, or Google Stitch when it is useful. Google Stitch planning screens are optional, not required. For broad or high-risk UI redesigns, provide a concise plan or visual checkpoint for user review before heavy implementation.
- Text-only web UI copy changes may proceed directly when they do not change layout, navigation, screen structure, or component behavior.
- Start the Web console from elevated PowerShell when it will control services. The Web console is served by `tools\osdcloud-tui\src\webServer.js` and uses the shared `serviceController.js`.
- Web management config defaults to `web.host=127.0.0.1` and `web.port=8080`; if `config\osdcloud-tui.json` omits `web`, the defaults apply.
- Starting `npm run web`, opening the browser UI, and reading state/status/logs/validation must not modify `C:\OSDCloud`.
- Web mutating actions can modify live deployment state: endpoint sync can modify live `boot.ipxe`, WinPE endpoint files, `boot.wim`, SMB firewall, and `osdcloud-assets`; OS image cache can download/stage cached Windows images, import browser-uploaded ISO/ESD/WIM sources into cache, switch or republish the active image, publish `selected-os.json`, and update SMB image path; deployment profile publish can replace live `Media\OSDCloud\Apps`; clear status deletes configured status JSON/JSONL/screenshot metadata; service start/stop changes live network responders.
- Do not run Web console and headless services at the same time to control services. They are separate Node processes and can conflict on ports 67/69/80.
- Run preflight before starting services. Preflight validates that the service bind IP exists on any enabled IPv4 adapter.
- Use `Select service interface` when the service bind interface/IP must change. Opening the endpoint settings drawer is read-only and must not wait for `/api/interfaces`; applying a selected endpoint must list only enabled non-APIPA IPv4 interfaces, stop running HTTP/TFTP/DHCP services before applying a new endpoint, persist `config\osdcloud-tui.json`, recalculate DHCP lease pool / subnet mask / router for the selected prefix, update live PXE/WinPE endpoint files through `tools\Set-OsdCloudIpxeEndpoint.ps1`, update the SMB firewall, commit the endpoint into `boot.wim`, verify the published `boot.wim`, and refresh `osdcloud-assets`.
- While `Select service interface` is applying an endpoint, the Web console must show human-visible progress, stream sync script output into Logs, and automatically run preflight after the sync completes.
- After changing the selected service interface, preflight must fail if the DHCP lease range or router is outside the selected service IP prefix. Treat this as a stale/manual config guard; the Web selection path should update DHCP settings automatically.
- After changing the selected service interface, DHCP must not retain leases from the previous endpoint. If a physical client receives a `192.168.100.x` lease while services are running on `192.168.100.x`, treat it as stale in-memory DHCP lease state and restart on code that rebuilds the lease pool for the current `dhcp.leaseStartIp` / `dhcp.leaseEndIp`.
- DHCP reservations may pin known physical client MAC addresses to fixed IPs. Endpoint switching must drop reservations outside the newly selected service IP prefix; stale reservations from WAN or vSwitch subnets must not remain in `config\osdcloud-tui.json`.
- Do not start DHCP until the real LAN DHCP server is confirmed disabled for the test window.
- Do not add a Web `Configure physical NIC` action. If Windows adapter IP assignment must be changed, keep it as an explicit script step such as `tools\Set-IpxePhysicalNic.ps1`.
- Keep confirmation gates for DHCP/PXE service start/stop toggles and status-file deletion.
- The individual `Start HTTP/status`, `Start TFTP`, and `Start DHCP` actions are service toggles; when a service is running, the same action must become `Stop ...` and shut that service down.
- Stopped service cards must render as neutral status, not as failures. Only actual blocked/error states should use red status treatment.
- Web console must show multi-client deployment state as a fleet view, selected run details, validation evidence, and log tailing.
- Validation Evidence must read parsed status events for the selected run, preferring `<runId>.jsonl` over the global `progress.jsonl` tail. Missing evidence should be shown as `Not reported`; explicitly empty no-redownload fields such as `imageFileUrl` should be shown as `<empty>`.
- Deployment payload includes selected client app installation during Windows SetupComplete, with `windows-apps-start`, `windows-apps-finished`, and `windows-apps-error` status stages.
- Web `Profiles` > `Software Catalog` > `Add software` is the operator-facing path for adding a new optional client software package. It accepts one MSI/EXE upload, generates the software id server-side, writes repo `Softwares\<software-id>\`, generates or stores `install.ps1`, appends `config\software-catalog.json`, and returns installer size/SHA256 evidence. Operators do not type the software id. It must not stop services, publish live `Apps`, change active profile, sync endpoint, mount `boot.wim`, or touch `C:\OSDCloud`.
- Web deployment profile selection publishes profile-filtered client software payloads. Use `Select deployment profile` before starting services when the software set or install order changes; it must stop running HTTP/TFTP/DHCP services, write the active profile to `config\osdcloud-tui.json`, clear stale live `Apps` content, copy only selected software from `Softwares\<software-id>` in profile order, write `selected-profile.json`, and let preflight verify the live payload matches the active profile.
- Keep the normal `Default` profile on 7-Zip only unless the user deliberately selects a Chrome-enabled profile.
- Endpoint sync hash verification must tolerate host PowerShell sessions where `Get-FileHash` is unavailable by falling back to .NET SHA256 hashing.
- Deployment profile management supports `Add profile`, per-row `Edit` / `Set active` / `Delete`, and the `Edit active` / `Delete inactive` toolbar shortcuts. Add copies the current active profile software list and order but does not switch or publish. Edit preserves id/name/description/unknown fields unless explicitly changed and lets the operator reorder selected software per profile; editing the **active** profile then republishes live `Apps` and reruns preflight, while editing an **inactive** profile only rewrites that profile's JSON (services keep running, the live `Apps` payload is untouched) and the changes take effect the next time it is set active. Delete can only remove inactive profile JSON files.
- Deployment profile creation generates an 8-character uppercase alphanumeric profile id server-side, with at least one letter and one digit, and must avoid collisions with existing profile ids and JSON file names. Operators edit the profile name as display text; profile id remains the stable service key.
- Keep `GET /osdcloud/status` backward-compatible as the latest single status event, and use `GET /osdcloud/status/runs` plus `runs-index.json` for multi-run fleet status.
- Driver pack host-first cache is supported through `windows-driverpack-cache-request`: client Windows only reports `C:\Drivers\*.json` metadata, and the host console downloads official driver packs into `C:\OSDCloud\Win11-iPXE-Lab\Media\OSDCloud\DriverPacks`. Do not add a client-side custom downloader and do not grant deployed Windows write access to the SMB share.
- Driver pack cache safety rules: `fileName` must be a plain file name with no path separators or `..`; allowed extensions are `.exe`, `.cab`, `.zip`, and `.msi`; v1 allowed download host is `downloads.dell.com`; resolved destinations must remain under the cache root; never overwrite an existing non-empty cache file.
- `Clear status files` must also remove `runs-index.json`, `*.summary.json`, `*.latest.json`, `latest-screenshot.json`, `*.screenshots.jsonl`, and `status\screenshots\`.
- Do not rewrite WinPE OSDCloud/SetupComplete behavior for Web console work unless the user explicitly expands scope.

Validation contract:

- `npm test` must pass for host console code changes.
- `npm run smoke` must pass before handoff; it uses temporary roots and test ports and must not touch the live LAN or live `C:\OSDCloud`.
- Web console code changes must include controller/API tests that prove read-only state calls do not create or modify live status roots.
- Web layout or visual changes must also run `node --check tools/osdcloud-tui/web/app.js`, `node --test tools/osdcloud-tui/test/webUi.test.js`, and a read-only browser or HTTP verification of `http://127.0.0.1:8080/`. The read-only check may fetch `/`, `styles.css`, `app.js`, `/api/state`, `/api/interfaces`, and `/api/profiles`; it must not click service start/stop, endpoint sync, profile publish/delete, or clear-status actions unless the user explicitly authorizes live mutation.
- A live deployment remains the final hardware validation when host-console networking behavior changes.
- Deployment progress must include explicit run lifecycle records: `run-start`, `winpe-end`, `windows-start`, and final `run-end` on `windows-desktop-ready`.
- Client app installation should report `windows-apps-start` and `windows-apps-finished`; installer failures should report `windows-apps-error` and leave detailed logs under `C:\Windows\Temp\osdcloud-logs`.
- Software catalog onboarding changes must test safe software ids, plain MSI/EXE filenames, duplicate catalog/source rejection, upload staging cleanup, template and raw `install.ps1` creation, and that adding catalog software does not mutate active profile or publish live `Apps`.
- Deployment profile changes must test catalog/profile validation, profile add/edit/delete validation, safe publish roots, selected-only ordered payload publishing, empty profiles, `Install-Apps.ps1` selected-only / ordered / missing-selected-app behavior, that publishing a profile also republishes its `osImage` to `selected-os.json` / `smb.imagePath`, and that editing an inactive profile only rewrites its JSON without stopping services, republishing live `Apps`, or rerunning preflight.
- Multi-client host-console changes must include synthetic tests for at least two interleaved runs and must verify that one client does not overwrite another client's summary.
- Screenshot behavior must preserve the status contract: `/osdcloud/status` stays JSON-only, `/osdcloud/screenshot` accepts PNG-only uploads capped at 5 MB, and PNG files remain local evidence rather than Git artifacts.
- Driver pack cache changes must test validation failures, disallowed hosts, cache hits, download success/failure, and confirm status events still persist when cache backfill fails.
- OS image source/cache changes must test official/custom catalog merging, custom host allowlist and required SHA256, browser-uploaded ISO/ESD/WIM inspect/import, staging cleanup, cache-hit hash validation, removed host-path API behavior, and the delete guard that refuses to remove an OS image referenced by any deployment profile. OS images no longer carry a separate active flag; the active selection is derived from the active profile's `osImage` field, and download/import simply add a cached image that becomes available for any profile to bind to.
- If deployment behavior changes inside `C:\OSDCloud` or WinPE, update the live files first, mount/commit `boot.wim` when needed, then run `.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts`.

## VM VM Regression Notes

These notes are regression evidence only. Do not use VM for the active physical-laptop iPXE path. If the user explicitly asks for VM regression, use Generation 2 VMs with:

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
- Legacy host-side PXE helper scripts used PowerShell DHCP/TFTP plus Node HTTP. The Web/GUI console is now the host-side console; keep the legacy helper scripts as lower-level fallback. The Linux helper VM `PXE-Lab-Server-01` was not required for the successful validation.
- Use static memory for iPXE timing VMs. `Timing-04` failed in WinPE DISM apply when Dynamic Memory assigned only about 1.5GB even though startup memory was configured higher.
- Full iPXE deployment succeeded with PXE-stage Secure Boot temporarily off. Hard-disk boot was verified with Secure Boot `MicrosoftWindows` and vTPM.
- For VM first-stage TFTP, do not disable `.efi` OACK/options handling. VM can send paired RRQs where one transfer logs `OACK not acknowledged` and the other succeeds with `SENT snponly.efi`; success is confirmed by later HTTP `boot.ipxe`. If the VM stays at `Downloading NBP file...`, debug TFTP service state before changing WinPE or OSDCloud.
- After `osdcloud-finished`, do not force power off the VM. Let WinPE run `wpeutil reboot`; premature power-off can leave `Unattend.xml` or `SetupComplete.ps1` NUL-filled and cause Windows Setup unattend parse errors.
- `tools\osdcloud-tui\src\headless.js` starts the same HTTP/status, TFTP, and DHCP services without Web UI. Use it only for VM regression or automation, and stop the owning `node.exe` after the test so DHCP does not keep responding.
- Record VM runs under VM / VM regression documentation only. Keep VM names, vSwitch IPs, VHDX details, VMConnect screenshots, and PowerShell Direct results out of the physical-laptop runbook.
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

`README.md` is also the human user manual. When changing deployment flow, Web console behavior, service-interface selection, endpoint synchronization, network topology, validation criteria, or failure triage, update the `README.md` `使用手冊` section in the same change so a human operator can still run the workflow without reading `AGENTS.md` or the detailed test report.

For portability/setup changes, also update the README `新主機 Clone 後啟動流程`, `osdcloud-assets\README.md`, and the report's fresh-clone readiness note. The docs must make clear that the repo can live anywhere, but `C:\OSDCloud` must be restored or rebuilt before deployment because large runtime artifacts are excluded from Git.

## Git Workflow

Use Git to track docs and process definitions in this workspace.

After every code change, finish by updating the related documentation and Git state in the same workflow. Do not leave a code-only diff unless the user explicitly scoped the task to read-only inspection or a throwaway experiment. Update the applicable docs, such as `README.md`, `OSDCloud-Win11-Automated-Deployment-Test-Report.md`, `AGENTS.md`, `osdcloud-assets`, or feature-specific docs; run the relevant verification for the changed surface; and create a local commit whose staged set includes the code, docs, tests, and synchronized assets required by that change. Push only when the user explicitly requests it, the task is a handoff/release, or an existing repo rule requires it.

At the start of every new conversation in this workspace, before planning or editing, check for handoff context that may have been written by other agents:

```powershell
git status --short --branch
git log --all --notes --decorate --date=iso --max-count=10 --format=fuller
```

Treat the recent commit subjects, commit bodies, and Git notes as multi-agent handoff material. If any recent commit mentions active work, deployment state, failing validation, endpoint changes, dirty worktree expectations, or files that should not be touched, summarize that context before acting and keep it in the plan. If the task is narrow and the recent log is unrelated, say that no relevant handoff note was found.

Track these files by default:

```text
README.md
AGENTS.md
OSDCloud-Win11-Automated-Deployment-Test-Report.md
tools\Invoke-IpxeTimingRun.ps1
Deploy-DeploymentServer.cmd
tools\Initialize-DeploymentServer.ps1
tools\Export-DeploymentServerBundle.ps1
tools\Set-IpxePhysicalNic.ps1
tools\Set-OsdCloudIpxeEndpoint.ps1
tools\Sync-OsdCloudAssets.ps1
package.json
package-lock.json
config\osdcloud-tui.json
config\os-image-catalog.json
config\os-download-sources.json
config\software-catalog.json
config\deployment-profiles\...
Softwares\...
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
