# Agent Instructions

This workspace documents and validates a Windows 11 zero-touch deployment lab using VM and OSDCloud. Follow these instructions when continuing work here.

## Current Goal

The working target is a repeatable OSDCloud ISO that deploys Windows 11 Pro 25H2 zh-TW and boots directly to the `davis` desktop with no human interaction inside OOBE.

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

## Important Paths

OSDCloud workspace:

```text
C:\OSDCloud\Win11-Lab
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

## Critical Lessons

- Do not put OOBE injection in `Config\Scripts\StartNet`. OSDCloud runs StartNet scripts before Windows is deployed. This caused early reboot loops where the VHD stayed near `0.04GB`.
- OOBE injection belongs in `Config\Scripts\Shutdown`, after OSDCloud has applied Windows and before WinPE shuts down.
- Keep the Windows ESD cached under `Media\OSDCloud\OS`; otherwise each deployment downloads Windows from Microsoft again.
- The ISO should set `LaunchUserOOBE=0`, `SkipMachineOOBE=1`, `SkipUserOOBE=1`, and `NoAutoUpdate=1` to avoid the first-boot OOBE update screen.
- `wuauserv` may later show as Running even with `NoAutoUpdate=1`; this is not by itself a failure. Failure is seeing `CloudExperienceHost`, `msoobe`, or an OOBE update screen after the desktop should be ready.

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

## Documentation

When behavior changes, update:

```text
README.md
OSDCloud-Win11-Automated-Deployment-Test-Report.md
AGENTS.md
```

Keep `README.md` concise and user-facing. Keep the report detailed and evidence-oriented. Keep `AGENTS.md` as the operational contract for future agents.

## Git Workflow

Use Git to track docs and process definitions in this workspace.

Track these files by default:

```text
README.md
AGENTS.md
OSDCloud-Win11-Automated-Deployment-Test-Report.md
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
