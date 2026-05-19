# Versioned OSDCloud Assets

This folder is a Git-friendly mirror of the deployment files that actually live under `C:\OSDCloud`.

It is not a complete runnable backup. A fresh clone still needs a restored or rebuilt live `C:\OSDCloud` tree before PXE deployment can start.

The live lab still runs from:

```text
C:\OSDCloud\Win11-Lab
C:\OSDCloud\Win11-iPXE-Lab
```

The repo tracks the small source/config files that define deployment behavior:

- ISO OOBE injection scripts under `Win11-Lab\Config\Scripts`
- iPXE OOBE injection scripts under `Win11-iPXE-Lab\Config\Scripts`
- iPXE client app payload under `Win11-iPXE-Lab\Media\OSDCloud\Apps`
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
- Windows boot binaries such as `bootmgr`, `bootx64.efi`, `BCD`, and `boot.sdi`
- iPXE / shim / wimboot binaries
- timing logs, transcripts, and screenshots

Those excluded files are recorded in `manifest.json` with path, size, timestamp, and SHA-256 when `-HashLargeArtifacts` is used.

## Using This Mirror On A New Host

After cloning the repo on another Windows host:

The preferred path is to export a deployment-server bundle from a verified host:

```powershell
.\tools\Export-DeploymentServerBundle.ps1 -Force -CreateZip
```

Move either `deployment-server-bundle` or `deployment-server-bundle.deployment-server.zip` to the new host's repo root, then run:

```powershell
.\tools\Initialize-DeploymentServer.ps1 -ArtifactBundle '.\deployment-server-bundle'
```

The initializer restores this mirror plus the excluded artifacts into `C:\OSDCloud`, verifies size and SHA-256, syncs the selected endpoint, runs server preflight, and starts the Web console. It does not start DHCP/TFTP/HTTP deployment services.

1. Restore or rebuild the live runtime folders:

```text
C:\OSDCloud\Win11-Lab
C:\OSDCloud\Win11-iPXE-Lab
```

2. Copy versioned scripts/config from this mirror only after the live folders exist. The mirror can repopulate the small deployment logic files, but it does not contain the large boot and OS artifacts.

3. Restore or regenerate every required `manifest.json` `excludedArtifacts` entry that is needed for the selected path. For physical iPXE deployment this includes at least:

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

5. Run preflight. If OS image preflight fails because the active image file is missing, use Web `OS Image Cache` to download/import the image on the host and then `Set active`. If the active image is already correct but preflight reports `selected manifest stale`, use the active row `Republish` action to rewrite `selected-os.json` and refresh the SMB image path.

The `assetsRoot` value inside `manifest.json` is the source machine path used when the mirror was generated. It is evidence, not a required clone path.

Refresh the mirror after changing anything under `C:\OSDCloud`:

```powershell
.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts
```

`-MountWinPe` mounts `C:\OSDCloud\Win11-iPXE-Lab\Media\sources\boot.wim` read-only, copies the current WinPE startup scripts and embedded `OSDCloud\Config\Scripts` into this folder, and unmounts the image with `/Discard`.

For iPXE, `Invoke-DavisOobe.ps1` copies SetupComplete from inside `boot.wim` first. If `WinPE\OSDCloud\Config\Scripts\SetupComplete` is stale, the deployed Windows can reach the desktop without reporting `windows-desktop-ready` back to the Web console.

The current iPXE `SetupComplete.ps1` installs the client app payload and the JSON desktop-ready reporter for Windows completion. It does not install a desktop screenshot Startup helper, because that path was blocked by Defender/AMSI as `ScriptContainedMaliciousContent`. The desktop-ready reporter retries every 5 seconds for up to 30 minutes from `windows-logon-start`; after a successful HTTP POST or WebClient fallback it must return success and unregister `OSDCloudDesktopReadyReport`.

The app payload is now profile-filtered by the Web console before deployment. The mirrored `Apps` folder includes `selected-profile.json`; `Install-Apps.ps1` reads it and installs only the selected software. The current `Default` profile publishes 7-Zip from `Apps\7zip\7z2601-x64.msi`; `All in One` publishes 7-Zip plus Google Chrome Enterprise from `Apps\chrome\googlechromestandaloneenterprise64.msi`; `Minimal` publishes no client software. App installation logs go to `C:\Windows\Temp\osdcloud-logs\apps-install.log` and per-app logs such as `7zip-msi.log` and `google-chrome-msi.log` on the deployed client.

The files include lab-only credentials such as the local `davis` account and SMB `pxeinstall` account. Keep this repository private.
