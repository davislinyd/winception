# Versioned OSDCloud Assets

This folder is a Git-friendly mirror of the small deployment files that actually live under `C:\OSDCloud`.

It is not a complete runnable backup. A fresh clone first runs the lightweight setup wizard, then uses Web `Runtime Readiness` / `Prepare runtime` to rebuild the live `C:\OSDCloud` tree before PXE deployment can start. This mirror is one source used during that rebuild; it is not a replacement for the runtime artifact catalog, ADK/WinPE build output, downloaded OS image, or installer payload cache.

The live lab still runs from:

```text
C:\OSDCloud
```

`C:\OSDCloud\Win11-Lab` and the old ISO boot path are retired historical evidence. They are not restored by fresh-host setup or runtime preparation and are not required for the active physical-laptop iPXE deployment path.

The repo tracks the small source/config files that define deployment behavior:

- iPXE OOBE injection scripts under `OSDCloud\Config\Scripts`
- iPXE client app scripts under `OSDCloud\Media\OSDCloud\Apps`
- PXE helper scripts under `OSDCloud\Tools`
- iPXE boot script under `OSDCloud\PXE-HttpRoot\osdcloud\boot.ipxe`
- Disabled TFTP `autoexec.ipxe` files that document the currently bypassed chain path
- WinPE startup files extracted from `boot.wim`:
  - `OSDCloud\WinPE\Windows\System32\Startnet.cmd`
  - `OSDCloud\WinPE\OSDCloud\Start-OSDCloud-iPXE.ps1`
  - `OSDCloud\WinPE\OSDCloud\Report-OSDCloudProgress.ps1`
  - `OSDCloud\WinPE\OSDCloud\Config\Scripts\...`

Large generated or upstream binary artifacts are not committed and must be downloaded, verified, or rebuilt by Web `Prepare runtime`:

- ISO / WIM / ESD / VHDX, including source OS images and Web-exported deployable Windows WIMs
- WinPE `boot.wim`, both the source copy and the published HTTP copy
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

Setup can ask to install Node.js LTS when `node`/`npm` are missing, installs Node dependencies, runs the lightweight smoke check, and starts the Web console. It does not capture deployment secrets, record endpoint overlay state, create the `C:\OSDCloud` runtime skeleton, create SMB accounts/shares, download cataloged installers, export OS image artifacts, build ADK/WinPE content, create `boot.wim`, or download `wimboot`; it also does not sync the endpoint, run server preflight, or start DHCP/TFTP/HTTP deployment services.

In the Web console, use `Runtime Readiness` > `Prepare runtime` to create the flat `C:\OSDCloud` structure, prepare `pxeinstall` / `OSDCloudiPXE`, restore this mirror, download cataloged installers/iPXE binaries through `.downloads` staging, verify size and SHA-256, and rebuild or publish WinPE boot files. If this action starts from the Initialization Wizard, the wizard remains open and shows the operation status, a scrollable full operation log with a copy button, and completed/failed result; from the main Runtime Readiness card, use the operation badge and System Log for the same backend operation. `boot.wim` is required because iPXE loads it over HTTP to enter WinPE, and that WinPE contains the OSDCloud startup scripts, SMB mapping, status callback, SetupComplete handoff, and local secret injection used by the deployment. A readiness `size-mismatch` for `boot.wim` means the file is incomplete or out of sync with the catalog, not that deployment services have been started.

OS images are prepared separately in Web `OS Image Cache`: download or import ISO/ESD/WIM, inspect DISM indexes, choose one index, export it to one deployable WIM under `C:\OSDCloud\Media\OSDCloud\OS`, then publish `selected-os.json`. Fresh clone can have no active OS image and no selected manifest until the operator completes that flow.

After runtime readiness is ready, select/sync the service endpoint and run preflight before manually starting services.

`-ArtifactBundle` remains a legacy fallback for offline or bit-for-bit restore only. It is not the formal handoff path.

1. Rebuild the live runtime folder:

```text
C:\OSDCloud
```

2. Copy versioned scripts/config from this mirror only after the live folder exists. The mirror can repopulate the small deployment logic files, but it does not contain the large boot and OS artifacts.

3. Download or regenerate every required `config\runtime-artifacts.json` entry that is needed for the selected path. For physical iPXE deployment this includes at least:

```text
C:\OSDCloud\Media\sources\boot.wim
C:\OSDCloud\PXE-HttpRoot\osdcloud\boot.wim
C:\OSDCloud\PXE-HttpRoot\osdcloud\wimboot
C:\OSDCloud\PXE-HttpRoot\osdcloud\bootmgr
C:\OSDCloud\PXE-HttpRoot\osdcloud\bootx64.efi
C:\OSDCloud\PXE-HttpRoot\osdcloud\BCD
C:\OSDCloud\PXE-HttpRoot\osdcloud\boot.sdi
C:\OSDCloud\PXE-TFTP\ipxeboot\x86_64-sb\snponly.efi
C:\OSDCloud\Media\OSDCloud\OS\<selected-image>.wim
```

The two `boot.wim` paths are both required: `Media\sources\boot.wim` is the source WinPE image that endpoint sync can mount/update, and `PXE-HttpRoot\osdcloud\boot.wim` is the published file that iPXE downloads. They may be hardlinks or separate files depending on the rebuild path, but readiness and preflight must be able to find a valid image for both roles.

4. Start the repo Web console with `npm run web`, then use `Select service interface` before physical deployment. The committed config may reflect the last synced lab endpoint, including a VM regression endpoint, so it must not be treated as a new host default.

5. Run preflight. If OS image preflight fails because no deployable WIM or `selected-os.json` exists, use Web `OS Image Cache` to download/import a source image, select the source index, export a WIM on the host, then publish the profile-bound OS image. If the selected image is already correct but preflight reports `selected manifest stale`, use `Deployment Profiles` > re-`Set active` current profile or `Edit active` to republish `selected-os.json` and refresh the SMB image path.

The `assetsRoot` value inside `manifest.json` is the source machine path used when the mirror was generated. It is evidence, not a required clone path.

Refresh the mirror after changing anything under `C:\OSDCloud`:

```powershell
.\tools\Sync-OsdCloudAssets.ps1 -MountWinPe -HashLargeArtifacts
```

`-MountWinPe` mounts `C:\OSDCloud\Media\sources\boot.wim` read-only, copies the current WinPE startup scripts and embedded `OSDCloud\Config\Scripts` into this folder, and unmounts the image with `/Discard`.

For iPXE, `Invoke-DavisOobe.ps1` copies SetupComplete from inside `boot.wim` first. If `WinPE\OSDCloud\Config\Scripts\SetupComplete` is stale, the deployed Windows can reach the desktop without reporting `windows-desktop-ready` back to the Web console.

The current iPXE `SetupComplete.ps1` installs the client app payload and the JSON desktop-ready reporter for Windows completion. It does not install a desktop screenshot Startup helper, because that path was blocked by Defender/AMSI as `ScriptContainedMaliciousContent`. The desktop-ready reporter retries every 5 seconds for up to 30 minutes from `windows-logon-start`; after a successful HTTP POST or WebClient fallback it must return success and unregister `OSDCloudDesktopReadyReport`.

The app payload is profile-filtered by the Web console before deployment. The mirrored `Apps` folder includes install scripts, but not generated `selected-profile.json` or MSI/EXE installer payloads. `Install-Apps.ps1` reads the selected profile published into the live runtime and installs only the selected software after Web runtime preparation has downloaded the cataloged installers into live `Apps`. The current `Default` profile publishes 7-Zip; `All in One` publishes 7-Zip plus Google Chrome Enterprise and Notepad++; `Minimal` publishes no client software. App installation logs go to `C:\Windows\Temp\osdcloud-logs\apps-install.log` and per-app logs such as `7zip-msi.log` and `google-chrome-msi.log` on the deployed client.

The files name the lab-only accounts such as local `davis` and SMB `pxeinstall`, but real passwords must stay outside Git. Prefer the Web initialization wizard to write the ignored `config\osdcloud-secrets.json`; API responses and logs must report only redacted presence/missing status. Endpoint sync injects the local secret file into live `boot.wim`.
