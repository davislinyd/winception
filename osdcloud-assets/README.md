# Versioned OSDCloud Assets

This folder is a Git-friendly mirror of the deployment files that actually live under `C:\OSDCloud`.

It is not a complete runnable backup. A fresh clone first runs the lightweight setup wizard, then uses Web Runtime Readiness / Prepare runtime to rebuild the live `C:\OSDCloud` tree before PXE deployment can start.

The live lab still runs from:

```text
C:\OSDCloud\Win11-iPXE-Lab
```

`C:\OSDCloud\Win11-Lab` and the old ISO boot path are retired historical evidence. They are not restored by fresh-host setup or runtime preparation and are not required for the active physical-laptop iPXE deployment path.

The repo tracks the small source/config files that define deployment behavior:

- iPXE OOBE injection scripts under `Win11-iPXE-Lab\Config\Scripts`
- iPXE client app scripts and selected profile metadata under `Win11-iPXE-Lab\Media\OSDCloud\Apps`
- PXE helper scripts under `Win11-iPXE-Lab\Tools`
- iPXE boot script under `Win11-iPXE-Lab\PXE-HttpRoot\osdcloud\boot.ipxe`
- Disabled TFTP `autoexec.ipxe` files that document the currently bypassed chain path
- WinPE startup files extracted from `boot.wim`:
  - `Win11-iPXE-Lab\WinPE\Windows\System32\Startnet.cmd`
  - `Win11-iPXE-Lab\WinPE\OSDCloud\Start-OSDCloud-iPXE.ps1`
  - `Win11-iPXE-Lab\WinPE\OSDCloud\Report-OSDCloudProgress.ps1`
  - `Win11-iPXE-Lab\WinPE\OSDCloud\Config\Scripts\...`

Large generated or upstream binary artifacts are not committed:

- ISO / WIM / ESD / VHDX
- client app installer payloads such as MSI / EXE files
- Windows boot binaries such as `bootmgr`, `bootx64.efi`, `BCD`, and `boot.sdi`
- iPXE / shim / wimboot binaries
- timing logs, transcripts, and screenshots

Runtime downloads and generated artifacts are recorded in `config\runtime-artifacts.json` with source, target, size, SHA-256, and required/optional status. `manifest.json` remains a snapshot of mirrored small files plus generated/excluded boot and OS evidence.

## Using This Mirror On A New Host

After cloning the repo on another Windows host, run the lightweight setup wizard:

```powershell
.\Setup-DeploymentServer.cmd
```

Setup installs the Node dependencies, runs the lightweight smoke check, captures local secrets, records the intended service endpoint in ignored local overlay state, creates the minimum `C:\OSDCloud` directory skeleton, and starts the Web console. It does not download cataloged installers, iPXE binaries, OS image artifacts, ADK/WinPE content, or `wimboot`; it also does not sync the endpoint, run server preflight, or start DHCP/TFTP/HTTP deployment services.

In the Web console, use `Runtime Readiness` > `Prepare runtime` to restore this mirror, download cataloged installers/iPXE binaries/OS image artifacts through `.downloads` staging, verify size and SHA-256, and rebuild or publish WinPE boot files. After runtime readiness is ready, select/sync the service endpoint and run preflight before manually starting services.

`-ArtifactBundle` remains a legacy fallback for offline or bit-for-bit restore only. It is not the formal handoff path.

1. Rebuild the live runtime folder:

```text
C:\OSDCloud\Win11-iPXE-Lab
```

2. Copy versioned scripts/config from this mirror only after the live folder exists. The mirror can repopulate the small deployment logic files, but it does not contain the large boot and OS artifacts.

3. Download or regenerate every required `config\runtime-artifacts.json` entry that is needed for the selected path. For physical iPXE deployment this includes at least:

```text
C:\OSDCloud\Win11-iPXE-Lab\Media\sources\boot.wim
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\osdcloud\boot.wim
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\osdcloud\wimboot
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\osdcloud\bootmgr
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\osdcloud\bootx64.efi
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\osdcloud\BCD
C:\OSDCloud\Win11-iPXE-Lab\PXE-HttpRoot\osdcloud\boot.sdi
C:\OSDCloud\Win11-iPXE-Lab\PXE-TFTP\ipxeboot\x86_64-sb\snponly.efi
C:\OSDCloud\Win11-iPXE-Lab\Media\OSDCloud\OS\<active-image>.esd
```

4. Start the repo Web console with `npm run web`, then use `Select service interface` before physical deployment. The committed config may reflect the last synced lab endpoint, including a VM regression endpoint, so it must not be treated as a new host default.

5. Run preflight. If OS image preflight fails because the active image file is missing and the OSD catalog download could not resolve it automatically, use Web `OS Image Cache` to download/import the image on the host, then republish the profile-bound OS image. If the active image is already correct but preflight reports `selected manifest stale`, use `Deployment Profiles` > re-`Set active` current profile or `Edit active` to republish `selected-os.json` and refresh the SMB image path.

The `assetsRoot` value inside `manifest.json` is the source machine path used when the mirror was generated. It is evidence, not a required clone path.

Refresh the mirror after changing anything under `C:\OSDCloud`:

```powershell
.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts
```

`-MountWinPe` mounts `C:\OSDCloud\Win11-iPXE-Lab\Media\sources\boot.wim` read-only, copies the current WinPE startup scripts and embedded `OSDCloud\Config\Scripts` into this folder, and unmounts the image with `/Discard`.

For iPXE, `Invoke-DavisOobe.ps1` copies SetupComplete from inside `boot.wim` first. If `WinPE\OSDCloud\Config\Scripts\SetupComplete` is stale, the deployed Windows can reach the desktop without reporting `windows-desktop-ready` back to the Web console.

The current iPXE `SetupComplete.ps1` installs the client app payload and the JSON desktop-ready reporter for Windows completion. It does not install a desktop screenshot Startup helper, because that path was blocked by Defender/AMSI as `ScriptContainedMaliciousContent`. The desktop-ready reporter retries every 5 seconds for up to 30 minutes from `windows-logon-start`; after a successful HTTP POST or WebClient fallback it must return success and unregister `OSDCloudDesktopReadyReport`.

The app payload is profile-filtered by the Web console before deployment. The mirrored `Apps` folder includes `selected-profile.json` and install scripts, but not MSI/EXE installer payloads. `Install-Apps.ps1` reads the selected profile and installs only the selected software after Web runtime preparation has downloaded the cataloged installers into live `Apps`. The current `Default` profile publishes 7-Zip; `All in One` publishes 7-Zip plus Google Chrome Enterprise and Notepad++; `Minimal` publishes no client software. App installation logs go to `C:\Windows\Temp\osdcloud-logs\apps-install.log` and per-app logs such as `7zip-msi.log` and `google-chrome-msi.log` on the deployed client.

The files name the lab-only accounts such as local `davis` and SMB `pxeinstall`, but real passwords must stay outside Git. Keep `config\osdcloud-secrets.json` local, ignored, and inject it into live `boot.wim` during endpoint sync.
