# Versioned OSDCloud Assets

This folder is a Git-friendly mirror of the deployment files that actually live under `C:\OSDCloud`.

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

Refresh the mirror after changing anything under `C:\OSDCloud`:

```powershell
.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts
```

`-MountWinPe` mounts `C:\OSDCloud\Win11-iPXE-Lab\Media\sources\boot.wim` read-only, copies the current WinPE startup scripts and embedded `OSDCloud\Config\Scripts` into this folder, and unmounts the image with `/Discard`.

For iPXE, `Invoke-DavisOobe.ps1` copies SetupComplete from inside `boot.wim` first. If `WinPE\OSDCloud\Config\Scripts\SetupComplete` is stale, the deployed Windows can reach the desktop without reporting `windows-desktop-ready` back to the TUI.

The current iPXE `SetupComplete.ps1` installs the client app payload and the JSON desktop-ready reporter for Windows completion. It does not install a desktop screenshot Startup helper, because that path was blocked by Defender/AMSI as `ScriptContainedMaliciousContent`. The desktop-ready reporter retries every 5 seconds for up to 30 minutes from `windows-logon-start`; after a successful HTTP POST or WebClient fallback it must return success and unregister `OSDCloudDesktopReadyReport`.

The app payload is now profile-filtered by the TUI before deployment. The mirrored `Apps` folder includes `selected-profile.json`; `Install-Apps.ps1` reads it and installs only the selected software. The current `default` profile publishes 7-Zip from `Apps\7zip\7z2601-x64.msi`; `minimal` publishes no client software. App installation logs go to `C:\Windows\Temp\osdcloud-logs\apps-install.log` and per-app logs such as `7zip-msi.log` on the deployed client.

The files include lab-only credentials such as the local `davis` account and SMB `pxeinstall` account. Keep this repository private.
