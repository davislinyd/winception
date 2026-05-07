# Agent Instructions

This workspace documents and validates a Windows 11 zero-touch deployment lab using VM and OSDCloud. Follow these instructions when continuing work here.

## Current Goal

The working target is a repeatable OSDCloud deployment flow that deploys Windows 11 Pro 25H2 zh-TW and boots directly to the `davis` desktop with no human interaction inside OOBE.

Two paths are now validated:

- ISO path: VM VM boots from `C:\OSDCloud\Win11-Lab\OSDCloud_NoPrompt.iso`
- iPXE path: VM VM boots from PXE/iPXE, loads WinPE over HTTP, and applies the Windows ESD directly from a host SMB share

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
```

iPXE SMB image source:

```text
Share: \\192.168.100.1\OSDCloudiPXE
Path : \\192.168.100.1\OSDCloudiPXE\OSDCloud\OS\26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_x64FRE_zh-tw.esd
User : pxeinstall
Mode : read-only SMB, firewall limited to 192.168.100.0/24 on local address 192.168.100.1
```

## Critical Lessons

- Do not put OOBE injection in `Config\Scripts\StartNet`. OSDCloud runs StartNet scripts before Windows is deployed. This caused early reboot loops where the VHD stayed near `0.04GB`.
- OOBE injection belongs in `Config\Scripts\Shutdown`, after OSDCloud has applied Windows and before WinPE shuts down.
- Keep the Windows ESD cached under `Media\OSDCloud\OS`; otherwise each deployment downloads Windows from Microsoft again.
- The ISO should set `LaunchUserOOBE=0`, `SkipMachineOOBE=1`, `SkipUserOOBE=1`, and `NoAutoUpdate=1` to avoid the first-boot OOBE update screen.
- `wuauserv` may later show as Running even with `NoAutoUpdate=1`; this is not by itself a failure. Failure is seeing `CloudExperienceHost`, `msoobe`, or an OOBE update screen after the desktop should be ready.
- For iPXE custom image deployment, do not combine `-ImageFileUrl` / `-OSImageIndex` with `-OSName`, `-OSLanguage`, `-OSEdition`, or `-OSActivation`. `Start-OSDCloud` treats custom image as a separate parameter set.
- For iPXE no-redownload deployment, do not use `-ImageFileUrl`. It always triggers OSDCloud's `Download Operating System` step and copies the ESD into WinPE. The current WinPE maps `\\192.168.100.1\OSDCloudiPXE` as `Z:`, sets `$Global:StartOSDCloud.ImageFileDestination` to the ESD `FileInfo`, sets `OSImageIndex=6`, then calls `Invoke-OSDCloud`.
- For the isolated `PXE-Lab` switch, remove or bypass `Initialize-OSDCloudStartnetUpdate` in the iPXE WinPE. It tries external PowerShell Gallery / Microsoft update endpoints and can stall before `Start-OSDCloud`.
- For iPXE WinPE, `Invoke-DavisOobe.ps1` must first look for SetupComplete scripts at `$PSScriptRoot\..\SetupComplete`, then fall back to scanning non-`C:` / non-`X:` drives. iPXE loads only `boot.wim`; it does not provide the ISO media path.
- The working iPXE `boot.ipxe` explicitly loads `wimboot`, `bootmgr`, `bootx64.efi`, `BCD`, `boot.sdi`, and `boot.wim` over HTTP.
- The working DHCP path returns `snponly.efi` for UEFI PXE first stage and returns `http://192.168.100.1/osdcloud/boot.ipxe` once the client identifies as iPXE. Keep `autoexec.ipxe` disabled unless you intentionally retest the TFTP script path.
- VM blocks changing the Secure Boot template after vTPM initialization. If a VM was initialized with the PXE template and must hard-boot Windows with `MicrosoftWindows`, preserve the VHDX and recreate the VM configuration before enabling vTPM.
- The live deployment files are under `C:\OSDCloud`, not only in this repo. After changing deployment behavior, run `.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts` so `osdcloud-assets` contains the current scripts, WinPE startup files, and large-artifact manifest before committing.

## iPXE Runbook

Use this runbook for the network-install validation path. The goal is to prove that the VM can deploy without an attached ISO/DVD, with WinPE served over HTTP and the Windows ESD applied directly from the lab SMB share.

Expected host network:

```text
Switch: PXE-Lab
Host vEthernet: 192.168.100.1/24
PXE client: 192.168.100.100
HTTP base: http://192.168.100.1/osdcloud
SMB image share: \\192.168.100.1\OSDCloudiPXE
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

Run sequence:

1. Confirm `PXE-Lab` exists and the host vEthernet has `192.168.100.1/24`.
2. Start the host-side PXE helpers: DHCP/TFTP for first-stage boot and HTTP for OSDCloud content.
3. Keep the working unsigned PXE path on `snponly.efi` unless the task is specifically to retest signed shim Secure Boot.
4. Confirm DHCP returns `snponly.efi` for UEFI PXE and returns `http://192.168.100.1/osdcloud/boot.ipxe` after the client identifies as iPXE.
5. Confirm the iPXE WinPE maps `\\192.168.100.1\OSDCloudiPXE` to `Z:` and sets `$Global:StartOSDCloud.ImageFileDestination` to `Z:\OSDCloud\OS\...zh-tw.esd`.
6. Confirm `Initialize-OSDCloudStartnetUpdate` is bypassed for the isolated switch.
7. Boot `OSDCloud-Win11-iPXE-01` from the PXE NIC with no ISO/DVD attached.
8. Watch the HTTP access log for `boot.ipxe`, `wimboot`, and `boot.wim`. A valid no-redownload run must not show zh-TW ESD `HEAD` or `GET`.
9. After WinPE shuts down, confirm the VHDX grew well beyond the initial near-empty size.
10. Switch the VM to hard-disk boot. If VM blocks Secure Boot template changes because vTPM was initialized, preserve the VHDX and recreate the VM configuration before enabling vTPM.
11. Boot Windows from the VHD with Secure Boot template `MicrosoftWindows`.
12. Verify the final state with PowerShell Direct and inspect the OSDCloud log for empty `ImageFileUrl`, `ImageFileDestination = Z:\OSDCloud\OS\...zh-tw.esd`, `ImageFileDestination.PSDrive.DisplayRoot = \\192.168.100.1\OSDCloudiPXE`, and `OSImageIndex : 6`.

For unattended timing runs, use the repo script instead of driving the VM manually:

```powershell
.\tools\Invoke-IpxeTimingRun.ps1 -VmName OSDCloud-Win11-iPXE-Timing-XX
```

Timing run contract:

- After the script starts the VM, do not use VMConnect or manually change VM settings.
- The script may record host state, HTTP/DHCP/TFTP logs, VM state, VHDX size, and PowerShell Direct validation.
- The script is responsible for the automated transition from WinPE shutdown to VHD boot with Secure Boot `MicrosoftWindows` and vTPM.
- iPXE timing VMs should use 8GB static memory with Dynamic Memory disabled. 6GB with Dynamic Memory can starve WinPE during DISM apply.
- For normal desktop-validation runs, keep `-PostDeploySwitchName ''` so the installed Windows VM remains on `PXE-Lab`.
- `PXE-Lab` should have host NAT named `PXE-Lab-NAT` for `192.168.100.0/24`, with host vEthernet `192.168.100.1/24`.
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

Post-deploy network lesson:

- If a deployed VM has no internet and still shows `192.168.100.x`, first verify `Get-NetNat -Name PXE-Lab-NAT` and `Ethernet` = `192.168.100.1/24`.
- The guest should use `192.168.100.1` as gateway and working DNS such as `1.1.1.1` / `8.8.8.8`.
- If Start menu pins show gray placeholders after the first offline boot, refresh StartMenuExperienceHost / Explorer and rebuild the current user's icon cache after internet is available.

Failure triage:

- No HTTP `boot.ipxe`: debug UEFI PXE, TFTP, or first-stage iPXE.
- `boot.ipxe` / `boot.wim` appears but the VHDX does not grow: debug WinPE startup, SMB mapping to `\\192.168.100.1\OSDCloudiPXE`, `$Global:StartOSDCloud.ImageFileDestination`, and isolated-switch addressing.
- `Start-OSDCloud` returns to `X:\>` immediately: check for mixed parameter sets.
- `Expand-WindowsImage failed` with `Insufficient memory`: check VM memory assignment. Use 8GB static memory and disable Dynamic Memory for iPXE timing/deployment runs.
- VHDX stays around `0.04GB`: Windows was not applied.
- VHDX grows and VM shuts down but first boot stops in OOBE: inspect `Invoke-DavisOobe.ps1`, SetupComplete injection, `CloudExperienceHost` / `msoobe`, and OOBE registry values.

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

A valid end-to-end VM test must not require clicking or typing inside VMConnect.

Allowed host-side automation:

- Create VM
- Attach ISO
- Boot from ISO
- Wait for WinPE to shut down after deployment
- Change first boot device to the VHD
- Remove DVD drive or ISO
- Start VM
- Verify with PowerShell Direct

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
```

Also verify the OSDCloud log from the deployed VHD:

```text
ImageFileSource : D:\OSDCloud\OS\...zh-tw.esd
ImageFileUrl    :
```

For the iPXE path, also verify:

```text
ImageFileUrl                    : <empty>
ImageFileDestination            : Z:\OSDCloud\OS\...zh-tw.esd
ImageFileDestinationDisplayRoot : \\192.168.100.1\OSDCloudiPXE
OSImageIndex                    : 6
```

The HTTP access log must show `boot.ipxe`, `wimboot`, and `boot.wim`, and must not show zh-TW ESD `HEAD` or `GET`. The VM must not have a DVD drive or ISO attached as the deployment source.

## VM Notes

Use Generation 2 VMs with:

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

iPXE VM notes:

- Use internal switch `PXE-Lab` with host vEthernet `192.168.100.1/24`.
- The current host-side PXE helper uses PowerShell DHCP/TFTP plus Node HTTP. The Linux helper VM `PXE-Lab-Server-01` was not required for the successful validation.
- Use static memory for iPXE timing VMs. `Timing-04` failed in WinPE DISM apply when Dynamic Memory assigned only about 1.5GB even though startup memory was configured higher.
- Full iPXE deployment succeeded with PXE-stage Secure Boot temporarily off. Hard-disk boot was verified with Secure Boot `MicrosoftWindows` and vTPM.
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
tools\Sync-OsdCloudAssets.ps1
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
